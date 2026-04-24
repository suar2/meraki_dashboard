"""Build topology nodes and links from Meraki switch port + client data (not only LLDP/CDP)."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable

from app.models.schemas import TopologyLink, TopologyNode

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


def infer_trunk_host_label(clients: list[dict[str, Any]]) -> str:
    for c in clients:
        d = str(c.get("description") or c.get("dhcpHostname") or "").lower()
        if "proxmox" in d:
            return "Proxmox / Server"
        if "esxi" in d or "vmware" in d:
            return "ESXi / Server"
    for c in clients:
        d = str(c.get("description") or c.get("dhcpHostname") or "").strip()
        if d and d.lower() not in {"unknown", "none"} and len(d) < 64:
            return f"{d} (trunk)"
    return "Server / Trunk host"


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


def synthesize_wired_port_topology(
    *,
    network: dict[str, Any],
    grouped: dict[tuple[str, str], list[dict[str, Any]]],
    ports_by_serial: dict[str, dict[str, Any]],
    status_by_serial: dict[str, dict[str, Any]],
    port_map_get: Callable[..., Any],
    canonical_port_id: Callable[[str], str],
    position_index: int,
    existing_node_ids: set[str] | None = None,
) -> tuple[list[TopologyNode], list[TopologyLink], dict[str, list[dict[str, Any]]], list[dict[str, Any]], dict[str, Any]]:
    new_nodes: list[TopologyNode] = []
    new_links: list[TopologyLink] = []
    by_sp: dict[str, list[dict[str, Any]]] = {}
    debug: dict[str, Any] = {
        "wired_port_groups": len(grouped),
        "trunk_groups": 0,
        "access_single": 0,
        "access_multi": 0,
        "trunk_port_ids": [],
    }

    pos_i = position_index
    existing = existing_node_ids or set()
    peer_hints: list[dict[str, Any]] = []

    def pos() -> dict[str, float]:
        nonlocal pos_i
        pos_i += 1
        return {"x": float((pos_i % 40) * 130), "y": float((pos_i // 40) * 60)}

    for (serial, port_key), group in grouped.items():
        ckey = f"{serial}:{port_key}"
        by_sp[ckey] = [dict(c) for c in group]
        uid: dict[str, dict[str, Any]] = {}
        for c in group:
            i = str(c.get("id", ""))
            if i and i not in uid:
                uid[i] = c
        ulist = list(uid.values())
        if not ulist:
            continue

        cfg: dict[str, Any] = {}
        sta: dict[str, Any] = {}
        for v in (canonical_port_id(port_key), port_key, f"port{port_key}"):
            c = port_map_get(ports_by_serial.get(serial), v)
            if c and isinstance(c, dict):
                cfg = dict(c)
                break
        for v in (canonical_port_id(port_key), port_key, f"port{port_key}"):
            s = port_map_get(status_by_serial.get(serial), v)
            if s and isinstance(s, dict):
                sta = dict(s)
                break
        ptype = str(cfg.get("type") or "").lower()
        is_trunk = ptype == "trunk"
        if is_trunk and ulist:
            debug["trunk_groups"] = int(debug["trunk_groups"]) + 1
            debug["trunk_port_ids"].append(f"{serial}:{port_key}")
            head_id = f"trunk-host-{serial}-{port_key}"
            head_label = infer_trunk_host_label(ulist)
            peer_hints.append(
                {
                    "serial": serial,
                    "port": port_key,
                    "peer_id": head_id,
                    "peer_label": head_label,
                    "kind": "trunk_host",
                }
            )
            new_nodes.append(
                TopologyNode(
                    id=head_id,
                    type="synthetic",
                    subtype="trunk_host",
                    label=head_label,
                    managed=False,
                    metadata={
                        "role": "trunk_host",
                        "switch_serial": serial,
                        "port_id": port_key,
                        "port_config": cfg,
                        "port_status": sta,
                        "downstream_client_ids": [str(c.get("id")) for c in ulist],
                        "meraki_clients": ulist,
                    },
                    network=network,
                    position=pos(),
                )
            )
            new_links.append(
                TopologyLink(
                    id=f"sw-trunk-{serial}-{port_key}-{head_id}",
                    source=serial,
                    target=head_id,
                    source_port={
                        "serial": serial,
                        "portId": port_key,
                        "config": cfg,
                        "status": sta,
                        "label": f"p{port_key} trunk",
                    },
                    target_port={"serial": head_id, "portId": "trunk", "config": None, "status": None},
                    link_type="wired",
                    discovery_method="switchport_trunk",
                    last_seen=datetime.now(timezone.utc),
                )
            )
            for c in ulist:
                cid = build_client_id(c)
                cmeta = {**c, "source": "meraki_wired", "mapped_switchport": port_key, "parent_trunk": head_id}
                if cid in existing:
                    pass
                else:
                    new_nodes.append(
                        TopologyNode(
                            id=cid,
                            type="client",
                            subtype="wired",
                            label=str(c.get("description") or c.get("ip") or cid),
                            managed=False,
                            metadata=cmeta,
                            network=network,
                            position=pos(),
                        )
                    )
                new_links.append(
                    TopologyLink(
                        id=f"trunk-down-{head_id}-{cid}",
                        source=head_id,
                        target=cid,
                        source_port={"serial": head_id, "portId": "down", "config": None, "status": None},
                        target_port={"serial": serial, "portId": port_key, "config": None, "status": None},
                        link_type="wired",
                        discovery_method="trunk_downstream",
                        last_seen=datetime.now(timezone.utc),
                    )
                )
            continue
        if len(ulist) == 1:
            debug["access_single"] = int(debug["access_single"]) + 1
            c = ulist[0]
            cid = build_client_id(c)
            cmeta = {**c, "source": "meraki_wired", "mapped_switchport": port_key}
            peer_hints.append(
                {
                    "serial": serial,
                    "port": port_key,
                    "peer_id": cid,
                    "peer_label": str(c.get("description") or c.get("ip") or cid),
                    "kind": "wired_client",
                }
            )
            if cid not in existing:
                new_nodes.append(
                    TopologyNode(
                        id=cid,
                        type="client",
                        subtype="wired",
                        label=str(c.get("description") or c.get("ip") or cid),
                        managed=False,
                        metadata=cmeta,
                        network=network,
                        position=pos(),
                    )
                )
            new_links.append(
                TopologyLink(
                    id=f"sw-acc-{serial}-{port_key}-{cid}",
                    source=serial,
                    target=cid,
                    source_port={
                        "serial": serial,
                        "portId": port_key,
                        "config": cfg,
                        "status": sta,
                        "label": f"p{port_key} access",
                    },
                    target_port={},
                    link_type="wired",
                    discovery_method="switchport_access",
                    last_seen=datetime.now(timezone.utc),
                )
            )
            continue
        debug["access_multi"] = int(debug["access_multi"]) + 1
        gid = f"port-lan-group-{serial}-{port_key}"
        g_label = f"Port {port_key} clients ({len(ulist)})"
        peer_hints.append(
            {
                "serial": serial,
                "port": port_key,
                "peer_id": gid,
                "peer_label": g_label,
                "kind": "port_access_group",
            }
        )
        new_nodes.append(
            TopologyNode(
            id=gid,
                type="synthetic",
                subtype="port_access_group",
                label=g_label,
                managed=False,
                metadata={
                    "role": "port_access_group",
                    "switch_serial": serial,
                    "port_id": port_key,
                    "port_config": cfg,
                    "port_status": sta,
                    "client_ids": [str(c.get("id")) for c in ulist],
                    "meraki_clients": ulist,
                },
                network=network,
                position=pos(),
            )
        )
        new_links.append(
            TopologyLink(
                id=f"sw-pag-{serial}-{port_key}",
                source=serial,
                target=gid,
                source_port={
                    "serial": serial,
                    "portId": port_key,
                    "config": cfg,
                    "status": sta,
                    "label": f"p{port_key} access",
                },
                target_port={},
                link_type="wired",
                discovery_method="port_access_group",
                last_seen=datetime.now(timezone.utc),
            )
        )
        for c in ulist:
            cid = build_client_id(c)
            cmeta = {**c, "source": "meraki_wired", "mapped_switchport": port_key, "port_group": gid}
            if cid not in existing:
                new_nodes.append(
                    TopologyNode(
                        id=cid,
                        type="client",
                        subtype="wired",
                        label=str(c.get("description") or c.get("ip") or cid),
                        managed=False,
                        metadata=cmeta,
                        network=network,
                        position=pos(),
                    )
                )
            new_links.append(
                TopologyLink(
                    id=f"pag-down-{gid}-{cid}",
                    source=gid,
                    target=cid,
                    source_port={},
                    target_port={},
                    link_type="wired",
                    discovery_method="port_access_downstream",
                    last_seen=datetime.now(timezone.utc),
                )
            )

    return new_nodes, new_links, by_sp, peer_hints, debug
