import React from "react";
import { TopologyGraph } from "../types/topology";

export function TopologyDebugPanel({ graph, open, onClose }: { graph: TopologyGraph | null; open: boolean; onClose: () => void }) {
  const d = graph?.topology_debug ?? {};
  const sp = graph?.switch_ports ?? {};
  const csp = graph?.clients_by_switch_port ?? {};
  const serials = Object.keys(sp);
  const sampleSerial = serials[0];
  const portsForSample = sampleSerial ? sp[sampleSerial] : [];
  const hintCount = (graph?.port_peer_hints ?? []).length;

  const summary = graph
    ? {
        nodeCount: graph.nodes.length,
        linkCount: graph.links.length,
        switchPortDevices: serials.length,
        clientsByPortKeys: Object.keys(csp).length,
        portPeerHints: hintCount,
        ...d,
      }
    : null;

  React.useEffect(() => {
    if (!open || !graph) return;
    const sum = {
      nodeCount: graph.nodes.length,
      linkCount: graph.links.length,
      switchPortDevices: Object.keys(graph.switch_ports ?? {}).length,
      clientsByPortKeys: Object.keys(graph.clients_by_switch_port ?? {}).length,
      portPeerHints: (graph.port_peer_hints ?? []).length,
      ...(graph.topology_debug ?? {}),
    };
    const ser0 = Object.keys(graph.switch_ports ?? {})[0];
    const p0 = ser0 ? (graph.switch_ports ?? {})[ser0] : [];
    const cport = graph.clients_by_switch_port ?? {};
    console.info("[topology:debug] summary", sum);
    if (ser0) {
      console.info(`[topology:debug] sample ports for ${ser0} (n=${(p0 as unknown[]).length})`, (p0 as unknown[]).slice(0, 32));
    }
    console.info(
      "[topology:debug] clients per port (first 16 keys, counts)",
      Object.entries(cport)
        .slice(0, 16)
        .map(([k, v]) => [k, (v as unknown[]).length])
    );
    const tr = (graph.topology_debug as { trunk_port_ids?: string[] } | undefined)?.trunk_port_ids;
    if (tr?.length) console.info("[topology:debug] trunk port ids", tr);
  }, [open, graph?.generated_at]);

  if (!open || !graph || !summary) return null;

  return (
    <div
      className="topo-debug-panel"
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        width: 420,
        maxHeight: "46vh",
        overflow: "auto",
        background: "#0a1522",
        border: "1px solid #2e5080",
        borderRadius: 8,
        padding: 10,
        fontSize: 11,
        color: "#b8d0e8",
        zIndex: 10020,
        boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <strong style={{ color: "#7ab8f5" }}>Topology debug</strong>
        <button type="button" onClick={onClose} style={{ cursor: "pointer" }}>
          Close
        </button>
      </div>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{JSON.stringify(summary, null, 2)}</pre>
    </div>
  );
}
