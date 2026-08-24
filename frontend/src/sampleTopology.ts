import type { Issue, RemediationAction, TopologyGraph, TopologyLink, TopologyNode } from "./types/topology";

const issue: Issue = {
  id: "l-core-acc-mode",
  category: "config_mismatch",
  severity: "critical",
  scope: "link",
  description: "Port mode mismatch: trunk vs access.",
  remediable: true,
  suggested_actions: ["Set both sides to trunk with matching native/allowed VLANs."],
};

const action: RemediationAction = {
  id: "fix-acc-mode",
  issue_id: issue.id,
  label: "Set MS-ACC port 24 to trunk",
  action_type: "switch_port_update",
  target_device_serial: "Q2XX-ACC-0001",
  target_port_id: "24",
  current_values: { type: "access", vlan: 10, enabled: true },
  proposed_values: { type: "trunk", nativeVlan: 1, allowedVlans: "1,10,20,30" },
  requires_confirmation: true,
};

function node(partial: Partial<TopologyNode> & Pick<TopologyNode, "id" | "type" | "subtype" | "label">): TopologyNode {
  return {
    managed: true,
    metadata: {},
    network: { id: "N_DEMO", name: "HQ Demo" },
    health: { state: "healthy", critical_count: 0, warning_count: 0 },
    issue_count: 0,
    position: { x: 0, y: 0 },
    hostname: partial.label,
    management_ip: "",
    platform: "",
    location: "HQ Demo",
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
    ...partial,
  };
}

