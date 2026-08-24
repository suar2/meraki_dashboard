import { shortIface } from "../topology/shortIface";

type PortRecord = Record<string, unknown>;

interface Props {
  serial: string;
  ports: PortRecord[];
  highlightPortId?: string;
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

function isSfp(port: PortRecord): boolean {
  const id = String(port.portId || "");
  const n = parseInt(id, 10);
  return Number.isFinite(n) && n >= 13;
}

export function SwitchPortPanel({ serial, ports, highlightPortId }: Props) {
  if (!ports.length) return null;
  const highlight = String(highlightPortId || "").replace(/^port/i, "");
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
          const active = Boolean(highlight && (id === highlight || id === String(parseInt(highlight, 10))));
          const cfg = asRecord(port.config);
          const name = String(cfg.name || "");
          const title = [`Port ${id}`, name, up ? "connected" : "unused", String(cfg.type || "")].filter(Boolean).join(" · ");
          return (
            <div
              key={id}
              role="listitem"
              title={title}
              className={`port-jack${up ? " up" : ""}${active ? " hi" : ""}${isSfp(port) ? " sfp" : ""}`}
            >
              <span className="port-num">{shortIface(id)}</span>
            </div>
          );
        })}
      </div>
      <div className="port-legend">
        <span>
          <i className="port-jack up" /> used
        </span>
        <span>
          <i className="port-jack" /> unused
        </span>
        {highlight ? (
          <span>
            <i className="port-jack hi up" /> selected link
          </span>
        ) : null}
      </div>
    </div>
  );
}
