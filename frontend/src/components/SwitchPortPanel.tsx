import React from "react";
import { shortIface } from "../topology/shortIface";

type PortRecord = Record<string, unknown>;

interface Peer {
  id: string;
  label: string;
}

interface Props {
  serial: string;
  ports: PortRecord[];
  highlightPortId?: string;
  peersByPort?: Record<string, Peer[]>;
  onPortClick?: (portId: string) => void;
}

function asRecord(value: unknown): PortRecord {
  return value && typeof value === "object" ? (value as PortRecord) : {};
}

function statusOf(port: PortRecord): string {
  return String(asRecord(port.status).status || "").toLowerCase();
}

function isUp(port: PortRecord): boolean {
  const st = statusOf(port);
  return st.includes("connect") || st === "up";
}

function isDown(port: PortRecord): boolean {
  const st = statusOf(port);
  return st.includes("error") || st.includes("down") || Boolean(asRecord(port.status).errors);
}

function isSfp(port: PortRecord): boolean {
  const id = String(port.portId || "");
  const n = parseInt(id, 10);
  return Number.isFinite(n) && n >= 13;
}

function poeOf(port: PortRecord): string {
  const status = asRecord(port.status);
  const poe = asRecord(status.poe);
  const cfg = asRecord(port.config);
  return String(poe.status || (cfg.poeEnabled ? "enabled" : "") || "");
}

export function SwitchPortPanel({ serial, ports, highlightPortId, peersByPort, onPortClick }: Props) {
  const [picked, setPicked] = React.useState(String(highlightPortId || ""));
  React.useEffect(() => {
    setPicked(String(highlightPortId || ""));
  }, [highlightPortId, serial]);
  if (!ports.length) return null;
  const highlight = String(picked || highlightPortId || "").replace(/^port/i, "");
  const selected = ports.find((p) => String(p.portId) === highlight || String(p.portId) === String(parseInt(highlight, 10)));
  const cfg = selected ? asRecord(selected.config) : {};
  const sta = selected ? asRecord(selected.status) : {};
  const peers = selected ? peersByPort?.[String(selected.portId)] || [] : [];

  return (
    <div className="port-panel">
      <div className="d-sub">
        <span className="bar" />
        <span className="t">Physical ports</span>
        <span className="n">{serial}</span>
      </div>
      <div className="port-strip" role="list">
        {ports.map((port) => {
          const id = String(port.portId || "");
          const up = isUp(port);
          const down = isDown(port);
          const active = Boolean(highlight && (id === highlight || id === String(parseInt(highlight, 10))));
          const name = String(asRecord(port.config).name || "");
          const mode = String(asRecord(port.config).type || "");
          const peersHere = peersByPort?.[id] || [];
          const title = [`Port ${id}`, name, up ? "connected" : down ? "down" : "unused", mode, peersHere[0]?.label]
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              key={id}
              type="button"
              role="listitem"
              title={title}
              className={`port-jack${up ? " up" : ""}${down ? " down" : ""}${active ? " hi" : ""}${isSfp(port) ? " sfp" : ""}`}
              onClick={() => {
                setPicked(id);
                onPortClick?.(id);
              }}
            >
              <span className="port-num">{shortIface(id)}</span>
            </button>
          );
        })}
      </div>
      <div className="port-legend">
        <span>
          <i className="port-jack up" /> connected
        </span>
        <span>
          <i className="port-jack" /> unused
        </span>
        <span>
          <i className="port-jack down" /> down
        </span>
      </div>
      {selected && (
        <div className="port-detail">
          <div className="port-detail-title">Port {String(selected.portId)}</div>
          <dl className="port-dl">
            <div>
              <dt>State</dt>
              <dd>{String(sta.status || (isUp(selected) ? "Connected" : "Disconnected"))}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{String(cfg.type || "—")}</dd>
            </div>
            <div>
              <dt>VLAN</dt>
              <dd>{String(cfg.vlan ?? cfg.nativeVlan ?? "—")}</dd>
            </div>
            <div>
              <dt>Speed</dt>
              <dd>{String(sta.speed || "—")}</dd>
            </div>
            <div>
              <dt>PoE</dt>
              <dd>{poeOf(selected) || "—"}</dd>
            </div>
            <div>
              <dt>Clients</dt>
              <dd>{String(sta.clientCount ?? "—")}</dd>
            </div>
            <div className="full">
              <dt>Connected</dt>
              <dd>{peers.length ? peers.map((p) => p.label).join(", ") : "—"}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
