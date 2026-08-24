import type { TopologyDiagnostics, TopologyGraph, TopologyLink, TopologyNode } from "../types/topology";

const GENERIC_PORTS = new Set(["", "unknown", "uplink", "wired", "down", "none", "n/a", "null", "ethernet"]);

function canonicalPort(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  const low = text.toLowerCase();
  if (low.startsWith("port") && /^\d+$/.test(low.slice(4))) return String(Number(low.slice(4)));
  if (/^\d+$/.test(text)) return String(Number(text));
  return text;
}

function physicalPort(value: unknown): string {
  const pid = canonicalPort(value);
  return !pid || GENERIC_PORTS.has(pid.toLowerCase()) ? "" : pid;
}

function looksLikeMac(value: unknown): boolean {
  const compact = String(value || "").toLowerCase().replace(/[^0-9a-f]/g, "");
  return compact.length === 12;
}

function specificPorts(link: TopologyLink): Record<string, string> {
  const out: Record<string, string> = {};
  const src = physicalPort((link.source_port as { portId?: string } | undefined)?.portId);
  const tgt = physicalPort((link.target_port as { portId?: string } | undefined)?.portId);
  if (src) out[link.source] = src;
  if (tgt) out[link.target] = tgt;
  return out;
}

function portsConflict(a: Record<string, string>, b: Record<string, string>): boolean {
  for (const [id, port] of Object.entries(a)) {
    if (b[id] && b[id] !== port) return true;
  }
  return false;
}

function duplicatePhysicalEdges(links: TopologyLink[]): number {
  const groups = new Map<string, TopologyLink[]>();
  for (const link of links) {
    if (link.link_type !== "wired" && link.link_type !== "discovered_partial") continue;
    if (link.discovery_method === "physical_downstream") continue;
    const key = [link.source, link.target].sort().join("|");
    groups.set(key, [...(groups.get(key) || []), link]);
  }
  let extras = 0;
  for (const group of groups.values()) {
    const clusters: TopologyLink[][] = [];
    for (const link of group) {
      const ports = specificPorts(link);
      const hit = clusters.find((cluster) => {
        const cports: Record<string, string> = {};
        for (const item of cluster) Object.assign(cports, specificPorts(item));
        return !portsConflict(ports, cports);
      });
      if (hit) hit.push(link);
      else clusters.push([link]);
    }
    for (const cluster of clusters) {
      if (cluster.length > 1) extras += cluster.length - 1;
    }
  }
  return extras;
}

function unresolvedIdentity(nodes: TopologyNode[]): number {
  return nodes.filter((node) => {
    if (node.managed && node.type === "meraki" && !looksLikeMac(node.label)) return false;
    const label = String(node.hostname || node.label || "").trim();
    return looksLikeMac(label) || label.toLowerCase().startsWith("unknown downstream") || label.toLowerCase().startsWith("discovered neighbor");
  }).length;
}

function duplicateChassisCandidates(graph: TopologyGraph): number {
  const fromDebug = graph.topology_debug?.duplicate_chassis;
  if (Array.isArray(fromDebug)) return fromDebug.length;
  const servers = graph.nodes.filter((n) => !n.managed && (n.subtype === "server" || n.device_class === "server"));
  const byName = new Map<string, string[]>();
  for (const node of servers) {
    const key = String(node.label || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!key || looksLikeMac(node.label)) continue;
    byName.set(key, [...(byName.get(key) || []), node.id]);
  }
  let count = 0;
  for (const ids of byName.values()) {
    if (new Set(ids).size > 1) count += 1;
  }
  return count;
}

export function computeDiagnostics(graph: TopologyGraph): TopologyDiagnostics {
  const wired = graph.links.filter((l) => l.link_type === "wired" || l.link_type === "discovered_partial");
  const conf = { high: 0, medium: 0, low: 0, unknown: 0 };
  for (const link of wired) {
    const key = String(link.confidence || "unknown").toLowerCase();
    if (key === "high" || key === "medium" || key === "low") conf[key] += 1;
    else conf.unknown += 1;
  }
  const macs = new Map<string, string[]>();
  const serials = new Map<string, string[]>();
  for (const node of graph.nodes) {
    const mac = String(node.metadata?.mac || node.metadata?.macAddress || "")
      .trim()
      .toLowerCase();
    if (mac) macs.set(mac, [...(macs.get(mac) || []), node.id]);
    const serial = String(node.serial || "").trim().toLowerCase();
    if (serial) serials.set(serial, [...(serials.get(serial) || []), node.id]);
  }
  let duplicates = 0;
  for (const ids of [...macs.values(), ...serials.values()]) {
    if (new Set(ids).size > 1) duplicates += 1;
  }
  const linked = new Set(graph.links.flatMap((l: TopologyLink) => [l.source, l.target]));
  const orphans = graph.nodes.filter(
    (n) => !linked.has(n.id) && !n.metadata?.topologyRoot && n.subtype !== "firewall"
  ).length;
  const unresolved = Array.isArray(graph.topology_debug?.unresolved_nodes) ? graph.topology_debug.unresolved_nodes.length : 0;
  return {
    physical_edges: wired.length,
    wireless_edges: graph.links.filter((l) => l.link_type === "wireless").length,
    high_confidence: conf.high,
    medium_confidence: conf.medium,
    low_confidence: conf.low,
    unknown_confidence: conf.unknown,
    unresolved_nodes: unresolved,
    duplicate_identities: duplicates,
    duplicate_chassis_candidates: duplicateChassisCandidates(graph),
    duplicate_physical_edges: duplicatePhysicalEdges(graph.links),
    unresolved_identity_count: unresolvedIdentity(graph.nodes),
    orphans,
    total_nodes: graph.nodes.length,
    managed_nodes: graph.nodes.filter((n) => n.managed).length,
  };
}
