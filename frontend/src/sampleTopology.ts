import type { Issue, TopologyGraph, TopologyLink, TopologyNode } from "./types/topology";

const poeWarn: Issue = {
  id: "ap-poe",
  category: "poe_warning",
  severity: "warning",
  scope: "port",
  description: "AP uplink is drawing PoE. Confirm class and cable length if the radio flaps.",
  remediable: false,
  suggested_actions: ["Check MR36 PoE class on switch port 2."],
};

function node(partial: Partial<TopologyNode> & Pick<TopologyNode, "id" | "type" | "subtype" | "label">): TopologyNode {
  return {
    managed: true,
    metadata: {},
    network: { id: "N_DEMO", name: "Home Lab" },
    health: { state: "healthy", critical_count: 0, warning_count: 0 },
    issue_count: 0,
    position: { x: 0, y: 0 },
    hostname: partial.label,
    management_ip: "",
    platform: "",
    location: "Home Lab",
    software_version: "",
    serial: partial.id,
    stack_members: [],
    device_class: "unknown",
    degree: 0,
    interfaces: [],
    ...partial,
  };
}

function link(partial: Partial<TopologyLink> & Pick<TopologyLink, "id" | "source" | "target">): TopologyLink {
  return {
    source_port: {},
    target_port: {},
    link_type: "wired",
    discovery_method: "lldp_cdp",
    health: "healthy",
    mismatches: [],
    faults: [],
    remediable_actions: [],
    source_hostname: "",
    target_hostname: "",
    source_interface: "",
    target_interface: "",
    source_management_ip: "",
    target_management_ip: "",
    source_platform: "",
    target_platform: "",
    source_device_class: "",
    target_device_class: "",
    interface_role: "",
    ...partial,
  };
}

function catalogPort(portId: string, extra?: { type?: string; status?: string; speed?: string; poe?: boolean; name?: string }) {
  const connected = extra?.status === "Connected";
  return {
    portId,
    config: {
      portId,
      name: extra?.name || "",
      type: extra?.type || "access",
      enabled: true,
      vlan: extra?.type === "trunk" ? undefined : 10,
      nativeVlan: extra?.type === "trunk" ? 1 : undefined,
      allowedVlans: extra?.type === "trunk" ? "1,10,20,30" : undefined,
      poeEnabled: extra?.poe ?? false,
    },
    status: {
      portId,
      status: extra?.status || "Disconnected",
      speed: connected ? extra?.speed || "1 Gbps" : "",
    },
    connectedPeers: [],
  };
}

const MS = "Q2XX-MS-0001";
const MX = "Q2XX-MX-0001";
const AP = "Q2XX-AP-0001";
const SERVER = "SERVER-01";

