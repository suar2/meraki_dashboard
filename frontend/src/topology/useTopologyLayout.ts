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
  showWireless: boolean
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
              String(n.rawNode.metadata?.lanIp || "").toLowerCase().includes(q)
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
      filteredEdges = filteredEdges.filter((e) => e.linkType !== "wireless");
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

    const filtered = { nodes: filteredNodes, edges: filteredEdges };
    return computeLayout(filtered);
  }, [graph, expandedGroups, viewMode, search, showMismatchesOnly, showWireless]);
}
