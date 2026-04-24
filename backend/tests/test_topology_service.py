import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models.schemas import TopologyLink, TopologyNode
from app.services.topology_service import TopologyService


class TopologyServiceUnitTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = TopologyService(meraki=None, validator=None, layouts=None, store=None)  # type: ignore[arg-type]

    def test_alias_matching_resolves_existing_managed_node(self):
        node_map = {
            "Q2NV-QUEV-DS7D": TopologyNode(
                id="Q2NV-QUEV-DS7D",
                type="meraki",
                subtype="switch",
                label="MS130",
                managed=True,
                metadata={"name": "MS130", "serial": "Q2NV-QUEV-DS7D", "model": "MS130-12X"},
                network={"id": "n1", "name": "Main"},
            )
        }
        resolved = self.service._resolve_peer_node_id("Meraki MS130-12X - MS130", node_map)
        self.assertEqual(resolved, "Q2NV-QUEV-DS7D")

    def test_link_dedup_prefers_direct_lldp(self):
        inferred = TopologyLink(
            id="lldp-inferred",
            source="A",
            target="B",
            source_port={"portId": "1"},
            target_port={"portId": "2"},
            link_type="wired",
            discovery_method="lldp_cdp_inferred",
        )
        direct = TopologyLink(
            id="lldp-direct",
            source="A",
            target="B",
            source_port={"portId": "1"},
            target_port={"portId": "2"},
            link_type="wired",
            discovery_method="lldp_cdp",
        )
        links = TopologyService._dedupe_links([inferred, direct])
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].id, "lldp-direct")

    def test_port_map_get_matches_port3_and_numeric_key(self):
        m = {"3": {"portId": "3", "name": "test"}}
        self.assertEqual(self.service._port_map_get(m, "port3"), m["3"])
        self.assertEqual(self.service._port_map_get(m, "port03"), m["3"])
        self.assertIsNone(self.service._port_map_get(m, "port5"))
        self.assertIsNone(self.service._port_map_get(None, "3"))


if __name__ == "__main__":
    unittest.main()
