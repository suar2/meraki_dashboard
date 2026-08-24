import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models.schemas import TopologyLink
from app.services.topology_assembler import assemble_topology, merge_duplicate_links


MX = "Q2KN-MX-0001"
MS = "Q2KN-MS-0001"
MR = "Q2KN-MR-0001"
MV = "Q2KN-MV-0001"

DEVICES = [
    {
        "serial": MX,
        "name": "FW-01",
        "model": "MX67",
        "productType": "appliance",
        "mac": "00:18:0a:aa:aa:01",
        "lanIp": "10.1.2.1",
        "status": "online",
    },
    {
        "serial": MS,
        "name": "MS130",
        "model": "MS130-12X",
        "productType": "switch",
        "mac": "00:18:0a:aa:aa:02",
        "lanIp": "10.1.2.2",
        "status": "online",
    },
    {
        "serial": MR,
        "name": "MR36",
        "model": "MR36",
        "productType": "wireless",
        "mac": "00:18:0a:aa:aa:03",
        "lanIp": "10.1.2.10",
        "status": "online",
    },
    {
        "serial": MV,
        "name": "Main - camera",
        "model": "MV12",
        "productType": "camera",
        "mac": "00:18:0a:aa:aa:04",
        "lanIp": "10.1.2.12",
        "status": "online",
    },
]

TOPOLOGY = {
    "nodes": [
        {
            "derivedId": "1111111111",
            "type": "device",
            "mac": "00:18:0a:aa:aa:01",
            "root": True,
            "device": {"serial": MX, "name": "FW-01", "model": "MX67", "productType": "appliance", "status": "online"},
        },
        {
            "derivedId": "2222222222",
            "type": "device",
            "mac": "00:18:0a:aa:aa:02",
            "root": False,
            "device": {"serial": MS, "name": "MS130", "model": "MS130-12X", "productType": "switch", "status": "online"},
        },
        {
            "derivedId": "3333333333",
            "type": "device",
            "mac": "00:18:0a:aa:aa:03",
            "device": {"serial": MR, "name": "MR36", "model": "MR36", "productType": "wireless", "status": "online"},
        },
        {
            "derivedId": "4444444444",
            "type": "device",
            "mac": "00:18:0a:aa:aa:04",
            "device": {"serial": MV, "name": "Main - camera", "model": "MV12", "productType": "camera", "status": "online"},
        },
        {"derivedId": "9999999999", "type": "discovered", "mac": ""},
    ],
    "links": [
        {
            "id": "fw-ms",
            "ends": [
                {"node": {"derivedId": "1111111111", "device": {"serial": MX}}, "discovered": {"port": "lan1"}},
                {"node": {"derivedId": "2222222222"}, "discovered": {"port": "1"}},
            ],
        },
        {
            "id": "ms-mr",
            "ends": [
                {"node": {"derivedId": "2222222222"}, "discovered": {"port": "2"}},
                {"node": {"derivedId": "3333333333"}, "discovered": {"lldp": {"portId": "wired"}}},
            ],
        },
        {
            "id": "ms-mv",
            "ends": [
                {"node": {"derivedId": "2222222222"}, "discovered": {"port": "8"}},
                {"derivedId": "4444444444", "node": {"derivedId": "4444444444"}},
            ],
        },
    ],
}

LLDP = {
    MS: {
        "ports": {
            "1": {
                "deviceMac": "00:18:0a:aa:aa:01",
                "lldp": {"systemName": "Meraki MX67 - FW-01", "portId": "lan1", "chassisId": "00:18:0a:aa:aa:01"},
            },
            "2": {
                "deviceMac": "00:18:0a:aa:aa:03",
                "lldp": {"systemName": "Meraki MR36 - MR36", "portId": "wired", "chassisId": "00:18:0a:aa:aa:03"},
            },
            "8": {
                "deviceMac": "00:18:0a:aa:aa:04",
                "lldp": {"systemName": "Main - camera", "portId": "eth0", "chassisId": "00:18:0a:aa:aa:04"},
            },
            "14": {
                "deviceMac": "98:b7:85:22:f8:79",
                "lldp": {"chassisId": "98:b7:85:22:f8:79"},
            },
        }
    }
}

PORTS = {
    MS: {
        "1": {"portId": "1", "type": "trunk"},
        "2": {"portId": "2", "type": "trunk"},
        "4": {"portId": "4", "type": "access"},
        "5": {"portId": "5", "type": "access"},
        "7": {"portId": "7", "type": "access"},
        "8": {"portId": "8", "type": "access"},
        "14": {"portId": "14", "type": "trunk"},
    }
}

