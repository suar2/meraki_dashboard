import { TopologyGraph, TopologyLink, TopologyNode } from "../types/topology";
import { classifyNode, NodeLayer, resolveDisplayLabel } from "./classify";

export interface HierarchyNode {
  id: string;
  layer: NodeLayer;
  displayLabel: string;
  rawNode: TopologyNode;
  // client group fields
  isGroup: boolean;
  groupCount: number;
  groupParentId: string | null;
  groupType: "wifi" | "lan" | null;
  groupMembers: TopologyNode[];
  // port node fields (layer === "PORT")
  portId?: string;
  portConfig?: Record<string, unknown>;
  portStatus?: Record<string, unknown>;
}

export interface HierarchyEdge {
  id: string;
  source: string;
  target: string;
  linkType: "wired" | "wireless" | "wan" | "discovered_partial";
  hasIssue: boolean;
  health: string;
  rawLink: TopologyLink | null;
  edgeLabel?: string;
}

export interface HierarchyGraph {
  nodes: HierarchyNode[];
  edges: HierarchyEdge[];
}

const UNMAPPED_GROUP_ID = "__group_unmapped_devices";
const SYNTHETIC_WAN_ID = "__synthetic_wan";

function buildCoreIds(graph: TopologyGraph): Set<string> {
  const firewallIds = new Set<string>();
  for (const n of graph.nodes) {
    const sub = (n.subtype || "").toLowerCase();
    const model = String(n.metadata?.model || n.metadata?.productType || "").toLowerCase();
    if (sub === "firewall" || model.startsWith("mx")) firewallIds.add(n.id);
  }

  const coreIds = new Set<string>();
  for (const link of graph.links) {
    if (firewallIds.has(link.source)) {
      coreIds.add(link.target);
    } else if (firewallIds.has(link.target)) {
      coreIds.add(link.source);
    }
  }
  return coreIds;
}

function makeGroupId(parentId: string, type: "wifi" | "lan"): string {
  return `__group_${type}_${parentId}`;
}

function makePortNodeId(switchId: string, portId: string): string {
  return `__port_${switchId}_${portId}`;
}

/** Build a port label like "Port 14 · trunk · VLAN 1 · 10G" */
function portLabel(portId: string, cfg: Record<string, unknown>, sta: Record<string, unknown>): string {
  const parts: string[] = [`Port ${portId}`];
  const mode = String(cfg.type || "").toLowerCase();
  if (mode) parts.push(mode);
  const vlan = cfg.vlan ?? cfg.nativeVlan;
  if (vlan !== undefined && vlan !== null) parts.push(`VLAN ${vlan}`);
  const speed = String(sta.speed || "").replace(/\s/g, "");
  if (speed) parts.push(speed);
  return parts.join(" · ");
}

