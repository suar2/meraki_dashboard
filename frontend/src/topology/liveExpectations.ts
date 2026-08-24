import type { TopologyGraph } from "../types/topology";

/** Expected live-lab adjacencies. Absent devices are skipped, not failed. */
export const LAB_EDGES: Array<{ left: string; right: string; port: string; id: string }> = [
  { left: "FW-01", right: "MS130", port: "1", id: "fw-ms" },
  { left: "MS130", right: "MR36", port: "2", id: "ms-mr" },
  { left: "MS130", right: "Main - camera", port: "8", id: "ms-mv" },
  { left: "MS130", right: "NAS", port: "7", id: "ms-nas" },
  { left: "MS130", right: "Pi4", port: "5", id: "ms-pi" },
  { left: "MS130", right: "SERVER", port: "4", id: "ms-server-mgmt" },
  { left: "MS130", right: "SERVER", port: "14", id: "ms-server-fabric" },
];

const SAMPLE_ALIASES: Record<string, string[]> = {
  "FW-01": ["MX-EDGE", "FW-01"],
  MS130: ["MS-MAIN", "MS130"],
  MR36: ["MR36 AP", "MR36"],
  "Main - camera": ["Main - camera"],
  NAS: ["NAS"],
  Pi4: ["Pi4"],
  SERVER: ["Server", "SERVER"],
};

function canonicalPort(value: unknown): string {
  const text = String(value || "").trim();
  if (/^\d+$/.test(text)) return String(parseInt(text, 10));
  const low = text.toLowerCase();
  if (low.startsWith("port") && /^\d+$/.test(low.slice(4))) return String(parseInt(low.slice(4), 10));
  return text;
}

function indexNodes(graph: TopologyGraph): Map<string, string> {
  const byLabel = new Map<string, string>();
  for (const node of graph.nodes) {
    for (const key of [node.id, node.label, node.hostname, node.serial, String(node.metadata?.name || "")]) {
      if (key) byLabel.set(String(key).trim().toLowerCase(), node.id);
    }
  }
  return byLabel;
}

function findId(index: Map<string, string>, name: string): string | undefined {
  for (const alias of SAMPLE_ALIASES[name] || [name]) {
    const hit = index.get(alias.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

function portsBetween(graph: TopologyGraph, leftId: string, rightId: string): Set<string> {
  const ports = new Set<string>();
  for (const link of graph.links) {
    if (link.link_type === "wireless") continue;
    if (!(link.source === leftId && link.target === rightId) && !(link.source === rightId && link.target === leftId)) {
      continue;
    }
    ports.add(canonicalPort(link.source_port?.portId || link.source_interface));
    ports.add(canonicalPort(link.target_port?.portId || link.target_interface));
  }
  return new Set([...ports].filter(Boolean));
}

export function validateExpectations(graph: TopologyGraph) {
  const index = indexNodes(graph);
  const checks: Array<Record<string, unknown>> = [];
  let applicable = 0;
  let passed = 0;
  for (const spec of LAB_EDGES) {
    const left = findId(index, spec.left);
    const right = findId(index, spec.right);
    if (!left || !right) {
      checks.push({ ...spec, status: "skipped", reason: "device not in graph" });
      continue;
    }
    applicable += 1;
    const have = portsBetween(graph, left, right);
    const ok = have.has(spec.port);
    if (ok) passed += 1;
    checks.push({ ...spec, status: ok ? "pass" : "fail", left_id: left, right_id: right, observed_ports: [...have].sort() });
  }
  const wifiParents = new Set(graph.links.filter((l) => l.link_type === "wireless").map((l) => l.source));
  const apIds = new Set(
    graph.nodes.filter((n) => String(n.device_class) === "ap" || n.subtype === "access_point" || n.subtype === "ap").map((n) => n.id)
  );
  const wirelessUnderAp = [...wifiParents].every((id) => apIds.has(id));
  return {
    applicable,
    passed,
    failed: applicable - passed,
    ok: applicable === 0 || passed === applicable,
    wireless_under_ap: wirelessUnderAp,
    checks,
  };
}
