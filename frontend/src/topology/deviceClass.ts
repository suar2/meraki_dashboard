import type { DeviceClass, TopologyNode } from "../types/topology";

export interface ClassStyle {
  label: string;
  cssVar: string;
  sizeVar: string;
  tier: number;
}

export const DEVICE_CLASSES: Record<DeviceClass, ClassStyle> = {
  core: { label: "Core", cssVar: "--color-core", sizeVar: "--size-node-core", tier: 8 },
  mx: { label: "MX Firewall", cssVar: "--color-mx", sizeVar: "--size-node-wlc", tier: 7 },
  access: { label: "Access", cssVar: "--color-access", sizeVar: "--size-node-access", tier: 6 },
  wlc: { label: "WLC", cssVar: "--color-wlc", sizeVar: "--size-node-wlc", tier: 5 },
  ap: { label: "Wireless", cssVar: "--color-ap", sizeVar: "--size-node-client", tier: 4 },
  mv: { label: "Camera", cssVar: "--color-mv", sizeVar: "--size-node-client", tier: 3 },
  mg: { label: "Cellular", cssVar: "--color-mg", sizeVar: "--size-node-access", tier: 3 },
  phone: { label: "VoIP Phone", cssVar: "--color-phone", sizeVar: "--size-node-client", tier: 2 },
  client: { label: "Client", cssVar: "--color-client", sizeVar: "--size-node-client", tier: 1 },
  unmanaged: { label: "Unmanaged", cssVar: "--color-unmanaged", sizeVar: "--size-node-access", tier: 2 },
  unknown: { label: "Unknown", cssVar: "--color-unknown", sizeVar: "--size-node-access", tier: 2 },
};

export const DEVICE_CLASS_ORDER: DeviceClass[] = [
  "core",
  "mx",
  "access",
  "wlc",
  "ap",
  "mv",
  "mg",
  "phone",
  "client",
  "unmanaged",
  "unknown",
];

const PLATFORM_RULES: { type: DeviceClass; re: RegExp }[] = [
  { type: "core", re: /c9500/i },
  { type: "wlc", re: /c9800|wireless.?lan.?controller|\bwlc\b/i },
  { type: "ap", re: /c91|cw91|\bair-?\b|\bmr\d|access.?point/i },
  { type: "mx", re: /\bmx\d|security.?appliance|firewall|\basa\b|\bftd\b/i },
  { type: "mv", re: /\bmv\d|\bcamera/i },
  { type: "mg", re: /\bmg\d|cellular|lte.?gateway/i },
  { type: "access", re: /c1000|c2960|c9200|c9300|ie-3000|c3560|\bms\d|\bgs\d|\bswitch/i },
  { type: "phone", re: /ip phone|cisco phone|\bsep\b/i },
];

export function asDeviceClass(value: string | undefined | null): DeviceClass {
  if (value && value in DEVICE_CLASSES) return value as DeviceClass;
  return "unknown";
}

export function classifyNode(node: TopologyNode, coreIds: Set<string>): DeviceClass {
  const backend = asDeviceClass(node.device_class);
  if (node.device_class && backend !== "unknown") return backend;

  const hostname = node.hostname || node.label || "";
  const platform = node.platform || String(node.metadata?.model || node.metadata?.productType || "");
  const product = String(node.metadata?.productType || "").toLowerCase();
  const sub = (node.subtype || "").toLowerCase();
  const ntype = (node.type || "").toLowerCase();

  if (ntype === "client" || sub === "client") return "client";
  if (/^SEP/i.test(hostname)) return "phone";
  if (sub === "camera" || product === "camera") return "mv";
  if (sub === "cellular" || product.includes("cellular")) return "mg";
  if (sub === "firewall" || product === "appliance" || product === "securityappliance") return "mx";
  if ((sub === "access_point" || sub === "ap" || product === "wireless") && ntype !== "client") return "ap";
  if (sub === "core_switch" || coreIds.has(node.id)) return "core";
  if (sub === "switch" || sub === "access_switch") return coreIds.has(node.id) ? "core" : "access";

  const blob = `${hostname} ${platform} ${product} ${sub}`;
  for (const rule of PLATFORM_RULES) {
    if (rule.re.test(blob)) {
      if (rule.type === "access" && coreIds.has(node.id)) return "core";
      return rule.type;
    }
  }
  if (!node.managed || ntype === "neighbor") return "unmanaged";
  return "unknown";
}

export function resolveColor(cssVar: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
}

export function resolveSize(cssVar: string): number {
  const el = document.createElement("div");
  el.style.cssText = `position:absolute;visibility:hidden;width:var(${cssVar})`;
  document.documentElement.appendChild(el);
  const px = el.getBoundingClientRect().width;
  el.remove();
  return px || parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10) || 24;
}

export function classVisuals(deviceClass: DeviceClass): { label: string; color: string; size: number; tier: number } {
  const def = DEVICE_CLASSES[deviceClass] ?? DEVICE_CLASSES.unknown;
  return {
    label: def.label,
    color: resolveColor(def.cssVar),
    size: resolveSize(def.sizeVar),
    tier: def.tier,
  };
}
