import { TopologyNode } from "../types/topology";

export type NodeLayer =
  | "WAN"
  | "FIREWALL"
  | "CORE_SWITCH"
  | "ACCESS_SWITCH"
  | "ACCESS_POINT"
  | "CLIENT"
  | "UNKNOWN";

export function classifyNode(
  node: TopologyNode,
  coreIds: Set<string>
): NodeLayer {
  const sub = (node.subtype || "").toLowerCase();
  const label = (node.label || "").toLowerCase();
  const model = String(
    node.metadata?.model || node.metadata?.productType || ""
  ).toLowerCase();

  // WAN: unmanaged nodes that look like internet gateways
  if (
    !node.managed &&
    (label.includes("internet") ||
      label.includes("wan") ||
      label.includes("isp") ||
      sub === "wan" ||
      sub === "internet")
  ) {
    return "WAN";
  }

  // Firewall (MX series or explicitly labeled)
  if (
    sub === "firewall" ||
    model.startsWith("mx") ||
    label.includes("firewall") ||
    label.includes("mx")
  ) {
    return "FIREWALL";
  }

  // Access Point (MR series)
  if (
    sub === "access_point" ||
    sub === "wireless" ||
    model.startsWith("mr") ||
    sub === "ap"
  ) {
    return "ACCESS_POINT";
  }

  // Switch (MS series)
  if (
    sub === "switch" ||
    sub === "core_switch" ||
    sub === "access_switch" ||
    model.startsWith("ms") ||
    model.startsWith("gs")
  ) {
    return coreIds.has(node.id) ? "CORE_SWITCH" : "ACCESS_SWITCH";
  }

  // Client
  if (sub === "client" || node.type === "client") {
    return "CLIENT";
  }

  return "UNKNOWN";
}

export function resolveDisplayLabel(node: TopologyNode): string {
  const hostname = String(
    node.metadata?.hostname || node.metadata?.dhcpHostname || ""
  ).trim();
  if (hostname && hostname !== "Unknown" && hostname !== "") return hostname;

  if (node.label && !node.label.match(/^[0-9a-f:]{17}$/i) && !node.label.match(/^\d+\.\d+\.\d+\.\d+$/)) {
    return node.label;
  }

  const os = String(node.metadata?.os || "").trim();
  const mfr = String(node.metadata?.manufacturer || "").trim();
  if (os) return `${os} Device`;
  if (mfr) return `${mfr} Device`;

  const sub = (node.subtype || "").toLowerCase();
  if (sub === "client") return "Unknown Client";

  return node.label || "Unknown Device";
}

export const LAYER_ORDER: NodeLayer[] = [
  "WAN",
  "FIREWALL",
  "CORE_SWITCH",
  "ACCESS_SWITCH",
  "ACCESS_POINT",
  "CLIENT",
  "UNKNOWN",
];

export const LAYER_Y: Record<NodeLayer, number> = {
  WAN: 60,
  FIREWALL: 210,
  CORE_SWITCH: 370,
  ACCESS_SWITCH: 530,
  ACCESS_POINT: 530,
  CLIENT: 700,
  UNKNOWN: 700,
};
