export type Severity = "critical" | "warning" | "info";

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

export interface TopologyNode {
  id: string;
  type: string;
  subtype: string;
  label: string;
  managed: boolean;
  metadata: Record<string, unknown>;
  network: Record<string, unknown>;
  health: { state: "healthy" | "warning" | "critical"; critical_count: number; warning_count: number };
  issue_count: number;
  position: { x: number; y: number };
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
}

export interface TopologyGraph {
  organization: { id: string };
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
  /** device serial -> port rows (config + status + peers) from Meraki switch APIs */
  switch_ports?: Record<string, Array<Record<string, unknown>>>;
  /** "SERIAL:portNumber" -> raw Meraki client rows */
  clients_by_switch_port?: Record<string, Array<Record<string, unknown>>>;
  port_peer_hints?: Array<Record<string, unknown>>;
  topology_debug?: Record<string, unknown>;
}
