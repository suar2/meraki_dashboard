"""Switch-port inventory and wired-client grouping. Topology chassis logic lives in physical_topology."""

from __future__ import annotations

import re
from typing import Any

_PORT_RE = re.compile(r"(\d+)")


def _parse_port_number(s: str | int | None) -> str:
    if s is None:
        return ""
    text = str(s).strip()
    if not text:
        return ""
    m = _PORT_RE.search(text)
    if m:
        return str(int(m.group(1)))
    return text


def is_likely_wired_lan_client(client: dict[str, Any]) -> bool:
    """Wired client on a switch: no SSID; not explicitly wireless."""
    if client.get("ssid"):
        return False
    conn = str(client.get("connection") or client.get("Connection") or "").lower()
    if any(x in conn for x in ("wireless", "wi-fi", "wifi")):
        return False
    if "wired" in conn or "802.3" in conn:
        return True
    if client.get("switchport") is not None or client.get("portId") is not None:
        return bool(client.get("recentDeviceSerial"))
    return bool(client.get("recentDeviceSerial") and not client.get("ssid"))


def build_client_id(client: dict[str, Any]) -> str:
    return f"client-{client.get('id', 'unknown')}"


def merge_port_entry(
    port_id: str, cfg: dict[str, Any] | None, sta: dict[str, Any] | None, peers: list[dict[str, str]] | None = None
) -> dict[str, Any]:
    return {
        "portId": port_id,
        "config": dict(cfg) if cfg else {},
        "status": dict(sta) if sta else {},
        "connectedPeers": list(peers) if peers else [],
    }


def build_switch_port_catalog(
    serial: str,
    ports_by_serial: dict[str, dict[str, Any]],
    status_by_serial: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    pmap = ports_by_serial.get(serial, {}) or {}
    smap = status_by_serial.get(serial, {}) or {}

    def sort_key(p: str) -> tuple[int, str]:
        return (int(p) if str(p).isdigit() else 9999, p)

    for key in sorted(pmap.keys(), key=sort_key):
        cfg = pmap.get(key) or {}
        sta = smap.get(key) or {}
        if isinstance(cfg, dict):
            pid = str(cfg.get("portId") or key)
        else:
            pid = str(key)
        out.append(merge_port_entry(pid, dict(cfg) if isinstance(cfg, dict) else None, dict(sta) if isinstance(sta, dict) else None))
    return out


def group_wired_clients_by_switch_port(
    clients: list[dict[str, Any]], switch_serials: set[str]
) -> dict[tuple[str, str], list[dict[str, Any]]]:
    by_key: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for c in clients:
        if not is_likely_wired_lan_client(c):
            continue
        serial = str(c.get("recentDeviceSerial") or "")
        if not serial or serial not in switch_serials:
            continue
        port_raw = c.get("switchport") or c.get("portId") or c.get("port")
        port_key = _parse_port_number(port_raw)
        if not port_key:
            continue
        by_key.setdefault((serial, port_key), []).append(c)
    return by_key
