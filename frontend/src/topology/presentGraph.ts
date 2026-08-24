import type { TopologyGraph, TopologyLink, TopologyNode } from "../types/topology";
import { asDeviceClass } from "./deviceClass";

export type VisibilityMode = "physical" | "physical_clients" | "full";

const PHYSICAL_CLASSES = new Set(["mx", "core", "access", "ap", "mv", "mg", "server"]);
const PI_NAS = /\b(pi\d?|raspberry|rpi|nas|synology|qnap|truenas|unraid)\b/i;
const VM_HINT = /\b(vm|homeassistant|hass|orthanc|docker|lxc|k8s|birthday)\b/i;

export function isWirelessNode(node: TopologyNode): boolean {
  const conn = String(node.metadata?.recentDeviceConnection || node.metadata?.connection || "").toLowerCase();
  return node.subtype === "wireless" || conn === "wireless" || Boolean(node.metadata?.ssid);
}

export function isGroupNode(node: TopologyNode): boolean {
  return node.type === "group" || Boolean(node.metadata?.group);
}

export function isPhysicalChassis(node: TopologyNode): boolean {
  if (isWirelessNode(node) || isGroupNode(node)) return false;
  const cls = asDeviceClass(String(node.device_class));
  if (PHYSICAL_CLASSES.has(cls)) return true;
  if (node.managed && node.type === "meraki") return true;
  const hay = `${node.label} ${node.hostname} ${node.platform}`;
  if (PI_NAS.test(hay)) return true;
  return false;
}

export function parentIdOf(node: TopologyNode): string {
  return String(node.metadata?.parent_id || "");
}

export function isDownstreamClient(node: TopologyNode, byId: Map<string, TopologyNode>): boolean {
  if (isWirelessNode(node) || isPhysicalChassis(node)) return false;
  const parent = byId.get(parentIdOf(node));
  if (!parent) return node.type === "client" && !isWirelessNode(node);
  const cls = asDeviceClass(String(parent.device_class));
  return cls === "server" || parent.subtype === "server" || parent.subtype === "unknown_downstream" || Boolean(parent.metadata?.merged);
}

export function nodeVisible(node: TopologyNode, mode: VisibilityMode, byId: Map<string, TopologyNode>): boolean {
  if (mode === "full") return true;
  if (isPhysicalChassis(node)) return true;
  if (mode === "physical") return false;
  if (isWirelessNode(node) || node.type === "client") return true;
  if (isDownstreamClient(node, byId)) return true;
  if (node.subtype === "unknown_downstream" || node.subtype === "physical_peer") return true;
  return false;
}

function cloneNode(node: TopologyNode, extra?: Partial<TopologyNode>): TopologyNode {
  return {
    ...node,
    metadata: { ...(node.metadata || {}), ...(extra?.metadata || {}) },
    ...extra,
  };
}

function groupNode(id: string, parent: TopologyNode, members: TopologyNode[], kind: "wireless" | "downstream"): TopologyNode {
  const count = members.length;
  const label = kind === "wireless" ? `${count} Wireless Client${count === 1 ? "" : "s"}` : `${count} downstream client${count === 1 ? "" : "s"}`;
  return {
    id,
    type: "group",
    subtype: kind === "wireless" ? "wireless_group" : "downstream_group",
    label,
    hostname: label,
    managed: false,
    metadata: {
      group: true,
      kind,
      parent_id: parent.id,
      member_ids: members.map((m) => m.id),
      count,
    },
    network: parent.network || {},
    health: { state: "healthy", critical_count: 0, warning_count: 0 },
    issue_count: 0,
    position: { x: 0, y: 0 },
    management_ip: "",
    platform: "",
    location: parent.location || "",
    software_version: "",
    serial: "",
    stack_members: [],
    device_class: "client",
    degree: 1,
    interfaces: [],
  };
}

export function descendantsOf(graph: TopologyGraph, ids: string[]): Set<string> {
  const keep = new Set(ids);
  const queue = [...ids];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const link of graph.links) {
      if (link.source !== cur || keep.has(link.target)) continue;
      keep.add(link.target);
      queue.push(link.target);
    }
  }
  return keep;
}

