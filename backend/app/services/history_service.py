"""Periodic topology snapshots and normalized change events."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from app.models.schemas import TopologyGraph
from app.storage.file_store import JsonFileStore

SNAPSHOT_MIN_INTERVAL_SECONDS = 60
SNAPSHOT_RETENTION_DAYS = 8
MAX_SNAPSHOTS = 96
CLIENT_COUNT_ABS = 5
CLIENT_COUNT_RATIO = 0.25


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _canonical_port(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    low = text.lower()
    if low.startswith("port") and low[4:].isdigit():
        return str(int(low[4:]))
    if text.isdigit():
        return str(int(text))
    return text


def _port_cfg(port: dict[str, Any]) -> dict[str, Any]:
    return _as_dict(port.get("config"))


def _port_sta(port: dict[str, Any]) -> dict[str, Any]:
    return _as_dict(port.get("status"))


def extract_snapshot(graph: TopologyGraph) -> dict[str, Any]:
    nodes: dict[str, dict[str, Any]] = {}
    for node in graph.nodes:
        meta = node.metadata or {}
        nodes[node.id] = {
            "id": node.id,
            "label": node.hostname or node.label,
            "serial": node.serial or "",
            "mac": str(meta.get("mac") or meta.get("macAddress") or ""),
            "ip": node.management_ip or "",
            "firmware": node.software_version or "",
            "model": node.platform or str(meta.get("model") or ""),
            "device_class": str(node.device_class or ""),
            "managed": bool(node.managed),
            "type": node.type,
            "subtype": node.subtype,
        }

    links: dict[str, dict[str, Any]] = {}
    attachments: dict[str, dict[str, Any]] = {}
    for link in graph.links:
        src_port = _canonical_port((link.source_port or {}).get("portId") or link.source_interface)
        tgt_port = _canonical_port((link.target_port or {}).get("portId") or link.target_interface)
        left, right = sorted((link.source, link.target))
        key = f"{left}|{right}|{src_port or tgt_port}|{link.link_type}"
        blob = {
            "id": link.id,
            "source": link.source,
            "target": link.target,
            "source_port": src_port,
            "target_port": tgt_port,
            "link_type": link.link_type,
            "discovery_method": link.discovery_method,
            "confidence": link.confidence or "",
            "discovery_sources": list(link.discovery_sources or []),
        }
        links[key] = blob
        if link.link_type == "wireless":
            continue
        for switch_id, port_id, peer_id in (
            (link.source, src_port, link.target),
            (link.target, tgt_port, link.source),
        ):
            if not port_id or not port_id.isdigit():
                continue
            attachments[f"{switch_id}:{port_id}"] = {
                "switch": switch_id,
                "port": port_id,
                "peer": peer_id,
                "peer_label": nodes.get(peer_id, {}).get("label") or peer_id,
                "link_type": link.link_type,
            }

    ports: dict[str, dict[str, Any]] = {}
    for serial, catalog in (graph.switch_ports or {}).items():
        for port in catalog or []:
            if not isinstance(port, dict):
                continue
            port_id = _canonical_port(port.get("portId"))
            if not port_id:
                continue
            cfg = _port_cfg(port)
            sta = _port_sta(port)
            key = f"{serial}:{port_id}"
            peer = attachments.get(key) or {}
            ports[key] = {
                "serial": serial,
                "portId": port_id,
                "mode": str(cfg.get("type") or ""),
                "vlan": cfg.get("vlan"),
                "nativeVlan": cfg.get("nativeVlan"),
                "allowedVlans": cfg.get("allowedVlans"),
                "poe": bool(cfg.get("poeEnabled")),
                "status": str(sta.get("status") or ""),
                "clientCount": sta.get("clientCount") if sta.get("clientCount") is not None else 0,
                "speed": str(sta.get("speed") or ""),
                "peer": peer.get("peer") or "",
                "peer_label": peer.get("peer_label") or "",
                "lldp": bool(_as_dict(sta.get("lldp")) or _as_dict(port.get("lldp"))),
            }

    return {
        "id": str(uuid4()),
        "captured_at": (graph.generated_at if isinstance(graph.generated_at, datetime) else _now()).isoformat(),
        "org_id": str((graph.organization or {}).get("id") or ""),
        "network_id": str((graph.network or {}).get("id") or ""),
        "nodes": nodes,
        "links": links,
        "ports": ports,
    }


def snapshot_fingerprint(snapshot: dict[str, Any]) -> str:
    nodes = snapshot.get("nodes") or {}
    links = snapshot.get("links") or {}
    ports = snapshot.get("ports") or {}
    node_bits = tuple(sorted((k, v.get("firmware"), v.get("ip"), v.get("label")) for k, v in nodes.items()))
    link_bits = tuple(sorted(links))
    port_bits = tuple(
        sorted((k, v.get("mode"), v.get("vlan"), v.get("nativeVlan"), v.get("peer"), v.get("clientCount")) for k, v in ports.items())
    )
    return str(hash((node_bits, link_bits, port_bits)))


def _label(snapshot: dict[str, Any], node_id: str) -> str:
    node = (snapshot.get("nodes") or {}).get(node_id) or {}
    return str(node.get("label") or node_id)


def _material_client_delta(old: int, new: int) -> bool:
    delta = abs(new - old)
    if delta < CLIENT_COUNT_ABS:
        return False
    baseline = max(old, 1)
    return delta / baseline >= CLIENT_COUNT_RATIO or delta >= 10


def diff_snapshots(previous: dict[str, Any], current: dict[str, Any]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    captured = current.get("captured_at") or _now().isoformat()
    prev_nodes = previous.get("nodes") or {}
    curr_nodes = current.get("nodes") or {}
    prev_ports = previous.get("ports") or {}
    curr_ports = current.get("ports") or {}
    prev_links = previous.get("links") or {}
    curr_links = current.get("links") or {}

    def add(kind: str, summary: str, **extra: Any) -> None:
        events.append(
            {
                "id": str(uuid4()),
                "at": captured,
                "kind": kind,
                "summary": summary,
                **extra,
            }
        )

    for node_id, node in curr_nodes.items():
        if node_id not in prev_nodes:
            add("appeared", f"{node.get('label') or node_id} appeared", node_id=node_id, severity="info")
        else:
            old = prev_nodes[node_id]
            if (old.get("firmware") or "") != (node.get("firmware") or "") and node.get("firmware"):
                add(
                    "firmware",
                    f"{node.get('label')} firmware {old.get('firmware') or '—'} → {node.get('firmware')}",
                    node_id=node_id,
                    before=old.get("firmware"),
                    after=node.get("firmware"),
                    severity="warning",
                )
    for node_id, node in prev_nodes.items():
        if node_id not in curr_nodes:
            add("disappeared", f"{node.get('label') or node_id} disappeared", node_id=node_id, severity="warning")

    prev_attach = {k: v for k, v in prev_ports.items() if v.get("peer")}
    curr_attach = {k: v for k, v in curr_ports.items() if v.get("peer")}
    peer_prev: dict[str, str] = {str(v.get("peer")): k for k, v in prev_attach.items()}
    peer_curr: dict[str, str] = {str(v.get("peer")): k for k, v in curr_attach.items()}
    for peer, key in peer_curr.items():
        old_key = peer_prev.get(peer)
        if old_key and old_key != key:
            old = prev_ports.get(old_key) or {}
            new = curr_ports.get(key) or {}
            label = _label(current, peer)
            cls = str((curr_nodes.get(peer) or {}).get("device_class") or "")
            kind = "ap_moved" if cls == "ap" else "moved"
            add(
                kind,
                f"{label} moved {old.get('serial')} p{old.get('portId')} → {new.get('serial')} p{new.get('portId')}",
                node_id=peer,
                before=old_key,
                after=key,
                severity="warning",
            )

    for key, port in curr_ports.items():
        old = prev_ports.get(key)
        if not old:
            if port.get("peer") and port.get("lldp"):
                add(
                    "lldp_neighbor",
                    f"New LLDP neighbor {port.get('peer_label') or port.get('peer')} on {port.get('serial')} p{port.get('portId')}",
                    port=key,
                    node_id=port.get("peer"),
                    severity="info",
                )
            continue
        old_mode = str(old.get("mode") or "").lower()
        new_mode = str(port.get("mode") or "").lower()
        if old_mode and new_mode and old_mode != new_mode:
            add(
                "port_mode",
                f"{port.get('serial')} p{port.get('portId')} changed {old_mode} → {new_mode}",
                port=key,
                before=old_mode,
                after=new_mode,
                severity="warning",
            )
        if old.get("nativeVlan") != port.get("nativeVlan") and (old.get("nativeVlan") not in (None, "") or port.get("nativeVlan") not in (None, "")):
            add(
                "native_vlan",
                f"{port.get('serial')} p{port.get('portId')} native VLAN changed {old.get('nativeVlan')} → {port.get('nativeVlan')}",
                port=key,
                before=old.get("nativeVlan"),
                after=port.get("nativeVlan"),
                severity="warning",
            )
        if old.get("vlan") != port.get("vlan") and (old.get("vlan") not in (None, "") or port.get("vlan") not in (None, "")):
            add(
                "vlan",
                f"{port.get('serial')} p{port.get('portId')} VLAN changed {old.get('vlan')} → {port.get('vlan')}",
                port=key,
                before=old.get("vlan"),
                after=port.get("vlan"),
                severity="warning",
            )
        try:
            old_cc = int(old.get("clientCount") or 0)
            new_cc = int(port.get("clientCount") or 0)
        except (TypeError, ValueError):
            old_cc = new_cc = 0
        if _material_client_delta(old_cc, new_cc):
            add(
                "client_count",
                f"{port.get('serial')} p{port.get('portId')} client count {old_cc} → {new_cc}",
                port=key,
                before=old_cc,
                after=new_cc,
                severity="info",
            )

    for key, link in curr_links.items():
        if key in prev_links:
            continue
        if link.get("link_type") == "wireless":
            continue
        if "lldp" in str(link.get("discovery_method") or "") or "lldp" in " ".join(link.get("discovery_sources") or []):
            add(
                "lldp_neighbor",
                f"New LLDP neighbor {_label(current, link.get('target'))} on {_label(current, link.get('source'))} p{link.get('source_port') or '—'}",
                link=key,
                node_id=link.get("target"),
                severity="info",
            )

    mx_prev = {k for k, v in prev_links.items() if v.get("link_type") != "wireless" and ("mx" in str((prev_nodes.get(v.get("source")) or {}).get("device_class")) or "mx" in str((prev_nodes.get(v.get("target")) or {}).get("device_class")))}
    mx_curr = {k for k, v in curr_links.items() if v.get("link_type") != "wireless" and ("mx" in str((curr_nodes.get(v.get("source")) or {}).get("device_class")) or "mx" in str((curr_nodes.get(v.get("target")) or {}).get("device_class")))}
    if mx_prev and mx_curr and mx_prev != mx_curr:
        add("uplink", "Uplink membership changed", before=sorted(mx_prev), after=sorted(mx_curr), severity="warning")

    return events


class HistoryService:
    def __init__(self, store: JsonFileStore) -> None:
        self.store = store

    def _snap_name(self, org_id: str, network_id: str) -> str:
        return f"history_snapshots_{org_id}_{network_id}.json"

    def _chg_name(self, org_id: str, network_id: str) -> str:
        return f"history_changes_{org_id}_{network_id}.json"

    def list_snapshots(self, org_id: str, network_id: str) -> list[dict[str, Any]]:
        payload = self.store.read_json(self._snap_name(org_id, network_id), {"snapshots": []})
        return list(payload.get("snapshots") or [])

    def list_changes(self, org_id: str, network_id: str, window: str = "24h") -> list[dict[str, Any]]:
        payload = self.store.read_json(self._chg_name(org_id, network_id), {"changes": []})
        changes = list(payload.get("changes") or [])
        cutoff = self._cutoff(window)
        if not cutoff:
            return changes
        kept: list[dict[str, Any]] = []
        for item in changes:
            at = _parse_dt(item.get("at"))
            if at and at >= cutoff:
                kept.append(item)
        return kept

    def record_graph(self, graph: TopologyGraph, *, force: bool = False) -> dict[str, Any] | None:
        org_id = str((graph.organization or {}).get("id") or "")
        network_id = str((graph.network or {}).get("id") or "")
        if not org_id or not network_id:
            return None
        snapshot = extract_snapshot(graph)
        snapshots = self.list_snapshots(org_id, network_id)
        previous = snapshots[-1] if snapshots else None
        if previous and not force:
            prev_at = _parse_dt(previous.get("captured_at"))
            if prev_at and (_now() - prev_at).total_seconds() < SNAPSHOT_MIN_INTERVAL_SECONDS:
                if snapshot_fingerprint(previous) == snapshot_fingerprint(snapshot):
                    return None
            elif snapshot_fingerprint(previous) == snapshot_fingerprint(snapshot):
                return None
        if previous:
            events = diff_snapshots(previous, snapshot)
            if events:
                existing = self.store.read_json(self._chg_name(org_id, network_id), {"changes": []})
                merged = list(existing.get("changes") or []) + events
                cutoff = _now() - timedelta(days=SNAPSHOT_RETENTION_DAYS)
                merged = [c for c in merged if (_parse_dt(c.get("at")) or _now()) >= cutoff]
                self.store.write_json(self._chg_name(org_id, network_id), {"changes": merged[-2000:]})
        snapshots.append(snapshot)
        cutoff = _now() - timedelta(days=SNAPSHOT_RETENTION_DAYS)
        snapshots = [s for s in snapshots if (_parse_dt(s.get("captured_at")) or _now()) >= cutoff][-MAX_SNAPSHOTS:]
        self.store.write_json(self._snap_name(org_id, network_id), {"snapshots": snapshots})
        return snapshot

    def seed_changes(self, org_id: str, network_id: str, changes: list[dict[str, Any]]) -> None:
        self.store.write_json(self._chg_name(org_id, network_id), {"changes": changes})

    @staticmethod
    def _cutoff(window: str) -> datetime | None:
        now = _now()
        key = (window or "24h").strip().lower()
        if key in {"1h", "hour"}:
            return now - timedelta(hours=1)
        if key in {"7d", "7day", "week"}:
            return now - timedelta(days=7)
        if key in {"all", "*"}:
            return None
        return now - timedelta(hours=24)
