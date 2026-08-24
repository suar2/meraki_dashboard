import { classColor } from "./cyStyle";
import type { SearchHit, TopologyGraph, TopologyNode } from "../types/topology";

export function nodeHaystack(graph: TopologyGraph, node: TopologyNode): string {
  const meta = node.metadata || {};
  return [
    node.hostname,
    node.label,
    node.id,
    node.serial,
    node.platform,
    node.management_ip,
    node.software_version,
    node.subtype,
    meta.mac,
    meta.macAddress,
    meta.ssid,
    meta.model,
    meta.os,
    meta.ip,
    ...portFields(graph, node),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function portFields(graph: TopologyGraph, node: TopologyNode): string[] {
  const out: string[] = [...(node.interfaces || [])];
  for (const port of graph.switch_ports?.[node.id] || []) {
    const cfg = (port.config as Record<string, unknown>) || {};
    const sta = (port.status as Record<string, unknown>) || {};
    out.push(String(port.portId || ""), String(cfg.vlan ?? ""), String(cfg.nativeVlan ?? ""), String(cfg.allowedVlans ?? ""), String(sta.status || ""));
  }
  for (const link of graph.links) {
    if (link.source === node.id) out.push(String(link.source_interface || ""), String(link.source_port?.portId || ""));
    if (link.target === node.id) out.push(String(link.target_interface || ""), String(link.target_port?.portId || ""));
  }
  return out;
}

export function buildSearchIndex(graph: TopologyGraph): SearchHit[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    label: node.hostname || node.label,
    ip: node.management_ip || "—",
    type: String(node.device_class),
    color: classColor(String(node.device_class)),
    haystack: nodeHaystack(graph, node),
  }));
}

export function filterSearchHits(hits: SearchHit[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: SearchHit[] = [];
  for (const hit of hits) {
    if (!hit.haystack.includes(q)) continue;
    out.push({ ...hit, match: q });
    if (out.length >= 12) break;
  }
  return out;
}