export function focusKeepIds(graph: TopologyGraph, selected: string[]): Set<string> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const keep = new Set(selected);
  for (const id of selected) {
    const node = byId.get(id);
    const cls = asDeviceClass(String(node?.device_class || ""));
    const sub = String(node?.subtype || "");
    const expand = cls !== "mx" && cls !== "core" && cls !== "access" && sub !== "switch" && sub !== "firewall";
    if (!expand) continue;
    for (const child of descendantsOf(graph, [id])) keep.add(child);
  }
  return keep;
}

export function presentGraph(
  graph: TopologyGraph,
  opts: {
    visibilityMode: VisibilityMode;
    collapseWireless: boolean;
    collapseDownstream: boolean;
    expandedGroups: string[];
    focusIds?: string[];
    hiddenNodeIds?: string[];
  }
): TopologyGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  let visible = graph.nodes.filter((n) => nodeVisible(n, opts.visibilityMode, byId));
  if (opts.hiddenNodeIds?.length) {
    const hidden = new Set(opts.hiddenNodeIds);
    visible = visible.filter((n) => !hidden.has(n.id));
  }
  if (opts.focusIds?.length) {
    const keep = focusKeepIds(graph, opts.focusIds);
    visible = visible.filter((n) => keep.has(n.id));
  }
  const visibleIds = new Set(visible.map((n) => n.id));
  let links = graph.links.filter((l) => visibleIds.has(l.source) && visibleIds.has(l.target));
  const expanded = new Set(opts.expandedGroups);
  const nodes = visible.map((n) => cloneNode(n));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const collapse = (kind: "wireless" | "downstream", enabled: boolean) => {
    if (!enabled) return;
    const buckets = new Map<string, TopologyNode[]>();
    for (const node of [...nodeMap.values()]) {
      if (kind === "wireless" && !isWirelessNode(node)) continue;
      if (kind === "downstream" && (isWirelessNode(node) || isPhysicalChassis(node))) continue;
      if (kind === "downstream" && !isDownstreamClient(node, nodeMap) && node.type !== "client") continue;
      if (kind === "downstream" && isWirelessNode(node)) continue;
      const parent = parentIdOf(node) || links.find((l) => l.target === node.id)?.source || "";
      if (!parent || !nodeMap.has(parent)) continue;
      if (kind === "wireless" && asDeviceClass(String(nodeMap.get(parent)?.device_class)) !== "ap") {
        const p = nodeMap.get(parent);
        if (p?.subtype !== "access_point") continue;
      }
      const list = buckets.get(parent) || [];
      list.push(node);
      buckets.set(parent, list);
    }
    for (const [parentId, members] of buckets) {
      if (members.length < 2) continue;
      const groupId = `group:${kind}:${parentId}`;
      if (expanded.has(groupId)) continue;
      const parent = nodeMap.get(parentId);
      if (!parent) continue;
      const memberIds = new Set(members.map((m) => m.id));
      for (const mid of memberIds) nodeMap.delete(mid);
      links = links.filter((l) => !memberIds.has(l.source) && !memberIds.has(l.target));
      const group = groupNode(groupId, parent, members, kind);
      nodeMap.set(group.id, group);
      links.push({
        id: `group-edge-${groupId}`,
        source: parentId,
        target: groupId,
        source_port: {},
        target_port: {},
        link_type: kind === "wireless" ? "wireless" : "wired",
        discovery_method: kind === "wireless" ? "wireless_association" : "physical_downstream",
        health: "healthy",
        mismatches: [],
        faults: [],
        remediable_actions: [],
        source_hostname: parent.hostname || parent.label,
        target_hostname: group.label,
        source_interface: kind === "wireless" ? "ssid" : "",
        target_interface: "",
        source_management_ip: parent.management_ip || "",
        target_management_ip: "",
        source_platform: parent.platform || "",
        target_platform: "",
        source_device_class: String(parent.device_class || ""),
        target_device_class: "client",
        discovery_sources: [kind === "wireless" ? "wireless_association" : "physical_downstream"],
        identity_resolution: { group: true, count: members.length },
      });
    }
  };

  collapse("wireless", opts.collapseWireless && opts.visibilityMode !== "physical");
  collapse("downstream", opts.collapseDownstream && opts.visibilityMode !== "physical");

  return { ...graph, nodes: [...nodeMap.values()], links };
}

