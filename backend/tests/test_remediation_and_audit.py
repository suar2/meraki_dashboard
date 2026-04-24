import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models.schemas import RemediationAction, RemediationExecuteRequest
from app.services.audit_service import AuditService
from app.services.remediation_service import RemediationService
from app.storage.file_store import JsonFileStore


class FakeMerakiClient:
    def __init__(self) -> None:
        self.last_payload = None

    async def update_switch_port(self, serial: str, port_id: str, payload: dict):
        self.last_payload = {"serial": serial, "port_id": port_id, "payload": payload}
        return {"portId": port_id, "name": f"Port {port_id}", "enabled": payload.get("enabled", True)}


class RemediationAuditTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        store = JsonFileStore(Path(self.tmp.name))
        self.audit = AuditService(store)
        self.meraki = FakeMerakiClient()
        self.service = RemediationService(self.meraki, self.audit)

    async def asyncTearDown(self) -> None:
        self.tmp.cleanup()

    async def test_allow_list_enforced(self):
        request = RemediationExecuteRequest(
            org_id="o1",
            network_id="n1",
            action=RemediationAction(
                id="a1",
                issue_id="i1",
                label="Fix",
                action_type="update_port_config",
                target_device_serial="S1",
                target_port_id="10",
                current_values={"type": "access"},
                proposed_values={"type": "trunk", "vlan": 10, "name": "unsafe-field"},
                requires_confirmation=True,
            ),
            actor="tester",
        )
        await self.service.apply(request)
        self.assertEqual(self.meraki.last_payload["payload"], {"type": "trunk", "vlan": 10})

    async def test_audit_payload_contains_required_fields(self):
        request = RemediationExecuteRequest(
            org_id="org-1",
            network_id="net-1",
            action=RemediationAction(
                id="a2",
                issue_id="issue-2",
                label="Enable port",
                action_type="update_port_config",
                target_device_serial="S2",
                target_port_id="4",
                current_values={"enabled": False},
                proposed_values={"enabled": True},
                requires_confirmation=True,
            ),
            actor="operator",
        )
        await self.service.apply(request)
        entries = self.audit.list_recent(limit=1)
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        for key in [
            "timestamp",
            "actor",
            "org_id",
            "network_id",
            "device_serial",
            "port_id",
            "issue_id",
            "issue_category",
            "previous_config",
            "proposed_config",
            "new_config",
            "outcome",
            "api_response",
        ]:
            self.assertIn(key, entry)

    async def test_merges_mode_context_for_partial_update(self):
        request = RemediationExecuteRequest(
            org_id="o1",
            network_id="n1",
            action=RemediationAction(
                id="a3",
                issue_id="i3",
                label="Copy admin",
                action_type="update_port_config",
                target_device_serial="S1",
                target_port_id="8",
                current_values={"enabled": True, "type": "trunk", "nativeVlan": 1},
                proposed_values={"enabled": False},
                requires_confirmation=True,
            ),
            actor="tester",
        )
        await self.service.apply(request)
        self.assertEqual(
            self.meraki.last_payload["payload"],
            {"enabled": False, "type": "trunk"},
        )


if __name__ == "__main__":
    unittest.main()
