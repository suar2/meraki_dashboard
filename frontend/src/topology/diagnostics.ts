import type { TopologyDiagnostics, TopologyGraph, TopologyLink } from "../types/topology";

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
    orphans,
    total_nodes: graph.nodes.length,
    managed_nodes: graph.nodes.filter((n) => n.managed).length,
  };
}