export const SAMPLE_GRAPH: TopologyGraph = {
  organization: { id: "O_DEMO", name: "Demo Org" },
  network: { id: "N_DEMO", name: "Home Lab" },
  generated_at: new Date().toISOString(),
  nodes: [
    node({
      id: MX,
      type: "meraki",
      subtype: "firewall",
      label: "MX-EDGE",
      hostname: "MX-EDGE",
      platform: "MX67",
      management_ip: "10.1.2.1",
      software_version: "18.211.2",
      serial: MX,
      device_class: "mx",
      metadata: { model: "MX67", productType: "appliance", lanIp: "10.1.2.1", firmware: "18.211.2", status: "online", mac: "00:18:0a:00:00:01" },
    }),
    node({
      id: MS,
      type: "meraki",
      subtype: "switch",
      label: "MS-MAIN",
      hostname: "MS-MAIN",
      platform: "MS120-8FP",
      management_ip: "10.1.2.2",
      software_version: "CS 15.21",
      serial: MS,
      device_class: "core",
      metadata: { model: "MS120-8FP", productType: "switch", lanIp: "10.1.2.2", firmware: "CS 15.21", status: "online" },
    }),
    node({
      id: AP,
      type: "meraki",
      subtype: "access_point",
      label: "MR36 AP",
      hostname: "MR36 AP",
      platform: "MR36",
      management_ip: "10.1.2.10",
      software_version: "31.1.5",
      serial: AP,
      device_class: "ap",
      metadata: { model: "MR36", productType: "wireless", lanIp: "10.1.2.10", firmware: "31.1.5", status: "online", mac: "00:18:0a:00:00:10" },
    }),
    node({
      id: SERVER,
      type: "neighbor",
      subtype: "server",
      label: "Server",
      hostname: "Server",
      platform: "Proxmox VE",
      management_ip: "10.1.2.20",
      managed: false,
      device_class: "server",
      serial: "",
      metadata: {
        merged: true,
        physical_interfaces: [
          { switch_serial: MS, port_id: "4", role: "management", member_id: "nic-mgmt" },
          { switch_serial: MS, port_id: "14", role: "fabric", member_id: "nic-fabric" },
        ],
      },
    }),
    node({
      id: "client-pi4",
      type: "client",
      subtype: "wired",
      label: "Pi4",
      hostname: "Pi4",
      platform: "Raspberry Pi",
      management_ip: "10.1.2.40",
      managed: false,
      device_class: "client",
      serial: "",
      metadata: { description: "Pi4", ip: "10.1.2.40", os: "Linux" },
    }),
    node({
      id: "client-rpi5",
      type: "client",
      subtype: "wired",
      label: "RPi5",
      hostname: "RPi5",
      platform: "Raspberry Pi",
      management_ip: "10.1.2.41",
      managed: false,
      device_class: "client",
      serial: "",
      metadata: { description: "RPi5", ip: "10.1.2.41", os: "Linux" },
    }),
    node({
      id: "client-nas",
      type: "neighbor",
      subtype: "server",
      label: "NAS",
      hostname: "NAS",
      platform: "Synology",
      management_ip: "10.1.2.30",
      managed: false,
      device_class: "server",
      serial: "",
      metadata: { description: "NAS", ip: "10.1.2.30" },
    }),
    node({
      id: "client-ha",
      type: "client",
      subtype: "wired",
      label: "homeassistant",
      hostname: "homeassistant",
      management_ip: "10.1.2.51",
      managed: false,
      device_class: "client",
      serial: "",
      metadata: { description: "homeassistant", parent_id: SERVER },
    }),
    node({
      id: "client-bday",
      type: "client",
      subtype: "wired",
      label: "birthdayserver",
      hostname: "birthdayserver",
      management_ip: "10.1.2.52",
      managed: false,
      device_class: "client",
      serial: "",
      metadata: { description: "birthdayserver", parent_id: SERVER },
    }),
    node({
      id: "client-orthanc",
      type: "client",
      subtype: "wired",
      label: "orthanc",
      hostname: "orthanc",
      management_ip: "10.1.2.53",
      managed: false,
      device_class: "client",
      serial: "",
      metadata: { description: "orthanc", parent_id: SERVER },
    }),
    node({
      id: "client-vm",
      type: "client",
      subtype: "wired",
      label: "vm-web",
      hostname: "vm-web",
      management_ip: "10.1.2.54",
      managed: false,
      device_class: "client",
      serial: "",
      metadata: { description: "vm-web", parent_id: SERVER },
    }),
    node({
      id: "client-eva",
      type: "client",
      subtype: "wireless",
      label: "Eva Tablet",
      hostname: "Eva Tablet",
      platform: "iPadOS",
      management_ip: "10.1.2.80",
      managed: false,
      device_class: "client",
      serial: "",
      metadata: { description: "Eva Tablet", ssid: "Home", os: "iPadOS" },
    }),
    node({
      id: "client-bechtle",
      type: "client",
      subtype: "wireless",
      label: "Bechtle Notebook",
      hostname: "Bechtle Notebook",
      platform: "Windows",
      management_ip: "10.1.2.81",
      managed: false,
      device_class: "client",
      serial: "",
      metadata: { description: "Bechtle Notebook", ssid: "Home", os: "Windows" },
    }),
    node({
      id: "client-android",
      type: "client",
      subtype: "wireless",
      label: "Android",
      hostname: "Android",
      platform: "Android",
      management_ip: "10.1.2.82",
      managed: false,
      device_class: "client",
      serial: "",
      metadata: { description: "Android", ssid: "Home" },
    }),
    node({
      id: "client-iphone",
      type: "client",
      subtype: "wireless",
      label: "Suars-iPhone",
      hostname: "Suars-iPhone",
      platform: "iOS",
      management_ip: "10.1.2.83",
      managed: false,
      device_class: "client",
      serial: "",
      metadata: { description: "Suars-iPhone", ssid: "Home", os: "iOS" },
    }),
    node({
      id: "neighbor-wan",
      type: "neighbor",
      subtype: "unmanaged",
      label: "ISP-CPE",
      hostname: "ISP-CPE",
      platform: "Unknown CPE",
      management_ip: "203.0.113.1",
      managed: false,
      device_class: "unmanaged",
      serial: "",
      metadata: { name: "ISP-CPE" },
    }),
  ],
  links: [
    link({
      id: "mx-wan",
      source: MX,
      target: "neighbor-wan",
      source_interface: "wan1",
      target_interface: "Gi0/1",
      link_type: "discovered_partial",
      discovery_method: "lldp_cdp_inferred",
    }),
    link({
      id: "mx-sw",
      source: MX,
      target: MS,
      source_interface: "lan1",
      target_interface: "1",
      source_port: { serial: MX, portId: "lan1", config: { type: "trunk" }, status: { status: "Connected", speed: "1 Gbps" } },
      target_port: { serial: MS, portId: "1", config: { type: "trunk", nativeVlan: 1, allowedVlans: "1,10,20,30" }, status: { status: "Connected", speed: "1 Gbps" } },
    }),
    link({
      id: "sw-ap",
      source: MS,
      target: AP,
      source_interface: "2",
      target_interface: "wired",
      health: "warning",
      faults: [poeWarn],
      source_port: { serial: MS, portId: "2", config: { type: "trunk", poeEnabled: true }, status: { status: "Connected", speed: "1 Gbps", poe: { status: "delivering" } } },
      target_port: { serial: AP, portId: "wired" },
    }),
    link({
      id: "sw-server-mgmt",
      source: MS,
      target: SERVER,
      source_interface: "4",
      target_interface: "mgmt",
      interface_role: "management",
      discovery_method: "physical_attachment",
      source_port: { serial: MS, portId: "4", role: "management", label: "management", config: { type: "access", vlan: 10 }, status: { status: "Connected" } },
      target_port: { serial: SERVER, portId: "mgmt", role: "management" },
    }),
    link({
      id: "sw-server-fabric",
      source: MS,
      target: SERVER,
      source_interface: "14",
      target_interface: "sfp",
      interface_role: "fabric",
      discovery_method: "physical_attachment",
      source_port: { serial: MS, portId: "14", role: "fabric", label: "fabric", config: { type: "trunk" }, status: { status: "Connected", speed: "10 Gbps" } },
      target_port: { serial: SERVER, portId: "sfp", role: "fabric" },
    }),
    link({
      id: "sw-pi4",
      source: MS,
      target: "client-pi4",
      source_interface: "5",
      target_interface: "eth0",
      discovery_method: "physical_attachment",
      source_port: { serial: MS, portId: "5", config: { type: "access", vlan: 10 }, status: { status: "Connected" } },
    }),
    link({
      id: "sw-rpi5",
      source: MS,
      target: "client-rpi5",
      source_interface: "10",
      target_interface: "eth0",
      discovery_method: "physical_attachment",
      source_port: { serial: MS, portId: "10", config: { type: "access", vlan: 10 }, status: { status: "Connected" } },
    }),
    link({
      id: "sw-nas",
      source: MS,
      target: "client-nas",
      source_interface: "7",
      target_interface: "eth0",
      discovery_method: "physical_attachment",
      source_port: { serial: MS, portId: "7", config: { type: "access", vlan: 10 }, status: { status: "Connected" } },
    }),
    link({ id: "srv-ha", source: SERVER, target: "client-ha", discovery_method: "physical_downstream" }),
    link({ id: "srv-bday", source: SERVER, target: "client-bday", discovery_method: "physical_downstream" }),
    link({ id: "srv-orthanc", source: SERVER, target: "client-orthanc", discovery_method: "physical_downstream" }),
    link({ id: "srv-vm", source: SERVER, target: "client-vm", discovery_method: "physical_downstream" }),
    link({ id: "ap-eva", source: AP, target: "client-eva", link_type: "wireless", discovery_method: "wireless_association", source_interface: "ssid:Home" }),
    link({ id: "ap-bechtle", source: AP, target: "client-bechtle", link_type: "wireless", discovery_method: "wireless_association", source_interface: "ssid:Home" }),
    link({ id: "ap-android", source: AP, target: "client-android", link_type: "wireless", discovery_method: "wireless_association", source_interface: "ssid:Home" }),
    link({ id: "ap-iphone", source: AP, target: "client-iphone", link_type: "wireless", discovery_method: "wireless_association", source_interface: "ssid:Home" }),
  ],
  issues: [poeWarn],
  summary: {
    total_nodes: 16,
    total_wired_links: 11,
    total_wireless_links: 4,
    total_mismatches: 0,
    total_critical_issues: 0,
    total_warning_issues: 1,
    unmanaged_neighbors: 12,
    remediable_issues: 0,
    manual_investigation_issues: 1,
  },
  switch_ports: {
    [MS]: [
      catalogPort("1", { type: "trunk", status: "Connected", name: "MX uplink" }),
      catalogPort("2", { type: "trunk", status: "Connected", poe: true, name: "MR36 AP" }),
      catalogPort("3"),
      catalogPort("4", { type: "access", status: "Connected", name: "Server mgmt" }),
      catalogPort("5", { type: "access", status: "Connected", name: "Pi4" }),
      catalogPort("6"),
      catalogPort("7", { type: "access", status: "Connected", name: "NAS" }),
      catalogPort("8"),
      catalogPort("9"),
      catalogPort("10", { type: "access", status: "Connected", name: "RPi5" }),
      catalogPort("11"),
      catalogPort("12"),
      catalogPort("13", { type: "trunk" }),
      catalogPort("14", { type: "trunk", status: "Connected", speed: "10 Gbps", name: "Server fabric" }),
    ],
  },
  clients_by_switch_port: {},
  port_peer_hints: [],
  topology_debug: { sample: true, physical_model: true },
};

