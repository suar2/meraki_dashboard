export type Severity = "critical" | "warning" | "info";

export interface Issue {
  id: string;
  category: string;
  severity: Severity;
  scope: "node" | "link" | "port";
  description: string;
  remediable: boolean;
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
}

export interface TopologyGraph {
  organization: { id: string };
  network: { id: string; name: string };
  nodes: TopologyNode[];
  links: TopologyLink[];
  issues: Issue[];
  summary: Record<string, number>;
  generated_at: string;
}
