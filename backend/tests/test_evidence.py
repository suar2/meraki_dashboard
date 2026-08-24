import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models.schemas import TopologyLink
from app.services.evidence import stamp_link_evidence


class LinkEvidenceTests(unittest.TestCase):
    def test_high_confidence_linklayer_and_lldp(self):
        link = TopologyLink(
            id="ms-mr",
            source="MS",
            target="MR",
            source_port={"portId": "2", "status": {"status": "Connected"}},
            target_port={"portId": "wired"},
            link_type="wired",
            discovery_method="topology_link_layer",
            discovery_sources=["topology_link_layer", "device_lldp_cdp", "switch_port_status"],
            identity_resolution={"method": "lldp_deviceMac", "deviceMac": "00:18:0a:aa:aa:03"},
        )
        stamp_link_evidence(link)
        self.assertEqual(link.confidence, "high")
        ok = {item["key"]: item["ok"] for item in link.evidence}
        self.assertTrue(ok["topology_link_layer"])
        self.assertTrue(ok["lldp"])
        self.assertTrue(ok["device_mac"])
        self.assertTrue(ok["switch_port_status"])

    def test_medium_inferred_from_client_mac(self):
        link = TopologyLink(
            id="ms-mv",
            source="MS",
            target="MV",
            source_port={"portId": "8"},
            target_port={"portId": "uplink"},
            link_type="wired",
            discovery_method="wired_client_switchport",
            discovery_sources=["wired_client_switchport"],
            identity_resolution={"method": "client_switchport", "mac": "00:18:0a:aa:aa:04"},
        )
        stamp_link_evidence(link)
        self.assertEqual(link.confidence, "medium")
        self.assertIn("switchport + client MAC", link.identity_resolution["confidence_summary"])
        ok = {item["key"]: item["ok"] for item in link.evidence}
        self.assertTrue(ok["client_history"])
        self.assertFalse(ok["topology_link_layer"])


if __name__ == "__main__":
    unittest.main()
