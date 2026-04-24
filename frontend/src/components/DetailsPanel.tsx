import { TopologyLink, TopologyNode } from "../types/topology";

interface Props {
  node?: TopologyNode;
  link?: TopologyLink;
  allNodes: TopologyNode[];
  allLinks: TopologyLink[];
}

export function DetailsPanel({ node, link }: Props) {
  if (!node && !link) {
    return <aside className="panel">Select a node or link to inspect details.</aside>;
  }

  if (node) {
    const serial = String(node.metadata?.serial || node.id);
    const model = String(node.metadata?.model || node.metadata?.productType || "—");
    const lanIp = String(node.metadata?.lanIp || node.metadata?.ip || "—");
    const mac = String(node.metadata?.mac || node.metadata?.macAddress || "—");
    return (
      <aside className="panel">
        <h3>{node.label}</h3>
        <p className="muted">{node.subtype} · {node.managed ? "managed" : "unmanaged"}</p>
        <div className="details-grid">
          <div><strong>ID</strong><span>{node.id}</span></div>
          <div><strong>Serial</strong><span>{serial}</span></div>
          <div><strong>Model</strong><span>{model}</span></div>
          <div><strong>IP</strong><span>{lanIp}</span></div>
          <div><strong>MAC</strong><span>{mac}</span></div>
          <div><strong>Health</strong><span>{node.health.state}</span></div>
          {node.issue_count > 0 && (
            <div><strong>Issues</strong><span>{node.issue_count}</span></div>
          )}
        </div>
        <details className="raw-details">
          <summary>Show metadata JSON</summary>
          <pre>{JSON.stringify(node.metadata, null, 2)}</pre>
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
