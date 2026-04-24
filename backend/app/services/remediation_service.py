from app.models.schemas import AuditLogEntry, RemediationExecuteRequest
from app.services.audit_service import AuditService
from app.services.meraki_client import MerakiClient


class RemediationService:
    SAFE_KEYS = {"type", "vlan", "nativeVlan", "allowedVlans", "enabled", "poeEnabled"}

    def __init__(self, meraki: MerakiClient, audit: AuditService) -> None:
        self.meraki = meraki
        self.audit = audit

    async def apply(self, payload: RemediationExecuteRequest) -> dict:
        changes = {k: v for k, v in payload.action.proposed_values.items() if k in self.SAFE_KEYS}
        if not changes:
            raise ValueError("No allowed configuration keys provided for remediation.")
        # Meraki often needs port mode in the same PUT; avoid 400s when only toggling admin/PoE.
        current = dict(payload.action.current_values or {})
        if "type" not in changes and current.get("type") is not None:
            if any(k in changes for k in ("enabled", "poeEnabled", "vlan", "nativeVlan", "allowedVlans")):
                changes = {**changes, "type": current["type"]}

        result = await self.meraki.update_switch_port(
            serial=payload.action.target_device_serial,
            port_id=payload.action.target_port_id,
            payload=changes,
        )

        self.audit.append(
            AuditLogEntry(
                timestamp=self.audit.now(),
                actor=payload.actor,
                org_id=payload.org_id,
                network_id=payload.network_id,
                device_serial=payload.action.target_device_serial,
                port_id=payload.action.target_port_id,
                issue_id=payload.action.issue_id,
                issue_category=str(payload.action.action_type),
                previous_config=payload.action.current_values,
                proposed_config=payload.action.proposed_values,
                new_config=changes,
                outcome="success",
                api_response={"id": result.get("portId"), "name": result.get("name"), "enabled": result.get("enabled")},
            )
        )
        return {"status": "ok", "result": result}