export function buildHierarchy(
  graph: TopologyGraph,
  expandedGroups: Set<string>,
  viewMode: "physical" | "logical" | "client"
): HierarchyGraph {
  const coreIds = buildCoreIds(graph);

  const classMap = new Map<string, NodeLayer>();
  for (const n of graph.nodes) {
    classMap.set(n.id, classifyNode(n, coreIds));
  }

  const infraNodes = graph.nodes.filter((n) => classMap.get(n.id) !== "CLIENT");
  const clientNodes = graph.nodes.filter((n) => classMap.get(n.id) === "CLIENT");

  const clientsByParent = new Map<string, { wifi: TopologyNode[]; lan: TopologyNode[] }>();

  for (const client of clientNodes) {
    for (const link of graph.links) {
      let parentId: string | null = null;
      const isWireless = link.link_type === "wireless";

      if (link.source === client.id) parentId = link.target;
      else if (link.target === client.id) parentId = link.source;

      if (parentId && classMap.get(parentId) !== "CLIENT") {
        const bucket = clientsByParent.get(parentId) ?? { wifi: [], lan: [] };
        if (isWireless) {
          if (!bucket.wifi.find((c) => c.id === client.id)) bucket.wifi.push(client);
        } else {
          if (!bucket.lan.find((c) => c.id === client.id)) bucket.lan.push(client);
        }
        clientsByParent.set(parentId, bucket);
        break;
      }
    }
  }

  const hierNodes: HierarchyNode[] = [];
  const hierEdges: HierarchyEdge[] = [];
  const edgeById = new Map<string, HierarchyEdge>();
  const addEdge = (
    source: string,
    target: string,
    linkType: HierarchyEdge["linkType"],
    rawLink: TopologyLink | null,
    opts?: { hasIssue?: boolean; health?: string; edgeLabel?: string }
  ) => {
    const id = `edge-${source}-${target}`;
    if (edgeById.has(id)) return;
    const e: HierarchyEdge = {
      id,
      source,
      target,
      linkType,
      hasIssue: opts?.hasIssue ?? false,
      health: opts?.health ?? "healthy",
      rawLink: rawLink ?? null,
      edgeLabel: opts?.edgeLabel,
    };
    edgeById.set(id, e);
    hierEdges.push(e);
  };

  // Add infra nodes
  for (const n of infraNodes) {
    const displayLabel = resolveDisplayLabel(n);
    const resolutionSource =
      n.metadata?.hostname ? "hostname" :
      n.metadata?.dhcpHostname ? "dhcpHostname" :
      (!(/^\d{10,}$/.test(n.label)) && n.label) ? "label" :
      n.metadata?.os ? "os" :
      n.metadata?.manufacturer ? "manufacturer" : "fallback";

    console.debug("[topology] node", {
      id: n.id,
      displayName: displayLabel,
      source: resolutionSource,
      subtype: n.subtype,
      layer: classMap.get(n.id),
      managed: n.managed,
    });

    hierNodes.push({
      id: n.id,
      layer: classMap.get(n.id)!,
      displayLabel,
      rawNode: n,
      isGroup: false,
      groupCount: 0,
      groupParentId: null,
      groupType: null,
      groupMembers: [],
    });
  }

  // Ensure we always have a WAN root for fallback hierarchy.
  if (!hierNodes.some((n) => n.layer === "WAN") && hierNodes.length > 0) {
    const base = hierNodes[0].rawNode;
    hierNodes.push({
      id: SYNTHETIC_WAN_ID,
      layer: "WAN",
      displayLabel: "Internet / WAN",
      rawNode: {
        ...base,
        id: SYNTHETIC_WAN_ID,
        type: "wan",
        subtype: "wan",
        label: "Internet / WAN",
        managed: false,
        metadata: {},
      },
      isGroup: false,
      groupCount: 0,
      groupParentId: null,
      groupType: null,
      groupMembers: [],
    });
  }

  // ── Port nodes ─────────────────────────────────────────────────────────────
  // For each managed switch, create one port node per connected port using
  // connected_interfaces stored in the switch's metadata by the backend.
  // Track which infra→infra edges are already covered by a port node so we
  // don't also render a direct switch→device edge.
  const portCoveredPairs = new Set<string>(); // "switchId|peerId"
  const hierNodeIds = new Set(hierNodes.map((n) => n.id));

  for (const switchNode of hierNodes) {
    const layer = switchNode.layer;
    if (layer !== "CORE_SWITCH" && layer !== "ACCESS_SWITCH") continue;

    const rawIfaces = (switchNode.rawNode.metadata?.connected_interfaces as Array<Record<string, unknown>>) ?? [];
    const interfaces = [...rawIfaces].sort((a, b) => {
      const pa = parseInt(String(a.portId ?? "0"), 10) || 0;
      const pb = parseInt(String(b.portId ?? "0"), 10) || 0;
      return pa - pb;
    });

    for (const iface of interfaces) {
      const portId = String(iface.portId ?? "");
      if (!portId) continue;

      const peers = (iface.connectedPeers as Array<Record<string, unknown>>) ?? [];
      // Only create a port node if at least one peer is in the hierarchy
      const knownPeers = peers.filter((p) => hierNodeIds.has(String(p.peer_id ?? "")));
      if (knownPeers.length === 0) continue;

      const portNodeId = makePortNodeId(switchNode.id, portId);
      const cfg = (iface.config as Record<string, unknown>) ?? {};
      const sta = (iface.status as Record<string, unknown>) ?? {};

      hierNodes.push({
        id: portNodeId,
        layer: "PORT",
        displayLabel: portLabel(portId, cfg, sta),
        rawNode: switchNode.rawNode, // reuse switch's rawNode; port details are in portConfig/portStatus
        isGroup: false,
        groupCount: 0,
        groupParentId: switchNode.id,
        groupType: null,
        groupMembers: [],
        portId,
        portConfig: cfg,
        portStatus: sta,
      });
      hierNodeIds.add(portNodeId);

      // Switch → port edge (no raw link; label from port config for styling where possible)
      const c = cfg as { type?: string; vlan?: number; nativeVlan?: number };
      const ptag = [String(c.type || ""), c.nativeVlan, c.vlan].filter((x) => x !== undefined && x !== null && x !== "").join(" ");
      addEdge(switchNode.id, portNodeId, "wired", null, { edgeLabel: ptag ? `p${portId} ${ptag}` : `p${portId}` });

      // Port → peer edges
      for (const peer of knownPeers) {
        const peerId = String(peer.peer_id ?? "");
        let gl =
          graph.links.find(
            (l) => l.target === peerId && (l.source === portNodeId || l.source === switchNode.id)
          ) || null;
        if (!gl) {
          gl =
            graph.links.find((l) => l.source === switchNode.id && l.target === peerId) || null;
        }
        const sp = (gl?.source_port as { label?: string } | undefined)?.label;
        const lbl = sp || (gl?.discovery_method ? String(gl.discovery_method) : "");
        addEdge(portNodeId, peerId, "wired", gl, { edgeLabel: lbl || undefined });
        // Mark this switch↔peer pair so we skip the raw graph.links edge
        portCoveredPairs.add(`${switchNode.id}|${peerId}`);
        portCoveredPairs.add(`${peerId}|${switchNode.id}`);
      }
    }
  }

  // ── Client groups ───────────────────────────────────────────────────────────
  const handledClientIds = new Set<string>();

  for (const [parentId, buckets] of clientsByParent) {
    for (const [groupType, members] of ([["wifi", buckets.wifi], ["lan", buckets.lan]] as const)) {
      if (members.length === 0) continue;
      const groupId = makeGroupId(parentId, groupType);

      // Resolve the parent: it could be a port node (if the AP is behind a port)
      // or the device directly. Use parentId as-is — the AP will have been added.
      if (expandedGroups.has(groupId)) {
        for (const client of members) {
          if (handledClientIds.has(client.id)) continue;
          handledClientIds.add(client.id);
          hierNodes.push({
            id: client.id,
            layer: "CLIENT",
            displayLabel: resolveDisplayLabel(client),
            rawNode: client,
            isGroup: false,
            groupCount: 0,
            groupParentId: parentId,
            groupType,
            groupMembers: [],
          });
          addEdge(parentId, client.id, groupType === "wifi" ? "wireless" : "wired", null);
        }
      } else {
        hierNodes.push({
          id: groupId,
          layer: "CLIENT",
          displayLabel: groupType === "wifi" ? `WiFi Clients (${members.length})` : `LAN Clients (${members.length})`,
          rawNode: members[0],
          isGroup: true,
          groupCount: members.length,
          groupParentId: parentId,
          groupType,
          groupMembers: members,
        });
        addEdge(parentId, groupId, groupType === "wifi" ? "wireless" : "wired", null);
        members.forEach((c) => handledClientIds.add(c.id));
      }
    }
  }

  // Orphaned clients (no parent found in links)
  for (const client of clientNodes) {
    if (!handledClientIds.has(client.id)) {
      hierNodes.push({
        id: client.id,
        layer: "CLIENT",
        displayLabel: resolveDisplayLabel(client),
        rawNode: client,
        isGroup: false,
        groupCount: 0,
        groupParentId: null,
        groupType: null,
        groupMembers: [],
      });
    }
  }

  // ── Infra↔infra edges from raw graph (skip port-covered pairs) ─────────────
  const allHierIds = new Set(hierNodes.map((n) => n.id));

  for (const link of graph.links) {
    if (!allHierIds.has(link.source) || !allHierIds.has(link.target)) continue;
    const srcLayer = classMap.get(link.source);
    const tgtLayer = classMap.get(link.target);
    if (srcLayer === "CLIENT" || tgtLayer === "CLIENT") continue;

    // Skip edges already represented by port nodes
    if (portCoveredPairs.has(`${link.source}|${link.target}`)) continue;

    if (viewMode === "client") {
      const srcNode = hierNodes.find((n) => n.id === link.source);
      const tgtNode = hierNodes.find((n) => n.id === link.target);
      if (!srcNode || !tgtNode) continue;
      const relevant = ["ACCESS_POINT", "ACCESS_SWITCH", "CLIENT"];
      if (!relevant.includes(srcNode.layer) && !relevant.includes(tgtNode.layer)) continue;
    }

    const lt = link.link_type as HierarchyEdge["linkType"];
    const pl = (link.source_port as { label?: string } | undefined)?.label;
    addEdge(link.source, link.target, lt, link, {
      hasIssue: link.mismatches.length > 0 || link.faults.length > 0,
      health: link.health,
      edgeLabel: pl,
    });
  }

  // Ensure every known parent-child relationship has an explicit edge.
  for (const node of hierNodes) {
    if (!node.groupParentId) continue;
    addEdge(node.groupParentId, node.id, node.groupType === "wifi" ? "wireless" : "wired", null);
  }

  // Infer WAN -> Firewall and Firewall -> Core edges if missing
  const wanNodes = hierNodes.filter((n) => n.layer === "WAN");
  const fwNodes = hierNodes.filter((n) => n.layer === "FIREWALL");
  const coreNodes = hierNodes.filter((n) => n.layer === "CORE_SWITCH");
  if (wanNodes.length > 0 && fwNodes.length > 0) addEdge(wanNodes[0].id, fwNodes[0].id, "wan", null);
  if (fwNodes.length > 0 && coreNodes.length > 0) {
    addEdge(fwNodes[0].id, coreNodes[0].id, "wired", null);
  } else {
    if (fwNodes.length === 0) console.warn("[topology] cannot build FW -> Core fallback edge: no firewall resolved");
    if (coreNodes.length === 0) console.warn("[topology] cannot build FW -> Core fallback edge: no core switch resolved");
  }

  // Fallback hierarchy when backend links are incomplete:
  // Core -> Access/AP/Unknown
  const accessNodes = hierNodes.filter(
    (n) => n.layer === "ACCESS_SWITCH" || n.layer === "ACCESS_POINT" || (n.layer === "UNKNOWN" && n.id !== UNMAPPED_GROUP_ID)
  );
  const infraEdgeCount = hierEdges.filter((e) => {
    const src = hierNodes.find((n) => n.id === e.source);
    const tgt = hierNodes.find((n) => n.id === e.target);
    return src && tgt && src.layer !== "CLIENT" && tgt.layer !== "CLIENT";
  }).length;
  if (infraEdgeCount === 0 && coreNodes.length > 0) {
    for (const access of accessNodes) {
      addEdge(coreNodes[0].id, access.id, "wired", null);
    }
  }

  // Prevent visible orphans: place disconnected nodes under an explicit Unmapped group.
  const nodeIds = new Set(hierNodes.map((n) => n.id));
  const incoming = new Map<string, number>();
  for (const e of hierEdges) {
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  }
  const roots = new Set([
    ...wanNodes.map((n) => n.id),
    ...fwNodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id),
  ]);
  const orphanIds = hierNodes
    .filter((n) => !roots.has(n.id) && (incoming.get(n.id) ?? 0) === 0)
    .map((n) => n.id);

  if (orphanIds.length > 0 && !nodeIds.has(UNMAPPED_GROUP_ID)) {
    const firstOrphan = hierNodes.find((n) => orphanIds.includes(n.id));
    hierNodes.push({
      id: UNMAPPED_GROUP_ID,
      layer: "UNKNOWN",
      displayLabel: `Unmapped devices (${orphanIds.length})`,
      rawNode: (firstOrphan?.rawNode ?? hierNodes[0]?.rawNode) as TopologyNode,
      isGroup: true,
      groupCount: orphanIds.length,
      groupParentId: null,
      groupType: null,
      groupMembers: [],
    });
    for (const orphanId of orphanIds) {
      addEdge(UNMAPPED_GROUP_ID, orphanId, "discovered_partial", null);
    }
  }

  // Collapse duplicate infrastructure links between the same device pair.
  // Keep only one visible edge for pairs like FW<->Core and Core<->AP.
  const nodeById = new Map(hierNodes.map((n) => [n.id, n]));
  const pickPriority = (e: HierarchyEdge) => {
    // Prefer real backend links, then wired, then fallback/discovered.
    const hasRaw = e.rawLink ? 10 : 0;
    const typeScore =
      e.linkType === "wired" ? 5 :
      e.linkType === "wan" ? 4 :
      e.linkType === "wireless" ? 3 : 1;
    const issueScore = e.hasIssue ? 2 : 0;
    return hasRaw + typeScore + issueScore;
  };
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const seenPair = new Map<string, HierarchyEdge>();
  const dedupedEdges: HierarchyEdge[] = [];
  for (const edge of hierEdges) {
    const src = nodeById.get(edge.source);
    const tgt = nodeById.get(edge.target);
    if (!src || !tgt) {
      dedupedEdges.push(edge);
      continue;
    }
    const isInfraPair =
      src.layer !== "CLIENT" &&
      tgt.layer !== "CLIENT" &&
      src.layer !== "PORT" &&
      tgt.layer !== "PORT" &&
      !src.isGroup &&
      !tgt.isGroup;
    if (!isInfraPair) {
      dedupedEdges.push(edge);
      continue;
    }
    const key = pairKey(edge.source, edge.target);
    const existing = seenPair.get(key);
    if (!existing) {
      seenPair.set(key, edge);
      dedupedEdges.push(edge);
      continue;
    }
    if (pickPriority(edge) > pickPriority(existing)) {
      const idx = dedupedEdges.findIndex((e) => e.id === existing.id);
      if (idx >= 0) dedupedEdges[idx] = edge;
      seenPair.set(key, edge);
    }
  }

  return { nodes: hierNodes, edges: dedupedEdges };
}
