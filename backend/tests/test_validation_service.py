import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.validation_service import ValidationService


class ValidationServiceUnitTests(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = ValidationService()

    def test_detects_mode_and_vlan_mismatch_and_generates_actions(self):
        mismatches, faults, actions = self.validator.compare_ports(
            link_id="l1",
            source_serial="S1",
            source_port_id="1",
            source_cfg={"type": "access", "vlan": 10, "enabled": True, "poeEnabled": True},
            target_serial="S2",
            target_port_id="2",
            target_cfg={"type": "trunk", "nativeVlan": 1, "enabled": False, "poeEnabled": False},
            source_status={"status": "Connected", "errors": []},
            target_status={"status": "Disconnected", "isUplink": True, "errors": ["linkFailure"]},
        )
        self.assertTrue(any(m.id.endswith("-mode") for m in mismatches))
        self.assertTrue(any(m.id.endswith("-admin-state") for m in mismatches))
        self.assertTrue(any(f.id.endswith("-B-uplink") for f in faults))
        self.assertGreaterEqual(len(actions), 2)

    def test_incomplete_peer_returns_unmanaged_ambiguity(self):
        mismatches, faults, actions = self.validator.compare_ports(
            link_id="l2",
            source_serial="S1",
            source_port_id="1",
            source_cfg=None,
            target_serial="S2",
            target_port_id="2",
            target_cfg={"type": "access"},
        )
        self.assertEqual(len(faults), 0)
        self.assertEqual(len(actions), 0)
        self.assertTrue(any(m.category == "unmanaged_ambiguity" for m in mismatches))

    def test_trunk_vs_access_does_not_flag_native_or_allowed_mismatch(self):
        mismatches, _, _ = self.validator.compare_ports(
            "l3",
            "S1",
            "1",
            {"type": "trunk", "nativeVlan": 99, "allowedVlans": "1-4094", "enabled": True, "poeEnabled": True},
            "S2",
            "2",
            {"type": "access", "vlan": 10, "enabled": True, "poeEnabled": True},
        )
        self.assertTrue(any(m.id.endswith("-mode") for m in mismatches))
        self.assertFalse(any("native-vlan" in m.id for m in mismatches))
        self.assertFalse(any("allowed-vlan" in m.id for m in mismatches))

    def test_access_vlan_missing_does_not_also_flag_numeric_mismatch(self):
        """One side with no VLAN and the other with VLAN should be 'missing', not a numeric mismatch critical."""
        mismatches, _, _ = self.validator.compare_ports(
            "l4",
            "S1",
            "1",
            {"type": "access", "vlan": 10, "enabled": True, "poeEnabled": True},
            "S2",
            "2",
            {"type": "access", "vlan": None, "enabled": True, "poeEnabled": True},
        )
        ids = {m.id for m in mismatches}
        self.assertIn("l4-missing-access-vlan", ids)
        self.assertNotIn("l4-access-vlan", ids)


if __name__ == "__main__":
    unittest.main()
