from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Severity = Literal["critical", "warning", "info"]
IssueCategory = Literal["config_mismatch", "operational_warning", "physical_suspicion", "poe_warning", "unmanaged_ambiguity"]


class NodeHealth(BaseModel):
    state: Literal["healthy", "warning", "critical"] = "healthy"
    critical_count: int = 0
    warning_count: int = 0


class TopologyNode(BaseModel):
    id: str
    type: str
    subtype: str
    label: str
    managed: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)
    network: dict[str, Any] = Field(default_factory=dict)
    health: NodeHealth = Field(default_factory=NodeHealth)
    issue_count: int = 0
    position: dict[str, float] = Field(default_factory=lambda: {"x": 0.0, "y": 0.0})


class Issue(BaseModel):
    id: str
    category: IssueCategory
    severity: Severity
    scope: Literal["node", "link", "port"]
    description: str
    remediable: bool
    source_data: dict[str, Any] = Field(default_factory=dict)
    suggested_actions: list[str] = Field(default_factory=list)


class RemediationAction(BaseModel):
    id: str
    issue_id: str
    label: str
    action_type: str
    target_device_serial: str
    target_port_id: str
    current_values: dict[str, Any] = Field(default_factory=dict)
    proposed_values: dict[str, Any] = Field(default_factory=dict)
    requires_confirmation: bool = True


class TopologyLink(BaseModel):
    id: str
    source: str
    target: str
    source_port: dict[str, Any] = Field(default_factory=dict)
    target_port: dict[str, Any] = Field(default_factory=dict)
    link_type: Literal["wired", "wireless", "discovered_partial"] = "wired"
    discovery_method: str = "lldp_cdp"
    health: Literal["healthy", "warning", "critical"] = "healthy"
    mismatches: list[Issue] = Field(default_factory=list)
    faults: list[Issue] = Field(default_factory=list)
    remediable_actions: list[RemediationAction] = Field(default_factory=list)
    last_seen: datetime | None = None


class TopologySummary(BaseModel):
    total_nodes: int
    total_wired_links: int
    total_wireless_links: int
    total_mismatches: int
    total_critical_issues: int
    total_warning_issues: int
    unmanaged_neighbors: int
    remediable_issues: int
    manual_investigation_issues: int


class TopologyGraph(BaseModel):
    organization: dict[str, Any]
    network: dict[str, Any]
    nodes: list[TopologyNode]
    links: list[TopologyLink]
    issues: list[Issue]
    summary: TopologySummary
    generated_at: datetime
    # Switch port + client reality (raw Meraki-friendly maps for UI / debug)
    switch_ports: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    clients_by_switch_port: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    port_peer_hints: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Synthetic or client-derived peers per switch port (trunk head, access group, etc.)",
    )
    topology_debug: dict[str, Any] = Field(default_factory=dict)


class LayoutPayload(BaseModel):
    org_id: str
    network_id: str
    positions: dict[str, dict[str, float]]


class AuditLogEntry(BaseModel):
    timestamp: datetime
    actor: str = "dashboard-user"
    org_id: str = ""
    network_id: str = ""
    device_serial: str
    port_id: str
    issue_id: str
    issue_category: str = ""
    previous_config: dict[str, Any]
    proposed_config: dict[str, Any] = Field(default_factory=dict)
    new_config: dict[str, Any]
    outcome: str
    api_response: dict[str, Any] = Field(default_factory=dict)


class RemediationExecuteRequest(BaseModel):
    org_id: str
    network_id: str
    action: RemediationAction
    actor: str = "dashboard-user"


class MerakiApiKeyPayload(BaseModel):
    api_key: str
