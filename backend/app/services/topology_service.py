from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.config import settings
from app.models.schemas import TopologyGraph, TopologyLink, TopologyNode, TopologySummary
from app.services.layout_service import LayoutService
from app.services.meraki_client import MerakiAPIError, MerakiClient
from app.services.validation_service import ValidationService
from app.storage.file_store import JsonFileStore


class TopologyService:
    def __init__(self, meraki: MerakiClient, validator: ValidationService, layouts: LayoutService, store: JsonFileStore) -> None:
        self.meraki = meraki
        self.validator = validator
        self.layouts = layouts
        self.store = store

    def _cache_name(self, org_id: str, network_id: str) -> str:
        return f"cache_topology_{org_id}_{network_id}.json"

    def _load_cache(self, org_id: str, network_id: str) -> TopologyGraph | None:
        cached = self.store.read_json(self._cache_name(org_id, network_id), None)
        if not cached:
            return None
        generated_at = datetime.fromisoformat(cached.get("generated_at").replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - generated_at).total_seconds()
        if age > settings.cache_ttl_seconds:
            return None
        return TopologyGraph.model_validate(cached)

    def _save_cache(self, graph: TopologyGraph) -> None:
        self.store.write_json(self._cache_name(graph.organization["id"], graph.network["id"]), graph.model_dump(mode="json"))

    @staticmethod
    def _as_dict(value: Any) -> dict[str, Any]:
        return value if isinstance(value, dict) else {}

    def _extract_port_id(self, end: dict[str, Any]) -> str:
        discovered = self._as_dict(end.get("discovered"))
        port = self._as_dict(end.get("port"))
        return str(discovered.get("port") or port.get("portId") or "")

    @staticmethod
    def _friendly_subtype(product_type: str) -> str:
        value = (product_type or "").lower()
        if value in {"appliance", "securityappliance"}:
            return "firewall"
        if value in {"wireless", "ap"}:
            return "access_point"
        if value == "switch":
            return "switch"
        if value == "camera":
            return "camera"
        return value or "unknown"

    def _infer_neighbor_subtype(self, node_data: dict[str, Any], end_data: dict[str, Any]) -> str:
        searchable = " ".join(
            str(v)
            for v in [
                node_data.get("description"),
                node_data.get("name"),
                node_data.get("model"),
                node_data.get("platform"),
                node_data.get("type"),
                node_data.get("manufacturer"),
                self._as_dict(end_data.get("discovered")).get("lldp"),
                self._as_dict(end_data.get("discovered")).get("cdp"),
            ]
            if v is not None
        ).lower()
        if any(k in searchable for k in ["mx", "firewall", "security appliance", "asa", "ftd"]):
            return "firewall"
        if any(k in searchable for k in ["mr", "access point", "wireless", "wlan", "ssid"]):
            return "access_point"
        if any(k in searchable for k in ["ms", "switch", "catalyst", "nexus"]):
            return "switch"
        if any(k in searchable for k in ["camera", "mv"]):
            return "camera"
        if any(k in searchable for k in ["server", "srv", "esxi", "vm", "nas", "synology", "windows", "linux"]):
            return "server"
        if ":" in str(node_data.get("description", "")) and len(str(node_data.get("description", ""))) >= 12:
            return "client"
        return "unmanaged"

    async def build(self, org_id: str, network_id: str) -> TopologyGraph:
        cached = self._load_cache(org_id, network_id)
        if cached:
            return cached
        networks = await self.meraki.get_organization_networks(org_id)
        devices = await self.meraki.get_network_devices(network_id)
        topology = await self.meraki.get_network_topology(network_id)
        client_timespan = max(settings.topology_refresh_seconds * 10, 300)
        clients = await self.meraki.get_network_clients(network_id, timespan=client_timespan)
        network = next((n for n in networks if n["id"] == network_id), {"id": network_id, "name": network_id})

        positions = self.layouts.get_positions(org_id, network_id)

        node_map: dict[str, TopologyNode] = {}
        ports_by_serial: dict[str, dict[str, Any]] = {}
        status_by_serial: dict[str, dict[str, Any]] = {}
        lldp_cdp_by_serial: dict[str, dict[str, Any]] = {}
        connected_by_port: dict[tuple[str, str], list[dict[str, str]]] = {}

        for d in devices:
            subtype = self._friendly_subtype(str(d.get("productType", "unknown")))
            node_map[d["serial"]] = TopologyNode(
                id=d["serial"],
                type="meraki",
                subtype=subtype,
                label=d.get("name") or d["serial"],
                managed=True,
                metadata=d,
                network={"id": network_id, "name": network.get("name", network_id)},
                position=positions.get(d["serial"], {"x": float(len(node_map) * 160), "y": float(len(node_map) * 80)}),
            )
            if subtype == "switch":
                raw_ports = await self.meraki.get_switch_ports(d["serial"])
                raw_statuses = await self.meraki.get_switch_port_statuses(d["serial"])
                ports_by_serial[d["serial"]] = {str(p["portId"]): p for p in raw_ports}
                status_by_serial[d["serial"]] = {str(s["portId"]): s for s in raw_statuses}
            try:
                lldp_cdp_by_serial[d["serial"]] = self._as_dict(await self.meraki.get_device_lldp_cdp(d["serial"]))
            except MerakiAPIError:
                lldp_cdp_by_serial[d["serial"]] = {}

        links: list[TopologyLink] = []
        all_issues = []

        for item in topology.get("links", []):
            ends = item.get("ends", [])
            if len(ends) != 2:
                continue
            a = ends[0]
            b = ends[1]

            a_node_data = self._as_dict(a.get("node"))
            b_node_data = self._as_dict(b.get("node"))
            a_node = a_node_data.get("derivedId") or self._as_dict(a_node_data.get("device")).get("serial")
            b_node = b_node_data.get("derivedId") or self._as_dict(b_node_data.get("device")).get("serial")
            if not a_node or not b_node:
                continue

            for node_id, end in ((a_node, a), (b_node, b)):
                end_node = self._as_dict(end.get("node"))
                if node_id not in node_map:
                    inferred_subtype = self._infer_neighbor_subtype(end_node, end)
                    node_map[node_id] = TopologyNode(
                        id=node_id,
                        type="neighbor",
                        subtype=inferred_subtype,
                        label=end_node.get("description") or node_id,
                        managed=False,
                        metadata=end_node,
                        network={"id": network_id, "name": network.get("name", network_id)},
                        position=positions.get(node_id, {"x": float(len(node_map) * 120), "y": float(len(node_map) * 60)}),
                    )

            a_serial = self._as_dict(a_node_data.get("device")).get("serial", a_node)
            b_serial = self._as_dict(b_node_data.get("device")).get("serial", b_node)
            a_port_id = self._extract_port_id(a)
            b_port_id = self._extract_port_id(b)

            a_cfg = ports_by_serial.get(a_serial, {}).get(a_port_id)
            b_cfg = ports_by_serial.get(b_serial, {}).get(b_port_id)
            a_status = status_by_serial.get(a_serial, {}).get(a_port_id)
            b_status = status_by_serial.get(b_serial, {}).get(b_port_id)

            if a_serial and a_port_id:
                connected_by_port.setdefault((a_serial, a_port_id), []).append(
                    {
                        "peer_id": b_node,
                        "peer_label": node_map[b_node].label if b_node in node_map else b_node,
                        "peer_port": b_port_id or "unknown",
                    }
                )
            if b_serial and b_port_id:
                connected_by_port.setdefault((b_serial, b_port_id), []).append(
                    {
                        "peer_id": a_node,
                        "peer_label": node_map[a_node].label if a_node in node_map else a_node,
                        "peer_port": a_port_id or "unknown",
                    }
                )

            mismatches, faults, actions = self.validator.compare_ports(
                item.get("id", f"{a_node}-{b_node}"),
                a_serial,
                a_port_id,
                a_cfg,
                b_serial,
                b_port_id,
                b_cfg,
                a_status,
                b_status,
            )
            health = "healthy"
            if any(i.severity == "critical" for i in mismatches + faults):
                health = "critical"
            elif mismatches or faults:
                health = "warning"
            all_issues.extend(mismatches + faults)
            links.append(
                TopologyLink(
                    id=item.get("id", f"{a_node}-{b_node}"),
                    source=a_node,
                    target=b_node,
                    source_port={"serial": a_serial, "portId": a_port_id, "config": a_cfg, "status": a_status},
                    target_port={"serial": b_serial, "portId": b_port_id, "config": b_cfg, "status": b_status},
                    link_type="wired",
                    discovery_method="lldp_cdp",
                    health=health,
                    mismatches=mismatches,
                    faults=faults,
                    remediable_actions=actions,
                    last_seen=datetime.now(timezone.utc),
                )
            )

        for client in clients[:250]:
            if client.get("recentDeviceSerial") and client.get("ssid"):
                client_id = f"client-{client['id']}"
                node_map[client_id] = TopologyNode(
                    id=client_id,
                    type="client",
                    subtype="wireless",
                    label=client.get("description") or client.get("ip") or client_id,
                    managed=False,
                    metadata=client,
                    network={"id": network_id, "name": network.get("name", network_id)},
                    position=positions.get(client_id, {"x": float(len(node_map) * 40), "y": float(len(node_map) * 20)}),
                )
                links.append(
                    TopologyLink(
                        id=f"wireless-{client_id}-{client['recentDeviceSerial']}",
                        source=client["recentDeviceSerial"],
                        target=client_id,
                        link_type="wireless",
                        discovery_method="wireless_association",
                    )
                )

        for serial, node in node_map.items():
            if not node.managed:
                continue

            interfaces: list[dict[str, Any]] = []
            for (device_serial, local_port), peers in connected_by_port.items():
                if device_serial != serial:
                    continue
                interfaces.append({"portId": local_port, "connectedPeers": peers})

            lldp_ports = self._as_dict(lldp_cdp_by_serial.get(serial, {}).get("ports"))
            for port_id, port_data in lldp_ports.items():
                details = self._as_dict(port_data)
                lldp = self._as_dict(details.get("lldp"))
                cdp = self._as_dict(details.get("cdp"))
                neighbor_name = str(
                    lldp.get("systemName")
                    or cdp.get("deviceId")
                    or cdp.get("platform")
                    or lldp.get("chassisId")
                    or "unknown"
                )
                peer_port = str(lldp.get("portId") or cdp.get("portId") or cdp.get("portIdFormatted") or "unknown")
                discovered_peer = {"peer_id": neighbor_name, "peer_label": neighbor_name, "peer_port": peer_port}

                existing = next((entry for entry in interfaces if str(entry.get("portId")) == str(port_id)), None)
                if existing:
                    existing.setdefault("connectedPeers", []).append(discovered_peer)
                else:
                    interfaces.append({"portId": str(port_id), "connectedPeers": [discovered_peer]})

            node.metadata["connected_interfaces"] = sorted(interfaces, key=lambda item: str(item.get("portId", "")))

        summary = TopologySummary(
            total_nodes=len(node_map),
            total_wired_links=len([l for l in links if l.link_type == "wired"]),
            total_wireless_links=len([l for l in links if l.link_type == "wireless"]),
            total_mismatches=len([i for i in all_issues if i.category == "config_mismatch"]),
            total_critical_issues=len([i for i in all_issues if i.severity == "critical"]),
            total_warning_issues=len([i for i in all_issues if i.severity == "warning"]),
            unmanaged_neighbors=len([n for n in node_map.values() if not n.managed]),
            remediable_issues=len([i for i in all_issues if i.remediable]),
            manual_investigation_issues=len([i for i in all_issues if not i.remediable]),
        )
        graph = TopologyGraph(
            organization={"id": org_id},
            network={"id": network_id, "name": network.get("name", network_id)},
            nodes=list(node_map.values()),
            links=links,
            issues=all_issues,
            summary=summary,
            generated_at=datetime.now(timezone.utc),
        )
        self._save_cache(graph)
        return graph
