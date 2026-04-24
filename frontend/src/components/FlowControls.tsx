import React from "react";
import { Panel, useReactFlow } from "@xyflow/react";

/**
 * Renders inside <ReactFlow> so useReactFlow() is available.
 * Fits the view when node count changes (e.g. after topology load).
 */
export function FlowControls({ nodeCount }: { nodeCount: number }) {
  const { fitView } = useReactFlow();
  const prevCountRef = React.useRef(0);

  React.useEffect(() => {
    if (nodeCount > 0 && nodeCount !== prevCountRef.current) {
      prevCountRef.current = nodeCount;
      requestAnimationFrame(() => fitView({ padding: 0.15, duration: 400 }));
    }
  }, [nodeCount, fitView]);

  return (
    <Panel position="top-left">
      <button
        onClick={() => fitView({ padding: 0.2, duration: 400 })}
        type="button"
        style={{
          background: "#0d1f38",
          color: "#7ab8f5",
          border: "1px solid #2e5080",
          borderRadius: 5,
          padding: "4px 10px",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Reset view
      </button>
    </Panel>
  );
}
