import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.switchport_client_builder import group_wired_clients_by_switch_port, is_likely_wired_lan_client


class SwitchportClientBuilderTests(unittest.TestCase):
    def test_wired_filter_excludes_ssid(self):
        self.assertFalse(is_likely_wired_lan_client({"ssid": "home", "recentDeviceSerial": "Q2"}))
        self.assertTrue(is_likely_wired_lan_client({"connection": "Wired", "switchport": "14", "recentDeviceSerial": "Q2"}))

    def test_grouping_by_port(self):
        sw = {"S1", "S2"}
        clients = [
            {"id": "a", "recentDeviceSerial": "S1", "switchport": "Port 14", "connection": "Wired", "description": "vm1"},
            {"id": "b", "recentDeviceSerial": "S1", "switchport": "14", "connection": "Wired", "description": "vm2"},
            {"id": "c", "recentDeviceSerial": "S1", "switchport": "2", "connection": "Wired", "description": "p"},
        ]
        g = group_wired_clients_by_switch_port(clients, sw)
        self.assertIn(("S1", "14"), g)
        self.assertEqual(len(g[("S1", "14")]), 2)
        self.assertIn(("S1", "2"), g)


if __name__ == "__main__":
    unittest.main()
