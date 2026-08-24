import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models.schemas import TopologyGraph, TopologyLink, TopologyNode, TopologySummary
from app.services.diagnostics import compute_diagnostics
from app.services.history_service import HistoryService, diff_snapshots, extract_snapshot
from app.services.live_expectations import validate_expectations
from app.storage.file_store import JsonFileStore


def _graph(nodes, links, ports=None) -> TopologyGraph:
    return TopologyGraph(
        organization={"id": "O1"},
        network={"id": "N1", "name": "Lab"},
        nodes=nodes,
        links=links,
        issues=[],
        summary=TopologySummary(
            total_nodes=len(nodes),
            total_wired_links=len([l for l in links if l.link_type == "wired"]),
            total_wireless_links=0,
            total_mismatches=0,
            total_critical_issues=0,
            total_warning_issues=0,
            unmanaged_neighbors=0,
            remediable_issues=0,
            manual_investigation_issues=0,
        ),
        generated_at=datetime.now(timezone.utc),
        switch_ports=ports or {},
    )


def _node(node_id: str, label: str, **extra) -> TopologyNode:
    return TopologyNode(
        id=node_id,
        type="meraki",
        subtype=extra.get("subtype", "switch"),
        label=label,
        hostname=label,
        managed=extra.get("managed", True),
        metadata=extra.get("metadata", {}),
        serial=node_id,
        device_class=extra.get("device_class", "access"),
        software_version=extra.get("firmware", "MS 18.1"),
        management_ip=extra.get("ip", "10.1.2.2"),
        platform=extra.get("platform", "MS130"),
    )


