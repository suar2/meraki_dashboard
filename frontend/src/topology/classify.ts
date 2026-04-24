import { TopologyNode } from "../types/topology";

export type NodeLayer =
  | "WAN"
  | "FIREWALL"
  | "CORE_SWITCH"
  | "ACCESS_SWITCH"
  | "PORT"
  | "TRUNK_HOST"
  | "PORT_ACCESS_GROUP"
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
  const role = String(
    (node.metadata as { role?: string } | undefined)?.role || ""
  ).toLowerCase();

  if (node.type === "synthetic" && sub === "trunk_host") {
    return "TRUNK_HOST";
  }
  if (node.type === "synthetic" && sub === "port_access_group") {
    return "PORT_ACCESS_GROUP";
  }
  if (role === "trunk_host") {
    return "TRUNK_HOST";
  }
  if (role === "port_access_group") {
    return "PORT_ACCESS_GROUP";
  }

  // CLIENT must be checked before ACCESS_POINT: wireless clients have
  // subtype="wireless" but type="client" and must not be classified as APs.
  if (node.type === "client" || sub === "client") {
    return "CLIENT";
  }

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

  // Access Point (MR series) — "wireless" subtype only for Meraki APs, not clients
  if (
    sub === "access_point" ||
    (sub === "wireless" && node.type !== "client") ||
    model.startsWith("mr") ||
    sub === "ap"
  ) {
    return "ACCESS_POINT";
  }

  // Switch (MS / GS series)
  if (
    sub === "switch" ||
    sub === "core_switch" ||
    sub === "access_switch" ||
    model.startsWith("ms") ||
    model.startsWith("gs")
  ) {
    return coreIds.has(node.id) ? "CORE_SWITCH" : "ACCESS_SWITCH";
  }

  return "UNKNOWN";
}

/** Skip labels that look like raw Meraki derivedIds (long digit strings). */
function looksLikeDerivedId(s: string): boolean {
  return /^\d{10,}$/.test(s);
}

export function resolveDisplayLabel(node: TopologyNode): string {
  // For clients: prefer description → dhcpHostname → mdnsName → user
  if (node.type === "client" || (node.subtype || "").toLowerCase() === "client") {
    const name =
      String(node.metadata?.description || "").trim() ||
      String(node.metadata?.dhcpHostname || "").trim() ||
      String(node.metadata?.mdnsName || "").trim() ||
      String(node.metadata?.netbiosName || "").trim() ||
      String(node.metadata?.user || "").trim();
    if (name && name !== "Unknown") return name;
    // Fall through to generic resolution below
  }

  const hostname = String(
    node.metadata?.hostname || node.metadata?.dhcpHostname || ""
  ).trim();
  if (hostname && hostname !== "Unknown") return hostname;

  // Use node.label if it's not a raw derivedId, MAC, or bare IP
  if (
    node.label &&
    !looksLikeDerivedId(node.label) &&
    !node.label.match(/^[0-9a-f:]{17}$/i) &&
    !node.label.match(/^\d+\.\d+\.\d+\.\d+$/)
  ) {
    return node.label;
  }

  const os = String(node.metadata?.os || "").trim();
  const mfr = String(node.metadata?.manufacturer || "").trim();
  if (os) return `${os} Device`;
  if (mfr) return `${mfr} Device`;

  // Last resorts: IP or MAC
  const ip = String(node.metadata?.ip || node.metadata?.lanIp || "").trim();
  if (ip) return ip;
  const mac = String(node.metadata?.mac || node.metadata?.macAddress || "").trim();
  if (mac) return mac;

  const sub = (node.subtype || "").toLowerCase();
  if (sub === "client") return "Unknown Client";
  if (sub === "access_point") return "Unknown AP";
  if (sub === "switch") return "Unknown Switch";

  return node.label || "Unknown Device";
}

export const LAYER_ORDER: NodeLayer[] = [
  "WAN",
  "FIREWALL",
  "CORE_SWITCH",
  "ACCESS_SWITCH",
  "PORT",
  "TRUNK_HOST",
  "PORT_ACCESS_GROUP",
  "ACCESS_POINT",
  "CLIENT",
  "UNKNOWN",
];

export const LAYER_Y: Record<NodeLayer, number> = {
  WAN: 80,
  FIREWALL: 250,
  CORE_SWITCH: 420,
  ACCESS_SWITCH: 590,
  PORT: 760,
  TRUNK_HOST: 820,
  PORT_ACCESS_GROUP: 835,
  ACCESS_POINT: 760,
  CLIENT: 930,
  UNKNOWN: 760,
};
