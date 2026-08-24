"""Assemble a TopologyGraph from already-fetched Meraki payloads.

GET /networks/{id}/topology/linkLayer nodes are the primary physical inventory.
Clients enrich that graph; they never invent a second copy of a managed device.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Callable

from app.models.schemas import TopologyLink, TopologyNode
from app.services.identity import (
    ManagedInventory,
    extract_end_derived_id,
    extract_end_port,
    hierarchy_rank,
    human_label,
    is_derived_id,
    is_wireless_client,
    normalize_mac,
    resolve_link_end,
    source_rank,
    unmanaged_node_id,
)
from app.services.physical_topology import (
    apply_entity_merges,
    apply_physical_port_attachments,
    prune_orphan_nodes,
)
from app.services.switchport_client_builder import (
    build_client_id,
    group_wired_clients_by_switch_port,
)

ComparePorts = Callable[..., tuple[list[Any], list[Any], list[Any]]]
PortMapGet = Callable[[dict[str, Any] | None, str], Any]


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _friendly_subtype(product_type: str, model: str = "") -> str:
    value = (product_type or "").lower()
    model_u = (model or "").upper()
    if value in {"appliance", "securityappliance"} or model_u.startswith("MX") or model_u.startswith("Z"):
        return "firewall"
    if value in {"wireless", "ap"} or model_u.startswith("MR"):
        return "access_point"
    if value == "switch" or model_u.startswith("MS"):
        return "switch"
    if value == "camera" or model_u.startswith("MV"):
        return "camera"
    if value in {"cellulargateway", "cellular_gateway"} or model_u.startswith("MG"):
        return "cellular"
    if "sensor" in value or model_u.startswith("MT"):
        return "sensor"
    return value or "unknown"


def _canonical_port_id(port_id: str) -> str:
    text = str(port_id or "").strip()
    if not text:
        return text
    low = text.lower()
    if low.startswith("port") and low[4:].isdigit():
        return str(int(low[4:]))
    if text.isdigit():
        return str(int(text))
    return text


def _infer_neighbor_subtype(node_data: dict[str, Any], end_data: dict[str, Any]) -> str:
    searchable = " ".join(
        str(v)
        for v in [
            node_data.get("description"),
            node_data.get("name"),
            node_data.get("model"),
            node_data.get("platform"),
            node_data.get("type"),
            node_data.get("manufacturer"),
            _as_dict(end_data.get("discovered")).get("lldp"),
            _as_dict(end_data.get("discovered")).get("cdp"),
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
    return "unmanaged"


def _next_position(node_map: dict[str, TopologyNode], positions: dict[str, dict[str, float]], node_id: str) -> dict[str, float]:
    if node_id in positions:
        return positions[node_id]
    idx = len(node_map)
    return {"x": float((idx % 40) * 130), "y": float((idx // 40) * 60)}


def merge_duplicate_links(links: list[TopologyLink]) -> list[TopologyLink]:
    """One canonical physical edge; union discovery_sources and identity evidence."""

    def key(link: TopologyLink) -> tuple[str, str, str, str]:
        left, right = sorted((link.source, link.target))
        ports = [
            _canonical_port_id(str((link.source_port or {}).get("portId") or "")),
            _canonical_port_id(str((link.target_port or {}).get("portId") or "")),
        ]
        usable = [
            port
            for port in ports
            if port and port.lower() not in {"unknown", "uplink", "wired", "down", "none"}
        ]
        numeric = [port for port in usable if port.isdigit()]
        port_key = numeric[0] if numeric else (usable[0] if usable else "")
        return (left, right, port_key, link.link_type)

    grouped: dict[tuple[str, str, str, str], list[TopologyLink]] = defaultdict(list)
    for link in links:
        grouped[key(link)].append(link)
    merged: list[TopologyLink] = []
    for group in grouped.values():
        group.sort(key=lambda item: source_rank(item), reverse=True)
        winner = group[0]
        sources: list[str] = []
        resolution: dict[str, Any] = dict(winner.identity_resolution or {})
        source_port = dict(winner.source_port or {})
        target_port = dict(winner.target_port or {})
        for item in group:
            for src in list(item.discovery_sources or []) + [item.discovery_method]:
                if src and src not in sources:
                    sources.append(src)
            for k, value in (item.identity_resolution or {}).items():
                if k not in resolution or resolution[k] in (None, "", {}, []):
                    resolution[k] = value
            for blob, other in ((source_port, item.source_port or {}), (target_port, item.target_port or {})):
                for k, value in other.items():
                    if k not in blob or blob[k] in (None, "", {}, []):
                        blob[k] = value
        winner.discovery_sources = sources
        winner.identity_resolution = resolution
        winner.source_port = source_port
        winner.target_port = target_port
        merged.append(winner)
    return merged


class TopologyAssembler:
    def __init__(
        self,
        *,
        network_id: str,
        network: dict[str, Any],
        devices: list[dict[str, Any]],
        topology: dict[str, Any],
        clients: list[dict[str, Any]],
        ports_by_serial: dict[str, dict[str, Any]],
        status_by_serial: dict[str, dict[str, Any]],
        lldp_cdp_by_serial: dict[str, dict[str, Any]],
        positions: dict[str, dict[str, float]] | None = None,
        entity_merges: list[dict[str, Any]] | None = None,
        compare_ports: ComparePorts | None = None,
        port_map_get: PortMapGet | None = None,
    ) -> None:
        self.network_id = network_id
        self.network = network
        self.devices = list(devices)
        self.topology = topology or {}
        self.clients = list(clients)
        self.ports_by_serial = ports_by_serial
        self.status_by_serial = status_by_serial
        self.lldp_cdp_by_serial = lldp_cdp_by_serial
        self.positions = positions or {}
        self.entity_merges = entity_merges or []
        self.compare_ports = compare_ports
        self.port_map_get = port_map_get or (lambda mapping, key: (mapping or {}).get(str(key)))
        self.inventory = ManagedInventory(self.devices)
        self.node_map: dict[str, TopologyNode] = {}
        self.links: list[TopologyLink] = []
        self.issues: list[Any] = []
        self.unresolved: list[dict[str, Any]] = []
        self.connected_by_port: dict[tuple[str, str], list[dict[str, str]]] = {}
        self.port_peer_hints: list[dict[str, Any]] = []
        self.sw_port_debug: dict[str, Any] = {}
        self.ap_serials: set[str] = set()
        self.switch_serials: set[str] = set()

    def assemble(self) -> dict[str, Any]:
        self._create_managed_nodes()
        topology_by_derived = self.inventory.bind_link_layer_nodes(self.topology)
        self._stamp_link_layer_nodes(topology_by_derived)
        self._ingest_link_layer_links(topology_by_derived)
        self._ingest_lldp_cdp()
        self._validate_connected_ports()
        self._attach_wireless_clients()
        self._attach_wired_clients()
        self._apply_merges()
        self._orient_hierarchy()
        self.links = merge_duplicate_links(self.links)
        self._prune()
        self._stamp_connected_interfaces()
        return {
            "nodes": self.node_map,
            "links": self.links,
            "issues": self.issues,
            "unresolved": self.unresolved,
            "port_peer_hints": self.port_peer_hints,
            "sw_port_debug": self.sw_port_debug,
            "switch_serials": self.switch_serials,
            "clients_by_switch_port": {
                f"{serial}:{port}": [dict(c) for c in group]
                for (serial, port), group in group_wired_clients_by_switch_port(
                    self.clients, self.switch_serials
                ).items()
            },
        }

    def _create_managed_nodes(self) -> None:
        for device in self.devices:
            serial = str(device.get("serial") or "").strip()
            if not serial:
                continue
            subtype = _friendly_subtype(str(device.get("productType") or ""), str(device.get("model") or ""))
            if subtype == "access_point":
                self.ap_serials.add(serial)
            if subtype == "switch":
                self.switch_serials.add(serial)
            meta = dict(device)
            meta["managed"] = True
            self.node_map[serial] = TopologyNode(
                id=serial,
                type="meraki",
                subtype=subtype,
                label=str(device.get("name") or serial),
                managed=True,
                metadata=meta,
                network={"id": self.network_id, "name": self.network.get("name", self.network_id)},
                position=_next_position(self.node_map, self.positions, serial),
                serial=serial,
            )

    def _stamp_link_layer_nodes(self, topology_by_derived: dict[str, dict[str, Any]]) -> None:
        for derived, raw in topology_by_derived.items():
            device = raw.get("device") if isinstance(raw.get("device"), dict) else {}
            serial = str(device.get("serial") or "").strip()
            mac = normalize_mac(raw.get("mac") or device.get("mac"))
            hit = self.inventory.resolve(
                serial=serial,
                mac=mac,
                name=device.get("name"),
                derived_id=derived,
            )
            if hit and hit.node_id in self.node_map:
                node = self.node_map[hit.node_id]
                extra = dict(node.metadata or {})
                extra["derivedId"] = derived
                extra["topologyType"] = raw.get("type")
                extra["topologyRoot"] = bool(raw.get("root"))
                extra["root"] = bool(raw.get("root"))
                if mac:
                    extra["mac"] = extra.get("mac") or mac
                if device.get("status"):
                    extra["status"] = device.get("status")
                if device.get("lastReportedAt"):
                    extra["lastReportedAt"] = device.get("lastReportedAt")
                node.metadata = extra
                if device.get("name"):
                    node.label = str(device.get("name"))
                continue
            if serial and serial not in self.node_map:
                subtype = _friendly_subtype(str(device.get("productType") or ""), str(device.get("model") or ""))
                meta = dict(device)
                meta.update({"derivedId": derived, "managed": True, "topologyRoot": bool(raw.get("root")), "fromLinkLayer": True})
                self.node_map[serial] = TopologyNode(
                    id=serial,
                    type="meraki",
                    subtype=subtype,
                    label=str(device.get("name") or serial),
                    managed=True,
                    metadata=meta,
                    network={"id": self.network_id, "name": self.network.get("name", self.network_id)},
                    position=_next_position(self.node_map, self.positions, serial),
                    serial=serial,
                )
                continue
            label = human_label(raw, device.get("name"), mac) or "Discovered neighbor"
            node_id = unmanaged_node_id(mac=mac, label=label, derived_id=derived)
            if node_id in self.node_map:
                extra = dict(self.node_map[node_id].metadata or {})
                extra["derivedId"] = derived
                self.node_map[node_id].metadata = extra
                continue
            if is_derived_id(label):
                label = f"Discovered neighbor {str(derived)[-6:]}"
            self.node_map[node_id] = TopologyNode(
                id=node_id,
                type="neighbor",
                subtype=_infer_neighbor_subtype(raw, {"discovered": raw.get("discovered") or {}}),
                label=label,
                managed=False,
                metadata={
                    "derivedId": derived,
                    "unmanaged": True,
                    "mac": mac,
                    "topologyType": raw.get("type"),
                    "discovered": raw.get("discovered") or {},
                },
                network={"id": self.network_id, "name": self.network.get("name", self.network_id)},
                position=_next_position(self.node_map, self.positions, node_id),
                hostname=label,
            )

    def _ensure_unmanaged_from_end(self, end: dict[str, Any], topo: dict[str, Any]) -> str | None:
        discovered = _as_dict(end.get("discovered"))
        lldp = _as_dict(discovered.get("lldp"))
        cdp = _as_dict(discovered.get("cdp"))
        derived = extract_end_derived_id(end)
        mac = normalize_mac(
            topo.get("mac") or _as_dict(end.get("node")).get("mac") or lldp.get("chassisId") or discovered.get("deviceMac")
        )
        label = human_label(
            lldp.get("systemName"),
            cdp.get("deviceId"),
            cdp.get("platform"),
            topo,
            mac,
        )
        if not label and not mac:
            if derived:
                self.unresolved.append(
                    {
                        "reason": "numeric_or_empty_link_end",
                        "derivedId": derived,
                        "end": {"derivedId": derived, "discovered": discovered},
                    }
                )
            return None
        node_id = unmanaged_node_id(mac=mac, label=label, derived_id=derived)
        if node_id not in self.node_map:
            if not label or is_derived_id(label):
                label = mac or f"Discovered neighbor {str(derived)[-6:] if derived else ''}".strip()
            self.node_map[node_id] = TopologyNode(
                id=node_id,
                type="neighbor",
                subtype=_infer_neighbor_subtype(topo or _as_dict(end.get("node")), end),
                label=label,
                managed=False,
                metadata={"derivedId": derived, "unmanaged": True, "mac": mac, "discovered": discovered},
                network={"id": self.network_id, "name": self.network.get("name", self.network_id)},
                position=_next_position(self.node_map, self.positions, node_id),
                hostname=label,
            )
        return node_id

    def _ingest_link_layer_links(self, topology_by_derived: dict[str, dict[str, Any]]) -> None:
        for item in self.topology.get("links") or []:
            ends = item.get("ends") or []
            if len(ends) < 2:
                continue
            left_hit, left_topo, _left_disc = resolve_link_end(ends[0], self.inventory, topology_by_derived)
            right_hit, right_topo, _right_disc = resolve_link_end(ends[1], self.inventory, topology_by_derived)
            source_id = left_hit.node_id if left_hit else self._ensure_unmanaged_from_end(ends[0], left_topo)
            target_id = right_hit.node_id if right_hit else self._ensure_unmanaged_from_end(ends[1], right_topo)
            if not source_id or not target_id:
                self.unresolved.append(
                    {
                        "reason": "unresolved_link_end",
                        "source": "topology_link_layer",
                        "ends": ends,
                        "resolved": [getattr(left_hit, "node_id", None), getattr(right_hit, "node_id", None)],
                    }
                )
                continue
            a_port = extract_end_port(ends[0])
            b_port = extract_end_port(ends[1])
            self._add_wired_edge(
                source_id,
                target_id,
                source_port_id=a_port,
                target_port_id=b_port,
                discovery_method="topology_link_layer",
                identity_resolution={
                    "source": dict(left_hit.evidence) if left_hit else {"method": "discovered"},
                    "target": dict(right_hit.evidence) if right_hit else {"method": "discovered"},
                    "sourceDerivedId": extract_end_derived_id(ends[0]),
                    "targetDerivedId": extract_end_derived_id(ends[1]),
                },
                link_id=str(item.get("id") or f"topo-{source_id}-{target_id}"),
            )

    def _ingest_lldp_cdp(self) -> None:
        for serial, payload in self.lldp_cdp_by_serial.items():
            if serial not in self.node_map:
                continue
            for port_id, info in _as_dict(payload.get("ports")).items():
                details = _as_dict(info)
                lldp = _as_dict(details.get("lldp"))
                cdp = _as_dict(details.get("cdp"))
                hit = self.inventory.resolve_lldp(details)
                peer_id = hit.node_id if hit else None
                if not peer_id:
                    mac = normalize_mac(details.get("deviceMac") or lldp.get("chassisId"))
                    name = human_label(lldp.get("systemName"), cdp.get("deviceId"), cdp.get("platform"), mac)
                    if not mac and not name:
                        continue
                    if is_derived_id(name) and not mac:
                        self.unresolved.append(
                            {
                                "reason": "numeric_lldp_identity",
                                "switch": serial,
                                "port": str(port_id),
                                "lldp": lldp,
                                "cdp": cdp,
                            }
                        )
                        continue
                    peer_id = unmanaged_node_id(mac=mac, label=name)
                    if peer_id not in self.node_map:
                        self.node_map[peer_id] = TopologyNode(
                            id=peer_id,
                            type="neighbor",
                            subtype=_infer_neighbor_subtype(
                                {"description": name, "name": name, "model": cdp.get("platform")},
                                {"discovered": {"lldp": lldp, "cdp": cdp}},
                            ),
                            label=name or mac,
                            managed=False,
                            metadata={
                                "unmanaged": True,
                                "discoveredVia": "device_lldp_cdp",
                                "mac": mac,
                                "lldp": lldp,
                                "cdp": cdp,
                                "deviceMac": details.get("deviceMac"),
                            },
                            network={"id": self.network_id, "name": self.network.get("name", self.network_id)},
                            position=_next_position(self.node_map, self.positions, peer_id),
                            hostname=name or mac,
                        )
                peer_port = str(lldp.get("portId") or cdp.get("portId") or cdp.get("portIdFormatted") or "")
                self._add_wired_edge(
                    serial,
                    peer_id,
                    source_port_id=str(port_id),
                    target_port_id=peer_port,
                    discovery_method="device_lldp_cdp",
                    identity_resolution={
                        "method": hit.method if hit else "lldp_cdp",
                        **(hit.evidence if hit else {}),
                        "deviceMac": details.get("deviceMac"),
                        "lldpChassisId": lldp.get("chassisId"),
                        "lldpSystemName": lldp.get("systemName"),
                        "cdpDeviceId": cdp.get("deviceId"),
                        "resolvedNode": peer_id,
                    },
                    link_id=f"lldp-{serial}-{port_id}-{peer_id}",
                )

    def _validate_connected_ports(self) -> None:
        for serial, status_map in self.status_by_serial.items():
            if serial not in self.node_map:
                continue
            for port_id, status in (status_map or {}).items():
                details = _as_dict(status)
                if str(details.get("status") or "") != "Connected":
                    continue
                lldp = _as_dict(details.get("lldp"))
                cdp = _as_dict(details.get("cdp"))
                hit = self.inventory.resolve_lldp(
                    {
                        "deviceMac": details.get("deviceMac") or lldp.get("chassisId") or lldp.get("portId"),
                        "lldp": lldp,
                        "cdp": cdp,
                    }
                )
                if not hit or hit.node_id not in self.node_map:
                    continue
                self._add_wired_edge(
                    serial,
                    hit.node_id,
                    source_port_id=str(details.get("portId") or port_id),
                    target_port_id=str(lldp.get("portId") or cdp.get("portId") or ""),
                    discovery_method="switch_port_status",
                    identity_resolution={
                        "method": "switch_port_status_lldp",
                        **hit.evidence,
                        "portStatus": details.get("status"),
                        "isUplink": details.get("isUplink"),
                        "clientCount": details.get("clientCount"),
                        "resolvedNode": hit.node_id,
                    },
                    extra_status=details,
                    link_id=f"status-{serial}-{port_id}-{hit.node_id}",
                )

    def _attach_wireless_clients(self) -> None:
        for client in self.clients:
            if not is_wireless_client(client, self.ap_serials):
                continue
            managed = self.inventory.resolve_client(client)
            if managed and managed.node_id in self.node_map and self.node_map[managed.node_id].managed:
                self._merge_client_into_managed(managed.node_id, client)
                continue
            ap_serial = str(client.get("recentDeviceSerial") or "")
            if ap_serial not in self.ap_serials or ap_serial not in self.node_map:
                self.unresolved.append(
                    {
                        "reason": "wireless_client_missing_ap",
                        "client": {
                            "mac": normalize_mac(client.get("mac")),
                            "description": client.get("description"),
                            "ip": client.get("ip"),
                        },
                        "recentDeviceSerial": ap_serial,
                    }
                )
                continue
            node_id = build_client_id(client)
            if node_id not in self.node_map:
                label = str(client.get("description") or client.get("user") or client.get("mac") or "Wireless client")
                self.node_map[node_id] = TopologyNode(
                    id=node_id,
                    type="client",
                    subtype="wireless",
                    label=label,
                    managed=False,
                    metadata={**client, "parent_id": ap_serial, "recentDeviceConnection": client.get("recentDeviceConnection") or "Wireless"},
                    network={"id": self.network_id, "name": self.network.get("name", self.network_id)},
                    position=_next_position(self.node_map, self.positions, node_id),
                    hostname=label,
                    management_ip=str(client.get("ip") or ""),
                    device_class="client",
                )
            self._add_link(
                TopologyLink(
                    id=f"wireless-{node_id}-{ap_serial}",
                    source=ap_serial,
                    target=node_id,
                    link_type="wireless",
                    discovery_method="wireless_association",
                    discovery_sources=["wireless_association"],
                    identity_resolution={
                        "method": "recentDeviceSerial",
                        "recentDeviceSerial": ap_serial,
                        "recentDeviceConnection": client.get("recentDeviceConnection") or "Wireless",
                        "ssid": client.get("ssid"),
                    },
                    last_seen=datetime.now(timezone.utc),
                )
            )

    def _merge_client_into_managed(self, serial: str, client: dict[str, Any]) -> None:
        node = self.node_map.get(serial)
        if not node:
            return
        extra = dict(node.metadata or {})
        records = list(extra.get("clientRecords") or [])
        records.append(
            {
                "mac": normalize_mac(client.get("mac")),
                "ip": client.get("ip"),
                "description": client.get("description"),
                "switchport": client.get("switchport"),
                "recentDeviceSerial": client.get("recentDeviceSerial"),
                "recentDeviceConnection": client.get("recentDeviceConnection"),
            }
        )
        extra["clientRecords"] = records
        node.metadata = extra

    def _attach_wired_clients(self) -> None:
        wireless_macs = {
            normalize_mac(c.get("mac"))
            for c in self.clients
            if is_wireless_client(c, self.ap_serials) and c.get("mac")
        }
        grouped = group_wired_clients_by_switch_port(self.clients, self.switch_serials)
        filtered: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for key, group in grouped.items():
            kept: list[dict[str, Any]] = []
            for client in group:
                managed = self.inventory.resolve_client(client)
                if managed and managed.node_id in self.node_map and self.node_map[managed.node_id].managed:
                    self._merge_client_into_managed(managed.node_id, client)
                    continue
                mac = normalize_mac(client.get("mac"))
                if mac and mac in wireless_macs:
                    continue
                kept.append(client)
            if kept:
                filtered[key] = kept
        self.node_map, self.links, self.port_peer_hints, self.sw_port_debug = apply_physical_port_attachments(
            nodes=self.node_map,
            links=self.links,
            wired_grouped=filtered,
            ports_by_serial=self.ports_by_serial,
            status_by_serial=self.status_by_serial,
            network={"id": self.network_id, "name": self.network.get("name", self.network_id)},
            positions=self.positions,
            port_map_get=self.port_map_get,
        )
        for link in self.links:
            if link.discovery_method == "physical_attachment" and not link.discovery_sources:
                link.discovery_sources = ["wired_client_switchport", "physical_attachment"]
                if not link.identity_resolution:
                    link.identity_resolution = {
                        "method": "client_switchport",
                        "sourcePort": (link.source_port or {}).get("portId"),
                    }

    def _apply_merges(self) -> None:
        self.node_map, self.links = apply_entity_merges(self.node_map, self.links, self.entity_merges)

    def _node_rank(self, node_id: str) -> int:
        node = self.node_map.get(node_id)
        if not node:
            return 3
        meta = node.metadata or {}
        return hierarchy_rank(
            node.subtype,
            topology_root=bool(meta.get("topologyRoot") or meta.get("root")),
            device_class=node.device_class,
        )

    def _orient_hierarchy(self) -> None:
        oriented: list[TopologyLink] = []
        for link in self.links:
            if link.link_type == "wireless":
                oriented.append(link)
                continue
            src_rank = self._node_rank(link.source)
            tgt_rank = self._node_rank(link.target)
            if src_rank <= tgt_rank:
                oriented.append(link)
                continue
            oriented.append(
                link.model_copy(
                    update={
                        "source": link.target,
                        "target": link.source,
                        "source_port": dict(link.target_port or {}),
                        "target_port": dict(link.source_port or {}),
                        "source_hostname": link.target_hostname,
                        "target_hostname": link.source_hostname,
                        "source_interface": link.target_interface,
                        "target_interface": link.source_interface,
                    }
                )
            )
        self.links = oriented
        for link in self.links:
            child = self.node_map.get(link.target)
            if not child or child.managed and child.subtype in {"firewall"}:
                continue
            extra = dict(child.metadata or {})
            if not extra.get("parent_id"):
                extra["parent_id"] = link.source
                child.metadata = extra

    def _prune(self) -> None:
        self.node_map, self.links, orphans = prune_orphan_nodes(self.node_map, self.links)
        self.unresolved.extend(orphans)

    def _stamp_connected_interfaces(self) -> None:
        """Record port/LLDP evidence on nodes. Never create new graph edges here."""
        interfaces_by_serial: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for link in self.links:
            if link.link_type == "wireless":
                continue
            for local_id, peer_id, port in (
                (link.source, link.target, link.source_port or {}),
                (link.target, link.source, link.target_port or {}),
            ):
                node = self.node_map.get(local_id)
                if not node or not node.managed:
                    continue
                port_id = str(port.get("portId") or "")
                if not port_id or port_id.lower() in {"unknown", "uplink"}:
                    continue
                peer = self.node_map.get(peer_id)
                peer_blob = _as_dict(link.target_port if local_id == link.source else link.source_port)
                interfaces_by_serial[local_id].append(
                    {
                        "portId": _canonical_port_id(port_id),
                        "connectedPeers": [
                            {
                                "peer_id": peer_id,
                                "peer_label": peer.label if peer else peer_id,
                                "peer_port": str(peer_blob.get("portId") or ""),
                            }
                        ],
                        "config": port.get("config") or {},
                        "status": port.get("status") or {},
                        "clientCount": (_as_dict(port.get("status")).get("clientCount")),
                    }
                )
        for serial, node in self.node_map.items():
            if not node.managed:
                continue
            merged: dict[str, dict[str, Any]] = {}
            for entry in interfaces_by_serial.get(serial, []):
                key = _canonical_port_id(str(entry.get("portId") or ""))
                if key not in merged:
                    merged[key] = entry
                    continue
                existing_ids = {p.get("peer_id") for p in merged[key].get("connectedPeers") or []}
                for peer in entry.get("connectedPeers") or []:
                    if peer.get("peer_id") not in existing_ids:
                        merged[key].setdefault("connectedPeers", []).append(peer)
            for port_id, info in _as_dict(self.lldp_cdp_by_serial.get(serial, {}).get("ports")).items():
                details = _as_dict(info)
                lldp = _as_dict(details.get("lldp"))
                cdp = _as_dict(details.get("cdp"))
                key = _canonical_port_id(str(port_id))
                hit = self.inventory.resolve_lldp(details)
                peer_label = human_label(lldp.get("systemName"), cdp.get("deviceId"), details.get("deviceMac"))
                discovered = {
                    "peer_id": hit.node_id if hit else peer_label,
                    "peer_label": (self.node_map[hit.node_id].label if hit and hit.node_id in self.node_map else peer_label),
                    "peer_port": str(lldp.get("portId") or cdp.get("portId") or ""),
                    "deviceMac": details.get("deviceMac"),
                }
                if key in merged:
                    existing_ids = {str(p.get("peer_id")) for p in merged[key].get("connectedPeers") or []}
                    if str(discovered.get("peer_id") or "") not in existing_ids:
                        merged[key].setdefault("connectedPeers", []).append(discovered)
                else:
                    cfg = self.port_map_get(self.ports_by_serial.get(serial), str(port_id)) or {}
                    sta = self.port_map_get(self.status_by_serial.get(serial), str(port_id)) or {}
                    merged[key] = {
                        "portId": key,
                        "connectedPeers": [discovered],
                        "config": dict(cfg) if isinstance(cfg, dict) else {},
                        "status": dict(sta) if isinstance(sta, dict) else {},
                    }
            for hint in self.port_peer_hints:
                if hint.get("serial") != serial:
                    continue
                key = _canonical_port_id(str(hint.get("port") or ""))
                if not key:
                    continue
                peer = {
                    "peer_id": hint.get("peer_id"),
                    "peer_label": hint.get("peer_label", hint.get("peer_id")),
                    "peer_type": hint.get("kind", "synthetic"),
                }
                if key in merged:
                    existing_ids = {str(x.get("peer_id")) for x in (merged[key].get("connectedPeers") or [])}
                    if str(peer.get("peer_id") or "") not in existing_ids:
                        merged[key].setdefault("connectedPeers", []).append(peer)
                else:
                    cfg = self.port_map_get(self.ports_by_serial.get(serial), key) or {}
                    sta = self.port_map_get(self.status_by_serial.get(serial), key) or {}
                    merged[key] = {
                        "portId": key,
                        "config": dict(cfg) if isinstance(cfg, dict) else {},
                        "status": dict(sta) if isinstance(sta, dict) else {},
                        "connectedPeers": [peer],
                    }

            def _port_sort_key(entry: dict[str, Any]) -> tuple[int, str]:
                pid = str(entry.get("portId") or "0")
                return (int(pid) if pid.isdigit() else 9999, pid)

            extra = dict(node.metadata or {})
            extra["connected_interfaces"] = sorted(merged.values(), key=_port_sort_key)
            node.metadata = extra

    def _add_wired_edge(
        self,
        source: str,
        target: str,
        *,
        source_port_id: str = "",
        target_port_id: str = "",
        discovery_method: str,
        identity_resolution: dict[str, Any] | None = None,
        extra_status: dict[str, Any] | None = None,
        link_id: str = "",
    ) -> None:
        if not source or not target or source == target:
            return
        if source not in self.node_map or target not in self.node_map:
            self.unresolved.append(
                {
                    "reason": "edge_missing_node",
                    "source": source,
                    "target": target,
                    "discovery_method": discovery_method,
                }
            )
            return
        src_cfg = self.port_map_get(self.ports_by_serial.get(source), source_port_id) if source_port_id else None
        tgt_cfg = self.port_map_get(self.ports_by_serial.get(target), target_port_id) if target_port_id else None
        src_status = self.port_map_get(self.status_by_serial.get(source), source_port_id) if source_port_id else None
        tgt_status = self.port_map_get(self.status_by_serial.get(target), target_port_id) if target_port_id else None
        if extra_status and isinstance(src_status, dict):
            src_status = {**src_status, **extra_status}
        elif extra_status:
            src_status = extra_status
        mismatches: list[Any] = []
        faults: list[Any] = []
        actions: list[Any] = []
        if self.compare_ports:
            mismatches, faults, actions = self.compare_ports(
                link_id or f"{source}-{target}",
                source,
                source_port_id,
                src_cfg,
                target,
                target_port_id,
                tgt_cfg,
                src_status,
                tgt_status,
            )
            self.issues.extend(mismatches + faults)
        health = "healthy"
        if any(getattr(i, "severity", "") == "critical" for i in mismatches + faults):
            health = "critical"
        elif mismatches or faults:
            health = "warning"
        source_port = {
            "serial": source,
            "portId": _canonical_port_id(source_port_id) if source_port_id else source_port_id,
            "config": src_cfg or {},
            "status": src_status or {},
        }
        target_port = {
            "serial": target,
            "portId": _canonical_port_id(target_port_id) if target_port_id else target_port_id,
            "config": tgt_cfg or {},
            "status": tgt_status or {},
        }
        if source_port_id:
            self.connected_by_port.setdefault((source, _canonical_port_id(source_port_id)), []).append(
                {
                    "peer_id": target,
                    "peer_label": self.node_map[target].label,
                    "peer_port": target_port_id or "unknown",
                }
            )
        self._add_link(
            TopologyLink(
                id=link_id or f"{source}->{target}:{source_port_id}->{target_port_id}",
                source=source,
                target=target,
                source_port=source_port,
                target_port=target_port,
                link_type="wired",
                discovery_method=discovery_method,
                discovery_sources=[discovery_method],
                identity_resolution=identity_resolution or {},
                health=health,
                mismatches=mismatches,
                faults=faults,
                remediable_actions=actions,
                last_seen=datetime.now(timezone.utc),
            )
        )

    def _add_link(self, link: TopologyLink) -> None:
        self.links.append(link)


def assemble_topology(**kwargs: Any) -> dict[str, Any]:
    return TopologyAssembler(**kwargs).assemble()
