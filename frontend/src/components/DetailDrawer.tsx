import React from "react";
import { Icon } from "./Icon";
import { SwitchPortPanel } from "./SwitchPortPanel";
import { asDeviceClass, classVisuals } from "../topology/deviceClass";
import { describeLinkEvidence } from "../topology/evidence";
import { isDownstreamClient, isPhysicalChassis, isWirelessNode } from "../topology/presentGraph";
import { shortIface } from "../topology/shortIface";
import type { TraceHop } from "../topology/tracePath";
import type { RemediationAction, TopologyGraph, TopologyLink, TopologyNode } from "../types/topology";

interface NeighborRow {
  id: string;
  label: string;
  color: string;
  type: string;
  myIf: string;
  theirIf: string;
}

export interface MergeRequest {
  survivorId: string;
  memberId: string;
  label: string;
  survivorRole: string;
  memberRole: string;
}

interface Props {
  node?: TopologyNode;
  link?: TopologyLink;
  neighbors: NeighborRow[];
  open: boolean;
  onClose: () => void;
  onGoto: (id: string) => void;
  onRemediation: (action: RemediationAction) => void;
  switchPorts?: Array<Record<string, unknown>>;
  switchSerial?: string;
  highlightPortId?: string;
  peersByPort?: Record<string, Array<{ id: string; label: string }>>;
  onPortClick?: (portId: string) => void;
  onTrace?: (nodeId: string) => void;
  onExpandGroup?: (groupId: string) => void;
  traceHops?: TraceHop[];
  graph?: TopologyGraph | null;
  mergeCandidates?: TopologyNode[];
  onMerge?: (request: MergeRequest) => void;
  learnedByPort?: Record<string, Array<{ label: string; mac?: string; ip?: string }>>;
  changesByPort?: Record<string, Array<{ at: string; summary: string }>>;
}

function Cell({ k, v, hideEmpty }: { k: string; v: unknown; hideEmpty?: boolean }) {
  const text = v == null || v === "" ? "—" : String(v);
  if (hideEmpty && (text === "—" || text === "")) return null;
  return (
    <div className="d-cell full">
      <div className="k">{k}</div>
      <div className="v">{text}</div>
    </div>
  );
}

function clientsBehind(graph: TopologyGraph | null | undefined, node: TopologyNode): number {
  if (!graph) return 0;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>([node.id]);
  const queue = [node.id];
  let count = 0;
  while (queue.length) {
    const id = queue.shift()!;
    for (const link of graph.links) {
      if (link.source !== id && link.target !== id) continue;
      const other = link.source === id ? link.target : link.source;
      if (seen.has(other)) continue;
      seen.add(other);
      const peer = byId.get(other);
      if (!peer) continue;
      if (isWirelessNode(peer) || peer.type === "client" || isDownstreamClient(peer, byId)) {
        count += 1;
      }
      const cls = asDeviceClass(String(peer.device_class));
      if (isPhysicalChassis(peer) && cls !== "mx") queue.push(other);
      else if (peer.subtype === "server" || cls === "server") queue.push(other);
    }
  }
  return count;
}

function switchOps(ports: Array<Record<string, unknown>>, node: TopologyNode, graph?: TopologyGraph | null) {
  const rec = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  let connected = 0;
  let poe = 0;
  let trunks = 0;
  let warning = 0;
  for (const port of ports) {
    const sta = rec(port.status);
    const cfg = rec(port.config);
    const st = String(sta.status || "").toLowerCase();
    if (st.includes("connect") || st === "up") connected += 1;
    const poeSt = String(rec(sta.poe).status || "");
    if (poeSt && poeSt.toLowerCase() !== "off" && poeSt.toLowerCase() !== "disabled") poe += 1;
    else if (cfg.poeEnabled) poe += 1;
    if (String(cfg.type || "").toLowerCase() === "trunk") trunks += 1;
    if ((Array.isArray(sta.warnings) && sta.warnings.length) || (Array.isArray(sta.errors) && sta.errors.length) || st.includes("error")) {
      warning += 1;
    }
  }
  const clients = clientsBehind(graph, node);
  return { connected, poe, trunks, warning, clients, issues: node.issue_count || 0, critical: node.health.critical_count, warnings: node.health.warning_count };
}

function portSummary(port: Record<string, unknown>) {
  const config = (port.config as Record<string, unknown>) || {};
  const status = (port.status as Record<string, unknown>) || {};
  const poe = (status.poe as Record<string, unknown> | undefined) || {};
  return {
    serial: String(port.serial || "—"),
    portId: String(port.portId || "—"),
    name: String(config.name || status.name || port.label || "—"),
    mode: String(config.type || "—"),
    vlan: String(config.vlan ?? config.nativeVlan ?? "—"),
    allowed: String(config.allowedVlans || "—"),
    enabled: String(config.enabled ?? "—"),
    speed: String(status.speed || "—"),
    link: String(status.status || "—"),
    poe: String(poe.status ?? config.poeEnabled ?? "—"),
    role: String(port.role || ""),
    clientCount: status.clientCount ?? port.clientCount ?? "",
  };
}

