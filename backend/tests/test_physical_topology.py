import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models.schemas import TopologyLink, TopologyNode
from app.services.physical_topology import (
    apply_entity_merges,
    apply_physical_port_attachments,
    prune_orphan_nodes,
    resolve_managed_device,
    index_managed_devices,
)
from app.services.switchport_client_builder import group_wired_clients_by_switch_port


def _node(**kwargs) -> TopologyNode:
    defaults = dict(
        type="meraki",
        subtype="switch",
        label="node",
        managed=True,
        metadata={},
        network={"id": "n1", "name": "lab"},
    )
    defaults.update(kwargs)
    return TopologyNode(**defaults)


def _link(**kwargs) -> TopologyLink:
    defaults = dict(
        link_type="wired",
        discovery_method="lldp_cdp",
        source_port={},
        target_port={},
    )
    defaults.update(kwargs)
    return TopologyLink(**defaults)


class PhysicalTopologyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mx = _node(
            id="MX1",
            subtype="firewall",
            label="MX-EDGE",
            metadata={"productType": "appliance", "serial": "MX1", "lanIp": "10.1.2.1", "mac": "aa:aa:aa:aa:aa:01"},
        )
        self.sw = _node(
            id="SW1",
            subtype="switch",
            label="MS-MAIN",
            metadata={"productType": "switch", "serial": "SW1", "lanIp": "10.1.2.2", "mac": "aa:aa:aa:aa:aa:02"},
        )
        self.ap = _node(
            id="AP1",
            subtype="access_point",
            label="MR36 AP",
            metadata={"productType": "wireless", "serial": "AP1", "lanIp": "10.1.2.10", "mac": "aa:aa:aa:aa:aa:03", "name": "MR36 AP"},
        )
        self.nodes = {n.id: n for n in (self.mx, self.sw, self.ap)}
        self.links = [
            _link(
                id="mx-sw",
                source="MX1",
                target="SW1",
                source_port={"serial": "MX1", "portId": "lan1"},
                target_port={"serial": "SW1", "portId": "1"},
            ),
            _link(
                id="sw-ap",
                source="SW1",
                target="AP1",
                source_port={"serial": "SW1", "portId": "2", "config": {"type": "trunk"}},
                target_port={"serial": "AP1", "portId": "wired"},
            ),
        ]
        self.network = {"id": "n1", "name": "lab"}

    def _apply(self, clients, extra_nodes=None, extra_links=None):
        nodes = dict(self.nodes)
        if extra_nodes:
            nodes.update(extra_nodes)
        links = list(self.links)
        if extra_links:
            links.extend(extra_links)
        grouped = group_wired_clients_by_switch_port(clients, {"SW1"})
        return apply_physical_port_attachments(
            nodes=nodes,
            links=links,
            wired_grouped=grouped,
            ports_by_serial={
                "SW1": {
                    "1": {"portId": "1", "type": "trunk"},
                    "2": {"portId": "2", "type": "trunk"},
                    "4": {"portId": "4", "type": "access"},
                    "5": {"portId": "5", "type": "access"},
                    "7": {"portId": "7", "type": "access"},
                    "14": {"portId": "14", "type": "trunk"},
                }
            },
            status_by_serial={"SW1": {}},
            network=self.network,
        )

    def test_managed_client_does_not_duplicate_ap(self):
        index = index_managed_devices(self.nodes)
        hit = resolve_managed_device(
            {"mac": "aa:aa:aa:aa:aa:03", "ip": "10.1.2.10", "description": "MR36 AP", "recentDeviceSerial": "SW1"},
            index,
        )
        self.assertEqual(hit.id, "AP1")

    def test_ap_uplink_does_not_group_wifi_or_create_port_lan_group(self):
        wifi = [
            {"id": "w1", "description": "Eva Tablet", "ssid": "Home", "recentDeviceSerial": "AP1", "mac": "11:11:11:11:11:01"},
            {"id": "w2", "description": "Suars-iPhone", "ssid": "Home", "recentDeviceSerial": "AP1", "mac": "11:11:11:11:11:02"},
        ]
        # AP also appears as a wired client on port 2; extra MACs learned on the uplink.
        wired = [
            {"id": "ap-self", "description": "MR36 AP", "mac": "aa:aa:aa:aa:aa:03", "ip": "10.1.2.10", "recentDeviceSerial": "SW1", "switchport": "2", "connection": "Wired"},
            {"id": "ghost", "description": "Android tablet", "mac": "11:11:11:11:11:03", "recentDeviceSerial": "SW1", "switchport": "2", "connection": "Wired"},
        ]
        extra = {
            "client-w1": _node(id="client-w1", type="client", subtype="wireless", label="Eva Tablet", managed=False, device_class="client"),
            "client-w2": _node(id="client-w2", type="client", subtype="wireless", label="Suars-iPhone", managed=False, device_class="client"),
        }
        extra_links = [
            _link(id="wifi-1", source="AP1", target="client-w1", link_type="wireless", discovery_method="wireless_association"),
            _link(id="wifi-2", source="AP1", target="client-w2", link_type="wireless", discovery_method="wireless_association"),
        ]
        nodes, links, hints, _debug = self._apply(wired + wifi, extra_nodes=extra, extra_links=extra_links)
        ids = set(nodes)
        self.assertNotIn("trunk-host-SW1-2", ids)
        self.assertNotIn("port-lan-group-SW1-2", ids)
        self.assertIn("AP1", ids)
        android = nodes["client-ghost"]
        self.assertEqual((android.metadata or {}).get("parent_id"), "AP1")
        switch_peers = {lk.target for lk in links if lk.source == "SW1"}
        self.assertIn("AP1", switch_peers)
        self.assertNotIn("client-ghost", switch_peers)
        self.assertNotIn("client-w1", switch_peers)

    def test_pi_is_leaf_on_its_switch_port(self):
        clients = [
            {"id": "pi", "description": "Pi4", "recentDeviceSerial": "SW1", "switchport": "5", "connection": "Wired", "mac": "22:22:22:22:22:05"},
        ]
        nodes, links, _hints, _debug = self._apply(clients)
        self.assertIn("client-pi", nodes)
        leaf_links = [lk for lk in links if {lk.source, lk.target} == {"SW1", "client-pi"}]
        self.assertEqual(len(leaf_links), 1)
        self.assertEqual((leaf_links[0].source_port or {}).get("portId"), "5")

    def test_unidentified_multi_mac_becomes_unknown_downstream_not_port_group(self):
        clients = [
            {"id": "a", "description": "host-a", "recentDeviceSerial": "SW1", "switchport": "7", "connection": "Wired"},
            {"id": "b", "description": "host-b", "recentDeviceSerial": "SW1", "switchport": "7", "connection": "Wired"},
        ]
        nodes, links, _hints, _debug = self._apply(clients)
        self.assertNotIn("port-lan-group-SW1-7", nodes)
        peer = nodes["physical-SW1-7"]
        self.assertIn("Unknown downstream device", peer.label)
        self.assertTrue(any(lk.source == "SW1" and lk.target == peer.id for lk in links))
        self.assertTrue(any(lk.source == peer.id and lk.target == "client-a" for lk in links))

    def test_merge_mgmt_and_fabric_into_one_server(self):
        clients = [
            {"id": "mgmt", "description": "Server mgmt", "recentDeviceSerial": "SW1", "switchport": "4", "connection": "Wired"},
            {"id": "vm1", "description": "homeassistant", "recentDeviceSerial": "SW1", "switchport": "14", "connection": "Wired"},
            {"id": "vm2", "description": "orthanc", "recentDeviceSerial": "SW1", "switchport": "14", "connection": "Wired"},
            {"id": "vm3", "description": "birthday-vm", "recentDeviceSerial": "SW1", "switchport": "14", "connection": "Wired"},
        ]
        nodes, links, _hints, _debug = self._apply(clients)
        self.assertIn("client-mgmt", nodes)
        self.assertIn("physical-SW1-14", nodes)
        nodes, links = apply_entity_merges(
            nodes,
            links,
            [
                {
                    "survivor_id": "physical-SW1-14",
                    "member_ids": ["client-mgmt", "physical-SW1-14"],
                    "label": "Server",
                    "device_class": "server",
                    "interfaces": [
                        {"switch_serial": "SW1", "port_id": "4", "role": "management", "member_id": "client-mgmt"},
                        {"switch_serial": "SW1", "port_id": "14", "role": "fabric", "member_id": "physical-SW1-14"},
                    ],
                }
            ],
        )
        self.assertIn("physical-SW1-14", nodes)
        self.assertNotIn("client-mgmt", nodes)
        server = nodes["physical-SW1-14"]
        self.assertEqual(server.label, "Server")
        self.assertEqual(server.device_class, "server")
        switch_links = [lk for lk in links if {lk.source, lk.target} == {"SW1", "physical-SW1-14"}]
        self.assertEqual(len(switch_links), 2)
        roles = {lk.interface_role for lk in switch_links}
        self.assertEqual(roles, {"management", "fabric"})
        children = {lk.target for lk in links if lk.source == "physical-SW1-14"}
        self.assertTrue({"client-vm1", "client-vm2", "client-vm3"} <= children)

    def test_prune_drops_disconnected_clients_but_keeps_linked_unknown(self):
        nodes = {
            "SW1": self.sw,
            "client-x": _node(id="client-x", type="client", subtype="wired", label="ghost", managed=False),
            "physical-SW1-7": _node(
                id="physical-SW1-7", type="neighbor", subtype="unknown_downstream", label="Unknown downstream device – Port 7", managed=False
            ),
        }
        links = [_link(id="p", source="SW1", target="physical-SW1-7", source_port={"serial": "SW1", "portId": "7"})]
        kept, kept_links = prune_orphan_nodes(nodes, links)
        self.assertNotIn("client-x", kept)
        self.assertIn("physical-SW1-7", kept)
        self.assertEqual(len(kept_links), 1)


if __name__ == "__main__":
    unittest.main()
