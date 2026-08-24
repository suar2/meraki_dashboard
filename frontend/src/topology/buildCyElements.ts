import type { ElementDefinition } from "cytoscape";
import type { TopologyGraph, TopologyLink, TopologyNode } from "../types/topology";
import { asDeviceClass, classVisuals, classifyNode } from "./deviceClass";
import { shortIface } from "./shortIface";

function edgeIface(link: TopologyLink, side: "source" | "target"): string {
  const port = side === "source" ? link.source_port || {} : link.target_port || {};
  const raw = side === "source" ? link.source_interface : link.target_interface;
  const portId = shortIface(String(raw || port.portId || ""));
  const role = String(link.interface_role || port.role || "").trim();
  if (role && portId) return `${portId} ${role}`;
  if (role) return role;
  return portId;
}

function electCoreIds(nodes: TopologyNode[]): Set<string> {
  const switches = nodes.filter((n) => {
    const sub = (n.subtype || "").toLowerCase();
    const model = String(n.platform || n.metadata?.model || "").toLowerCase();
    return sub.includes("switch") || /\bms\d|\bgs\d|c9500|c9300|c9200/.test(model);
  });
  const forced = switches.filter((n) => /c9500|\bcore\b/i.test(`${n.platform} ${n.hostname} ${n.label}`));
  if (forced.length) return new Set(forced.map((n) => n.id));
  if (switches.length <= 1) return new Set(switches.map((n) => n.id));
  const top = Math.max(...switches.map((n) => n.degree || 0), 0);
  return new Set(switches.filter((n) => (n.degree || 0) === top && top > 0).map((n) => n.id));
}

function healthDotUri(opState: string): string {
  const color = opState === "offline" ? "#8b8d97" : opState === "critical" ? "#dc3146" : opState === "warning" ? "#fac22b" : "#3dd68c";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="26" cy="6" r="5.2" fill="${color}" stroke="#101219" stroke-width="1.6"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function buildCyElements(graph: TopologyGraph): ElementDefinition[] {
  const coreIds = electCoreIds(graph.nodes);
  const elements: ElementDefinition[] = [];

  for (const node of graph.nodes) {
    const deviceClass = node.type === "group" ? "client" : classifyNode(node, coreIds);
    const vis = classVisuals(deviceClass);
    const members = (node.stack_members || []).map((m) => ({
      member: m.id,
      role: m.role || "",
      serial_number: m.serial_number || "—",
      software_version: m.software_version || "—",
    }));
    const status = String(node.metadata?.status || "").toLowerCase();
    const opState = status === "offline" || status === "dormant" ? "offline" : node.health?.state || "healthy";
    elements.push({
      group: "nodes",
      data: {
        id: node.id,
        label: node.hostname || node.label || node.id,
        type: deviceClass,
        color: vis.color,
        size: node.type === "group" ? Math.max(vis.size, 36) : vis.size,
        ip: node.management_ip || "—",
        platform: node.platform || "—",
        deg: node.degree || 0,
        ifaces: (node.interfaces || []).map(shortIface).join(", "),
        location: node.location || graph.network?.name || "",
        serial: node.serial || "—",
        sw_version: node.software_version || "—",
        members,
        health: opState,
        issue_count: node.issue_count || 0,
        managed: node.managed,
        subtype: node.subtype,
        healthDot: healthDotUri(opState),
        memberIds: node.type === "group" ? node.metadata?.member_ids || [] : [],
        isGroup: node.type === "group" ? 1 : 0,
      },
    });
  }

  for (const link of graph.links) {
    const st = asDeviceClass(link.source_device_class || classifyNode(nodeOf(graph, link.source), coreIds));
    const tt = asDeviceClass(link.target_device_class || classifyNode(nodeOf(graph, link.target), coreIds));
    const backbone = st === "core" || tt === "core" || st === "mx" || tt === "mx";
    const physicalUplink = link.link_type === "wired" && (st === "ap" || tt === "ap" || st === "mv" || tt === "mv");
    elements.push({
      group: "edges",
      data: {
        id: link.id,
        source: link.source,
        target: link.target,
        sourceIf: edgeIface(link, "source"),
        targetIf: edgeIface(link, "target"),
        kind: backbone ? "backbone" : physicalUplink ? "uplink" : "edge",
        linkType: link.link_type,
        health: link.health,
        discovery: link.discovery_method,
        selectable: true,
      },
    });
  }

  return elements;
}

function nodeOf(graph: TopologyGraph, id: string): TopologyNode {
  return (
    graph.nodes.find((n) => n.id === id) ||
    ({
      id,
      type: "neighbor",
      subtype: "unmanaged",
      label: id,
      managed: false,
      metadata: {},
      network: {},
      health: { state: "healthy", critical_count: 0, warning_count: 0 },
      issue_count: 0,
      position: { x: 0, y: 0 },
      hostname: id,
      management_ip: "",
      platform: "",
      location: "",
      software_version: "",
      serial: "",
      stack_members: [],
      device_class: "unmanaged",
      degree: 0,
      interfaces: [],
    } satisfies TopologyNode)
  );
}

export function linkPassesOpsFilters(
  link: TopologyLink,
  filters: {
    showWireless: boolean;
    wiredOnly: boolean;
    wirelessOnly: boolean;
    showMismatchesOnly: boolean;
    severityFilter: "all" | "critical" | "warning" | "healthy";
  }
): boolean {
  if (link.link_type === "wireless" && !filters.showWireless) return false;
  if (filters.wiredOnly && link.link_type !== "wired") return false;
  if (filters.wirelessOnly && link.link_type !== "wireless") return false;
  if (filters.showMismatchesOnly && (link.mismatches?.length ?? 0) + (link.faults?.length ?? 0) === 0) return false;
  if (filters.severityFilter !== "all" && link.health !== filters.severityFilter) return false;
  return true;
}

export function nodePassesOpsFilters(
  node: TopologyNode,
  incident: TopologyLink[],
  filters: {
    unmanagedOnly: boolean;
    clientsOnly: boolean;
    showMismatchesOnly: boolean;
    severityFilter: "all" | "critical" | "warning" | "healthy";
    search: string;
  }
): boolean {
  if (filters.unmanagedOnly && node.managed) return false;
  if (filters.clientsOnly && node.type !== "client" && node.subtype !== "client") return false;
  if (filters.showMismatchesOnly && !incident.some((l) => (l.mismatches?.length ?? 0) + (l.faults?.length ?? 0) > 0) && node.issue_count === 0) {
    return false;
  }
  if (filters.severityFilter !== "all") {
    if (filters.severityFilter === "healthy" && node.health.state !== "healthy") return false;
    if (filters.severityFilter === "critical" && node.health.state !== "critical") return false;
    if (filters.severityFilter === "warning" && node.health.state !== "warning") return false;
  }
  const q = filters.search.trim().toLowerCase();
  if (q) {
    const hay = [
      node.hostname,
      node.label,
      node.id,
      node.serial,
      node.platform,
      node.management_ip,
      node.software_version,
      ...(node.interfaces || []),
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