export function DetailDrawer({
  node,
  link,
  neighbors,
  open,
  onClose,
  onGoto,
  onRemediation,
  switchPorts,
  switchSerial,
  highlightPortId,
  peersByPort,
  onPortClick,
  onTrace,
  onExpandGroup,
  traceHops,
  graph,
  mergeCandidates,
  onMerge,
  learnedByPort,
  changesByPort,
}: Props) {
  const [mergeId, setMergeId] = React.useState("");
  const [mergeLabel, setMergeLabel] = React.useState("");
  const [survivorRole, setSurvivorRole] = React.useState("management");
  const [memberRole, setMemberRole] = React.useState("fabric");

  React.useEffect(() => {
    setMergeId("");
    setMergeLabel(node?.hostname || node?.label || "Server");
    setSurvivorRole("management");
    setMemberRole("fabric");
  }, [node?.id]);

  if (!open || (!node && !link)) {
    return <aside id="detail" />;
  }

  const portStrip =
    switchPorts && switchPorts.length && switchSerial ? (
      <SwitchPortPanel
        serial={switchSerial}
        ports={switchPorts}
        highlightPortId={highlightPortId}
        peersByPort={peersByPort}
        onPortClick={onPortClick}
        learnedByPort={learnedByPort}
        changesByPort={changesByPort}
      />
    ) : null;

  if (node) {
    const cls = classVisuals(asDeviceClass(String(node.device_class)));
    const members = node.stack_members || [];
    const meta = node.metadata || {};
    const physicalIfaces = Array.isArray(meta.physical_interfaces) ? (meta.physical_interfaces as Array<Record<string, unknown>>) : [];
    const canMerge = Boolean(onMerge && mergeCandidates && mergeCandidates.length && !node.managed && node.subtype !== "wireless");
    return (
      <aside id="detail" className="open">
        <div className="d-head">
          <button type="button" className="d-close" onClick={onClose} aria-label="Close details">
            <Icon name="x" />
          </button>
          <div className="d-type">
            <span className="dot" style={{ background: cls.color }} />
            <span className="label" style={{ color: cls.color }}>
              {cls.label}
            </span>
            <span className={`health-pill ${node.health.state}`}>{node.health.state}</span>
          </div>
          <div className="d-name">{node.hostname || node.label}</div>
          <div className="d-ip">{node.platform || node.subtype}</div>
          <div className="d-ip">{String(node.metadata?.status || node.health.state)}</div>
        </div>
        <div className="d-body">
          {node.type === "group" && onExpandGroup && (
            <button type="button" className="fix-btn" onClick={() => onExpandGroup(node.id)}>
              Show {String(node.metadata?.count || "")} clients
            </button>
          )}
          {onTrace && node.type !== "group" && (
            <button type="button" className="fix-btn ghost" onClick={() => onTrace(node.id)}>
              Trace to Internet
            </button>
          )}
          {traceHops && traceHops.length > 0 && (
            <ol className="trace-hops">
              {traceHops.map((h, i) => (
                <li key={`${h.nodeId}-${i}`}>
                  {h.via ? <span className="trace-via">{h.via}</span> : null}
                  <button type="button" className="trace-node" onClick={() => h.nodeId !== "internet" && onGoto(h.nodeId)}>
                    {h.label}
                  </button>
                </li>
              ))}
            </ol>
          )}
          {portStrip}
          <div className="d-sub">
            <span className="bar" />
            <span className="t">Management</span>
          </div>
          <div className="d-grid">
            <Cell k="IP" v={node.management_ip} />
            <Cell k="Firmware" v={members[0]?.software_version || node.software_version} hideEmpty />
            <Cell k="Serial" v={members[0]?.serial_number || node.serial} hideEmpty />
          </div>
          {switchPorts && switchPorts.length > 0 && (
            <>
              <div className="d-sub">
                <span className="bar" />
                <span className="t">Operations</span>
              </div>
              <div className="ops-grid">
                {(() => {
                  const ops = switchOps(switchPorts, node, graph);
                  return (
                    <>
                      <div className="ops-cell">
                        <b>{ops.connected}</b>
                        <span>connected</span>
                      </div>
                      <div className="ops-cell">
                        <b>{ops.poe}</b>
                        <span>PoE</span>
                      </div>
                      <div className="ops-cell">
                        <b>{ops.trunks}</b>
                        <span>trunks</span>
                      </div>
                      <div className="ops-cell">
                        <b>{ops.warning}</b>
                        <span>port warnings</span>
                      </div>
                      <div className="ops-cell">
                        <b>{ops.clients}</b>
                        <span>clients</span>
                      </div>
                      <div className="ops-cell">
                        <b>{ops.critical}</b>
                        <span>critical</span>
                      </div>
                      <div className="ops-cell">
                        <b>{ops.warnings}</b>
                        <span>warnings</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </>
          )}
          <div className="d-sub">
            <span className="bar" />
            <span className="t">Details</span>
          </div>
          <div className="d-grid">
            <Cell k="Platform" v={node.platform} />
            {members.length <= 1 && (
              <>
                <Cell k="Firmware" v={members[0]?.software_version || node.software_version} hideEmpty />
                <Cell k="Serial Number" v={members[0]?.serial_number || node.serial} hideEmpty />
              </>
            )}
            <Cell k="Location" v={node.location} />
            <Cell k="Managed" v={node.managed ? "yes" : "no"} />
            <Cell k="Product" v={meta.productType || node.subtype} />
            <Cell k="MAC" v={meta.mac || meta.macAddress} hideEmpty />
            <Cell k="Status" v={meta.status} hideEmpty />
            <Cell k="Neighbors" v={node.degree} />
            <Cell k="Issues" v={node.issue_count} />
            <Cell k="SSID" v={meta.ssid} hideEmpty />
            <Cell k="OS" v={meta.os} hideEmpty />
          </div>
          {physicalIfaces.length > 0 && (
            <>
              <div className="d-sub">
                <span className="bar" />
                <span className="t">Physical interfaces</span>
              </div>
              <div className="d-grid">
                {physicalIfaces.map((iface) => (
                  <Cell
                    key={`${iface.port_id}-${iface.role}`}
                    k={String(iface.role || "link")}
                    v={`p${iface.port_id}${iface.switch_serial ? ` · ${iface.switch_serial}` : ""}`}
                  />
                ))}
              </div>
            </>
          )}
          {members.length > 1 && (
            <>
              <div className="d-sub">
                <span className="bar" />
                <span className="t">Members</span>
              </div>
              <div className="d-cell">
                <table className="stack-tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Role</th>
                      <th>Serial</th>
                      <th>Firmware</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={`${m.id}-${m.serial_number}`}>
                        <td>{m.id}</td>
                        <td>{m.role || "—"}</td>
                        <td className="sm-mono">{m.serial_number || "—"}</td>
                        <td className="sm-mono">{m.software_version || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="d-sub">
            <span className="bar" />
            <span className="t">Neighbors</span>
            <span className="n">{neighbors.length} link{neighbors.length !== 1 ? "s" : ""}</span>
          </div>
          <div id="d-nbrs">
            {neighbors.length === 0 && <div className="res-empty">No neighbors</div>}
            {neighbors.map((r) => (
              <div key={`${r.id}-${r.myIf}`} className="nbr" role="button" tabIndex={0} onClick={() => onGoto(r.id)} onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onGoto(r.id);
              }}>
                <span className="dot" style={{ background: r.color }} />
                <div className="nbr-main">
                  <div className="nbr-name">{r.label}</div>
                  <div className="nbr-path">
                    <em>{r.myIf || "—"}</em> → {r.theirIf || "—"}
                  </div>
                </div>
                <Icon name="chevron-right" className="arr" />
              </div>
            ))}
          </div>
          {canMerge && (
            <div className="merge-box">
              <div className="d-sub">
                <span className="bar" />
                <span className="t">Merge as same physical device</span>
              </div>
              <p className="merge-help">
                Use this when two NICs (for example management and fabric) belong to one chassis. The association is stored in the backend.
              </p>
              <label className="merge-field">
                Other device
                <select value={mergeId} onChange={(e) => setMergeId(e.target.value)}>
                  <option value="">Select…</option>
                  {mergeCandidates!.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.hostname || c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="merge-field">
                Chassis name
                <input value={mergeLabel} onChange={(e) => setMergeLabel(e.target.value)} />
              </label>
              <div className="merge-roles">
                <label className="merge-field">
                  This NIC
                  <select value={survivorRole} onChange={(e) => setSurvivorRole(e.target.value)}>
                    <option value="management">Management</option>
                    <option value="fabric">Fabric / SFP</option>
                    <option value="uplink">Uplink</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="merge-field">
                  Other NIC
                  <select value={memberRole} onChange={(e) => setMemberRole(e.target.value)}>
                    <option value="management">Management</option>
                    <option value="fabric">Fabric / SFP</option>
                    <option value="uplink">Uplink</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              </div>
              <button
                type="button"
                className="fix-btn"
                disabled={!mergeId}
                onClick={() =>
                  onMerge?.({
                    survivorId: node.id,
                    memberId: mergeId,
                    label: mergeLabel || "Server",
                    survivorRole,
                    memberRole,
                  })
                }
              >
                Merge chassis
              </button>
            </div>
          )}
        </div>
      </aside>
    );
  }

  const src = portSummary(link!.source_port || {});
  const tgt = portSummary(link!.target_port || {});
  const issues = [...(link!.mismatches || []), ...(link!.faults || [])];
  return (
    <aside id="detail" className="open">
      <div className="d-head">
        <button type="button" className="d-close" onClick={onClose} aria-label="Close details">
          <Icon name="x" />
        </button>
        <div className="d-type">
          <span className="dot" style={{ background: "var(--teal)" }} />
          <span className="label">{link!.link_type} link</span>
          <span className={`health-pill ${link!.health}`}>{link!.health}</span>
        </div>
        <div className="d-name">
          {link!.source_hostname || link!.source} ↔ {link!.target_hostname || link!.target}
        </div>
        <div className="d-ip">
          {shortIface(link!.source_interface)} ↔ {shortIface(link!.target_interface)}
        </div>
      </div>
      <div className="d-body">
        {portStrip}
        <div className="d-sub">
          <span className="bar" />
          <span className="t">Link</span>
        </div>
        <div className="d-grid">
          <Cell k="Confidence" v={(link!.confidence || describeLinkEvidence(link!).confidence).toUpperCase()} />
          <Cell k="Discovery" v={link!.discovery_method} />
          <Cell k="Role" v={link!.interface_role} hideEmpty />
          <Cell k="Source device" v={src.serial} />
          <Cell k="Source port" v={src.portId} />
          <Cell k="Target device" v={tgt.serial} />
          <Cell k="Target port" v={tgt.portId} />
          <Cell k="Client count (through port)" v={src.clientCount} hideEmpty />
          <Cell k="Source IP" v={link!.source_management_ip} hideEmpty />
          <Cell k="Target IP" v={link!.target_management_ip} hideEmpty />
        </div>
        {(() => {
          const ev = describeLinkEvidence(link!);
          return (
            <>
              <div className="d-sub">
                <span className="bar" />
                <span className="t">Evidence</span>
                <span className={`n conf-${ev.confidence}`}>{ev.confidence}</span>
              </div>
              <p className="merge-help">{ev.summary}</p>
              <ul className="evidence-list">
                {ev.items.map((item) => (
                  <li key={item.key} className={item.ok ? "ok" : "miss"}>
                    {item.ok ? "✓" : "○"} {item.label}
                  </li>
                ))}
              </ul>
            </>
          );
        })()}
        <div className="d-sub">
          <span className="bar" />
          <span className="t">Source port</span>
        </div>
        <div className="d-grid">
          <Cell k="Device" v={src.serial} />
          <Cell k="Port" v={src.portId} />
          <Cell k="Role" v={src.role} hideEmpty />
          <Cell k="Mode" v={src.mode} />
          <Cell k="VLAN" v={src.vlan} />
          <Cell k="Allowed VLANs" v={src.allowed} hideEmpty />
          <Cell k="Enabled" v={src.enabled} />
          <Cell k="Speed" v={src.speed} hideEmpty />
          <Cell k="Status" v={src.link} hideEmpty />
          <Cell k="PoE" v={src.poe} hideEmpty />
        </div>
        <div className="d-sub">
          <span className="bar" />
          <span className="t">Target port</span>
        </div>
        <div className="d-grid">
          <Cell k="Device" v={tgt.serial} />
          <Cell k="Port" v={tgt.portId} />
          <Cell k="Role" v={tgt.role} hideEmpty />
          <Cell k="Mode" v={tgt.mode} />
          <Cell k="VLAN" v={tgt.vlan} />
          <Cell k="Allowed VLANs" v={tgt.allowed} hideEmpty />
          <Cell k="Enabled" v={tgt.enabled} />
          <Cell k="Speed" v={tgt.speed} hideEmpty />
          <Cell k="Status" v={tgt.link} hideEmpty />
          <Cell k="PoE" v={tgt.poe} hideEmpty />
        </div>
        <div className="d-sub">
          <span className="bar" />
          <span className="t">Findings</span>
          <span className="n">{issues.length}</span>
        </div>
        {issues.length === 0 && <div className="res-empty">No mismatches or faults</div>}
        {issues.map((iss) => (
          <div key={iss.id} className={`issue-row ${iss.severity}`}>
            <strong>
              {iss.severity.toUpperCase()} · {iss.category}
            </strong>
            <p>{iss.description}</p>
            {iss.suggested_actions?.length > 0 && (
              <ul>
                {iss.suggested_actions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {(link!.remediable_actions?.length ?? 0) > 0 && (
          <div className="d-actions">
            {link!.remediable_actions.map((a) => (
              <button key={a.id} type="button" className="fix-btn" onClick={() => onRemediation(a)}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
