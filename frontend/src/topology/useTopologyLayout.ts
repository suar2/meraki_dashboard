import { useMemo } from "react";
import { Node, Edge } from "@xyflow/react";
import { TopologyGraph } from "../types/topology";
import { buildHierarchy } from "./buildHierarchy";
import { computeLayout } from "./layout";

export type ViewMode = "physical" | "logical" | "client";

export interface TopologyLayoutResult {
  nodes: Node[];
  edges: Edge[];
}

export function useTopologyLayout(
  graph: TopologyGraph | null,
  expandedGroups: Set<string>,
  viewMode: ViewMode,
  search: string,
  showMismatchesOnly: boolean,
  showWireless: boolean,
  wiredOnly: boolean,
  wirelessOnly: boolean,
  unmanagedOnly: boolean,
  clientsOnly: boolean,
  severityFilter: "all" | "critical" | "warning" | "healthy",
  savedPositions: Record<string, { x: number; y: number }> | null
): TopologyLayoutResult {
  return useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };

    const hierarchy = buildHierarchy(graph, expandedGroups, viewMode);

    // Apply filters — in logical view show VLAN overlay (no node filtering)
    let filteredNodes = hierarchy.nodes;
    let filteredEdges = hierarchy.edges;

    if (search.trim()) {
      const q = search.toLowerCase();
      const matchingIds = new Set(
        filteredNodes
          .filter(
            (n) =>
              n.displayLabel.toLowerCase().includes(q) ||
              String(n.rawNode.metadata?.serial || "").toLowerCase().includes(q) ||
              String(n.rawNode.metadata?.model || "").toLowerCase().includes(q) ||
              String(n.rawNode.metadata?.mac || "").toLowerCase().includes(q) ||
              String(n.rawNode.metadata?.lanIp || "").toLowerCase().includes(q) ||
              JSON.stringify(n.rawNode.metadata?.connected_interfaces || []).toLowerCase().includes(q)
          )
          .map((n) => n.id)
      );
      filteredNodes = filteredNodes.filter((n) => matchingIds.has(n.id));
      const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
      filteredEdges = filteredEdges.filter(
        (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
      );
    }

    if (!showWireless) {
      const nodeById = new Map(filteredNodes.map((n) => [n.id, n]));
      filteredEdges = filteredEdges.filter((e) => {
        if (e.linkType !== "wireless") return true;
        // "Show wireless links" only controls wireless client edges.
        const src = nodeById.get(e.source);
        const tgt = nodeById.get(e.target);
        const touchesClient =
          src?.layer === "CLIENT" ||
          tgt?.layer === "CLIENT" ||
          src?.isGroup ||
          tgt?.isGroup;
        return !touchesClient;
      });
    }

    if (showMismatchesOnly) {
      const issueNodeIds = new Set<string>();
      filteredEdges.forEach((e) => {
        if (e.hasIssue) {
          issueNodeIds.add(e.source);
          issueNodeIds.add(e.target);
        }
      });
      // Also include nodes with their own health issues
      filteredNodes.forEach((n) => {
        if (n.rawNode.health.state !== "healthy") issueNodeIds.add(n.id);
      });
      filteredEdges = filteredEdges.filter((e) => e.hasIssue);
      filteredNodes = filteredNodes.filter((n) => issueNodeIds.has(n.id));
    }

    if (wiredOnly || wirelessOnly) {
      filteredEdges = filteredEdges.filter((e) => {
        if (wiredOnly && wirelessOnly) return true;
        if (wiredOnly) return e.linkType !== "wireless";
        return e.linkType === "wireless";
      });
      const keepIds = new Set<string>();
      filteredEdges.forEach((e) => {
        keepIds.add(e.source);
        keepIds.add(e.target);
      });
      filteredNodes = filteredNodes.filter((n) => keepIds.has(n.id));
    }

    if (unmanagedOnly) {
      const unmanagedIds = new Set(filteredNodes.filter((n) => !n.rawNode.managed).map((n) => n.id));
      filteredNodes = filteredNodes.filter((n) => unmanagedIds.has(n.id));
      filteredEdges = filteredEdges.filter((e) => unmanagedIds.has(e.source) || unmanagedIds.has(e.target));
    }

    if (clientsOnly) {
      const clientIds = new Set(
        filteredNodes
          .filter((n) => n.layer === "CLIENT" || n.rawNode.type === "client" || n.rawNode.subtype === "wireless")
          .map((n) => n.id)
      );
      filteredNodes = filteredNodes.filter((n) => clientIds.has(n.id));
      filteredEdges = filteredEdges.filter((e) => clientIds.has(e.source) || clientIds.has(e.target));
    }

    if (severityFilter !== "all") {
      filteredNodes = filteredNodes.filter((n) => n.rawNode.health.state === severityFilter);
      const ids = new Set(filteredNodes.map((n) => n.id));
      filteredEdges = filteredEdges.filter((e) => ids.has(e.source) || ids.has(e.target));
    }

    const filtered = { nodes: filteredNodes, edges: filteredEdges };
    const layout = computeLayout(filtered, savedPositions);

    const nodeIdSet = new Set(layout.nodes.map((n) => n.id));
    const handleMap = new Map<string, { source: Set<string>; target: Set<string> }>();
    for (const n of layout.nodes) {
      const handles = (n.data as { handles?: { sources?: string[]; targets?: string[] } } | undefined)?.handles;
      handleMap.set(n.id, {
        source: new Set(handles?.sources ?? ["bottom-0"]),
        target: new Set(handles?.targets ?? ["top"]),
      });
    }
    const validEdges = layout.edges.filter((e) => {
      const sourceExists = nodeIdSet.has(e.source);
      const targetExists = nodeIdSet.has(e.target);
      const sourceHandleOk = !e.sourceHandle || !!handleMap.get(e.source)?.source.has(e.sourceHandle);
      const targetHandleOk = !e.targetHandle || !!handleMap.get(e.target)?.target.has(e.targetHandle);
      if (!sourceExists) {
        console.warn("[topology] dropping edge with missing source node", { edgeId: e.id, source: e.source, target: e.target });
      }
      if (!targetExists) {
        console.warn("[topology] dropping edge with missing target node", { edgeId: e.id, source: e.source, target: e.target });
      }
      if (!sourceHandleOk) {
        console.warn("[topology] dropping edge with missing source handle", {
          edgeId: e.id,
          source: e.source,
          sourceHandle: e.sourceHandle,
        });
      }
      if (!targetHandleOk) {
        console.warn("[topology] dropping edge with missing target handle", {
          edgeId: e.id,
          target: e.target,
          targetHandle: e.targetHandle,
        });
      }
      return sourceExists && targetExists && sourceHandleOk && targetHandleOk;
    });

    console.info("[topology] totals", {
      totalNodes: layout.nodes.length,
      totalEdges: validEdges.length,
    });
    console.info(
      "[topology] edges source->target",
      validEdges.map((e) => `${e.source} -> ${e.target}`)
    );
    console.table(
      layout.nodes.map((n) => ({
        id: n.id,
        label: n.data?.label,
        type: n.type,
        x: n.position?.x,
        y: n.position?.y,
      }))
    );
    console.table(
      validEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceExists: nodeIdSet.has(e.source),
        targetExists: nodeIdSet.has(e.target),
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: e.type,
      }))
    );

    return { nodes: layout.nodes, edges: validEdges };
  }, [
    graph,
    expandedGroups,
    viewMode,
    search,
    showMismatchesOnly,
    showWireless,
    wiredOnly,
    wirelessOnly,
    unmanagedOnly,
    clientsOnly,
    severityFilter,
    savedPositions,
  ]);
}