export function groupIdForHiddenMember(
  graph: TopologyGraph,
  memberId: string,
  opts: { collapseWireless: boolean; collapseDownstream: boolean; expandedGroups: string[] }
): string | null {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const node = byId.get(memberId);
  if (!node || isPhysicalChassis(node) || isGroupNode(node)) return null;
  const parent = parentIdOf(node) || graph.links.find((l) => l.target === memberId)?.source || "";
  if (!parent) return null;
  const expanded = new Set(opts.expandedGroups || []);
  const siblings = (kind: "wireless" | "downstream") =>
    graph.nodes.filter((n) => {
      if (n.id === memberId) return true;
      const p = parentIdOf(n) || graph.links.find((l) => l.target === n.id)?.source || "";
      if (p !== parent) return false;
      return kind === "wireless" ? isWirelessNode(n) : isDownstreamClient(n, byId);
    }).length;
  if (opts.collapseWireless && isWirelessNode(node)) {
    const gid = `group:wireless:${parent}`;
    if (!expanded.has(gid) && siblings("wireless") >= 2) return gid;
  }
  if (opts.collapseDownstream && isDownstreamClient(node, byId)) {
    const gid = `group:downstream:${parent}`;
    if (!expanded.has(gid) && siblings("downstream") >= 2) return gid;
  }
  return null;
}

export function branchForPort(graph: TopologyGraph, switchId: string, portId: string): { nodeIds: string[]; linkIds: string[] } {
  const want = String(parseInt(portId, 10) || portId);
  const seeds = graph.links.filter((l) => {
    if (l.link_type === "wireless") return false;
    const srcPort = String(l.source_port?.portId || l.source_interface || "");
    const tgtPort = String(l.target_port?.portId || l.target_interface || "");
    const srcMatch = l.source === switchId && (srcPort === portId || srcPort === want);
    const tgtMatch = l.target === switchId && (tgtPort === portId || tgtPort === want);
    return srcMatch || tgtMatch;
  });
  const nodeIds = new Set<string>([switchId]);
  const linkIds = new Set<string>();
  const queue: string[] = [];
  for (const link of seeds) {
    linkIds.add(link.id);
    const peer = link.source === switchId ? link.target : link.source;
    nodeIds.add(peer);
    queue.push(peer);
  }
  while (queue.length) {
    const id = queue.shift()!;
    for (const link of graph.links) {
      if (link.source !== id && link.target !== id) continue;
      const other = link.source === id ? link.target : link.source;
      if (other === switchId) continue;
      if (!nodeIds.has(other)) {
        nodeIds.add(other);
        queue.push(other);
      }
      linkIds.add(link.id);
    }
  }
  return { nodeIds: [...nodeIds], linkIds: [...linkIds] };
}

export function peersOnSwitchPort(graph: TopologyGraph, switchId: string, portId: string): { id: string; label: string }[] {
  const want = String(parseInt(portId, 10) || portId);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: { id: string; label: string }[] = [];
  for (const link of graph.links) {
    const srcPort = String(link.source_port?.portId || "");
    const tgtPort = String(link.target_port?.portId || "");
    if (link.source === switchId && (srcPort === portId || srcPort === want)) {
      const n = byId.get(link.target);
      out.push({ id: link.target, label: n?.hostname || n?.label || link.target_hostname || link.target });
    } else if (link.target === switchId && (tgtPort === portId || tgtPort === want)) {
      const n = byId.get(link.source);
      out.push({ id: link.source, label: n?.hostname || n?.label || link.source_hostname || link.source });
    }
  }
  return out;
}
