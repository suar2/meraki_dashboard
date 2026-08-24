export type Severity = "critical" | "warning" | "info";
export type DeviceClass =
  | "mx"
  | "core"
  | "access"
  | "wlc"
  | "ap"
  | "server"
  | "mv"
  | "mg"
  | "phone"
  | "client"
  | "unmanaged"
  | "unknown";

export interface Issue {
  id: string;
  category: string;
  severity: Severity;
  scope: "node" | "link" | "port";
  description: string;
  remediable: boolean;
  source_data?: Record<string, unknown>;
  suggested_actions: string[];
}

export interface RemediationAction {
  id: string;
  issue_id: string;
  label: string;
  action_type: string;
  target_device_serial: string;
  target_port_id: string;
  current_values: Record<string, unknown>;
  proposed_values: Record<string, unknown>;
  requires_confirmation: boolean;
}

export interface StackMember {
  id: number;
  role?: string;
  serial_number: string;
  software_version: string;
}

export interface NodeHealth {
  state: "healthy" | "warning" | "critical";
  critical_count: number;
  warning_count: number;
}

export interface TopologyNode {
  id: string;
  type: string;
  subtype: string;
  label: string;
  managed: boolean;
  metadata: Record<string, unknown>;
  network: Record<string, unknown>;
  health: NodeHealth;
  issue_count: number;
  position: { x: number; y: number };
  hostname: string;
  management_ip: string;
  platform: string;
  location: string;
  software_version: string;
  serial: string;
  stack_members: StackMember[];
  device_class: DeviceClass | string;
  degree: number;
  interfaces: string[];
}

export interface TopologyLink {
  id: string;
  source: string;
  target: string;
  source_port: Record<string, unknown>;
  target_port: Record<string, unknown>;
  link_type: "wired" | "wireless" | "discovered_partial";
  discovery_method: string;
  health: "healthy" | "warning" | "critical";
  mismatches: Issue[];
  faults: Issue[];
  remediable_actions: RemediationAction[];
  last_seen?: string;
  source_hostname: string;
  target_hostname: string;
  source_interface: string;
  target_interface: string;
  source_management_ip: string;
  target_management_ip: string;
  source_platform: string;
  target_platform: string;
  source_device_class: string;
  target_device_class: string;
  interface_role?: string;
  discovery_sources?: string[];
  identity_resolution?: Record<string, unknown>;
  confidence?: string;
  evidence?: Array<{ key: string; label: string; ok: boolean }>;
}

export interface TopologyGraph {
  organization: { id: string; name?: string };
  network: { id: string; name: string };
  nodes: TopologyNode[];
  links: TopologyLink[];
  issues: Issue[];
  summary: {
    total_nodes: number;
    total_wired_links: number;
    total_wireless_links: number;
    total_mismatches: number;
    total_critical_issues: number;
    total_warning_issues: number;
    unmanaged_neighbors: number;
    remediable_issues: number;
    manual_investigation_issues: number;
  };
  generated_at: string;
  switch_ports?: Record<string, Array<Record<string, unknown>>>;
  clients_by_switch_port?: Record<string, Array<Record<string, unknown>>>;
  port_peer_hints?: Array<Record<string, unknown>>;
  topology_debug?: Record<string, unknown>;
}

export interface TopologyChange {
  id: string;
  at: string;
  kind: string;
  summary: string;
  node_id?: string;
  port?: string;
  severity?: string;
  before?: unknown;
  after?: unknown;
}

export interface TopologyDiagnostics {
  physical_edges: number;
  wireless_edges: number;
  high_confidence: number;
  medium_confidence: number;
  low_confidence: number;
  unknown_confidence?: number;
  unresolved_nodes: number;
  duplicate_identities: number;
  duplicate_chassis_candidates: number;
  duplicate_physical_edges: number;
  unresolved_identity_count: number;
  orphans: number;
  total_nodes: number;
  managed_nodes?: number;
}

export interface SavedView {
  id: string;
  name: string;
  starred?: boolean;
  shared?: boolean;
  view_mode?: string;
  selected_nodes?: string[];
  hidden_nodes?: string[];
  focus_nodes?: string[];
  expanded_groups?: string[];
  filters?: Record<string, unknown>;
  positions?: Record<string, { x: number; y: number }>;
  zoom?: number | null;
  pan?: { x: number; y: number };
  selected_ports?: string[];
  highlighted_path?: string[];
  layout?: string;
  collapse_wireless?: boolean;
  collapse_downstream?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface LogicalGroup {
  id: string;
  name: string;
  member_ids: string[];
}

export interface SearchHit {
  id: string;
  label: string;
  ip: string;
  type: string;
  color: string;
  haystack: string;
  match?: string;
}
