import { Node, Edge } from "@xyflow/react";
import { HierarchyGraph, HierarchyNode } from "./buildHierarchy";
import { NodeLayer, LAYER_Y } from "./classify";

// Node dimensions by layer/type
const NODE_WIDTH: Record<string, number> = {
  WAN: 140,
  FIREWALL: 160,
  CORE_SWITCH: 160,
  ACCESS_SWITCH: 150,
  PORT: 150,
  ACCESS_POINT: 90,
  CLIENT: 130,
  UNKNOWN: 130,
};

const NODE_HEIGHT: Record<string, number> = {
  WAN: 50,
  FIREWALL: 56,
  CORE_SWITCH: 56,
  ACCESS_SWITCH: 56,
  PORT: 44,
  ACCESS_POINT: 90, // circle
  CLIENT: 48,
  UNKNOWN: 48,
};

const H_GAP = 60; // horizontal gap between nodes in same layer
const CANVAS_CENTER_X = 700;

function layerNodes(nodes: HierarchyNode[], layer: NodeLayer): HierarchyNode[] {
  return nodes.filter((n) => n.layer === layer);
}

function spreadX(count: number, nodeWidth: number, gap: number): number[] {
  if (count === 0) return [];
  const totalWidth = count * nodeWidth + (count - 1) * gap;
  const startX = CANVAS_CENTER_X - totalWidth / 2;
  return Array.from({ length: count }, (_, i) => startX + i * (nodeWidth + gap));
}

// Group ACCESS_SWITCH and ACCESS_POINT into a shared layer
// but separate them visually within it: switches left, APs right
function accessLayerPositions(nodes: HierarchyNode[]): Map<string, { x: number; y: number }> {
  const switches = nodes.filter((n) => n.layer === "ACCESS_SWITCH");
  const aps = nodes.filter((n) => n.layer === "ACCESS_POINT");
  const unknowns = nodes.filter((n) => n.layer === "UNKNOWN");

  const positions = new Map<string, { x: number; y: number }>();

  const allGroups = [switches, aps, unknowns].filter((g) => g.length > 0);
  const totalNodes = switches.length + aps.length + unknowns.length;

  if (totalNodes === 0) return positions;

  // Compute a combined X spread for all access-layer nodes
  const switchWidth = NODE_WIDTH["ACCESS_SWITCH"];
  const apWidth = NODE_WIDTH["ACCESS_POINT"];
  const unknownWidth = NODE_WIDTH["UNKNOWN"];

  // Place groups left-to-right with a larger gap between sub-groups
  const GROUP_GAP = 100;
  let cursor = CANVAS_CENTER_X;

  // Calculate total width
  const swTotal = switches.length * switchWidth + Math.max(0, switches.length - 1) * H_GAP;
  const apTotal = aps.length * apWidth + Math.max(0, aps.length - 1) * H_GAP;
  const unTotal = unknowns.length * unknownWidth + Math.max(0, unknowns.length - 1) * H_GAP;

  const groupTotals = allGroups.map((g) => {
    if (g === switches) return swTotal;
    if (g === aps) return apTotal;
    return unTotal;
  });
  const totalGroupsWidth =
    groupTotals.reduce((a, b) => a + b, 0) + Math.max(0, allGroups.length - 1) * GROUP_GAP;
  cursor = CANVAS_CENTER_X - totalGroupsWidth / 2;

  const placeGroup = (group: HierarchyNode[], width: number, y: number) => {
    for (const n of group) {
      positions.set(n.id, { x: cursor, y });
      cursor += width + H_GAP;
    }
    cursor -= H_GAP; // remove last gap
    cursor += GROUP_GAP;
  };

  const y = LAYER_Y["ACCESS_SWITCH"]; // same Y for both
  if (switches.length) placeGroup(switches, switchWidth, y);
  if (aps.length) placeGroup(aps, apWidth, y);
  if (unknowns.length) placeGroup(unknowns, unknownWidth, y);

  return positions;
}