class HistoryDiffTests(unittest.TestCase):
    def test_device_moved_port_and_ap_move(self):
        ms = _node("MS", "MS130")
        ap = _node("MR", "MR36", subtype="access_point", device_class="ap")
        before = _graph(
            [ms, ap],
            [
                TopologyLink(
                    id="ms-mr",
                    source="MS",
                    target="MR",
                    source_port={"portId": "2"},
                    target_port={"portId": "wired"},
                    source_interface="2",
                    link_type="wired",
                    discovery_method="topology_link_layer",
                    confidence="high",
                )
            ],
            {
                "MS": [
                    {
                        "portId": "2",
                        "config": {"type": "trunk", "nativeVlan": 1},
                        "status": {"status": "Connected", "clientCount": 12, "lldp": {"systemName": "MR36"}},
                    },
                    {"portId": "8", "config": {"type": "access"}, "status": {"status": "Disconnected", "clientCount": 0}},
                ]
            },
        )
        after = _graph(
            [ms, ap],
            [
                TopologyLink(
                    id="ms-mr",
                    source="MS",
                    target="MR",
                    source_port={"portId": "8"},
                    target_port={"portId": "wired"},
                    source_interface="8",
                    link_type="wired",
                    discovery_method="topology_link_layer",
                    confidence="high",
                )
            ],
            {
                "MS": [
                    {"portId": "2", "config": {"type": "trunk", "nativeVlan": 1}, "status": {"status": "Disconnected", "clientCount": 0}},
                    {
                        "portId": "8",
                        "config": {"type": "access", "vlan": 10},
                        "status": {"status": "Connected", "clientCount": 12, "lldp": {"systemName": "MR36"}},
                    },
                ]
            },
        )
        events = diff_snapshots(extract_snapshot(before), extract_snapshot(after))
        kinds = {e["kind"] for e in events}
        self.assertIn("ap_moved", kinds)
        moved = next(e for e in events if e["kind"] == "ap_moved")
        self.assertIn("p2", moved["summary"])
        self.assertIn("p8", moved["summary"])

    def test_port_mode_vlan_and_client_count(self):
        ms = _node("MS", "MS130")
        before = _graph(
            [ms],
            [],
            {
                "MS": [
                    {
                        "portId": "14",
                        "config": {"type": "trunk", "nativeVlan": 1},
                        "status": {"status": "Connected", "clientCount": 2},
                    }
                ]
            },
        )
        after = _graph(
            [ms],
            [],
            {
                "MS": [
                    {
                        "portId": "14",
                        "config": {"type": "access", "vlan": 10, "nativeVlan": 10},
                        "status": {"status": "Connected", "clientCount": 20},
                    }
                ]
            },
        )
        events = diff_snapshots(extract_snapshot(before), extract_snapshot(after))
        kinds = {e["kind"] for e in events}
        self.assertIn("port_mode", kinds)
        self.assertIn("native_vlan", kinds)
        self.assertIn("client_count", kinds)

    def test_appeared_disappeared_and_firmware(self):
        ms = _node("MS", "MS130", firmware="MS 18.1")
        cam = _node("MV", "Main - camera", subtype="camera", device_class="mv")
        before = _graph([ms], [])
        after_ms = _node("MS", "MS130", firmware="MS 18.2")
        after = _graph([after_ms, cam], [])
        events = diff_snapshots(extract_snapshot(before), extract_snapshot(after))
        kinds = {e["kind"] for e in events}
        self.assertIn("appeared", kinds)
        self.assertIn("firmware", kinds)
        gone = diff_snapshots(extract_snapshot(after), extract_snapshot(_graph([after_ms], [])))
        self.assertTrue(any(e["kind"] == "disappeared" and "camera" in e["summary"].lower() for e in gone))

    def test_persist_and_window(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        svc = HistoryService(JsonFileStore(tmp.name))
        ms = _node("MS", "MS130")
        pi = _node("PI", "Pi5", subtype="wired", device_class="client", managed=False)
        g1 = _graph([ms], [])
        g2 = _graph(
            [ms, pi],
            [
                TopologyLink(
                    id="ms-pi",
                    source="MS",
                    target="PI",
                    source_port={"portId": "5"},
                    source_interface="5",
                    link_type="wired",
                    discovery_method="physical_attachment",
                    confidence="medium",
                )
            ],
            {
                "MS": [
                    {
                        "portId": "5",
                        "config": {"type": "access", "vlan": 10},
                        "status": {"status": "Connected", "clientCount": 1},
                    }
                ]
            },
        )
        svc.record_graph(g1, force=True)
        svc.record_graph(g2, force=True)
        changes = svc.list_changes("O1", "N1", "24h")
        self.assertTrue(any("Pi5" in c["summary"] for c in changes))
        snaps = svc.list_snapshots("O1", "N1")
        self.assertEqual(len(snaps), 2)


class DiagnosticsAndExpectationsTests(unittest.TestCase):
    def test_diagnostics_counts_confidence(self):
        ms = _node("MS", "MS130")
        ap = _node("MR", "MR36", subtype="access_point", device_class="ap")
        graph = _graph(
            [ms, ap],
            [
                TopologyLink(
                    id="ms-mr",
                    source="MS",
                    target="MR",
                    source_port={"portId": "2"},
                    link_type="wired",
                    discovery_method="topology_link_layer",
                    confidence="high",
                    discovery_sources=["topology_link_layer", "device_lldp_cdp"],
                )
            ],
        )
        diag = compute_diagnostics(graph)
        self.assertEqual(diag["physical_edges"], 1)
        self.assertEqual(diag["high_confidence"], 1)
        self.assertEqual(diag["orphans"], 0)

    def test_lab_expectations_pass_on_named_graph(self):
        nodes = [
            _node("MX", "FW-01", subtype="firewall", device_class="mx"),
            _node("MS", "MS130"),
            _node("MR", "MR36", subtype="access_point", device_class="ap"),
            _node("MV", "Main - camera", subtype="camera", device_class="mv"),
            _node("NAS", "NAS", subtype="server", device_class="server", managed=False),
            _node("PI", "Pi4", subtype="wired", device_class="client", managed=False),
            _node("SRV", "SERVER", subtype="server", device_class="server", managed=False),
        ]
        def edge(src, tgt, port, lid):
            return TopologyLink(
                id=lid,
                source=src,
                target=tgt,
                source_port={"portId": port},
                source_interface=port,
                link_type="wired",
                discovery_method="topology_link_layer",
                confidence="high",
            )
        links = [
            edge("MX", "MS", "1", "fw-ms"),
            edge("MS", "MR", "2", "ms-mr"),
            edge("MS", "MV", "8", "ms-mv"),
            edge("MS", "NAS", "7", "ms-nas"),
            edge("MS", "PI", "5", "ms-pi"),
            edge("MS", "SRV", "4", "ms-mgmt"),
            edge("MS", "SRV", "14", "ms-fab"),
        ]
        result = validate_expectations(_graph(nodes, links))
        self.assertTrue(result["ok"])
        self.assertEqual(result["failed"], 0)
        self.assertEqual(result["applicable"], 7)

    def test_sample_dashboard_aliases(self):
        nodes = [
            _node("Q2XX-MX-0001", "MX-EDGE", subtype="firewall", device_class="mx"),
            _node("Q2XX-MS-0001", "MS-MAIN"),
            _node("Q2XX-AP-0001", "MR36 AP", subtype="access_point", device_class="ap"),
            _node("Q2XX-MV-0001", "Main - camera", subtype="camera", device_class="mv"),
            _node("client-nas", "NAS", subtype="server", device_class="server", managed=False),
            _node("client-pi4", "Pi4", subtype="wired", device_class="client", managed=False),
            _node("SERVER-01", "Server", subtype="server", device_class="server", managed=False),
        ]

        def edge(src, tgt, port, lid):
            return TopologyLink(
                id=lid,
                source=src,
                target=tgt,
                source_port={"portId": port},
                source_interface=port,
                link_type="wired",
                discovery_method="topology_link_layer",
                confidence="high",
            )

        links = [
            edge("Q2XX-MX-0001", "Q2XX-MS-0001", "1", "fw-ms"),
            edge("Q2XX-MS-0001", "Q2XX-AP-0001", "2", "ms-mr"),
            edge("Q2XX-MS-0001", "Q2XX-MV-0001", "8", "ms-mv"),
            edge("Q2XX-MS-0001", "client-nas", "7", "ms-nas"),
            edge("Q2XX-MS-0001", "client-pi4", "5", "ms-pi"),
            edge("Q2XX-MS-0001", "SERVER-01", "4", "ms-mgmt"),
            edge("Q2XX-MS-0001", "SERVER-01", "14", "ms-fab"),
        ]
        result = validate_expectations(_graph(nodes, links))
        self.assertTrue(result["ok"])
        self.assertEqual(result["applicable"], 7)


if __name__ == "__main__":
    unittest.main()
