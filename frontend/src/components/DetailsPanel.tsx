import { TopologyLink, TopologyNode } from "../types/topology";

interface Props {
  node?: TopologyNode;
  link?: TopologyLink;
  allNodes: TopologyNode[];
  allLinks: TopologyLink[];
}

export function DetailsPanel({ node, link }: Props) {
  const displayValue = (value: unknown): string => {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
  };

  if (!node && !link) {
    return <aside className="panel">Select a node or link to inspect details.</aside>;
  }

  if (node) {
    const serial = displayValue(node.metadata?.serial ?? node.id);
    const model = displayValue(node.metadata?.model ?? node.metadata?.productType);
    const lanIp = displayValue(node.metadata?.lanIp ?? node.metadata?.ip);
    const mac = displayValue(node.metadata?.mac ?? node.metadata?.macAddress);
    const metadataEntries = Object.entries(node.metadata || {}).sort(([a], [b]) => a.localeCompare(b));
    const clientCount = allLinks.filter((l) => l.source === node.id && l.link_type === "wireless").length;
    const uplinks = allLinks.filter((l) => l.target === node.id && l.link_type !== "wireless").length;
    const lastSeen = displayValue(node.metadata?.lastReportedAt ?? node.metadata?.lastSeen ?? node.metadata?.seenAt);
    return (
      <aside className="panel">
        <h3>{node.label}</h3>
        <p className="muted">{node.subtype} · {node.managed ? "managed" : "unmanaged"}</p>
        <div className="details-grid">
          <div><strong>ID</strong><span>{node.id}</span></div>
          <div><strong>Serial</strong><span>{serial}</span></div>
          <div><strong>Model</strong><span>{model}</span></div>
          <div><strong>Product Type</strong><span>{displayValue(node.metadata?.productType ?? node.subtype)}</span></div>
          <div><strong>Network</strong><span>{displayValue(node.network?.name ?? node.network?.id)}</span></div>
          <div><strong>Status</strong><span>{displayValue(node.metadata?.status ?? node.health.state)}</span></div>
          <div><strong>IP</strong><span>{lanIp}</span></div>
          <div><strong>Mgmt IP</strong><span>{displayValue(node.metadata?.managementIp ?? node.metadata?.wan1Ip ?? node.metadata?.ip)}</span></div>
          <div><strong>MAC</strong><span>{mac}</span></div>
          <div><strong>Client Count</strong><span>{clientCount}</span></div>
          <div><strong>Uplinks</strong><span>{uplinks}</span></div>
          <div><strong>Last Seen</strong><span>{lastSeen}</span></div>
          <div><strong>Health</strong><span>{node.health.state}</span></div>
          {node.issue_count > 0 && (
            <div><strong>Issues</strong><span>{node.issue_count}</span></div>
          )}
        </div>
        <h4>Metadata</h4>
        <div className="details-grid">
          {metadataEntries.length === 0 && (
            <div><strong>metadata</strong><span>—</span></div>
          )}
          {metadataEntries.map(([key, value]) => {
            const rendered = displayValue(value);
            const isComplex = typeof value === "object" && value !== null;
            return (
              <div key={key} style={isComplex ? { gridColumn: "1 / -1" } : undefined}>
                <strong>{key}</strong>
                {isComplex ? (
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{rendered}</pre>
                ) : (
                  <span>{rendered}</span>
                )}
              </div>
            );
          })}
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
      poe: String((status.poe as Record<string, unknown> | undefined)?.status || config.poeEnabled || "Unknown"),
      discovery: String(port.discovery || "lldp_cdp"),
    };
  };
  const mismatches = link?.mismatches ?? [];
  const faults = link?.faults ?? [];
  const fixableCount = mismatches.filter((i) => i.remediable).length + faults.filter((i) => i.remediable).length;

  return (
    <aside className="panel">
      <h3>Interface / Link Details</h3>
      <p className="muted">{link!.source} {"->"} {link!.target} ({link!.discovery_method})</p>
      <div className="details-grid">
        <div><strong>Link Type</strong><span>{link!.link_type}</span></div>
        <div><strong>Health</strong><span>{link!.health}</span></div>
        <div><strong>Discovery</strong><span>{link!.discovery_method}</span></div>
        <div><strong>Fixable Issues</strong><span>{fixableCount}</span></div>
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
        <div><strong>PoE</strong><span>{portSummary(link!.source_port).poe}</span></div>
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
        <div><strong>PoE</strong><span>{portSummary(link!.target_port).poe}</span></div>
      </div>
      <h4>Mismatches / Faults</h4>
      <div className="details-grid">
        {mismatches.length === 0 && faults.length === 0 && (
          <div><strong>Issues</strong><span>None</span></div>
        )}
        {[...mismatches, ...faults].map((issue) => (
          <div key={issue.id} style={{ gridColumn: "1 / -1", display: "block" }}>
            <strong>{issue.severity.toUpperCase()} · {issue.category}</strong>
            <pre style={{ marginTop: 6 }}>{JSON.stringify({
              description: issue.description,
              scope: issue.scope,
              fixable: issue.remediable,
              suggested: issue.suggested_actions ?? [],
            }, null, 2)}</pre>
          </div>
        ))}
      </div>
    </aside>
  );
}