STATUSES = {
    MS: {
        "1": {"portId": "1", "status": "Connected", "isUplink": True, "clientCount": 40, "lldp": {"systemName": "FW-01", "chassisId": "00:18:0a:aa:aa:01"}},
        "2": {
            "portId": "2",
            "status": "Connected",
            "isUplink": False,
            "clientCount": 12,
            "lldp": {"systemName": "Meraki MR36 - MR36", "chassisId": "00:18:0a:aa:aa:03"},
        },
        "8": {
            "portId": "8",
            "status": "Connected",
            "clientCount": 1,
            "lldp": {"systemName": "Main - camera", "chassisId": "00:18:0a:aa:aa:04"},
        },
        "4": {"portId": "4", "status": "Connected", "clientCount": 1},
        "5": {"portId": "5", "status": "Connected", "clientCount": 1},
        "7": {"portId": "7", "status": "Connected", "clientCount": 1},
        "14": {"portId": "14", "status": "Connected", "clientCount": 8},
    }
}

CLIENTS = [
    {
        "id": "cam-as-client",
        "mac": "00:18:0a:aa:aa:04",
        "description": "Main - camera",
        "recentDeviceSerial": MS,
        "switchport": "8",
        "connection": "Wired",
        "status": "Online",
    },
    {
        "id": "mr-as-client",
        "mac": "00:18:0a:aa:aa:03",
        "description": "MR36",
        "recentDeviceSerial": MS,
        "switchport": "2",
        "connection": "Wired",
        "status": "Online",
    },
    {
        "id": "iphone",
        "mac": "11:11:11:11:11:01",
        "description": "Suars-iPhone",
        "recentDeviceSerial": MR,
        "recentDeviceConnection": "Wireless",
        "ssid": "Home",
        "status": "Online",
    },
    {
        "id": "tablet",
        "mac": "11:11:11:11:11:02",
        "description": "Eva Tablet",
        "recentDeviceSerial": MR,
        "recentDeviceConnection": "Wireless",
        "status": "Online",
    },
    {
        "id": "wifi-on-uplink",
        "mac": "11:11:11:11:11:03",
        "description": "Android",
        "recentDeviceSerial": MS,
        "switchport": "2",
        "connection": "Wired",
        "ssid": "",
        "status": "Online",
    },
    {
        "id": "pi",
        "mac": "22:22:22:22:22:05",
        "description": "Pi4",
        "recentDeviceSerial": MS,
        "switchport": "5",
        "connection": "Wired",
    },
    {
        "id": "nas",
        "mac": "22:22:22:22:22:07",
        "description": "NAS",
        "recentDeviceSerial": MS,
        "switchport": "7",
        "connection": "Wired",
    },
    {
        "id": "mgmt",
        "mac": "98:b7:85:22:f8:01",
        "description": "Server mgmt",
        "recentDeviceSerial": MS,
        "switchport": "4",
        "connection": "Wired",
    },
    {
        "id": "nic",
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
        "id": "photo",
        "description": "photoai",
        "mac": "33:33:33:33:33:02",
        "recentDeviceSerial": MS,
        "switchport": "14",
        "connection": "Wired",
    },
    {
        "id": "ghost",
        "mac": "44:44:44:44:44:44",
        "description": "Unattached laptop",
        "status": "Offline",
    },
]


def _assemble(**overrides):
    payload = dict(
        network_id="N1",
        network={"id": "N1", "name": "Lab"},
        devices=DEVICES,
        topology=TOPOLOGY,
        clients=CLIENTS,
        ports_by_serial=PORTS,
        status_by_serial=STATUSES,
        lldp_cdp_by_serial=LLDP,
        positions={},
        entity_merges=[],
    )
    payload.update(overrides)
    return assemble_topology(**payload)


