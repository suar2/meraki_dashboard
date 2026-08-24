import type { TopologyGraph, TopologyLink, TopologyNode } from "../types/topology";

export interface EntityMergePayload {
  org_id: string;
  network_id: string;
  survivor_id: string;
  member_ids: string[];
  label: string;
  device_class: string;
  interfaces: Array<{ switch_serial: string; port_id: string; role: string; member_id: string }>;
}

function canonicalPort(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  const low = text.toLowerCase();
  if (low.startsWith("port") && /^\d+$/.test(low.slice(4))) return String(parseInt(low.slice(4), 10));
  if (/^\d+$/.test(text)) return String(parseInt(text, 10));
  return text;
}

export function applyLocalEntityMerge(graph: TopologyGraph, payload: EntityMergePayload): TopologyGraph {
  const survivor = graph.nodes.find((n) => n.id === payload.survivor_id);
  const members = payload.member_ids.filter((id) => id !== payload.survivor_id);
  if (!survivor || members.some((id) => !graph.nodes.find((n) => n.id === id))) return graph;

  const memberSet = new Set(members);
  const roleByPort = new Map<string, string>();
  for (const iface of payload.interfaces) {
    if (iface.port_id && iface.role) roleByPort.set(`${iface.switch_serial}:${canonicalPort(iface.port_id)}`, iface.role);
  }

  const merged: TopologyNode = {
    ...survivor,
    label: payload.label || survivor.label,
    hostname: payload.label || survivor.hostname,
    device_class: payload.device_class || "server",
    subtype: payload.device_class === "server" ? "server" : survivor.subtype,
    type: survivor.type === "client" ? "neighbor" : survivor.type,
    metadata: {
      ...survivor.metadata,
      merged: true,
      merged_from: members,
      physical_interfaces: payload.interfaces,
    },
  };

  const seen = new Set<string>();
  const links: TopologyLink[] = [];
  for (const link of graph.links) {
    const source = memberSet.has(link.source) ? merged.id : link.source;
    const target = memberSet.has(link.target) ? merged.id : link.target;
    if (source === target) continue;
    const srcPort = { ...(link.source_port || {}) };
    const tgtPort = { ...(link.target_port || {}) };
    let role = link.interface_role || "";
    for (const blob of [srcPort, tgtPort]) {
      const key = `${blob.serial || ""}:${canonicalPort(blob.portId)}`;
      const found = roleByPort.get(key) || roleByPort.get(`:${canonicalPort(blob.portId)}`);
      if (found) {
        role = found;
        blob.role = found;
        blob.label = found;
      }
    }
    const method = String(link.discovery_method || "");
    const portKey =
      method === "physical_downstream"
        ? `down:${source}:${target}`
        : canonicalPort(srcPort.portId || tgtPort.portId);
    const dedupe = `${source}|${target}|${portKey}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    links.push({
      ...link,
      id: `${source}__${target}__${portKey || link.id}`,
      source,
      target,
      source_port: srcPort,
      target_port: tgtPort,
      interface_role: role,
    });
  }

  const nodes = graph.nodes
    .filter((n) => !memberSet.has(n.id))
    .map((n) => (n.id === merged.id ? merged : n));

  const deg: Record<string, number> = {};
  for (const n of nodes) deg[n.id] = 0;
  for (const l of links) {
    deg[l.source] = (deg[l.source] || 0) + 1;
    deg[l.target] = (deg[l.target] || 0) + 1;
  }
  for (const n of nodes) n.degree = deg[n.id] || 0;

  return {
    ...graph,
    nodes,
    links,
    summary: {
      ...graph.summary,
      total_nodes: nodes.length,
      total_wired_links: links.filter((l) => l.link_type === "wired").length,
      total_wireless_links: links.filter((l) => l.link_type === "wireless").length,
    },
  };
}

export function switchPortOfNode(graph: TopologyGraph, nodeId: string): { serial: string; portId: string } | null {
  for (const link of graph.links) {
    if (link.link_type === "wireless") continue;
    const src = String(link.source_port?.serial || "");
    const tgt = String(link.target_port?.serial || "");
    const srcPort = String(link.source_port?.portId || "");
    const tgtPort = String(link.target_port?.portId || "");
    if (link.target === nodeId && src && srcPort) return { serial: src, portId: canonicalPort(srcPort) };
    if (link.source === nodeId && tgt && tgtPort) return { serial: tgt, portId: canonicalPort(tgtPort) };
  }
  return null;
}
