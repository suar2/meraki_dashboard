import { Node } from "@xyflow/react";
import { TopologyLink, TopologyNode } from "../types/topology";

interface Props {
  node?: Node<any>;
  link?: TopologyLink;
  allNodes: TopologyNode[];
  allLinks: TopologyLink[];
}

export function DetailsPanel({ node, link }: Props) {
  if (!node && !link) {
    return <aside className="panel">Select a node or link to inspect details.</aside>;
  }

  if (node) {
    const details = (node.data?.details || {}) as Record<string, unknown>;
    const nodeType = String(node.data?.nodeType || "unknownDevice");
    return (
      <aside className="panel">
        <h3>{String(node.data?.label || node.id)}</h3>
        <p className="muted">{nodeType}</p>
        <div className="details-grid">
          <div><strong>Node ID</strong><span>{node.id}</span></div>
          <div><strong>Type</strong><span>{nodeType}</span></div>
          {"portId" in details && <div><strong>Port</strong><span>{String(details.portId)}</span></div>}
          {"config" in details && <div><strong>Config</strong><span>Available</span></div>}
          {"status" in details && <div><strong>Status</strong><span>Available</span></div>}
        </div>
        <details className="raw-details">
          <summary>Show details JSON</summary>
          <pre>{JSON.stringify(details, null, 2)}</pre>
        </details>
      </aside>
    );
  }

  const portSummary = (port: Record<string, unknown>) => {
    const config = (port.config as Record<string, unknown>) || {};
    const status = (port.status as Record<string, unknown>) || {};
    return {
      serial: String(port.serial || "Unknown"),
      portId: String(port.portId || "Unknown"),
      name: String(config.name || status.name || "Unknown"),
      mode: String(config.type || "Unknown"),
      vlan: String(config.vlan || config.nativeVlan || "Unknown"),
      enabled: String(config.enabled ?? "Unknown"),
      speed: String(status.speed || "Unknown"),
      link: String(status.status || "Unknown"),
    };
  };

  return (
    <aside className="panel">
      <h3>Interface / Link Details</h3>
      <p className="muted">{link!.source} {"->"} {link!.target} ({link!.discovery_method})</p>
      <div className="details-grid">
        <div><strong>Link Type</strong><span>{link!.link_type}</span></div>
        <div><strong>Health</strong><span>{link!.health}</span></div>
      </div>
      <h4>Source Interface</h4>
      <div className="details-grid">
        <div><strong>Device</strong><span>{portSummary(link!.source_port).serial}</span></div>
        <div><strong>Port ID</strong><span>{portSummary(link!.source_port).portId}</span></div>
        <div><strong>Name</strong><span>{portSummary(link!.source_port).name}</span></div>
        <div><strong>Mode</strong><span>{portSummary(link!.source_port).mode}</span></div>
        <div><strong>VLAN</strong><span>{portSummary(link!.source_port).vlan}</span></div>
        <div><strong>Enabled</strong><span>{portSummary(link!.source_port).enabled}</span></div>
        <div><strong>Speed</strong><span>{portSummary(link!.source_port).speed}</span></div>
        <div><strong>Status</strong><span>{portSummary(link!.source_port).link}</span></div>
      </div>
      <h4>Target Interface</h4>
      <div className="details-grid">
        <div><strong>Device</strong><span>{portSummary(link!.target_port).serial}</span></div>
        <div><strong>Port ID</strong><span>{portSummary(link!.target_port).portId}</span></div>
        <div><strong>Name</strong><span>{portSummary(link!.target_port).name}</span></div>
        <div><strong>Mode</strong><span>{portSummary(link!.target_port).mode}</span></div>
        <div><strong>VLAN</strong><span>{portSummary(link!.target_port).vlan}</span></div>
        <div><strong>Enabled</strong><span>{portSummary(link!.target_port).enabled}</span></div>
        <div><strong>Speed</strong><span>{portSummary(link!.target_port).speed}</span></div>
        <div><strong>Status</strong><span>{portSummary(link!.target_port).link}</span></div>
      </div>
    </aside>
  );
}
