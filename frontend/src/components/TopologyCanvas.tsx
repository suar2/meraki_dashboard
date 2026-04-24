import React from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  NodeMouseHandler,
  EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { TopologyGraph, TopologyNode, TopologyLink, RemediationAction } from "../types/topology";
import { useTopologyLayout, ViewMode } from "../topology/useTopologyLayout";
import { nodeTypes } from "../topology/nodeTypes";
import { HierarchyNode } from "../topology/buildHierarchy";

interface Props {
  graph: TopologyGraph | null;
  search: string;
  showMismatchesOnly: boolean;
  showWireless: boolean;
  onNodeSelect: (node: TopologyNode | undefined) => void;
  onLinkSelect: (link: TopologyLink | undefined) => void;
  onRemediationTrigger: (action: RemediationAction) => void;
}

const VIEW_LABELS: Record<ViewMode, string> = {
  physical: "Physical",
  logical: "Logical",
  client: "Client",
};

export function TopologyCanvas({
  graph,
  search,
  showMismatchesOnly,
  showWireless,
  onNodeSelect,
  onLinkSelect,
  onRemediationTrigger,
}: Props) {
  const [viewMode, setViewMode] = React.useState<ViewMode>("physical");
  const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(new Set());

  const layoutResult = useTopologyLayout(
    graph,
    expandedGroups,
    viewMode,
    search,
    showMismatchesOnly,
    showWireless
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  React.useEffect(() => {
    setNodes(layoutResult.nodes);
    setEdges(layoutResult.edges);
  }, [layoutResult, setNodes, setEdges]);

  const toggleGroup = React.useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const handleNodeClick: NodeMouseHandler = React.useCallback(
    (_evt, rfNode) => {
      const hierNode: HierarchyNode | undefined = rfNode.data?.hierNode as HierarchyNode | undefined;
      if (!hierNode) return;

      if (hierNode.isGroup) {
        toggleGroup(rfNode.id);
        return;
      }

      onNodeSelect(hierNode.rawNode);
      onLinkSelect(undefined);
    },
    [toggleGroup, onNodeSelect, onLinkSelect]
  );

  const handleEdgeClick: EdgeMouseHandler = React.useCallback(
    (_evt, rfEdge) => {
      const hierEdge = rfEdge.data?.hierEdge as { rawLink: TopologyLink } | undefined;
      if (!hierEdge?.rawLink) return;
      onLinkSelect(hierEdge.rawLink);
      onNodeSelect(undefined);
    },
    [onLinkSelect, onNodeSelect]
  );

  const layerCount = graph
    ? new Set(
        (layoutResult.nodes as Node[]).map((n) => {
          const hn = n.data?.hierNode as HierarchyNode | undefined;
          return hn?.layer ?? "UNKNOWN";
        })
      ).size
    : 0;

  return (
    <div className="topo-canvas-wrapper">
      {/* View mode selector */}
      <div className="view-mode-bar">
        {(Object.keys(VIEW_LABELS) as ViewMode[]).map((mode) => (
          <button
            key={mode}
            className={`view-btn${viewMode === mode ? " active" : ""}`}
            onClick={() => setViewMode(mode)}
          >
            {VIEW_LABELS[mode]}
          </button>
        ))}
        {graph && (
          <span className="topo-meta">
            {graph.nodes.length} devices · {graph.links.length} links · {layerCount} layers
          </span>
        )}
      </div>

      {/* Layer legend */}
      <div className="layer-legend">
        {[
          { label: "WAN", color: "#4a6fa1" },
          { label: "Firewall", color: "#d9920a" },
          { label: "Core Switch", color: "#4a9a6b" },
          { label: "Access Switch", color: "#2da862" },
          { label: "Access Point", color: "#4ba3ff" },
          { label: "Clients", color: "#3a7acc" },
        ].map(({ label, color }) => (
          <span key={label} className="legend-item">
            <span className="legend-dot" style={{ background: color }} />
            {label}
          </span>
        ))}
        {expandedGroups.size > 0 && (
          <button
            className="collapse-all-btn"
            onClick={() => setExpandedGroups(new Set())}
          >
            Collapse all
          </button>
        )}
      </div>

      {!graph && (
        <div className="topo-empty">
          <span>Select an organization and network to load topology</span>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: false }}
      >
        <MiniMap
          style={{ background: "#081320" }}
          maskColor="rgba(0,0,0,0.6)"
          nodeColor={(n) => {
            const hn = n.data?.hierNode as HierarchyNode | undefined;
            const health = hn?.rawNode.health.state ?? "healthy";
            return health === "critical" ? "#e84040" : health === "warning" ? "#d9920a" : "#2da862";
          }}
        />
        <Controls />
        <Background color="#1a2d45" gap={24} size={1} />
      </ReactFlow>
    </div>
  );
}
