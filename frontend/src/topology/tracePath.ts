import type { TopologyGraph, TopologyLink, TopologyNode } from "../types/topology";
import { asDeviceClass } from "./deviceClass";

export interface TraceHop {
  nodeId: string;
  label: string;
  via: string;
  linkId?: string;
}

const UPSTREAM = new Set(["mx", "core", "access", "ap"]);

function rank(node: TopologyNode | undefined): number {
  if (!node) return 50;
  const cls = asDeviceClass(String(node.device_class));
  if (cls === "mx") return 0;
  if (cls === "core") return 1;
  if (cls === "access") return 2;
  if (cls === "ap" || cls === "mv" || cls === "mg") return 3;
  if (cls === "server") return 4;
  return 5;
}

function portOf(link: TopologyLink, nodeId: string): string {
  if (link.source === nodeId) return String(link.source_interface || link.source_port?.portId || "");
  return String(link.target_interface || link.target_port?.portId || "");
}

function hopVia(link: TopologyLink, fromId: string, toId: string): string {
  if (link.link_type === "wireless") return "Wi-Fi";
  const fromPort = portOf(link, fromId);
  const toPort = portOf(link, toId);
  const numeric = [toPort, fromPort]
    .map((p) => String(p || "").replace(/^port/i, ""))
    .find((p) => /^\d+$/.test(p));
  if (numeric) return `Port ${numeric}`;
  if (fromPort && fromPort.toLowerCase() !== "wired" && fromPort.toLowerCase() !== "uplink") return fromPort;
  if (toPort) return `Port ${toPort}`;
  return "";
}

export function traceToInternet(graph: TopologyGraph, startId: string): TraceHop[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const start = byId.get(startId);
  if (!start) return [];
  const hops: TraceHop[] = [{ nodeId: start.id, label: start.hostname || start.label, via: "" }];
  const seen = new Set<string>([start.id]);
  let current = start.id;
  for (let i = 0; i < 12; i++) {
    const node = byId.get(current);
    const parentMeta = String(node?.metadata?.parent_id || "");
    const candidates = graph.links.filter((l) => l.source === current || l.target === current);
    let best: TopologyLink | undefined;
    let bestPeer: TopologyNode | undefined;
    let bestRank = rank(node);
    for (const link of candidates) {
      const peerId = link.source === current ? link.target : link.source;
      if (seen.has(peerId)) continue;
      const peer = byId.get(peerId);
      const pr = rank(peer);
      if (pr < bestRank) {
        bestRank = pr;
        best = link;
        bestPeer = peer;
      }
    }
    if (parentMeta && byId.has(parentMeta) && !seen.has(parentMeta)) {
      const parent = byId.get(parentMeta)!;
      if (rank(parent) <= bestRank) {
        bestPeer = parent;
        best = candidates.find((l) => l.source === parentMeta || l.target === parentMeta) || best;
        bestRank = rank(parent);
      }
    }
    if (!bestPeer || !best) break;
    hops.push({
      nodeId: bestPeer.id,
      label: bestPeer.hostname || bestPeer.label,
      via: hopVia(best, current, bestPeer.id),
      linkId: best.id,
    });
    seen.add(bestPeer.id);
    current = bestPeer.id;
    if (asDeviceClass(String(bestPeer.device_class)) === "mx") break;
    if (bestPeer.metadata?.topologyRoot || bestPeer.subtype === "firewall") break;
  }
  const last = hops[hops.length - 1];
  const lastNode = byId.get(last?.nodeId || "");
  if (lastNode && asDeviceClass(String(lastNode.device_class)) === "mx") {
    hops.push({ nodeId: "internet", label: "Internet", via: "WAN" });
  }
  return hops;
}

export function internetClass(node: TopologyNode): boolean {
  return asDeviceClass(String(node.device_class)) === "mx" || UPSTREAM.has(asDeviceClass(String(node.device_class)));
}
