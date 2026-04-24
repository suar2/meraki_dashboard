from __future__ import annotations

from typing import Any

from app.models.schemas import Issue, RemediationAction


class ValidationService:
    def compare_ports(
        self,
        link_id: str,
        source_serial: str,
        source_port_id: str,
        source_cfg: dict[str, Any] | None,
        target_serial: str,
        target_port_id: str,
        target_cfg: dict[str, Any] | None,
        source_status: dict[str, Any] | None = None,
        target_status: dict[str, Any] | None = None,
    ) -> tuple[list[Issue], list[Issue], list[RemediationAction]]:
        mismatches: list[Issue] = []
        faults: list[Issue] = []
        actions: list[RemediationAction] = []

        if not source_cfg or not target_cfg:
            mismatches.append(
                Issue(
                    id=f"{link_id}-incomplete",
                    category="unmanaged_ambiguity",
                    severity="warning",
                    scope="link",
                    description="Peer link is not fully managed or neighbor data is incomplete.",
                    remediable=False,
                    source_data={
                        "source_serial": source_serial,
                        "source_port_id": source_port_id,
                        "target_serial": target_serial,
                        "target_port_id": target_port_id,
                    },
                )
            )
            return mismatches, faults, actions

        src_type = source_cfg.get("type")
        dst_type = target_cfg.get("type")
        if src_type != dst_type:
            mismatches.append(
                Issue(
                    id=f"{link_id}-mode",
                    category="config_mismatch",
                    severity="critical",
                    scope="link",
                    description=f"Port mode mismatch: {src_type} vs {dst_type}",
                    remediable=True,
                    suggested_actions=["Set both ports to matching mode (access or trunk)."],
                )
            )
            actions.append(self._copy_action(link_id, "Copy mode from A to B", source_serial, source_port_id, target_serial, target_port_id, target_cfg, {"type": src_type}))

        # Access VLAN: do not report both "mismatch" and "missing" for the same pair; trunk comparisons only if both sides are trunk
        if src_type == "access" and dst_type == "access":
            sv = source_cfg.get("vlan")
            tv = target_cfg.get("vlan")
            if sv is None or tv is None:
                if sv != tv:
                    mismatches.append(
                        Issue(
                            id=f"{link_id}-missing-access-vlan",
                            category="config_mismatch",
                            severity="warning",
                            scope="port",
                            description=f"Access VLAN not set on one or both sides (A={sv!r}, B={tv!r}).",
                            remediable=sv is not None,
                            suggested_actions=["Set explicit access VLAN on both ports when both are in access mode."],
                        )
                    )
                    if sv is not None:
                        actions.append(
                            self._copy_action(
                                link_id,
                                "Copy access VLAN from A to B",
                                source_serial,
                                source_port_id,
                                target_serial,
                                target_port_id,
                                target_cfg,
                                {"vlan": sv, "type": "access"},
                            )
                        )
            elif sv != tv:
                mismatches.append(
                    Issue(
                        id=f"{link_id}-access-vlan",
                        category="config_mismatch",
                        severity="critical",
                        scope="link",
                        description=f"Access VLAN mismatch: {sv} vs {tv}",
                        remediable=True,
                    )
                )
                actions.append(
                    self._copy_action(
                        link_id,
                        "Copy access VLAN from A to B",
                        source_serial,
                        source_port_id,
                        target_serial,
                        target_port_id,
                        target_cfg,
                        {"vlan": sv, "type": "access"},
                    )
                )

        if src_type == "trunk" and dst_type == "trunk":
            if source_cfg.get("nativeVlan") != target_cfg.get("nativeVlan"):
                mismatches.append(
                    Issue(
                        id=f"{link_id}-native-vlan",
                        category="config_mismatch",
                        severity="warning",
                        scope="link",
                        description=f"Native VLAN mismatch: {source_cfg.get('nativeVlan')} vs {target_cfg.get('nativeVlan')}",
                        remediable=True,
                    )
                )
                actions.append(self._copy_action(link_id, "Copy native VLAN from A to B", source_serial, source_port_id, target_serial, target_port_id, target_cfg, {"nativeVlan": source_cfg.get("nativeVlan"), "type": "trunk"}))
            if source_cfg.get("allowedVlans") != target_cfg.get("allowedVlans"):
                mismatches.append(
                    Issue(
                        id=f"{link_id}-allowed-vlan",
                        category="config_mismatch",
                        severity="warning",
                        scope="link",
                        description=f"Allowed VLAN mismatch: {source_cfg.get('allowedVlans')} vs {target_cfg.get('allowedVlans')}",
                        remediable=True,
                    )
                )
                actions.append(self._copy_action(link_id, "Copy allowed VLANs from A to B", source_serial, source_port_id, target_serial, target_port_id, target_cfg, {"allowedVlans": source_cfg.get("allowedVlans"), "type": "trunk"}))

        if source_cfg.get("enabled") != target_cfg.get("enabled"):
            mismatches.append(
                Issue(
                    id=f"{link_id}-admin-state",
                    category="config_mismatch",
                    severity="warning",
                    scope="link",
                    description=f"Admin state mismatch: {source_cfg.get('enabled')} vs {target_cfg.get('enabled')}",
                    remediable=True,
                )
            )
            actions.append(self._copy_action(link_id, "Copy admin state from A to B", source_serial, source_port_id, target_serial, target_port_id, target_cfg, {"enabled": source_cfg.get("enabled")}))

        if source_cfg.get("enabled") is False or target_cfg.get("enabled") is False:
            mismatches.append(
                Issue(
                    id=f"{link_id}-port-disabled",
                    category="operational_warning",
                    severity="warning",
                    scope="port",
                    description="One side of the link is administratively disabled.",
                    remediable=True,
                    suggested_actions=["Enable disabled port if link should be active."],
                )
            )

        if source_cfg.get("poeEnabled") != target_cfg.get("poeEnabled"):
            mismatches.append(
                Issue(
                    id=f"{link_id}-poe-admin",
                    category="poe_warning",
                    severity="warning",
                    scope="link",
                    description=f"PoE admin mismatch: {source_cfg.get('poeEnabled')} vs {target_cfg.get('poeEnabled')}",
                    remediable=True,
                )
            )
            actions.append(self._copy_action(link_id, "Copy PoE state from A to B", source_serial, source_port_id, target_serial, target_port_id, target_cfg, {"poeEnabled": source_cfg.get("poeEnabled")}))

        for side, status in (("A", source_status), ("B", target_status)):
            if not status:
                continue
            errors = status.get("errors", [])
            if errors:
                faults.append(
                    Issue(
                        id=f"{link_id}-{side}-errors",
                        category="operational_warning",
                        severity="warning",
                        scope="port",
                        description=f"Port {side} reports operational issues: {', '.join(errors)}",
                        remediable=False,
                    )
                )
            warnings = status.get("warnings", [])
            if warnings:
                faults.append(
                    Issue(
                        id=f"{link_id}-{side}-warnings",
                        category="operational_warning",
                        severity="warning",
                        scope="port",
                        description=f"Port {side} warnings: {', '.join(warnings)}",
                        remediable=False,
                    )
                )
            if status.get("isUplink") and status.get("status") != "Connected":
                faults.append(
                    Issue(
                        id=f"{link_id}-{side}-uplink",
                        category="operational_warning",
                        severity="critical",
                        scope="port",
                        description=f"Uplink on side {side} is not connected.",
                        remediable=False,
                    )
                )
            # Surface physical-layer counters as manual-investigation diagnostics.
            crc = status.get("crcErrors")
            if isinstance(crc, int) and crc > 0:
                faults.append(
                    Issue(
                        id=f"{link_id}-{side}-crc",
                        category="physical_suspicion",
                        severity="warning",
                        scope="port",
                        description=f"Port {side} reports CRC errors ({crc}). Check cable/optic/PHY.",
                        remediable=False,
                    )
                )
            poe_fault = status.get("poe", {}).get("status") if isinstance(status.get("poe"), dict) else None
            if poe_fault and str(poe_fault).lower() not in {"ok", "enabled"}:
                faults.append(
                    Issue(
                        id=f"{link_id}-{side}-poe-fault",
                        category="poe_warning",
                        severity="warning",
                        scope="port",
                        description=f"Port {side} reports PoE status '{poe_fault}'.",
                        remediable=False,
                    )
                )
        return mismatches, faults, actions

    def _copy_action(
        self,
        link_id: str,
        label: str,
        source_serial: str,
        source_port_id: str,
        target_serial: str,
        target_port_id: str,
        target_current_cfg: dict[str, Any],
        proposed: dict[str, Any],
    ) -> RemediationAction:
        return RemediationAction(
            id=f"{link_id}-{label.lower().replace(' ', '-')}",
            issue_id=link_id,
            label=label,
            action_type="update_port_config",
            target_device_serial=target_serial,
            target_port_id=target_port_id,
            current_values={"peer_serial": source_serial, "peer_port": source_port_id, **target_current_cfg},
            proposed_values=proposed,
            requires_confirmation=True,
        )
