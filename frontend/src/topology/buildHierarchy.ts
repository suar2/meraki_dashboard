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

  // Switches directly connected to a firewall are "core"
  const coreIds = new Set<string>();
  for (const link of graph.links) {
    if (firewallIds.has(link.source)) {
      coreIds.add(link.target);
    } else if (firewallIds.has(link.target)) {
      coreIds.add(link.source);
    }
  }
  // Also tag firewalls themselves so classify() doesn't need re-pass
  return coreIds;
}

function makeGroupId(parentId: string, type: "wifi" | "lan"): string {
  return `__group_${type}_${parentId}`;
}

export function buildHierarchy(
  graph: TopologyGraph,
  expandedGroups: Set<string>,
  viewMode: "physical" | "logical" | "client"
): HierarchyGraph {
  const coreIds = buildCoreIds(graph);

  // Classify every raw node
  const classMap = new Map<string, NodeLayer>();
  for (const n of graph.nodes) {
    classMap.set(n.id, classifyNode(n, coreIds));
  }

  // Separate clients from infrastructure
  const infraNodes = graph.nodes.filter((n) => classMap.get(n.id) !== "CLIENT");
  const clientNodes = graph.nodes.filter((n) => classMap.get(n.id) === "CLIENT");

  // Map: parentId → { wifi: TopologyNode[], lan: TopologyNode[] }
  const clientsByParent = new Map<string, { wifi: TopologyNode[]; lan: TopologyNode[] }>();

  for (const client of clientNodes) {
    // Find links involving this client
    for (const link of graph.links) {
      let parentId: string | null = null;
      let isWireless = link.link_type === "wireless";

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

  // Add infrastructure nodes
  for (const n of infraNodes) {
    hierNodes.push({
      id: n.id,
      layer: classMap.get(n.id)!,
      displayLabel: resolveDisplayLabel(n),
      rawNode: n,
      isGroup: false,
      groupCount: 0,
      groupParentId: null,
      groupType: null,
      groupMembers: [],
    });
  }

  // Add client groups (or individual clients if expanded)
  const handledClientIds = new Set<string>();

  for (const [parentId, buckets] of clientsByParent) {
    // WiFi group
    if (buckets.wifi.length > 0) {
      const groupId = makeGroupId(parentId, "wifi");
      if (expandedGroups.has(groupId)) {
        // Show individual wifi clients
        for (const client of buckets.wifi) {
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
            groupType: "wifi",
            groupMembers: [],
          });
          hierEdges.push({
            id: `__client_edge_${parentId}_${client.id}`,
            source: parentId,
            target: client.id,
            linkType: "wireless",
            hasIssue: false,
            health: "healthy",
            rawLink: null as unknown as TopologyLink,
          });
        }
      } else {
        hierNodes.push({
          id: groupId,
          layer: "CLIENT",
          displayLabel: `WiFi Clients (${buckets.wifi.length})`,
          rawNode: buckets.wifi[0],
          isGroup: true,
          groupCount: buckets.wifi.length,
          groupParentId: parentId,
          groupType: "wifi",
          groupMembers: buckets.wifi,
        });
        hierEdges.push({
          id: `__group_edge_wifi_${parentId}`,
          source: parentId,
          target: groupId,
          linkType: "wireless",
          hasIssue: false,
          health: "healthy",
          rawLink: null as unknown as TopologyLink,
        });
        buckets.wifi.forEach((c) => handledClientIds.add(c.id));
      }
    }

    // LAN group
    if (buckets.lan.length > 0) {
      const groupId = makeGroupId(parentId, "lan");
      if (expandedGroups.has(groupId)) {
        for (const client of buckets.lan) {
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
            groupType: "lan",
            groupMembers: [],
          });
          hierEdges.push({
            id: `__client_edge_${parentId}_${client.id}`,
            source: parentId,
            target: client.id,
            linkType: "wired",
            hasIssue: false,
            health: "healthy",
            rawLink: null as unknown as TopologyLink,
          });
        }
      } else {
        hierNodes.push({
          id: groupId,
          layer: "CLIENT",
          displayLabel: `LAN Clients (${buckets.lan.length})`,
          rawNode: buckets.lan[0],
          isGroup: true,
          groupCount: buckets.lan.length,
          groupParentId: parentId,
          groupType: "lan",
          groupMembers: buckets.lan,
        });
        hierEdges.push({
          id: `__group_edge_lan_${parentId}`,
          source: parentId,
          target: groupId,
          linkType: "wired",
          hasIssue: false,
          health: "healthy",
          rawLink: null as unknown as TopologyLink,
        });
        buckets.lan.forEach((c) => handledClientIds.add(c.id));
      }
    }
  }

  // Add un-parented clients (orphaned) as individual nodes
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

  // Add infra–infra links from raw graph (skip client links — handled above)
  const hierNodeIds = new Set(hierNodes.map((n) => n.id));

  for (const link of graph.links) {
    if (!hierNodeIds.has(link.source) || !hierNodeIds.has(link.target)) continue;
    // Skip if either endpoint is a raw client (already handled)
    const srcLayer = classMap.get(link.source);
    const tgtLayer = classMap.get(link.target);
    if (srcLayer === "CLIENT" || tgtLayer === "CLIENT") continue;

    // In client view, only show links to/from APs and client-bearing switches
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
