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
  rawLink: TopologyLink;
}

export interface HierarchyGraph {
  nodes: HierarchyNode[];
  edges: HierarchyEdge[];
}

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

    const interfaces = (switchNode.rawNode.metadata?.connected_interfaces as Array<Record<string, unknown>>) ?? [];

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

      // Switch → port edge
      hierEdges.push({
        id: `__port_edge_${switchNode.id}_${portId}`,
        source: switchNode.id,
        target: portNodeId,
        linkType: "wired",
        hasIssue: false,
        health: "healthy",
        rawLink: null as unknown as TopologyLink,
      });

      // Port → peer edges
      for (const peer of knownPeers) {
        const peerId = String(peer.peer_id ?? "");
        hierEdges.push({
          id: `__port_peer_edge_${portNodeId}_${peerId}`,
          source: portNodeId,
          target: peerId,
          linkType: "wired",
          hasIssue: false,
          health: "healthy",
          rawLink: null as unknown as TopologyLink,
        });
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
          hierEdges.push({
            id: `__client_edge_${parentId}_${client.id}`,
            source: parentId,
            target: client.id,
            linkType: groupType === "wifi" ? "wireless" : "wired",
            hasIssue: false,
            health: "healthy",
            rawLink: null as unknown as TopologyLink,
          });
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
        hierEdges.push({
          id: `__group_edge_${groupType}_${parentId}`,
          source: parentId,
          target: groupId,
          linkType: groupType === "wifi" ? "wireless" : "wired",
          hasIssue: false,
          health: "healthy",
          rawLink: null as unknown as TopologyLink,
        });
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
    hierEdges.push({
      id: link.id,
      source: link.source,
      target: link.target,
      linkType: lt,
      hasIssue: link.mismatches.length > 0 || link.faults.length > 0,
      health: link.health,
      rawLink: link,
    });
  }

  return { nodes: hierNodes, edges: hierEdges };
}
