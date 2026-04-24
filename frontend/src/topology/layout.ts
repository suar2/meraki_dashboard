import { Edge, MarkerType, Node } from "@xyflow/react";
import { HierarchyGraph, HierarchyEdge, HierarchyNode } from "./buildHierarchy";
import { NodeLayer, LAYER_Y } from "./classify";

// Node dimensions by layer/type
const NODE_WIDTH: Record<string, number> = {
  WAN: 140,
  FIREWALL: 160,
  CORE_SWITCH: 160,
  ACCESS_SWITCH: 150,
  PORT: 150,
  TRUNK_HOST: 160,
  PORT_ACCESS_GROUP: 170,
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
  TRUNK_HOST: 52,
  PORT_ACCESS_GROUP: 48,
  ACCESS_POINT: 90, // circle
  CLIENT: 48,
  UNKNOWN: 48,
};

const H_GAP = 200; // horizontal gap between nodes in same layer
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

export function computeLayout(
  graph: HierarchyGraph,
  savedPositions?: Record<string, { x: number; y: number }> | null
): { nodes: Node[]; edges: Edge[] } {
  const posMap = new Map<string, { x: number; y: number }>();
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodeLayerY = new Map(graph.nodes.map((n) => [n.id, LAYER_Y[n.layer] ?? 9999]));
  const orientedEdges = graph.edges.map((e) => {
    const sy = nodeLayerY.get(e.source) ?? 9999;
    const ty = nodeLayerY.get(e.target) ?? 9999;
    // Always orient upper -> lower for consistent top-in / bottom-out rendering.
    if (sy <= ty) return e;
    return { ...e, source: e.target, target: e.source };
  });
  const childrenByParent = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  for (const e of orientedEdges) {
    if (!childrenByParent.has(e.source)) childrenByParent.set(e.source, []);
    childrenByParent.get(e.source)!.push(e.target);
    incomingCount.set(e.target, (incomingCount.get(e.target) ?? 0) + 1);
  }
  for (const [parentId, children] of childrenByParent) {
    const uniqueChildren = [...new Set(children)].sort();
    childrenByParent.set(parentId, uniqueChildren);
  }

  const layers: NodeLayer[] = ["WAN", "FIREWALL", "CORE_SWITCH", "TRUNK_HOST", "PORT_ACCESS_GROUP", "CLIENT"];

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
    const sortedPorts = [...ports].sort((a, b) => {
      const pa = parseInt(String(a.portId ?? "0"), 10) || 0;
      const pb = parseInt(String(b.portId ?? "0"), 10) || 0;
      return pa - pb;
    });
    const totalW = sortedPorts.length * portW + Math.max(0, sortedPorts.length - 1) * H_GAP;
    const startX = centerX - totalW / 2;
    sortedPorts.forEach((pn, i) => posMap.set(pn.id, { x: startX + i * (portW + H_GAP), y: LAYER_Y["PORT"] }));
  }

  // Refine to a deterministic layered tree layout so children stay under parents.
  const roots = graph.nodes.filter((n) => (incomingCount.get(n.id) ?? 0) === 0);
  const rootXs = spreadX(roots.length, NODE_WIDTH["CORE_SWITCH"], 240);
  roots.forEach((root, i) => {
    const y = LAYER_Y[root.layer];
    posMap.set(root.id, { x: rootXs[i] ?? CANVAS_CENTER_X, y });
  });

  const placeChildren = (parentId: string, depth = 0) => {
    if (depth > 12) return;
    const parentPos = posMap.get(parentId);
    if (!parentPos) return;
    const childIds = [...new Set(childrenByParent.get(parentId) ?? [])].filter((id) => nodeById.has(id));
    if (childIds.length === 0) return;
    const children = childIds.map((id) => nodeById.get(id)!);
    const childWidths = children.map((n) => NODE_WIDTH[n.layer] ?? 130);
    const siblingGap = Math.min(240, Math.max(180, H_GAP + Math.floor(children.length / 3) * 12));
    const totalW = childWidths.reduce((acc, w) => acc + w, 0) + Math.max(0, children.length - 1) * siblingGap;
    let cursor = parentPos.x + (NODE_WIDTH[nodeById.get(parentId)?.layer ?? "CORE_SWITCH"] ?? 150) / 2 - totalW / 2;
    children.forEach((child, idx) => {
      const w = childWidths[idx];
      posMap.set(child.id, { x: cursor, y: LAYER_Y[child.layer] });
      cursor += w + siblingGap;
      placeChildren(child.id, depth + 1);
    });
  };
  roots.forEach((r) => placeChildren(r.id));

  if (savedPositions) {
    for (const n of graph.nodes) {
      const s = savedPositions[n.id];
      if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) {
        posMap.set(n.id, { x: s.x, y: s.y });
      }
    }
  }

  const outgoingIndexByEdge = new Map<string, number>();
  for (const e of orientedEdges) {
    const siblings = childrenByParent.get(e.source) ?? [];
    outgoingIndexByEdge.set(e.id, Math.max(0, siblings.indexOf(e.target)));
  }

  function edgeStrokeForHierarchy(e: HierarchyEdge): { stroke: string; dash: string | undefined; width: number } {
    const m = (e.rawLink as { discovery_method?: string; health?: string; link_type?: string } | null)
      ?.discovery_method;
    const lt = (e.rawLink as { link_type?: string } | null)?.link_type;
    if (e.linkType === "wan" || m === "wan_uplink" || m === "synthetic_wan") {
      return { stroke: "#4b8fd8", dash: undefined, width: 2.8 };
    }
    if (lt === "wireless" || e.linkType === "wireless") {
      return { stroke: "#66b8ff", dash: "7 4", width: 2.5 };
    }
    if (m && /(trunk|switchport_trunk|lldp_cdp)/i.test(m)) {
      return { stroke: "#d9920a", dash: undefined, width: 2.8 };
    }
    if (m && /downstream|trunk_downstream|port_access|access/i.test(m)) {
      return { stroke: m.includes("trunk") ? "#e0a84a" : "#6fb07a", dash: m.includes("downstream") ? "4 3" : undefined, width: 2.4 };
    }
    if (m && /switchport_access|port_access|wired_client/i.test(m)) {
      return { stroke: "#79d7a4", dash: undefined, width: 2.4 };
    }
    if (e.hasIssue) {
      return { stroke: "#e84040", dash: undefined, width: 3 };
    }
    if (e.rawLink && (e.rawLink as { health?: string }).health === "warning") {
      return { stroke: "#d9920a", dash: undefined, width: 2.5 };
    }
    if (e.linkType === "discovered_partial") {
      return { stroke: "#5a5f65", dash: "2 3", width: 2 };
    }
    return { stroke: "#4a6fa1", dash: undefined, width: 2.5 };
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
    else if (n.layer === "TRUNK_HOST") rfType = "trunkHostNode";
    else if (n.layer === "PORT_ACCESS_GROUP") rfType = "portGroupNode";

    const childCount = (childrenByParent.get(n.id) ?? []).length;
    const handles = {
      targets: ["top"],
      sources: Array.from({ length: Math.max(1, childCount) }, (_, i) => `bottom-${i}`),
    };

    return {
      id: n.id,
      type: rfType,
      position: pos,
      data: {
        hierNode: n,
        label: n.displayLabel,
        width: w,
        height: h,
        handles,
      },
      style: { width: w, height: h },
    };
  });

  // Build React Flow edges
  const rfEdges: Edge[] = orientedEdges.map((e) => {
    const isWireless = e.linkType === "wireless";
    const es = edgeStrokeForHierarchy(e as HierarchyEdge);
    const strokeColor = es.stroke;
    const sourceHandle = `bottom-${outgoingIndexByEdge.get(e.id) ?? 0}`;
    const targetHandle = "top";
    const edgeLabel = (e as HierarchyEdge).edgeLabel;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle,
      targetHandle,
      type: "smoothstep",
      animated: isWireless,
      pathOptions: { borderRadius: 16, offset: 24 },
      style: {
        stroke: strokeColor,
        strokeWidth: es.width,
        opacity: 0.92,
        strokeDasharray: es.dash,
      },
      label: edgeLabel,
      labelStyle: { fill: "#7ab0d0", fontSize: 9, fontWeight: 500 },
      labelBgStyle: { fill: "#0a1522", fillOpacity: 0.9 },
      labelShowBg: Boolean(edgeLabel),
      markerEnd: { type: MarkerType.ArrowClosed, color: strokeColor, width: 16, height: 16 },
      data: { hierEdge: e },
    };
  });

  return { nodes: rfNodes, edges: rfEdges };
}
