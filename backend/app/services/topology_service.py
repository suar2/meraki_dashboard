from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any

from app.config import settings
from app.models.schemas import TopologyGraph, TopologyLink, TopologyNode, TopologySummary
from app.services.layout_service import LayoutService
from app.services.meraki_client import MerakiAPIError, MerakiClient
from app.services.validation_service import ValidationService
from app.storage.file_store import JsonFileStore
from app.services.switchport_client_builder import (
    build_switch_port_catalog,
    group_wired_clients_by_switch_port,
    synthesize_wired_port_topology,
)

logger = logging.getLogger(__name__)


class TopologyService:
    def __init__(self, meraki: MerakiClient, validator: ValidationService, layouts: LayoutService, store: JsonFileStore) -> None:
        self.meraki = meraki
        self.validator = validator
        self.layouts = layouts
        self.store = store

    def _cache_name(self, org_id: str, network_id: str) -> str:
        return f"cache_topology_v4_{org_id}_{network_id}.json"

    def _load_cache(self, org_id: str, network_id: str) -> TopologyGraph | None:
        cached = self.store.read_json(self._cache_name(org_id, network_id), None)
        if not cached:
            return None
        generated_raw = cached.get("generated_at")
        if not generated_raw:
            return None
        generated_at = datetime.fromisoformat(str(generated_raw).replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - generated_at).total_seconds()
        if age > settings.cache_ttl_seconds:
            return None
        return TopologyGraph.model_validate(cached)

    def _save_cache(self, graph: TopologyGraph) -> None:
        self.store.write_json(self._cache_name(graph.organization["id"], graph.network["id"]), graph.model_dump(mode="json"))

    @staticmethod
    def _as_dict(value: Any) -> dict[str, Any]:
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _is_derived_id(value: str) -> bool:
        """Return True if the string looks like a Meraki-generated numeric derivedId."""
        return bool(value) and value.isdigit() and len(value) >= 10

    def _resolve_neighbor_label(self, end_node: dict[str, Any], end: dict[str, Any]) -> str:
        """Resolve a human-readable label for an unmanaged topology neighbor.

        Priority: LLDP systemName → CDP deviceId → CDP platform →
                  LLDP chassisId → node description → empty string.
        """
        end_disc = self._as_dict(end.get("discovered"))
        end_lldp = self._as_dict(end_disc.get("lldp"))
        end_cdp  = self._as_dict(end_disc.get("cdp"))

        node_disc = self._as_dict(end_node.get("discovered"))
        node_lldp = self._as_dict(node_disc.get("lldp"))
        node_cdp  = self._as_dict(node_disc.get("cdp"))

        candidates = [
            str(end_lldp.get("systemName") or "").strip(),
            str(node_lldp.get("systemName") or "").strip(),
            str(end_cdp.get("deviceId") or "").strip(),
            str(node_cdp.get("deviceId") or "").strip(),
            str(end_cdp.get("platform") or "").strip(),
            str(end_lldp.get("chassisId") or "").strip(),
            str(end_node.get("description") or "").strip(),
        ]
        for candidate in candidates:
            if candidate and not self._is_derived_id(candidate):
                return candidate
        return ""

    def _extract_port_id(self, end: dict[str, Any]) -> str:
        discovered = self._as_dict(end.get("discovered"))
        port = self._as_dict(end.get("port"))
        return str(discovered.get("port") or port.get("portId") or "")

    @staticmethod
    def _canonical_port_id(port_id: str) -> str:
        """Normalize Meraki-style keys so 'port3', '3', and '03' share one bucket."""
        s = str(port_id).strip()
        if not s:
            return s
        low = s.lower()
        if low.startswith("port") and low[4:].isdigit():
            return str(int(low[4:]))
        if s.isdigit():
            return str(int(s))
        return s

    @staticmethod
    def _port_id_variants(port_id: str) -> list[str]:
        """LLDP may report 'port3' while switch port APIs use '3'. Try both when looking up config/status."""
        s = str(port_id).strip()
        if not s:
            return [s]
        out: list[str] = []
        seen: set[str] = set()

        def add(x: str) -> None:
            if not x or x in seen:
                return
            seen.add(x)
            out.append(x)

        add(s)
        low = s.lower()
        if low.startswith("port") and low[4:].isdigit():
            n = str(int(low[4:]))
            add(n)
            add(f"port{n}")
        elif s.isdigit():
            n = str(int(s))
            add(n)
            add(f"port{n}")
        return out

    @staticmethod
    def _port_map_get(port_map: dict[str, Any] | None, port_id: str) -> Any:
        if not port_map:
            return None
        for k in TopologyService._port_id_variants(port_id):
            v = port_map.get(k)
            if v is not None:
                return v
        return None

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

    @staticmethod
    def _slug(value: str) -> str:
        cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")
        return cleaned or "unknown"

    @staticmethod
    def _normalize_alias(value: str) -> str:
        text = (value or "").strip().lower()
        if not text:
            return ""
        for token in ["meraki", "inc.", "llc"]:
            text = text.replace(token, " ")
        normalized = "".join(ch if ch.isalnum() else " " for ch in text)
        return " ".join(normalized.split())

    @staticmethod
    def _pair_key(a: str, b: str) -> tuple[str, str]:
        return (a, b) if a <= b else (b, a)

    def _resolve_peer_node_id(self, neighbor_name: str, node_map: dict[str, TopologyNode]) -> str | None:
        neighbor = (neighbor_name or "").strip()
        if not neighbor:
            return None
        if neighbor in node_map:
            return neighbor
        neighbor_lower = neighbor.lower()
        neighbor_norm = self._normalize_alias(neighbor)
        # LLDP/CDP names are often "Meraki MODEL - DeviceName"; keep the right-most part as alias candidate.
        alias_tail = neighbor.split(" - ")[-1].strip().lower() if " - " in neighbor else ""
        alias_tail_norm = self._normalize_alias(alias_tail)
        for node_id, node in node_map.items():
            node_id_lower = node_id.lower()
            node_label_lower = str(node.label).lower()
            node_name_lower = str(node.metadata.get("name", "")).lower()
            node_serial_lower = str(node.metadata.get("serial", "")).lower()

            if node_id_lower == neighbor_lower:
                return node_id
            if node_label_lower == neighbor_lower:
                return node_id
            if node_name_lower == neighbor_lower:
                return node_id
            if node_serial_lower and node_serial_lower == neighbor_lower:
                return node_id

            # Alias matching for formatted neighbor strings.
            node_norms = {
                self._normalize_alias(node_id),
                self._normalize_alias(str(node.label)),
                self._normalize_alias(str(node.metadata.get("name", ""))),
                self._normalize_alias(str(node.metadata.get("model", ""))),
            }
            if neighbor_norm and neighbor_norm in node_norms:
                return node_id
            if alias_tail_norm and alias_tail_norm in node_norms:
                return node_id
            if neighbor_norm:
                for nrm in node_norms:
                    if not nrm:
                        continue
                    if neighbor_norm.endswith(nrm) or neighbor_norm.startswith(nrm):
                        return node_id
                    if nrm.endswith(neighbor_norm) or nrm.startswith(neighbor_norm):
                        return node_id
                    if len(nrm) >= 4 and nrm in neighbor_norm:
                        return node_id
            if alias_tail and alias_tail == node_label_lower:
                return node_id
        return None

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

    @staticmethod
    def _dedupe_links(links: list[TopologyLink]) -> list[TopologyLink]:
        """
        Dedupe links by normalized endpoint+port tuple.
        Keeps the first highest-priority link by discovery confidence.
        """
        def score(link: TopologyLink) -> int:
            method = (link.discovery_method or "").lower()
            if method == "lldp_cdp":
                return 3
            if method == "lldp_cdp_inferred":
                return 2
            if method == "wireless_association":
                return 1
            return 0

        def key(link: TopologyLink) -> tuple[str, str, str, str, str]:
            src = link.source
            tgt = link.target
            src_port = str(link.source_port.get("portId", "")) if link.source_port else ""
            tgt_port = str(link.target_port.get("portId", "")) if link.target_port else ""
            if src <= tgt:
                return (src, tgt, src_port, tgt_port, link.link_type)
            return (tgt, src, tgt_port, src_port, link.link_type)

        best_by_key: dict[tuple[str, str, str, str, str], TopologyLink] = {}
        for link in links:
            k = key(link)
            prev = best_by_key.get(k)
            if prev is None or score(link) > score(prev):
                best_by_key[k] = link
        return list(best_by_key.values())

    async def build(self, org_id: str, network_id: str) -> TopologyGraph:
        cached = self._load_cache(org_id, network_id)
        if cached:
            return cached
        networks = await self.meraki.get_organization_networks(org_id)
        devices = await self.meraki.get_network_devices(network_id)
        try:
            topology = await self.meraki.get_network_topology(network_id)
        except MerakiAPIError as exc:
            logger.warning("Topology endpoint failed for network %s: %s", network_id, exc)
            topology = {"links": []}
        client_timespan = max(settings.topology_refresh_seconds * 10, 300)
        try:
            clients = await self.meraki.get_network_clients(network_id, timespan=client_timespan)
        except MerakiAPIError as exc:
            logger.warning("Clients endpoint failed for network %s: %s", network_id, exc)
            clients = []
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
                try:
                    raw_ports = await self.meraki.get_switch_ports(d["serial"])
                except MerakiAPIError as exc:
                    logger.warning("Switch ports endpoint failed for %s: %s", d["serial"], exc)
                    raw_ports = []
                try:
                    raw_statuses = await self.meraki.get_switch_port_statuses(d["serial"])
                except MerakiAPIError as exc:
                    logger.warning("Switch port status endpoint failed for %s: %s", d["serial"], exc)
                    raw_statuses = []
                ports_by_serial[d["serial"]] = {str(p["portId"]): p for p in raw_ports}
                status_by_serial[d["serial"]] = {str(s["portId"]): s for s in raw_statuses}
            try:
                lldp_cdp_by_serial[d["serial"]] = self._as_dict(await self.meraki.get_device_lldp_cdp(d["serial"]))
            except MerakiAPIError:
                lldp_cdp_by_serial[d["serial"]] = {}

        links: list[TopologyLink] = []
        all_issues = []
        linked_pairs: set[tuple[str, str]] = set()
        linked_ports: set[tuple[str, str, str]] = set()

        for item in topology.get("links", []):
            ends = item.get("ends", [])
            if len(ends) != 2:
                continue
            a = ends[0]
            b = ends[1]

            a_node_data = self._as_dict(a.get("node"))
            b_node_data = self._as_dict(b.get("node"))
            # Prefer the device serial (merges with existing managed node) over derivedId.
            a_node = self._as_dict(a_node_data.get("device")).get("serial") or a_node_data.get("derivedId")
            b_node = self._as_dict(b_node_data.get("device")).get("serial") or b_node_data.get("derivedId")
            if not a_node or not b_node:
                continue

            for node_id, end in ((a_node, a), (b_node, b)):
                end_node = self._as_dict(end.get("node"))
                if node_id not in node_map:
                    inferred_subtype = self._infer_neighbor_subtype(end_node, end)
                    resolved_label = self._resolve_neighbor_label(end_node, end) or node_id
                    node_map[node_id] = TopologyNode(
                        id=node_id,
                        type="neighbor",
                        subtype=inferred_subtype,
                        label=resolved_label,
                        managed=False,
                        metadata=end_node,
                        network={"id": network_id, "name": network.get("name", network_id)},
                        position=positions.get(node_id, {"x": float(len(node_map) * 120), "y": float(len(node_map) * 60)}),
                    )

            a_serial = self._as_dict(a_node_data.get("device")).get("serial", a_node)
            b_serial = self._as_dict(b_node_data.get("device")).get("serial", b_node)
            a_port_id = self._extract_port_id(a)
            b_port_id = self._extract_port_id(b)
            a_port_key = self._canonical_port_id(a_port_id) if a_port_id else ""
            b_port_key = self._canonical_port_id(b_port_id) if b_port_id else ""

            a_cfg = self._port_map_get(ports_by_serial.get(a_serial), a_port_id)
            b_cfg = self._port_map_get(ports_by_serial.get(b_serial), b_port_id)
            a_status = self._port_map_get(status_by_serial.get(a_serial), a_port_id)
            b_status = self._port_map_get(status_by_serial.get(b_serial), b_port_id)

            if a_serial and a_port_key:
                connected_by_port.setdefault((a_serial, a_port_key), []).append(
                    {
                        "peer_id": b_node,
                        "peer_label": node_map[b_node].label if b_node in node_map else b_node,
                        "peer_port": b_port_id or "unknown",
                    }
                )
            if b_serial and b_port_key:
                connected_by_port.setdefault((b_serial, b_port_key), []).append(
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
            linked_pairs.add(self._pair_key(a_node, b_node))
            if a_port_id:
                linked_ports.add((a_node, a_port_key, b_node))
            if b_port_id:
                linked_ports.add((b_node, b_port_key, a_node))

        for client in clients[:2000]:
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

        switch_serials = {
            d["serial"] for d in devices if self._friendly_subtype(str(d.get("productType", "unknown"))) == "switch"
        }
        grouped_wired = group_wired_clients_by_switch_port(clients, switch_serials)
        synth_nodes, synth_links, clients_by_sp, port_peer_hints, sw_port_debug = synthesize_wired_port_topology(
            network={"id": network_id, "name": network.get("name", network_id)},
            grouped=grouped_wired,
            ports_by_serial=ports_by_serial,
            status_by_serial=status_by_serial,
            port_map_get=self._port_map_get,
            canonical_port_id=self._canonical_port_id,
            position_index=len(node_map),
            existing_node_ids=set(node_map.keys()),
        )
        for n in synth_nodes:
            if n.id in node_map:
                old = node_map[n.id]
                node_map[n.id] = old.model_copy(update={"metadata": {**old.metadata, **n.metadata}})
            else:
                node_map[n.id] = n
        known_link_ids = {ln.id for ln in links}
        for ln in synth_links:
            if ln.id not in known_link_ids:
                links.append(ln)
                known_link_ids.add(ln.id)

        for serial, node in list(node_map.items()):
            if not node.managed:
                continue

            interfaces: list[dict[str, Any]] = []
            for (device_serial, local_port), peers in connected_by_port.items():
                if device_serial != serial:
                    continue
                cfg = self._port_map_get(ports_by_serial.get(serial), str(local_port)) or {}
                sta = self._port_map_get(status_by_serial.get(serial), str(local_port)) or {}
                interfaces.append({
                    "portId": local_port,
                    "connectedPeers": peers,
                    "config": cfg,
                    "status": sta,
                })

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

                port_key = self._canonical_port_id(str(port_id))
                existing = next(
                    (entry for entry in interfaces if self._canonical_port_id(str(entry.get("portId", ""))) == port_key),
                    None,
                )
                if existing:
                    # Only append if this peer isn't already listed (avoid duplicates)
                    existing_ids = {p.get("peer_id") for p in existing.get("connectedPeers", [])}
                    if neighbor_name not in existing_ids:
                        existing.setdefault("connectedPeers", []).append(discovered_peer)
                else:
                    cfg = self._port_map_get(ports_by_serial.get(serial), str(port_id)) or {}
                    sta = self._port_map_get(status_by_serial.get(serial), str(port_id)) or {}
                    interfaces.append({
                        "portId": port_key,
                        "connectedPeers": [discovered_peer],
                        "config": cfg,
                        "status": sta,
                    })

                # Build missing wired links directly from LLDP/CDP interface data.
                peer_id = self._resolve_peer_node_id(neighbor_name, node_map)
                if not peer_id:
                    peer_id = f"neighbor-{serial}-{port_id}-{self._slug(neighbor_name)}"
                    if peer_id not in node_map:
                        inferred_subtype = self._infer_neighbor_subtype(
                            {"description": neighbor_name, "name": neighbor_name, "model": cdp.get("platform")},
                            {"discovered": {"lldp": lldp, "cdp": cdp}},
                        )
                        node_map[peer_id] = TopologyNode(
                            id=peer_id,
                            type="neighbor",
                            subtype=inferred_subtype,
                            label=neighbor_name,
                            managed=False,
                            metadata={"name": neighbor_name, "lldp": lldp, "cdp": cdp},
                            network={"id": network_id, "name": network.get("name", network_id)},
                            position=positions.get(
                                peer_id,
                                {"x": float(len(node_map) * 120), "y": float(len(node_map) * 60)},
                            ),
                        )

                peer_port_id = str(lldp.get("portId") or cdp.get("portId") or cdp.get("portIdFormatted") or "")
                pkey = self._canonical_port_id(str(port_id))
                if (serial, pkey, peer_id) in linked_ports:
                    continue
                if self._pair_key(serial, peer_id) in linked_pairs and not peer_port_id:
                    continue

                src_cfg = self._port_map_get(ports_by_serial.get(serial), str(port_id))
                src_status = self._port_map_get(status_by_serial.get(serial), str(port_id))
                dst_cfg = self._port_map_get(ports_by_serial.get(peer_id), peer_port_id) if peer_port_id else None
                dst_status = self._port_map_get(status_by_serial.get(peer_id), peer_port_id) if peer_port_id else None
                mismatches, faults, actions = self.validator.compare_ports(
                    f"lldp-{serial}-{port_id}-{peer_id}",
                    serial,
                    str(port_id),
                    src_cfg,
                    peer_id,
                    peer_port_id or "unknown",
                    dst_cfg,
                    src_status,
                    dst_status,
                )
                health = "healthy"
                if any(i.severity == "critical" for i in mismatches + faults):
                    health = "critical"
                elif mismatches or faults:
                    health = "warning"
                all_issues.extend(mismatches + faults)
                links.append(
                    TopologyLink(
                        id=f"lldp-{serial}-{port_id}-{peer_id}",
                        source=serial,
                        target=peer_id,
                        source_port={"serial": serial, "portId": str(port_id), "config": src_cfg, "status": src_status},
                        target_port={"serial": peer_id, "portId": peer_port_id or "unknown", "config": dst_cfg, "status": dst_status},
                        link_type="wired",
                        discovery_method="lldp_cdp_inferred",
                        health=health,
                        mismatches=mismatches,
                        faults=faults,
                        remediable_actions=actions,
                        last_seen=datetime.now(timezone.utc),
                    )
                )
                linked_pairs.add(self._pair_key(serial, peer_id))
                linked_ports.add((serial, pkey, peer_id))

            for h in port_peer_hints:
                if h.get("serial") != serial:
                    continue
                pkey = self._canonical_port_id(str(h.get("port", "")))
                if not pkey:
                    continue
                peer = {
                    "peer_id": h["peer_id"],
                    "peer_label": h.get("peer_label", h.get("peer_id", "")),
                    "peer_type": h.get("kind", "synthetic"),
                }
                found = next(
                    (e for e in interfaces if self._canonical_port_id(str(e.get("portId", ""))) == pkey),
                    None,
                )
                if found:
                    existing_ids2 = {str(x.get("peer_id", "")) for x in (found.get("connectedPeers") or [])}
                    if str(peer.get("peer_id", "")) not in existing_ids2:
                        found.setdefault("connectedPeers", []).append(peer)
                else:
                    cfg = self._port_map_get(ports_by_serial.get(serial), pkey) or {}
                    sta = self._port_map_get(status_by_serial.get(serial), pkey) or {}
                    interfaces.append({
                        "portId": pkey,
                        "config": dict(cfg) if isinstance(cfg, dict) else {},
                        "status": dict(sta) if isinstance(sta, dict) else {},
                        "connectedPeers": [peer],
                    })

            def _port_sort_key(i: dict[str, Any]) -> tuple[int, str]:
                pid = str(i.get("portId", "0"))
                return (int(pid) if pid.isdigit() else 9999, pid)

            node.metadata["connected_interfaces"] = sorted(interfaces, key=_port_sort_key)

        links = self._dedupe_links(links)
        switch_ports_cat: dict[str, list[dict[str, Any]]] = {
            s: build_switch_port_catalog(s, ports_by_serial, status_by_serial) for s in switch_serials
        }
        topology_debug: dict[str, Any] = {
            **sw_port_debug,
            "meraki_client_total": len(clients),
            "switch_serials": sorted(switch_serials),
            "port_peer_hint_count": len(port_peer_hints),
        }
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
            switch_ports=switch_ports_cat,
            clients_by_switch_port=clients_by_sp,
            port_peer_hints=port_peer_hints,
            topology_debug=topology_debug,
        )
        self._save_cache(graph)
        return graph
