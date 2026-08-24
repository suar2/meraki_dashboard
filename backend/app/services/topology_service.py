from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any

from app.config import settings
from app.models.schemas import StackMember, TopologyGraph, TopologyLink, TopologyNode, TopologySummary
from app.services.device_class import classify_device, elect_core_switch_ids
from app.services.diagnostics import compute_diagnostics
from app.services.history_service import HistoryService
from app.services.layout_service import LayoutService
from app.services.live_expectations import validate_expectations
from app.services.meraki_client import MerakiAPIError, MerakiClient
from app.services.validation_service import ValidationService
from app.storage.file_store import JsonFileStore
from app.services.entity_merge_service import EntityMergeService
from app.services.identity import human_label, is_derived_id
from app.services.switchport_client_builder import (
    build_switch_port_catalog,
)
from app.services.topology_assembler import assemble_topology, merge_duplicate_links

logger = logging.getLogger(__name__)


class TopologyService:
    def __init__(
        self,
        meraki: MerakiClient,
        validator: ValidationService,
        layouts: LayoutService | None,
        store: JsonFileStore | None,
        history: HistoryService | None = None,
    ) -> None:
        self.meraki = meraki
        self.validator = validator
        self.layouts = layouts
        self.store = store
        self.history = history
        self.entity_merges = EntityMergeService(store) if store else None

    def _cache_name(self, org_id: str, network_id: str) -> str:
        return f"cache_topology_v8_{org_id}_{network_id}.json"

    def invalidate_cache(self, org_id: str, network_id: str) -> None:
        if not self.store:
            return
        path = self.store.base / self._cache_name(org_id, network_id)
        path.unlink(missing_ok=True)

    @staticmethod
    def _first_str(*values: Any) -> str:
        for value in values:
            if value is None:
                continue
            text = str(value).strip()
            if text and text.lower() not in {"none", "unknown", "null"}:
                return text
        return ""

    def _node_hostname(self, node: TopologyNode) -> str:
        meta = node.metadata or {}
        lldp = self._as_dict(meta.get("lldp"))
        cdp = self._as_dict(meta.get("cdp"))
        label = human_label(
            lldp.get("systemName"),
            cdp.get("deviceId"),
            meta.get("name"),
            meta.get("description"),
            meta.get("dhcpHostname"),
            meta.get("mdnsName"),
            meta.get("deviceTypePrediction"),
            node.hostname,
            node.label,
            meta.get("ip") or node.management_ip,
            meta.get("mac"),
        )
        if label:
            return label
        if is_derived_id(node.id):
            return ""
        return str(node.id)

    def _node_management_ip(self, node: TopologyNode) -> str:
        meta = node.metadata or {}
        lldp = self._as_dict(meta.get("lldp"))
        cdp = self._as_dict(meta.get("cdp"))
        return self._first_str(
            node.management_ip,
            meta.get("lanIp"),
            meta.get("managementIp"),
            meta.get("wan1Ip"),
            meta.get("ip"),
            meta.get("ipAddress"),
            lldp.get("managementAddress"),
            cdp.get("address"),
            cdp.get("managementAddress"),
        )

    def _node_platform(self, node: TopologyNode) -> str:
        meta = node.metadata or {}
        cdp = self._as_dict(meta.get("cdp"))
        return self._first_str(
            node.platform,
            meta.get("model"),
            meta.get("productType"),
            cdp.get("platform"),
            node.subtype,
        )

    def _node_serial(self, node: TopologyNode) -> str:
        meta = node.metadata or {}
        if node.managed:
            return self._first_str(node.serial, meta.get("serial"), node.id)
        return self._first_str(node.serial, meta.get("serial"))

    def _node_firmware(self, node: TopologyNode) -> str:
        meta = node.metadata or {}
        return self._first_str(
            node.software_version,
            meta.get("firmware"),
            meta.get("software_version"),
            meta.get("os"),
        )

    def _node_interfaces(self, node: TopologyNode, links: list[TopologyLink]) -> list[str]:
        ifaces: list[str] = []
        seen: set[str] = set()

        def add(value: Any) -> None:
            text = str(value or "").strip()
            if not text or text.lower() in {"unknown", "none"} or text in seen:
                return
            seen.add(text)
            ifaces.append(text)

        for entry in node.metadata.get("connected_interfaces") or []:
            if isinstance(entry, dict):
                add(entry.get("portId"))
        for link in links:
            if link.source == node.id:
                add((link.source_port or {}).get("portId"))
            elif link.target == node.id:
                add((link.target_port or {}).get("portId"))
        return ifaces

    def _enrich_graph(
        self,
        nodes: list[TopologyNode],
        links: list[TopologyLink],
        network: dict[str, Any],
        stacks: list[dict[str, Any]] | None = None,
    ) -> None:
        """Stamp inventory/adjacency fields onto the unified graph."""
        location = self._first_str(network.get("name"), network.get("id"))
        degree: dict[str, int] = {n.id: 0 for n in nodes}
        for link in links:
            if link.source in degree:
                degree[link.source] += 1
            if link.target in degree:
                degree[link.target] += 1

        election_payload = []
        for node in nodes:
            meta = node.metadata or {}
            election_payload.append(
                {
                    "id": node.id,
                    "subtype": node.subtype,
                    "product_type": meta.get("productType"),
                    "platform": self._node_platform(node),
                    "hostname": self._node_hostname(node),
                    "label": node.label,
                    "name": meta.get("name"),
                    "model": meta.get("model"),
                }
            )
        core_ids = elect_core_switch_ids(election_payload, degree)

        stack_by_serial: dict[str, list[StackMember]] = {}
        firmware_by_serial = {n.id: self._node_firmware(n) for n in nodes}
        for stack in stacks or []:
            serials = [str(s) for s in (stack.get("serials") or []) if s]
            members: list[StackMember] = []
            for idx, serial in enumerate(serials, start=1):
                members.append(
                    StackMember(
                        id=idx,
                        role=str(stack.get("name") or ""),
                        serial_number=serial,
                        software_version=firmware_by_serial.get(serial, ""),
                    )
                )
            for serial in serials:
                stack_by_serial[serial] = members

        node_by_id = {n.id: n for n in nodes}
        for node in nodes:
            hostname = self._node_hostname(node)
            platform = self._node_platform(node)
            product_type = str((node.metadata or {}).get("productType") or "")
            node.hostname = hostname
            node.management_ip = self._node_management_ip(node)
            node.platform = platform
            node.location = self._first_str(node.location, location)
            node.software_version = self._node_firmware(node)
            node.serial = self._node_serial(node)
            node.degree = degree.get(node.id, 0)
            node.interfaces = self._node_interfaces(node, links)
            node.device_class = classify_device(
                hostname=hostname,
                platform=platform,
                product_type=product_type,
                subtype=node.subtype,
                node_type=node.type,
                managed=node.managed,
                is_core_switch=node.id in core_ids,
            )
            if node.id in stack_by_serial:
                node.stack_members = stack_by_serial[node.id]
            elif not node.stack_members:
                serial = node.serial or "—"
                firmware = node.software_version or "—"
                node.stack_members = [
                    StackMember(id=1, role="", serial_number=serial, software_version=firmware)
                ]

        for node in nodes:
            crit = 0
            warn = 0
            for link in links:
                if link.source != node.id and link.target != node.id:
                    continue
                for issue in [*link.mismatches, *link.faults]:
                    if issue.severity == "critical":
                        crit += 1
                    elif issue.severity == "warning":
                        warn += 1
            node.health.critical_count = crit
            node.health.warning_count = warn
            node.issue_count = crit + warn
            if crit:
                node.health.state = "critical"
            elif warn:
                node.health.state = "warning"
            else:
                node.health.state = "healthy"

        for link in links:
            src = node_by_id.get(link.source)
            tgt = node_by_id.get(link.target)
            link.source_hostname = src.hostname if src else link.source
            link.target_hostname = tgt.hostname if tgt else link.target
            link.source_management_ip = src.management_ip if src else ""
            link.target_management_ip = tgt.management_ip if tgt else ""
            link.source_platform = src.platform if src else ""
            link.target_platform = tgt.platform if tgt else ""
            link.source_device_class = src.device_class if src else ""
            link.target_device_class = tgt.device_class if tgt else ""
            link.source_interface = self._first_str(
                link.source_interface, (link.source_port or {}).get("portId")
            )
            link.target_interface = self._first_str(
                link.target_interface, (link.target_port or {}).get("portId")
            )

    def _load_cache(self, org_id: str, network_id: str) -> TopologyGraph | None:
        if not self.store:
            return None
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
        if not self.store:
            return
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
        """Dedupe links by endpoint+port, merging discovery_sources into one edge."""
        return merge_duplicate_links(links)


    async def build(self, org_id: str, network_id: str) -> TopologyGraph:
        cached = self._load_cache(org_id, network_id)
        if cached:
            return cached
        networks = await self.meraki.get_organization_networks(org_id)
        devices = await self.meraki.get_network_devices(network_id)
        try:
            org_devices = await self.meraki.get_organization_devices(org_id, network_id)
        except MerakiAPIError as exc:
            logger.warning("Organization inventory failed for %s: %s", org_id, exc)
            org_devices = []
        by_serial = {str(d.get("serial") or ""): d for d in devices if d.get("serial")}
        for extra in org_devices:
            serial = str(extra.get("serial") or "")
            if serial and serial not in by_serial:
                by_serial[serial] = extra
        devices = list(by_serial.values())
        try:
            topology = await self.meraki.get_network_topology(network_id)
        except MerakiAPIError as exc:
            logger.warning("Topology endpoint failed for network %s: %s", network_id, exc)
            topology = {"nodes": [], "links": []}
        if "nodes" not in topology:
            topology["nodes"] = []
        client_timespan = settings.meraki_client_lookback_seconds
        try:
            clients = await self.meraki.get_network_clients(network_id, timespan=client_timespan)
        except MerakiAPIError as exc:
            logger.warning("Clients endpoint failed for network %s: %s", network_id, exc)
            clients = []
        try:
            stacks = await self.meraki.get_network_switch_stacks(network_id)
        except MerakiAPIError as exc:
            logger.warning("Switch stacks endpoint failed for network %s: %s", network_id, exc)
            stacks = []
        network = next((n for n in networks if n["id"] == network_id), {"id": network_id, "name": network_id})
        positions = self.layouts.get_positions(org_id, network_id) if self.layouts else {}

        ports_by_serial: dict[str, dict[str, Any]] = {}
        status_by_serial: dict[str, dict[str, Any]] = {}
        lldp_cdp_by_serial: dict[str, dict[str, Any]] = {}
        for d in devices:
            serial = str(d.get("serial") or "")
            subtype = self._friendly_subtype(str(d.get("productType", "unknown")))
            if subtype == "switch" and serial:
                try:
                    raw_ports = await self.meraki.get_switch_ports(serial)
                except MerakiAPIError as exc:
                    logger.warning("Switch ports endpoint failed for %s: %s", serial, exc)
                    raw_ports = []
                try:
                    raw_statuses = await self.meraki.get_switch_port_statuses(serial)
                except MerakiAPIError as exc:
                    logger.warning("Switch port status endpoint failed for %s: %s", serial, exc)
                    raw_statuses = []
                ports_by_serial[serial] = {str(p["portId"]): p for p in raw_ports}
                status_by_serial[serial] = {str(s["portId"]): s for s in raw_statuses}
            if serial:
                try:
                    lldp_cdp_by_serial[serial] = self._as_dict(await self.meraki.get_device_lldp_cdp(serial))
                except MerakiAPIError:
                    lldp_cdp_by_serial[serial] = {}

        assembled = assemble_topology(
            network_id=network_id,
            network=network,
            devices=devices,
            topology=topology,
            clients=clients,
            ports_by_serial=ports_by_serial,
            status_by_serial=status_by_serial,
            lldp_cdp_by_serial=lldp_cdp_by_serial,
            positions=positions,
            entity_merges=self.entity_merges.list_merges(org_id, network_id) if self.entity_merges else [],
            compare_ports=self.validator.compare_ports if self.validator else None,
            port_map_get=self._port_map_get,
        )
        node_map: dict[str, TopologyNode] = assembled["nodes"]
        links: list[TopologyLink] = assembled["links"]
        all_issues = assembled["issues"]
        port_peer_hints = assembled["port_peer_hints"]
        sw_port_debug = assembled["sw_port_debug"]
        switch_serials = assembled["switch_serials"]
        clients_by_sp = assembled["clients_by_switch_port"]

        self._enrich_graph(list(node_map.values()), links, network, stacks)
        switch_ports_cat: dict[str, list[dict[str, Any]]] = {
            s: build_switch_port_catalog(s, ports_by_serial, status_by_serial) for s in switch_serials
        }
        topology_debug: dict[str, Any] = {
            **sw_port_debug,
            "meraki_client_total": len(clients),
            "client_lookback_seconds": client_timespan,
            "switch_serials": sorted(switch_serials),
            "port_peer_hint_count": len(port_peer_hints),
            "clients_by_switch_port_counts": {key: len(val) for key, val in clients_by_sp.items()},
            "unresolved_nodes": assembled["unresolved"],
            "duplicate_chassis": assembled.get("chassis_debug") or [],
        }
        summary = TopologySummary(
            total_nodes=len(node_map),
            total_wired_links=len([l for l in links if l.link_type == "wired"]),
            total_wireless_links=len([l for l in links if l.link_type == "wireless"]),
            total_mismatches=len([i for i in all_issues if getattr(i, "category", "") == "config_mismatch"]),
            total_critical_issues=len([i for i in all_issues if getattr(i, "severity", "") == "critical"]),
            total_warning_issues=len([i for i in all_issues if getattr(i, "severity", "") == "warning"]),
            unmanaged_neighbors=len([n for n in node_map.values() if not n.managed]),
            remediable_issues=len([i for i in all_issues if getattr(i, "remediable", False)]),
            manual_investigation_issues=len([i for i in all_issues if not getattr(i, "remediable", True)]),
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
        graph.topology_debug["diagnostics"] = compute_diagnostics(graph)
        graph.topology_debug["expectations"] = validate_expectations(graph)
        if self.history:
            try:
                self.history.record_graph(graph)
            except Exception:
                logger.exception("Failed to record topology snapshot for %s/%s", org_id, network_id)
        self._save_cache(graph)
        return graph