(function finalizeSample(graph: TopologyGraph) {
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  const deg: Record<string, number> = {};
  for (const n of graph.nodes) deg[n.id] = 0;
  for (const l of graph.links) {
    deg[l.source] = (deg[l.source] || 0) + 1;
    deg[l.target] = (deg[l.target] || 0) + 1;
    const src = byId[l.source];
    const tgt = byId[l.target];
    l.source_hostname = src?.hostname || l.source;
    l.target_hostname = tgt?.hostname || l.target;
    l.source_management_ip = src?.management_ip || "";
    l.target_management_ip = tgt?.management_ip || "";
    l.source_platform = src?.platform || "";
    l.target_platform = tgt?.platform || "";
    l.source_device_class = src?.device_class || "";
    l.target_device_class = tgt?.device_class || "";
  }
  for (const n of graph.nodes) {
    n.degree = deg[n.id] || 0;
    n.interfaces = graph.links
      .flatMap((l) => {
        if (l.source === n.id) return [l.interface_role ? `${l.source_interface} ${l.interface_role}` : l.source_interface];
        if (l.target === n.id) return [l.target_interface];
        return [];
      })
      .filter(Boolean);
  }
  graph.summary.total_nodes = graph.nodes.length;
  graph.summary.total_wired_links = graph.links.filter((l) => l.link_type === "wired" || l.link_type === "discovered_partial").length;
  graph.summary.total_wireless_links = graph.links.filter((l) => l.link_type === "wireless").length;
})(SAMPLE_GRAPH);
