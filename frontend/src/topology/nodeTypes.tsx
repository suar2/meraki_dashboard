import React from "react";
import { NodeProps } from "@xyflow/react";
import { HierarchyNode } from "./buildHierarchy";

interface NodeData {
  hierNode: HierarchyNode;
  label: string;
  width: number;
  height: number;
  onGroupToggle?: (id: string) => void;
  [key: string]: unknown;
}

function healthColor(state: string): string {
  if (state === "critical") return "#e84040";
  if (state === "warning") return "#d9920a";
  return "#2da862";
}

function healthBg(state: string): string {
  if (state === "critical") return "#2a0808";
  if (state === "warning") return "#251a00";
  return "#071f14";
}

// ── WAN node (cloud-like) ────────────────────────────────────────────────────
export function WanNode({ data }: NodeProps) {
  const d = data as NodeData;
  const w = d.width ?? 140;
  const h = d.height ?? 50;
  return (
    <div
      style={{
        width: w,
        height: h,
        background: "#1a2a42",
        border: "2px dashed #4a6fa1",
        borderRadius: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#9bb8d8",
        fontSize: 12,
        fontWeight: 600,
        gap: 6,
        cursor: "default",
      }}
    >
      <span style={{ fontSize: 16 }}>☁</span>
      {d.label}
    </div>
  );
}

// ── Firewall node (hexagon via clip-path) ────────────────────────────────────
export function FirewallNode({ data }: NodeProps) {
  const d = data as NodeData;
  const n = d.hierNode;
  const health = n.rawNode.health.state;
  const w = d.width ?? 160;
  const h = d.height ?? 56;

  return (
    <div
      style={{
        width: w,
        height: h,
        background: healthBg(health),
        border: `2.5px solid ${healthColor(health)}`,
        clipPath: "polygon(8% 0%, 92% 0%, 100% 50%, 92% 100%, 8% 100%, 0% 50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "#eaf1ff",
        fontSize: 11,
        fontWeight: 700,
        textAlign: "center",
        padding: "0 18px",
        gap: 2,
        cursor: "pointer",
      }}
    >
      <span style={{ fontSize: 14 }}>🛡</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: w - 36 }}>
        {d.label}
      </span>
      {n.rawNode.issue_count > 0 && (
        <span style={{ fontSize: 9, color: healthColor(health) }}>
          {n.rawNode.issue_count} issue{n.rawNode.issue_count > 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

// ── Infrastructure node (switch, core switch) ────────────────────────────────
export function InfraNode({ data }: NodeProps) {
  const d = data as NodeData;
  const n = d.hierNode;
  const health = n.rawNode.health.state;
  const w = d.width ?? 160;
  const h = d.height ?? 56;
  const isCore = n.layer === "CORE_SWITCH";

  return (
    <div
      style={{
        width: w,
        height: h,
        background: isCore ? "#0c1d40" : "#0b1f38",
        border: `2px solid ${healthColor(health)}`,
        borderRadius: 6,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "#eaf1ff",
        fontSize: 11,
        fontWeight: 600,
        textAlign: "center",
        padding: "0 8px",
        gap: 2,
        cursor: "pointer",
        boxShadow: isCore ? "0 0 0 1px #2050a0" : undefined,
      }}
    >
      <span style={{ fontSize: 13 }}>{isCore ? "🔀" : "⬛"}</span>
      <span
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: w - 16 }}
        title={d.label}
      >
        {d.label}
      </span>
      {n.rawNode.issue_count > 0 && (
        <span style={{ fontSize: 9, color: healthColor(health) }}>
          ⚠ {n.rawNode.issue_count}
        </span>
      )}
    </div>
  );
}

// ── Access Point node (circle) ───────────────────────────────────────────────
export function ApNode({ data }: NodeProps) {
  const d = data as NodeData;
  const n = d.hierNode;
  const health = n.rawNode.health.state;
  const size = d.width ?? 90;

  return (
    <div
      style={{
        width: size,
        height: size,
        background: healthBg(health),
        border: `2.5px solid ${healthColor(health)}`,
        borderRadius: "50%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "#eaf1ff",
        fontSize: 10,
        fontWeight: 600,
        textAlign: "center",
        gap: 2,
        cursor: "pointer",
      }}
    >
      <span style={{ fontSize: 15 }}>📡</span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: size - 10,
          padding: "0 4px",
        }}
        title={d.label}
      >
        {d.label}
      </span>
    </div>
  );
}

// ── Client Group node (rounded rectangle, expandable) ───────────────────────
export function ClientGroupNode({ data }: NodeProps) {
  const d = data as NodeData;
  const n = d.hierNode;
  const w = d.width ?? 130;
  const h = d.height ?? 48;
  const isWifi = n.groupType === "wifi";

  return (
    <div
      style={{
        width: w,
        height: h,
        background: "#0c1b30",
        border: `1.5px solid ${isWifi ? "#3a7acc" : "#2a7a4a"}`,
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        color: "#c8dff5",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        userSelect: "none",
      }}
      title="Click to expand clients"
    >
      <span style={{ fontSize: 14 }}>{isWifi ? "📶" : "🔌"}</span>
      <span>{d.label}</span>
      <span
        style={{
          fontSize: 9,
          background: isWifi ? "#1a3a6a" : "#0e3020",
          border: `1px solid ${isWifi ? "#3a7acc" : "#2a7a4a"}`,
          borderRadius: 8,
          padding: "1px 5px",
          color: isWifi ? "#7ab8f5" : "#6ad4a0",
        }}
      >
        +
      </span>
    </div>
  );
}

// ── Individual client node (small circle) ────────────────────────────────────
export function ClientNode({ data }: NodeProps) {
  const d = data as NodeData;
  const n = d.hierNode;
  const w = d.width ?? 130;
  const h = d.height ?? 48;
  const isWifi = n.groupType === "wifi";

  const icon = (() => {
    const label = d.label.toLowerCase();
    const os = String(n.rawNode.metadata?.os || "").toLowerCase();
    if (label.includes("iphone") || label.includes("android") || os.includes("ios") || os.includes("android")) return "📱";
    if (label.includes("print") || os.includes("print")) return "🖨";
    if (label.includes("camera")) return "📷";
    return isWifi ? "💻" : "🖥";
  })();

  return (
    <div
      style={{
        width: w,
        height: h,
        background: "#081520",
        border: "1px solid #2a4060",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        gap: 5,
        color: "#9ab5d0",
        fontSize: 10,
        fontWeight: 500,
        padding: "0 8px",
        cursor: "pointer",
        overflow: "hidden",
      }}
    >
      <span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={d.label}
      >
        {d.label}
      </span>
    </div>
  );
}

export const nodeTypes = {
  wanNode: WanNode,
  firewallNode: FirewallNode,
  infraNode: InfraNode,
  apNode: ApNode,
  clientGroupNode: ClientGroupNode,
  clientNode: ClientNode,
};