class AssemblerLabTests(unittest.TestCase):
    def test_lab_physical_hierarchy(self):
        result = _assemble()
        nodes = result["nodes"]
        links = result["links"]
        labels = {node.id: node.label for node in nodes.values()}
        self.assertEqual(labels[MX], "FW-01")
        self.assertEqual(labels[MS], "MS130")
        self.assertEqual(labels[MR], "MR36")
        self.assertEqual(labels[MV], "Main - camera")

        def peers(src):
            return {lk.target for lk in links if lk.source == src} | {lk.source for lk in links if lk.target == src}

        self.assertIn(MS, peers(MX))
        mx_ms = [lk for lk in links if {lk.source, lk.target} == {MX, MS}]
        self.assertEqual(len(mx_ms), 1)
        self.assertEqual(mx_ms[0].source, MX)
        self.assertEqual(mx_ms[0].target, MS)

        ms_mr = [lk for lk in links if {lk.source, lk.target} == {MS, MR}]
        self.assertEqual(len(ms_mr), 1)
        self.assertEqual(ms_mr[0].source, MS)
        self.assertEqual((ms_mr[0].source_port or {}).get("portId"), "2")

        ms_mv = [lk for lk in links if {lk.source, lk.target} == {MS, MV}]
        self.assertEqual(len(ms_mv), 1)
        self.assertEqual(ms_mv[0].source, MS)
        self.assertEqual((ms_mv[0].source_port or {}).get("portId"), "8")

        wifi_parents = {lk.source for lk in links if lk.target in {"client-iphone", "client-tablet"}}
        self.assertEqual(wifi_parents, {MR})
        switch_targets = {lk.target for lk in links if lk.source == MS}
        self.assertNotIn("client-iphone", switch_targets)
        self.assertNotIn("client-tablet", switch_targets)

    def test_no_duplicate_managed_client_nodes(self):
        result = _assemble()
        nodes = result["nodes"]
        camera_nodes = [n for n in nodes.values() if "camera" in n.label.lower() or n.id == MV]
        ap_nodes = [n for n in nodes.values() if n.label == "MR36" or n.id == MR]
        self.assertEqual(len(camera_nodes), 1)
        self.assertEqual(len(ap_nodes), 1)
        self.assertNotIn("client-cam-as-client", nodes)
        self.assertNotIn("client-mr-as-client", nodes)
        self.assertTrue(any(n.id == MV for n in camera_nodes))

    def test_no_numeric_derived_ids_on_canvas(self):
        result = _assemble()
        for node in result["nodes"].values():
            self.assertFalse(node.id.isdigit(), node.id)
            self.assertFalse(node.label.isdigit(), node.label)
        self.assertTrue(any(item.get("derivedId") == "9999999999" or "9999999999" in str(item) for item in result["unresolved"]))

    def test_wireless_clients_under_ap_not_switch(self):
        result = _assemble()
        links = result["links"]
        iphone = [lk for lk in links if "iphone" in lk.target]
        self.assertEqual(len(iphone), 1)
        self.assertEqual(iphone[0].source, MR)
        self.assertEqual(iphone[0].link_type, "wireless")

    def test_multiple_clients_behind_occupied_port(self):
        result = _assemble()
        nodes = result["nodes"]
        links = result["links"]
        switch_p14 = [
            lk
            for lk in links
            if lk.source == MS and str((lk.source_port or {}).get("portId")) == "14"
        ]
        self.assertEqual(len(switch_p14), 1)
        fabric = switch_p14[0].target
        self.assertNotEqual(fabric, "client-ha")
        children = {lk.target for lk in links if lk.source == fabric}
        self.assertIn("client-ha", children)
        self.assertIn("client-photo", children)
        self.assertNotIn("client-ha", {lk.target for lk in links if lk.source == MS})

    def test_direct_pi_and_nas_on_switchports(self):
        result = _assemble()
        links = result["links"]
        pi = [lk for lk in links if {lk.source, lk.target} == {MS, "client-pi"}]
        nas = [lk for lk in links if {lk.source, lk.target} == {MS, "client-nas"}]
        self.assertEqual(len(pi), 1)
        self.assertEqual((pi[0].source_port or {}).get("portId"), "5")
        self.assertEqual(len(nas), 1)
        self.assertEqual((nas[0].source_port or {}).get("portId"), "7")

    def test_camera_appears_from_client_without_linklayer(self):
        """Managed camera in devices+clients only must still draw MS --port--> MV."""
        result = _assemble(
            topology={"nodes": [], "links": []},
            lldp_cdp_by_serial={},
            status_by_serial={
                MS: {"8": {"portId": "8", "status": "Connected", "clientCount": 1}},
            },
            clients=[
                {
                    "id": "cam-as-client",
                    "mac": "00:18:0a:aa:aa:04",
                    "description": "Main - camera",
                    "recentDeviceSerial": MS,
                    "switchport": "8",
                    "connection": "Wired",
                    "status": "Online",
                }
            ],
        )
        nodes = result["nodes"]
        links = result["links"]
        self.assertIn(MV, nodes)
        self.assertEqual(nodes[MV].label, "Main - camera")
        self.assertTrue(nodes[MV].managed)
        self.assertFalse(any(nid.startswith("client-") and "cam" in nid for nid in nodes))
        ms_mv = [lk for lk in links if {lk.source, lk.target} == {MS, MV}]
        self.assertEqual(len(ms_mv), 1)
        self.assertEqual(ms_mv[0].source, MS)
        self.assertEqual(str((ms_mv[0].source_port or {}).get("portId")), "8")
        self.assertIn("wired_client_switchport", ms_mv[0].discovery_sources)
        self.assertEqual(ms_mv[0].confidence, "medium")

    def test_ms_mr_single_selectable_uplink(self):
        result = _assemble()
        ms_mr = [lk for lk in result["links"] if {lk.source, lk.target} == {MS, MR}]
        self.assertEqual(len(ms_mr), 1)
        link = ms_mr[0]
        self.assertEqual(link.link_type, "wired")
        self.assertEqual(link.source, MS)
        self.assertEqual(str((link.source_port or {}).get("portId")), "2")
        self.assertTrue(link.id)
        self.assertEqual(link.confidence, "high")
        keys = {item["key"] for item in link.evidence if item.get("ok")}
        self.assertIn("topology_link_layer", keys)
        self.assertIn("lldp", keys)

    def test_orphan_suppression(self):
        result = _assemble()
        self.assertNotIn("client-ghost", result["nodes"])
        for node in result["nodes"].values():
            if node.id not in {lk.source for lk in result["links"]} | {lk.target for lk in result["links"]}:
                self.assertTrue(
                    (node.metadata or {}).get("topologyRoot") or node.subtype == "firewall",
                    f"floating node {node.id}",
                )

    def test_edge_evidence_dedup_merges_sources(self):
        result = _assemble()
        ms_mr = [lk for lk in result["links"] if {lk.source, lk.target} == {MS, MR}]
        self.assertEqual(len(ms_mr), 1)
        sources = set(ms_mr[0].discovery_sources)
        self.assertTrue({"topology_link_layer", "device_lldp_cdp"} <= sources)
        status = (ms_mr[0].source_port or {}).get("status") or {}
        client_count = status.get("clientCount") or ms_mr[0].identity_resolution.get("clientCount")
        self.assertEqual(client_count, 12)

    def test_merge_keeps_both_nics_and_downstream(self):
        result = _assemble(
            entity_merges=[
                {
                    "survivor_id": "client-mgmt",
                    "member_ids": ["client-mgmt"],
                    "label": "SERVER",
                    "device_class": "server",
                    "interfaces": [
                        {"switch_serial": MS, "port_id": "4", "role": "management", "member_id": "client-mgmt"},
                        {"switch_serial": MS, "port_id": "14", "role": "fabric"},
                    ],
                }
            ]
        )
        nodes = result["nodes"]
        links = result["links"]
        self.assertIn("client-mgmt", nodes)
        self.assertEqual(nodes["client-mgmt"].label, "SERVER")
        switch_ports = {
            str((lk.source_port or {}).get("portId"))
            for lk in links
            if lk.source == MS and lk.target == "client-mgmt"
        }
        self.assertEqual(switch_ports, {"4", "14"})
        children = {lk.target for lk in links if lk.source == "client-mgmt"}
        self.assertTrue({"client-ha", "client-photo"} <= children)

    def test_merge_duplicate_links_unions_sources(self):
        inferred = TopologyLink(
            id="lldp-inferred",
            source="A",
            target="B",
            source_port={"portId": "1"},
            target_port={"portId": "2"},
            link_type="wired",
            discovery_method="lldp_cdp_inferred",
            discovery_sources=["lldp_cdp_inferred"],
        )
        direct = TopologyLink(
            id="lldp-direct",
            source="A",
            target="B",
            source_port={"portId": "1"},
            target_port={"portId": "2"},
            link_type="wired",
            discovery_method="lldp_cdp",
            discovery_sources=["lldp_cdp"],
            identity_resolution={"method": "serial_match"},
        )
        links = merge_duplicate_links([inferred, direct])
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].id, "lldp-direct")
        self.assertEqual(set(links[0].discovery_sources), {"lldp_cdp", "lldp_cdp_inferred"})


if __name__ == "__main__":
    unittest.main()
