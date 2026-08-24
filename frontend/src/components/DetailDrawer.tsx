import { Icon } from "./Icon";
import { asDeviceClass, classVisuals } from "../topology/deviceClass";
import { shortIface } from "../topology/shortIface";
import type { RemediationAction, TopologyLink, TopologyNode } from "../types/topology";

interface NeighborRow {
  id: string;
  label: string;
  color: string;
  type: string;
  myIf: string;
  theirIf: string;
}

interface Props {
  node?: TopologyNode;
  link?: TopologyLink;
  neighbors: NeighborRow[];
  open: boolean;
  onClose: () => void;
  onGoto: (id: string) => void;
  onRemediation: (action: RemediationAction) => void;
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

function portSummary(port: Record<string, unknown>) {
  const config = (port.config as Record<string, unknown>) || {};
  const status = (port.status as Record<string, unknown>) || {};
  const poe = (status.poe as Record<string, unknown> | undefined) || {};
  return {
    serial: String(port.serial || "—"),
    portId: String(port.portId || "—"),
    name: String(config.name || status.name || "—"),
    mode: String(config.type || "—"),
    vlan: String(config.vlan ?? config.nativeVlan ?? "—"),
    allowed: String(config.allowedVlans || "—"),
    enabled: String(config.enabled ?? "—"),
    speed: String(status.speed || "—"),
    link: String(status.status || "—"),
    poe: String(poe.status ?? config.poeEnabled ?? "—"),
  };
}

export function DetailDrawer({ node, link, neighbors, open, onClose, onGoto, onRemediation }: Props) {
  if (!open || (!node && !link)) {
    return <aside id="detail" />;
  }

  if (node) {
    const cls = classVisuals(asDeviceClass(String(node.device_class)));
    const members = node.stack_members || [];
    const meta = node.metadata || {};
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
          <div className="d-ip">{node.management_ip || "—"}</div>
        </div>
        <div className="d-body">
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
        <div className="d-sub">
          <span className="bar" />
          <span className="t">Link</span>
        </div>
        <div className="d-grid">
          <Cell k="Discovery" v={link!.discovery_method} />
          <Cell k="Source IP" v={link!.source_management_ip} hideEmpty />
          <Cell k="Target IP" v={link!.target_management_ip} hideEmpty />
          <Cell k="Source platform" v={link!.source_platform} hideEmpty />
          <Cell k="Target platform" v={link!.target_platform} hideEmpty />
        </div>
        <div className="d-sub">
          <span className="bar" />
          <span className="t">Source port</span>
        </div>
        <div className="d-grid">
          <Cell k="Device" v={src.serial} />
          <Cell k="Port" v={src.portId} />
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