export const SAMPLE_GRAPH: TopologyGraph = {
  organization: { id: "O_DEMO", name: "Demo Org" },
  network: { id: "N_DEMO", name: "HQ Demo" },
  generated_at: new Date().toISOString(),
  nodes: [
    node({
      id: "Q2XX-MX-0001",
      type: "meraki",
      subtype: "firewall",
      label: "MX-EDGE",
      hostname: "MX-EDGE",
      platform: "MX84",
      management_ip: "10.10.0.1",
      software_version: "18.211.2",
      serial: "Q2XX-MX-0001",
      device_class: "mx",
      metadata: { model: "MX84", productType: "appliance", lanIp: "10.10.0.1", firmware: "18.211.2", status: "online" },
    }),
    node({
      id: "Q2XX-CORE-0001",
      type: "meraki",
      subtype: "switch",
      label: "MS-CORE",
      hostname: "MS-CORE",
      platform: "MS425-32",
      management_ip: "10.10.0.10",
      software_version: "CS 15.21",
      serial: "Q2XX-CORE-0001",
      device_class: "core",
      stack_members: [
        { id: 1, role: "active", serial_number: "Q2XX-CORE-0001", software_version: "CS 15.21" },
        { id: 2, role: "member", serial_number: "Q2XX-CORE-0002", software_version: "CS 15.21" },
      ],
      metadata: { model: "MS425-32", productType: "switch", lanIp: "10.10.0.10", firmware: "CS 15.21", status: "online" },
    }),
    node({
      id: "Q2XX-ACC-0001",
      type: "meraki",
      subtype: "switch",
      label: "MS-ACC",
      hostname: "MS-ACC",
      platform: "MS130-12X",
      management_ip: "10.10.0.11",
      software_version: "CS 15.21",
      serial: "Q2XX-ACC-0001",
      device_class: "access",
      health: { state: "critical", critical_count: 1, warning_count: 0 },
      issue_count: 1,
      metadata: { model: "MS130-12X", productType: "switch", lanIp: "10.10.0.11", firmware: "CS 15.21", status: "online" },
    }),
    node({
      id: "Q2XX-AP-0001",
      type: "meraki",
      subtype: "access_point",
      label: "MR-LOBBY",
      hostname: "MR-LOBBY",
      platform: "MR46",
      management_ip: "10.10.0.21",
      software_version: "31.1.5",
      serial: "Q2XX-AP-0001",
      device_class: "ap",
      metadata: { model: "MR46", productType: "wireless", lanIp: "10.10.0.21", firmware: "31.1.5", status: "online" },
    }),
    node({
      id: "Q2XX-MV-0001",
      type: "meraki",
      subtype: "camera",
      label: "MV-DOOR",
      hostname: "MV-DOOR",
      platform: "MV12",
      management_ip: "10.10.0.31",
      software_version: "5.9.1",
      serial: "Q2XX-MV-0001",
      device_class: "mv",
      metadata: { model: "MV12", productType: "camera", lanIp: "10.10.0.31" },
    }),
    node({
      id: "Q2XX-MG-0001",
      type: "meraki",
      subtype: "cellular",
      label: "MG-BACKUP",
      hostname: "MG-BACKUP",
      platform: "MG21",
      management_ip: "10.10.0.41",
      software_version: "5.0",
      serial: "Q2XX-MG-0001",
      device_class: "mg",
      metadata: { model: "MG21", productType: "cellularGateway", lanIp: "10.10.0.41" },
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
      metadata: { name: "ISP-CPE", cdp: { platform: "Unknown CPE", address: "203.0.113.1" } },
    }),
    node({
      id: "client-1",
      type: "client",
      subtype: "wireless",
      label: "lobby-laptop",
      hostname: "lobby-laptop",
      platform: "macOS",
      management_ip: "10.10.20.88",
      managed: false,
      device_class: "client",
      serial: "",
      metadata: { description: "lobby-laptop", ip: "10.10.20.88", os: "macOS", ssid: "Corp" },
    }),
  ],
  links: [
    link({
      id: "mx-wan",
      source: "Q2XX-MX-0001",
      target: "neighbor-wan",
      source_interface: "wan1",
      target_interface: "Gi0/1",
      link_type: "discovered_partial",
      discovery_method: "lldp_cdp_inferred",
    }),
    link({
      id: "mx-core",
      source: "Q2XX-MX-0001",
      target: "Q2XX-CORE-0001",
      source_interface: "lan1",
      target_interface: "1",
      source_port: { serial: "Q2XX-MX-0001", portId: "lan1", config: { type: "trunk" } },
      target_port: { serial: "Q2XX-CORE-0001", portId: "1", config: { type: "trunk", nativeVlan: 1, allowedVlans: "1,10,20,30" }, status: { status: "Connected", speed: "10 Gbps" } },
    }),
    link({
      id: "core-acc",
      source: "Q2XX-CORE-0001",
      target: "Q2XX-ACC-0001",
      source_interface: "8",
      target_interface: "24",
      health: "critical",
      mismatches: [issue],
      remediable_actions: [action],
      source_port: {
        serial: "Q2XX-CORE-0001",
        portId: "8",
        config: { type: "trunk", nativeVlan: 1, allowedVlans: "1,10,20,30", enabled: true, poeEnabled: false },
        status: { status: "Connected", speed: "10 Gbps" },
      },
      target_port: {
        serial: "Q2XX-ACC-0001",
        portId: "24",
        config: { type: "access", vlan: 10, enabled: true, poeEnabled: true },
        status: { status: "Connected", speed: "1 Gbps" },
      },
    }),
    link({
      id: "acc-ap",
      source: "Q2XX-ACC-0001",
      target: "Q2XX-AP-0001",
      source_interface: "5",
      target_interface: "wired",
      source_port: { serial: "Q2XX-ACC-0001", portId: "5", config: { type: "access", vlan: 20, poeEnabled: true }, status: { status: "Connected" } },
      target_port: { serial: "Q2XX-AP-0001", portId: "wired" },
    }),
    link({
      id: "acc-mv",
      source: "Q2XX-ACC-0001",
      target: "Q2XX-MV-0001",
      source_interface: "6",
      target_interface: "eth0",
      health: "warning",
      faults: [
        {
          id: "poe-warn",
          category: "poe_warning",
          severity: "warning",
          scope: "port",
          description: "PoE draw is high on camera port.",
          remediable: false,
          suggested_actions: ["Check camera PoE class and cable length."],
        },
      ],
      source_port: { serial: "Q2XX-ACC-0001", portId: "6", config: { type: "access", vlan: 30, poeEnabled: true }, status: { status: "Connected", poe: { status: "high" } } },
      target_port: { serial: "Q2XX-MV-0001", portId: "eth0" },
    }),
    link({
      id: "mx-mg",
      source: "Q2XX-MX-0001",
      target: "Q2XX-MG-0001",
      source_interface: "wan2",
      target_interface: "eth0",
    }),
    link({
      id: "ap-client",
      source: "Q2XX-AP-0001",
      target: "client-1",
      source_interface: "ssid:Corp",
      target_interface: "wlan0",
      link_type: "wireless",
      discovery_method: "wireless_association",
    }),
  ],
  issues: [issue],
  summary: {
    total_nodes: 8,
    total_wired_links: 6,
    total_wireless_links: 1,
    total_mismatches: 1,
    total_critical_issues: 1,
    total_warning_issues: 1,
    unmanaged_neighbors: 2,
    remediable_issues: 1,
    manual_investigation_issues: 1,
  },
  switch_ports: {},
  clients_by_switch_port: {},
  port_peer_hints: [],
  topology_debug: { sample: true },
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
    n.interfaces = graph.links.flatMap((l) => {
      if (l.source === n.id) return [l.source_interface];
      if (l.target === n.id) return [l.target_interface];
      return [];
    }).filter(Boolean);
  }
})(SAMPLE_GRAPH);
