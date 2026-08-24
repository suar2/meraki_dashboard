import type { TopologyLink } from "../types/topology";

export interface EvidenceItem {
  key: string;
  label: string;
  ok: boolean;
}

export interface LinkEvidence {
  confidence: "high" | "medium" | "low";
  summary: string;
  items: EvidenceItem[];
}

const CHECKS: Array<{ key: string; label: string; methods: string[] }> = [
  { key: "topology_link_layer", label: "Meraki linkLayer", methods: ["topology_link_layer", "lldp_cdp"] },
  { key: "lldp", label: "LLDP", methods: ["device_lldp_cdp", "lldp_cdp", "lldp_cdp_inferred"] },
  { key: "device_mac", label: "deviceMac match", methods: [] },
  { key: "switch_port_status", label: "Switch port status", methods: ["switch_port_status"] },
  { key: "client_history", label: "Client history", methods: ["wired_client_switchport", "physical_attachment", "wireless_association"] },
];

function sourcesOf(link: TopologyLink): Set<string> {
  return new Set([...(link.discovery_sources || []), link.discovery_method].filter(Boolean) as string[]);
}

function deviceMacOk(link: TopologyLink): boolean {
  if (Array.isArray(link.evidence) && link.evidence.some((e) => e.key === "device_mac" && e.ok)) return true;
  const blob = JSON.stringify(link.identity_resolution || {}).toLowerCase();
  return blob.includes("lldp_devicemac") || blob.includes("\"devicemac\"") || blob.includes("mac_match");
}

export function describeLinkEvidence(link: TopologyLink): LinkEvidence {
  const sources = sourcesOf(link);
  if (link.confidence && Array.isArray(link.evidence) && link.evidence.length) {
    const items = CHECKS.map((check) => {
      const found = link.evidence!.find((e) => e.key === check.key);
      return { key: check.key, label: check.label, ok: Boolean(found?.ok) };
    });
    const confidence = (link.confidence as LinkEvidence["confidence"]) || "medium";
    const summary = String(link.identity_resolution?.confidence_summary || "");
    return { confidence, summary, items };
  }
  const items: EvidenceItem[] = CHECKS.map((check) => ({
    key: check.key,
    label: check.label,
    ok: check.key === "device_mac" ? deviceMacOk(link) : check.methods.some((m) => sources.has(m)),
  }));
  const ok = new Set(items.filter((i) => i.ok).map((i) => i.key));
  if (link.link_type === "wireless") {
    return { confidence: "high", summary: "Wireless association from the client table.", items };
  }
  if (ok.has("topology_link_layer") && (ok.has("lldp") || ok.has("device_mac"))) {
    return { confidence: "high", summary: "Confirmed by Meraki linkLayer and LLDP/MAC.", items };
  }
  if (ok.has("lldp") || ok.has("switch_port_status") || ok.has("device_mac")) {
    return { confidence: "medium", summary: "Confirmed by LLDP or switch port status.", items };
  }
  if (ok.has("client_history")) {
    return { confidence: "medium", summary: "Inferred from switchport + client MAC.", items };
  }
  return { confidence: "low", summary: "Inferred with limited evidence.", items };
}