export function computeLayout(graph: HierarchyGraph): { nodes: Node[]; edges: Edge[] } {
  const posMap = new Map<string, { x: number; y: number }>();

  const layers: NodeLayer[] = ["WAN", "FIREWALL", "CORE_SWITCH", "CLIENT"];

  for (const layer of layers) {
    const layerNodeList = layerNodes(graph.nodes, layer);
    const w = NODE_WIDTH[layer];
    const xs = spreadX(layerNodeList.length, w, H_GAP);
    const y = LAYER_Y[layer];
    layerNodeList.forEach((n, i) => posMap.set(n.id, { x: xs[i], y }));
  }

  // Access layer: ACCESS_SWITCH + ACCESS_POINT + UNKNOWN together
  const accessPositions = accessLayerPositions(graph.nodes);
  for (const [id, pos] of accessPositions) posMap.set(id, pos);

  // PORT layer: group ports under their parent switch/device.
  // groupParentId stores the parent node id for port nodes.
  const portNodes = graph.nodes.filter((n) => n.layer === "PORT");
  const portsByParent = new Map<string, typeof portNodes>();
  for (const pn of portNodes) {
    const parentId = pn.groupParentId ?? "";
    if (!portsByParent.has(parentId)) portsByParent.set(parentId, []);
    portsByParent.get(parentId)!.push(pn);
  }
  for (const [parentId, ports] of portsByParent) {
    const parentPos = posMap.get(parentId);
    const parentNode = graph.nodes.find((n) => n.id === parentId);
    const parentW = NODE_WIDTH[parentNode?.layer ?? "ACCESS_SWITCH"] ?? 150;
    const centerX = parentPos ? parentPos.x + parentW / 2 : CANVAS_CENTER_X;
    const portW = NODE_WIDTH["PORT"];
    const totalW = ports.length * portW + Math.max(0, ports.length - 1) * H_GAP;
    const startX = centerX - totalW / 2;
    ports.forEach((pn, i) => posMap.set(pn.id, { x: startX + i * (portW + H_GAP), y: LAYER_Y["PORT"] }));
  }

  // Build React Flow nodes
  const rfNodes: Node[] = graph.nodes.map((n) => {
    const pos = posMap.get(n.id) ?? { x: 100, y: 100 };
    const w = NODE_WIDTH[n.layer];
    const h = NODE_HEIGHT[n.layer];

    // Determine React Flow node type
    let rfType = "infraNode";
    if (n.layer === "FIREWALL") rfType = "firewallNode";
    else if (n.layer === "ACCESS_POINT") rfType = "apNode";
    else if (n.isGroup) rfType = "clientGroupNode";
    else if (n.layer === "CLIENT") rfType = "clientNode";
    else if (n.layer === "WAN") rfType = "wanNode";
    else if (n.layer === "PORT") rfType = "portNode";

    return {
      id: n.id,
      type: rfType,
      position: pos,
      data: {
        hierNode: n,
        label: n.displayLabel,
        width: w,
        height: h,
      },
      style: { width: w, height: h },
    };
  });

  // Build React Flow edges
  const rfEdges: Edge[] = graph.edges.map((e) => {
    const isWireless = e.linkType === "wireless";
    const isWan = e.linkType === "wan";
    const health = e.health;

    const strokeColor = !e.rawLink
      ? "#4a6fa1"
      : health === "critical"
      ? "#e84040"
      : health === "warning"
      ? "#d9920a"
      : isWireless
      ? "#4ba3ff"
      : "#4a9a6b";

    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: isWan ? "smoothstep" : "default",
      animated: isWireless && !!e.rawLink,
      style: {
        stroke: strokeColor,
        strokeWidth: e.hasIssue ? 3 : 2,
        strokeDasharray: isWireless ? "7 4" : undefined,
      },
      data: { hierEdge: e },
    };
  });

  return { nodes: rfNodes, edges: rfEdges };
}
