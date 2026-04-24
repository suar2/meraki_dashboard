import React from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  NodeChange,
  applyNodeChanges,
  NodeMouseHandler,
  EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { TopologyGraph, TopologyNode, TopologyLink, RemediationAction } from "../types/topology";
import { useTopologyLayout, ViewMode } from "../topology/useTopologyLayout";
import { nodeTypes } from "../topology/nodeTypesMap";
import { HierarchyNode } from "../topology/buildHierarchy";
import { loadLayout, saveLayout } from "../api/client";
import { FlowControls } from "./FlowControls";
import { VIEW_MODE_LABELS } from "../topology/viewModeLabels";

const LAYOUT_SAVE_DEBOUNCE_MS = 400;

interface Props {
  graph: TopologyGraph | null;
  orgId: string;
  networkId: string;
  search: string;
  showMismatchesOnly: boolean;
  showWireless: boolean;
  wiredOnly: boolean;
  wirelessOnly: boolean;
  unmanagedOnly: boolean;
  clientsOnly: boolean;
  severityFilter: "all" | "critical" | "warning" | "healthy";
  onNodeSelect: (node: TopologyNode | undefined) => void;
  onLinkSelect: (link: TopologyLink | undefined) => void;
  onRemediationTrigger: (action: RemediationAction) => void;
}

export function TopologyCanvas({
  graph,
  orgId,
  networkId,
  search,
  showMismatchesOnly,
  showWireless,
  wiredOnly,
  wirelessOnly,
  unmanagedOnly,
  clientsOnly,
  severityFilter,
  onNodeSelect,
  onLinkSelect,
  onRemediationTrigger,
}: Props) {
  const [viewMode, setViewMode] = React.useState<ViewMode>("physical");
  const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(new Set());
  const [savedLayoutPositions, setSavedLayoutPositions] = React.useState<Record<string, { x: number; y: number }> | null>(
    null
  );
  const layoutSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLayoutRef = React.useRef<{
    orgId: string;
    networkId: string;
    positions: Record<string, { x: number; y: number }>;
  } | null>(null);

  React.useEffect(() => {
    if (layoutSaveTimerRef.current) {
      clearTimeout(layoutSaveTimerRef.current);
      layoutSaveTimerRef.current = null;
    }
    pendingLayoutRef.current = null;
  }, [orgId, networkId]);

  React.useEffect(() => {
    if (!orgId || !networkId) {
      setSavedLayoutPositions(null);
      return;
    }
    let cancelled = false;
    loadLayout(orgId, networkId)
      .then((pos) => {
        if (!cancelled) setSavedLayoutPositions(Object.keys(pos).length ? pos : null);
      })
      .catch(() => {
        if (!cancelled) setSavedLayoutPositions(null);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, networkId]);

  React.useEffect(() => {
    return () => {
      if (layoutSaveTimerRef.current) {
        clearTimeout(layoutSaveTimerRef.current);
        layoutSaveTimerRef.current = null;
      }
    };
  }, []);

  const layoutResult = useTopologyLayout(
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
    savedLayoutPositions
  );

  const nodes = layoutResult.nodes;
  const edges = layoutResult.edges;
  const [localNodes, setLocalNodes] = React.useState<Node[]>([]);

  React.useEffect(() => {
    setLocalNodes(nodes);
  }, [nodes]);

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
        layoutResult.nodes.map((n) => {
          const hn = n.data?.hierNode as HierarchyNode | undefined;
          return hn?.layer ?? "UNKNOWN";
        })
      ).size
    : 0;

  const onNodesChange = React.useCallback((changes: NodeChange<Node>[]) => {
    setLocalNodes((prev) => applyNodeChanges(changes, prev));
  }, []);

  const flushLayoutSave = React.useCallback(() => {
    const pending = pendingLayoutRef.current;
    if (!pending) return;
    pendingLayoutRef.current = null;
    void (async () => {
      try {
        await saveLayout(pending.orgId, pending.networkId, pending.positions);
        setSavedLayoutPositions((prev) => ({ ...(prev ?? {}), ...pending.positions }));
      } catch (error) {
        console.warn("[topology] failed to persist layout", error);
      }
    })();
  }, []);

  const onNodeDragStop = React.useCallback(
    (_evt: React.MouseEvent, _node: Node, allNodes: Node[]) => {
      if (!orgId || !networkId) return;
      const positions = Object.fromEntries(allNodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
      pendingLayoutRef.current = { orgId, networkId, positions };
      if (layoutSaveTimerRef.current) {
        clearTimeout(layoutSaveTimerRef.current);
        layoutSaveTimerRef.current = null;
      }
      layoutSaveTimerRef.current = setTimeout(() => {
        layoutSaveTimerRef.current = null;
        flushLayoutSave();
      }, LAYOUT_SAVE_DEBOUNCE_MS);
    },
    [orgId, networkId, flushLayoutSave]
  );

  return (
    <div className="topo-canvas-wrapper">
      <div className="view-mode-bar">
        {(Object.keys(VIEW_MODE_LABELS) as ViewMode[]).map((mode) => (
          <button
            type="button"
            key={mode}
            className={`view-btn${viewMode === mode ? " active" : ""}`}
            onClick={() => setViewMode(mode)}
          >
            {VIEW_MODE_LABELS[mode]}
          </button>
        ))}
        {graph && (
          <span className="topo-meta">
            {graph.nodes.length} devices · {graph.links.length} links · {layerCount} layers
          </span>
        )}
      </div>

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
          <button type="button" className="collapse-all-btn" onClick={() => setExpandedGroups(new Set())}>
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
        nodes={localNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        minZoom={0.15}
        maxZoom={2}
        nodesDraggable
        panOnDrag
        zoomOnScroll
        fitView
        proOptions={{ hideAttribution: false }}
      >
        <FlowControls nodeCount={localNodes.length} />
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
      {graph && edges.length === 0 && (
        <div className="topo-empty" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <span style={{ color: "#ffb86c", borderColor: "#8a5b2b" }}>
            No edges built. Check topology link mapping/fallback hierarchy.
          </span>
        </div>
      )}
    </div>
  );
}
