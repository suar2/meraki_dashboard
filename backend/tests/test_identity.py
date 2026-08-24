import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.identity import (
    ManagedInventory,
    best_identity_name,
    human_label,
    is_derived_id,
    is_wireless_client,
    normalize_hostname,
    normalize_mac,
    resolve_link_end,
    unmanaged_node_id,
)


class IdentityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.devices = [
            {
                "serial": "Q2KN-MX-0001",
                "name": "FW-01",
                "model": "MX67",
                "productType": "appliance",
                "mac": "00:18:0a:aa:aa:01",
                "lanIp": "10.1.2.1",
            },
            {
                "serial": "Q2KN-MS-0001",
                "name": "MS130",
                "model": "MS130-12X",
                "productType": "switch",
                "mac": "00:18:0a:aa:aa:02",
                "lanIp": "10.1.2.2",
            },
            {
                "serial": "Q2KN-MR-0001",
                "name": "MR36",
                "model": "MR36",
                "productType": "wireless",
                "mac": "00180aaaaa03",
                "lanIp": "10.1.2.10",
            },
            {
                "serial": "Q2KN-MV-0001",
                "name": "Main - camera",
                "model": "MV12",
                "productType": "camera",
                "mac": "00-18-0A-AA-AA-04",
                "lanIp": "10.1.2.12",
            },
        ]
        self.inventory = ManagedInventory(self.devices)

    def test_normalize_mac_accepts_colonless_and_hyphen(self):
        self.assertEqual(normalize_mac("00180aaaaa03"), "00:18:0a:aa:aa:03")
        self.assertEqual(normalize_mac("00-18-0A-AA-AA-04"), "00:18:0a:aa:aa:04")

    def test_managed_mv_matched_by_mac(self):
        hit = self.inventory.resolve(mac="00:18:0a:aa:aa:04")
        self.assertIsNotNone(hit)
        self.assertEqual(hit.node_id, "Q2KN-MV-0001")
        self.assertEqual(hit.method, "mac_match")

    def test_managed_mr_matched_by_mac_without_colons(self):
        hit = self.inventory.resolve(mac="00:18:0a:aa:aa:03")
        self.assertIsNotNone(hit)
        self.assertEqual(hit.node_id, "Q2KN-MR-0001")

    def test_client_duplicate_suppression_camera(self):
        hit = self.inventory.resolve_client(
            {
                "mac": "00:18:0a:aa:aa:04",
                "description": "Main - camera",
                "recentDeviceSerial": "Q2KN-MS-0001",
                "switchport": "8",
            }
        )
        self.assertIsNotNone(hit)
        self.assertEqual(hit.node_id, "Q2KN-MV-0001")

    def test_topology_derived_id_resolves_to_managed_serial(self):
        topology = {
            "nodes": [
                {
                    "derivedId": "5555555555",
                    "mac": "00:18:0a:aa:aa:04",
                    "type": "device",
                    "device": {
                        "serial": "Q2KN-MV-0001",
                        "name": "Main - camera",
                        "model": "MV12",
                        "productType": "camera",
                    },
                }
            ]
        }
        indexed = self.inventory.bind_link_layer_nodes(topology)
        self.assertIn("5555555555", indexed)
        hit = self.inventory.resolve(derived_id="5555555555")
        self.assertIsNotNone(hit)
        self.assertEqual(hit.node_id, "Q2KN-MV-0001")
        self.assertEqual(hit.method, "topology_derivedId")

    def test_lldp_device_mac_resolves_managed_device(self):
        hit = self.inventory.resolve_lldp(
            {
                "deviceMac": "00:18:0a:aa:aa:04",
                "lldp": {"systemName": "Main - camera", "chassisId": "00:18:0a:aa:aa:04"},
            }
        )
        self.assertIsNotNone(hit)
        self.assertEqual(hit.node_id, "Q2KN-MV-0001")
        self.assertEqual(hit.method, "lldp_deviceMac")

    def test_link_end_derived_id_without_serial_uses_topology_nodes(self):
        topology = {
            "nodes": [
                {
                    "derivedId": "2222222222",
                    "mac": "00:18:0a:aa:aa:02",
                    "root": False,
                    "device": {"serial": "Q2KN-MS-0001", "name": "MS130", "productType": "switch"},
                }
            ]
        }
        indexed = self.inventory.bind_link_layer_nodes(topology)
        hit, _topo, _disc = resolve_link_end(
            {"node": {"derivedId": "2222222222"}, "discovered": {"port": "2"}},
            self.inventory,
            indexed,
        )
        self.assertIsNotNone(hit)
        self.assertEqual(hit.node_id, "Q2KN-MS-0001")
        self.assertIn("topology_derivedId", hit.evidence)

    def test_best_name_resolution_before_raw_mac(self):
        self.assertEqual(best_identity_name("00:11:22:33:44:55", "Proxmox"), "Proxmox")
        self.assertEqual(best_identity_name("aa:bb:cc:dd:ee:ff", "10.1.2.20"), "10.1.2.20")
        self.assertEqual(best_identity_name("aa:bb:cc:dd:ee:ff"), "aa:bb:cc:dd:ee:ff")
        self.assertEqual(
            best_identity_name(
                {"lldp": {"systemName": "Proxmox VE"}, "mac": "aa:bb:cc:dd:ee:ff", "ip": "10.1.2.20"}
            ),
            "Proxmox VE",
        )
        self.assertEqual(human_label("5555555555", "00:18:0a:aa:aa:04", "Main - camera"), "Main - camera")
        self.assertEqual(normalize_hostname("pve.local"), "pve")
        self.assertEqual(normalize_hostname("Meraki MX67 - FW-01"), "fw01")
        self.assertTrue(is_derived_id("5555555555"))
        self.assertEqual(human_label("5555555555", "Main - camera"), "Main - camera")
        self.assertEqual(human_label("5555555555"), "")
        self.assertTrue(unmanaged_node_id(derived_id="5555555555").startswith("neighbor-"))
        self.assertNotEqual(unmanaged_node_id(derived_id="5555555555"), "5555555555")

    def test_wireless_client_rule_uses_connection_not_just_ssid(self):
        self.assertTrue(
            is_wireless_client(
                {"recentDeviceConnection": "Wireless", "recentDeviceSerial": "Q2KN-MR-0001"},
                {"Q2KN-MR-0001"},
            )
        )
        self.assertFalse(
            is_wireless_client(
                {"recentDeviceConnection": "Wired", "recentDeviceSerial": "Q2KN-MS-0001", "switchport": "5"},
                {"Q2KN-MR-0001"},
            )
        )


if __name__ == "__main__":
    unittest.main()
