import unittest
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.models.schemas import TopologyGraph, TopologyLink, TopologySummary
from app.services.diagnostics import compute_diagnostics
from app.services.physical_topology import client_label
from app.services.topology_assembler import merge_duplicate_links
from test_assembler import MS, MR, MV, MX, _assemble


class IdentityCleanupTests(unittest.TestCase):
    def test_same_chassis_two_nics_become_one_proxmox(self):
        result = _assemble(
            clients=[
                {
                    "id": "pve-mgmt",
                    "description": "Proxmox",
                    "dhcpHostname": "pve.local",
                    "mac": "98:b7:85:22:f8:01",
                    "recentDeviceSerial": MS,
                    "switchport": "4",
                    "connection": "Wired",
                },
                {
                    "id": "pve-fab",
                    "dhcpHostname": "Proxmox",
                    "mac": "98:b7:85:22:f8:79",
                    "recentDeviceSerial": MS,
                    "switchport": "14",
                    "connection": "Wired",
                },
                {
                    "id": "ha",
                    "description": "homeassistant",
                    "mac": "33:33:33:33:33:01",
                    "recentDeviceSerial": MS,
                    "switchport": "14",
                    "connection": "Wired",
                },
                {
                    "id": "vm",
                    "description": "orthanc",
                    "mac": "33:33:33:33:33:02",
                    "recentDeviceSerial": MS,
                    "switchport": "14",
                    "connection": "Wired",
                },
                {
                    "id": "nas",
                    "description": "NAS",
                    "mac": "22:22:22:22:22:07",
                    "recentDeviceSerial": MS,
                    "switchport": "7",
                    "connection": "Wired",
                },
            ]
        )
        nodes = result["nodes"]
        links = result["links"]
        proxmox = [n for n in nodes.values() if "proxmox" in n.label.lower()]
        self.assertEqual(len(proxmox), 1, [n.label for n in nodes.values()])
        chassis = proxmox[0]
        switch_links = [lk for lk in links if {lk.source, lk.target} == {MS, chassis.id} and lk.discovery_method != "physical_downstream"]
        ports = {str((lk.source_port or {}).get("portId") or (lk.target_port or {}).get("portId")) for lk in switch_links}
        self.assertEqual(len(switch_links), 2)
        self.assertEqual(ports, {"4", "14"})
        roles = {lk.interface_role for lk in switch_links}
        self.assertTrue(roles & {"management", "fabric"} or len(switch_links) == 2)
        children = {lk.target for lk in links if lk.source == chassis.id}
        self.assertTrue({"client-ha", "client-vm"} <= children)
        nas = [lk for lk in links if {lk.source, lk.target} == {MS, "client-nas"}]
        self.assertEqual(len(nas), 1)

    def test_duplicate_evidence_collapses_to_one_edge(self):
        inferred = TopologyLink(
            id="a",
            source=MS,
            target=MR,
            source_port={"portId": "2"},
            target_port={"portId": "wired"},
            link_type="wired",
            discovery_method="topology_link_layer",
            discovery_sources=["topology_link_layer"],
        )
        lldp = TopologyLink(
            id="b",
            source=MS,
            target=MR,
            source_port={"portId": "2", "status": {"status": "Connected", "lldp": {"systemName": "MR36"}}},
            target_port={"portId": "wired"},
            link_type="wired",
            discovery_method="device_lldp_cdp",
            discovery_sources=["device_lldp_cdp"],
            identity_resolution={"method": "lldp_deviceMac", "lldpSystemName": "MR36"},
        )
        client = TopologyLink(
            id="c",
            source=MS,
            target=MR,
            source_port={"portId": "2"},
            target_port={"portId": "uplink"},
            link_type="wired",
            discovery_method="wired_client_switchport",
            discovery_sources=["wired_client_switchport"],
            identity_resolution={"method": "client_switchport", "mac": "00:18:0a:aa:aa:03"},
        )
        links = merge_duplicate_links([inferred, lldp, client])
        self.assertEqual(len(links), 1)
        self.assertEqual(set(links[0].discovery_sources), {"topology_link_layer", "device_lldp_cdp", "wired_client_switchport"})
        self.assertIn("lldpSystemName", links[0].identity_resolution)
        self.assertTrue(links[0].identity_resolution.get("records"))

    def test_real_two_nic_chassis_keeps_two_edges(self):
        mgmt = TopologyLink(
            id="mgmt",
            source=MS,
            target="PX",
            source_port={"portId": "4", "config": {"type": "access"}},
            target_port={"portId": "vmbr0"},
            link_type="wired",
            discovery_method="device_lldp_cdp",
            interface_role="management",
        )
        fabric = TopologyLink(
            id="fabric",
            source=MS,
            target="PX",
            source_port={"portId": "14", "config": {"type": "trunk"}},
            target_port={"portId": "sfp-sfpplus1"},
            link_type="wired",
            discovery_method="wired_client_switchport",
            interface_role="fabric",
        )
        extra = TopologyLink(
            id="dup-mgmt",
            source=MS,
            target="PX",
            source_port={"portId": "4"},
            target_port={"portId": "uplink"},
            link_type="wired",
            discovery_method="physical_attachment",
        )
        links = merge_duplicate_links([mgmt, fabric, extra])
        self.assertEqual(len(links), 2)
        ports = {physical_port(lk) for lk in links}
        self.assertEqual(ports, {"4", "14"})

    def test_mr_linklayer_lldp_client_is_one_edge(self):
        result = _assemble()
        ms_mr = [lk for lk in result["links"] if {lk.source, lk.target} == {MS, MR}]
        self.assertEqual(len(ms_mr), 1)
        sources = set(ms_mr[0].discovery_sources)
        self.assertTrue({"topology_link_layer", "device_lldp_cdp"} <= sources)
        self.assertIn("wired_client_switchport", sources)
        self.assertEqual(str((ms_mr[0].source_port or {}).get("portId")), "2")

    def test_mx_linklayer_lldp_is_one_edge(self):
        result = _assemble()
        mx_ms = [lk for lk in result["links"] if {lk.source, lk.target} == {MX, MS}]
        self.assertEqual(len(mx_ms), 1)
        sources = set(mx_ms[0].discovery_sources)
        self.assertTrue({"topology_link_layer", "device_lldp_cdp"} <= sources)
        ports = {
            str((mx_ms[0].source_port or {}).get("portId")),
            str((mx_ms[0].target_port or {}).get("portId")),
        }
        self.assertTrue("lan1" in ports or "1" in ports)

    def test_best_client_name_before_mac(self):
        self.assertEqual(
            client_label(
                {
                    "mac": "aa:bb:cc:dd:ee:01",
                    "ip": "10.1.2.40",
                    "deviceTypePrediction": "iPhone",
                    "mdnsName": "",
                }
            ),
            "iPhone",
        )
        self.assertEqual(
            client_label(
                {
                    "mac": "aa:bb:cc:dd:ee:02",
                    "ip": "10.1.2.41",
                    "dhcpHostname": "pve",
                    "deviceTypePrediction": "Server",
                }
            ),
            "pve",
        )
        self.assertEqual(
            client_label(
                {"mac": "aa:bb:cc:dd:ee:03", "description": "", "ip": "10.9.9.9"},
                extra={"lldp": {"systemName": "Proxmox"}},
            ),
            "Proxmox",
        )
        self.assertEqual(client_label({"mac": "aa:bb:cc:dd:ee:04"}), "aa:bb:cc:dd:ee:04")

    def test_lab_server_mgmt_and_fabric_automerge_keeps_distinct_ports(self):
        result = _assemble()
        links = result["links"]
        p4 = [lk for lk in links if lk.source == MS and str((lk.source_port or {}).get("portId")) == "4"]
        p14 = [lk for lk in links if lk.source == MS and str((lk.source_port or {}).get("portId")) == "14"]
        self.assertEqual(len(p4), 1)
        self.assertEqual(len(p14), 1)
        self.assertEqual(p4[0].target, p14[0].target)
        chassis = result["nodes"][p4[0].target]
        self.assertNotIn(chassis.id, {MX, MS, MR, MV, "client-nas", "client-pi"})
        children = {lk.target for lk in links if lk.source == chassis.id}
        self.assertIn("client-ha", children)
        self.assertIn("client-photo", children)

    def test_diagnostics_identity_fields(self):
        result = _assemble()
        graph = TopologyGraph(
            organization={"id": "O1"},
            network={"id": "N1", "name": "Lab"},
            nodes=list(result["nodes"].values()),
            links=result["links"],
            issues=[],
            summary=TopologySummary(
                total_nodes=len(result["nodes"]),
                total_wired_links=len(result["links"]),
                total_wireless_links=0,
                total_mismatches=0,
                total_critical_issues=0,
                total_warning_issues=0,
                unmanaged_neighbors=0,
                remediable_issues=0,
                manual_investigation_issues=0,
            ),
            generated_at=datetime.now(timezone.utc),
            topology_debug={"unresolved_nodes": result["unresolved"]},
        )
        diag = compute_diagnostics(graph)
        self.assertIn("duplicate_chassis_candidates", diag)
        self.assertIn("duplicate_physical_edges", diag)
        self.assertIn("unresolved_identity_count", diag)
        self.assertEqual(diag["duplicate_physical_edges"], 0)
        mx_ms = [lk for lk in result["links"] if {lk.source, lk.target} == {MX, MS}]
        ms_mr = [lk for lk in result["links"] if {lk.source, lk.target} == {MS, MR}]
        self.assertEqual(len(mx_ms), 1)
        self.assertEqual(len(ms_mr), 1)


def physical_port(link: TopologyLink) -> str:
    from app.services.identity import physical_port_id

    return physical_port_id((link.source_port or {}).get("portId")) or physical_port_id(
        (link.target_port or {}).get("portId")
    )


if __name__ == "__main__":
    unittest.main()
