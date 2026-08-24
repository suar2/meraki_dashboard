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

    def test_enrich_graph_adds_packet_express_fields_and_keeps_ops(self):
        nodes = [
            TopologyNode(
                id="S1",
                type="meraki",
                subtype="switch",
                label="MS-CORE",
                managed=True,
                metadata={"name": "MS-CORE", "serial": "S1", "model": "MS425-32", "lanIp": "10.0.0.1", "firmware": "CS 15.21", "productType": "switch"},
                network={"id": "n1", "name": "HQ"},
            ),
            TopologyNode(
                id="S2",
                type="meraki",
                subtype="switch",
                label="MS-ACC",
                managed=True,
                metadata={"name": "MS-ACC", "serial": "S2", "model": "MS130-12X", "lanIp": "10.0.0.2", "firmware": "CS 15.21", "productType": "switch"},
                network={"id": "n1", "name": "HQ"},
            ),
        ]
        from app.models.schemas import Issue

        links = [
            TopologyLink(
                id="l1",
                source="S1",
                target="S2",
                source_port={"serial": "S1", "portId": "1", "config": {"type": "trunk", "vlan": 1}},
                target_port={"serial": "S2", "portId": "24", "config": {"type": "access", "vlan": 10}},
                link_type="wired",
                discovery_method="lldp_cdp",
                health="critical",
                mismatches=[
                    Issue(
                        id="l1-mode",
                        category="config_mismatch",
                        severity="critical",
                        scope="link",
                        description="Port mode mismatch",
                        remediable=True,
                        suggested_actions=["align mode"],
                    )
                ],
            )
        ]
        self.service._enrich_graph(nodes, links, {"id": "n1", "name": "HQ"}, stacks=[{"name": "stack-a", "serials": ["S1", "S2"]}])
        core = next(n for n in nodes if n.id == "S1")
        acc = next(n for n in nodes if n.id == "S2")
        self.assertEqual(core.device_class, "core")
        self.assertEqual(acc.device_class, "access")
        self.assertEqual(core.hostname, "MS-CORE")
        self.assertEqual(core.management_ip, "10.0.0.1")
        self.assertEqual(core.platform, "MS425-32")
        self.assertEqual(core.location, "HQ")
        self.assertEqual(core.software_version, "CS 15.21")
        self.assertEqual(core.serial, "S1")
        self.assertEqual(core.degree, 1)
        self.assertIn("1", core.interfaces)
        self.assertEqual(len(core.stack_members), 2)
        self.assertEqual(core.health.state, "critical")
        self.assertGreaterEqual(core.issue_count, 1)
        self.assertEqual(links[0].source_hostname, "MS-CORE")
        self.assertEqual(links[0].target_hostname, "MS-ACC")
        self.assertEqual(links[0].source_interface, "1")
        self.assertEqual(links[0].target_interface, "24")
        self.assertEqual(links[0].source_device_class, "core")
        self.assertEqual(links[0].health, "critical")
        self.assertEqual(len(links[0].mismatches), 1)


if __name__ == "__main__":
    unittest.main()


if __name__ == "__main__":
    unittest.main()
