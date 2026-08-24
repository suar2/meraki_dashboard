import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.device_class import classify_device, elect_core_switch_ids


class DeviceClassTests(unittest.TestCase):
    def test_packet_express_platforms(self):
        self.assertEqual(classify_device(hostname="DE-HAM-CORE", platform="C9500-48Y4C"), "core")
        self.assertEqual(classify_device(hostname="WLC-01", platform="C9800-L-C"), "wlc")
        self.assertEqual(classify_device(hostname="ACC-01", platform="C9200-48P"), "access")
        self.assertEqual(classify_device(hostname="AP-01", platform="C9120AXI"), "ap")
        self.assertEqual(classify_device(hostname="SEP001122334455", platform="IP Phone 8841"), "phone")

    def test_meraki_product_families(self):
        self.assertEqual(classify_device(hostname="MX", platform="MX84", product_type="appliance", subtype="firewall"), "mx")
        self.assertEqual(classify_device(hostname="MR", platform="MR46", product_type="wireless", subtype="access_point"), "ap")
        self.assertEqual(classify_device(hostname="MV", platform="MV12", product_type="camera", subtype="camera"), "mv")
        self.assertEqual(classify_device(hostname="MG", platform="MG21", product_type="cellularGateway", subtype="cellular"), "mg")
        self.assertEqual(
            classify_device(hostname="MS-CORE", platform="MS425-32", product_type="switch", subtype="switch", is_core_switch=True),
            "core",
        )
        self.assertEqual(
            classify_device(hostname="MS-ACC", platform="MS130-12X", product_type="switch", subtype="switch"),
            "access",
        )

    def test_client_and_unmanaged(self):
        self.assertEqual(classify_device(hostname="laptop", node_type="client", subtype="wireless", managed=False), "client")
        self.assertEqual(
            classify_device(hostname="Unknown CDP peer", node_type="neighbor", subtype="unmanaged", managed=False),
            "unmanaged",
        )

    def test_core_election_prefers_c9500_then_degree(self):
        nodes = [
            {"id": "a", "subtype": "switch", "platform": "MS130", "hostname": "acc"},
            {"id": "b", "subtype": "switch", "platform": "MS425", "hostname": "core-sw"},
        ]
        self.assertEqual(elect_core_switch_ids(nodes, {"a": 8, "b": 2}), {"b"})
        catalyst = [
            {"id": "a", "subtype": "switch", "platform": "MS130", "hostname": "acc"},
            {"id": "c", "subtype": "switch", "platform": "C9500-48Y4C", "hostname": "core"},
        ]
        self.assertEqual(elect_core_switch_ids(catalyst, {"a": 12, "c": 1}), {"c"})


if __name__ == "__main__":
    unittest.main()
