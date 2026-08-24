"""Physical-device topology: chassis first, interfaces second, downstream third."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from app.models.schemas import TopologyLink, TopologyNode
from app.services.switchport_client_builder import build_client_id

INFRA_SUBTYPES = {
    "firewall",
    "switch",
    "core_switch",
    "access_switch",
    "access_point",
    "ap",
    "camera",
    "cellular",
    "server",
}
INFRA_PRODUCTS = {"appliance", "switch", "wireless", "camera", "cellularGateway", "cellulargateway"}
INFRA_CLASSES = {"mx", "ms", "mr", "mv", "mg", "core", "access", "ap", "wlc", "server"}

SERVER_HINTS = (
    "proxmox",
    "esxi",
    "vmware",
    "hyper-v",
    "hyperv",
    "nutanix",
    "xenserver",
    "server",
    "nas",
    "synology",
    "qnap",
    "truenas",
    "unraid",
)
VM_HINTS = (
    "vm",
    "homeassistant",
    "hass",
    "birthday",
    "orthanc",
    "docker",
    "k8s",
    "kubernetes",
    "lxc",
    "container",
)


def _norm(value: Any) -> str:
    return str(value or "").strip().lower()


def _mac(value: Any) -> str:
    return _norm(value).replace("-", ":")


def canonical_port_id(port_id: str) -> str:
    text = str(port_id or "").strip()
    if not text:
        return text
    low = text.lower()
    if low.startswith("port") and low[4:].isdigit():
        return str(int(low[4:]))
    if text.isdigit():
        return str(int(text))
    return text


def looks_like_server(name: str) -> bool:
    hay = _norm(name)
    return any(hint in hay for hint in SERVER_HINTS)


def looks_like_vm(name: str) -> bool:
    hay = _norm(name)
    return any(hint in hay for hint in VM_HINTS)


def is_infra_node(node: TopologyNode) -> bool:
    if node.device_class in INFRA_CLASSES:
        return True
    if node.subtype in INFRA_SUBTYPES:
        return True
    product = _norm((node.metadata or {}).get("productType"))
    if product in INFRA_PRODUCTS:
        return True
    if node.managed and node.type == "meraki":
        return True
    return False


def is_switch_node(node: TopologyNode) -> bool:
    product = _norm((node.metadata or {}).get("productType"))
    return node.subtype in {"switch", "core_switch", "access_switch"} or product == "switch"


def client_label(client: dict[str, Any]) -> str:
    return str(
        client.get("description")
        or client.get("dhcpHostname")
        or client.get("mdnsName")
        or client.get("ip")
        or client.get("mac")
        or "Client"
    )


def index_managed_devices(nodes: dict[str, TopologyNode]) -> dict[str, TopologyNode]:
    index: dict[str, TopologyNode] = {}
    for node in nodes.values():
        if not node.managed or node.type != "meraki":
            continue
        meta = node.metadata or {}
        serial = _norm(node.serial or meta.get("serial") or node.id)
        if serial:
            index[f"serial:{serial}"] = node
        for mac in (meta.get("mac"), meta.get("macAddress"), node.id):
            hashed = _mac(mac)
            if hashed and ":" in hashed:
                index[f"mac:{hashed}"] = node
        for ip in (meta.get("lanIp"), meta.get("wan1Ip"), meta.get("ip"), node.management_ip):
            if _norm(ip):
                index[f"ip:{_norm(ip)}"] = node
        for name in (node.label, node.hostname, meta.get("name")):
            if _norm(name):
                index[f"name:{_norm(name)}"] = node
    return index


def resolve_managed_device(client: dict[str, Any], index: dict[str, TopologyNode]) -> TopologyNode | None:
    """Match a Meraki client record to an already-known managed chassis.

    recentDeviceSerial is the *uplink* device (switch/AP), not the client itself.
    """
    keys: list[str] = []
    serial = _norm(client.get("serial"))
    if serial:
        keys.append(f"serial:{serial}")
    mac = _mac(client.get("mac") or client.get("macAddress"))
    if mac:
        keys.append(f"mac:{mac}")
    ip = _norm(client.get("ip") or client.get("ipAddress"))
    if ip:
        keys.append(f"ip:{ip}")
    for name in (client.get("description"), client.get("dhcpHostname"), client.get("mdnsName"), client.get("name")):
        if _norm(name):
            keys.append(f"name:{_norm(name)}")
    for key in keys:
        hit = index.get(key)
        if hit:
            return hit
    return None


def occupied_switch_ports(
    nodes: dict[str, TopologyNode],
    links: list[TopologyLink],
) -> dict[tuple[str, str], str]:
    """Map (switch_serial, port) → peer node id for existing physical adjacencies."""
    switch_ids = {node.id for node in nodes.values() if is_switch_node(node)}
    occupied: dict[tuple[str, str], str] = {}
    for link in links:
        if link.link_type == "wireless":
            continue
        method = _norm(link.discovery_method)
        if method in {"physical_downstream", "trunk_downstream", "port_access_downstream"}:
            continue
        pairs = (
            (link.source, link.target, link.source_port or {}),
            (link.target, link.source, link.target_port or {}),
        )
        for local_id, peer_id, port in pairs:
            if local_id not in switch_ids:
                continue
            port_id = canonical_port_id(str(port.get("portId") or ""))
            if not port_id or port_id.lower() in {"unknown", "down", "trunk", "wired"}:
                continue
            occupied[(local_id, port_id)] = peer_id
    return occupied


def _next_position(nodes: dict[str, TopologyNode], positions: dict[str, dict[str, float]], node_id: str) -> dict[str, float]:
    if node_id in positions:
        return positions[node_id]
    idx = len(nodes)
    return {"x": float((idx % 40) * 130), "y": float((idx // 40) * 60)}


def _ensure_client_node(
    client: dict[str, Any],
    nodes: dict[str, TopologyNode],
    network: dict[str, Any],
    positions: dict[str, dict[str, float]],
    *,
    parent_id: str | None = None,
    subtype: str = "wired",
) -> TopologyNode:
    node_id = build_client_id(client)
    existing = nodes.get(node_id)
    if existing:
        if parent_id:
            existing.metadata = {**existing.metadata, "parent_id": parent_id}
        return existing
    label = client_label(client)
    node = TopologyNode(
        id=node_id,
        type="client",
        subtype=subtype,
        label=label,
        managed=False,
        metadata={**client, "parent_id": parent_id, "source": "meraki_wired"},
        network=network,
        position=_next_position(nodes, positions, node_id),
        hostname=label,
        management_ip=str(client.get("ip") or ""),
        platform=str(client.get("manufacturer") or client.get("os") or ""),
        device_class="client",
    )
    nodes[node.id] = node
    return node


def _add_link(links: list[TopologyLink], seen: set[tuple[str, str, str]], link: TopologyLink) -> None:
    port = canonical_port_id(str((link.source_port or {}).get("portId") or ""))
    a, b = sorted((link.source, link.target))
    key = (a, b, port)
    if key in seen:
        return
    seen.add(key)
    links.append(link)


def _seen_from_links(links: list[TopologyLink]) -> set[tuple[str, str, str]]:
    seen: set[tuple[str, str, str]] = set()
    for link in links:
        port = canonical_port_id(
            str((link.source_port or {}).get("portId") or (link.target_port or {}).get("portId") or "")
        )
        a, b = sorted((link.source, link.target))
        seen.add((a, b, port))
    return seen


def _pair_linked(seen: set[tuple[str, str, str]], a: str, b: str) -> bool:
    for src, tgt, _port in seen:
        if {src, tgt} == {a, b}:
            return True
    return False


def _pick_physical_identity(clients: list[dict[str, Any]], port_id: str) -> tuple[str, str, str]:
    """Return (label, subtype, device_class) for the chassis on this port."""
    named = [c for c in clients if client_label(c)]
    servers = [c for c in named if looks_like_server(client_label(c)) and not looks_like_vm(client_label(c))]
    if servers:
        best = max(servers, key=lambda c: len(client_label(c)))
        return (client_label(best), "server", "server")
    physical = [c for c in named if not looks_like_vm(client_label(c))]
    if len(physical) == 1:
        label = client_label(physical[0])
        cls = "server" if looks_like_server(label) else "unmanaged"
        return (label, "server" if cls == "server" else "physical_peer", cls)
    return (f"Unknown downstream device – Port {port_id}", "unknown_downstream", "unknown")


def _port_maps(
    serial: str,
    port_id: str,
    ports_by_serial: dict[str, dict[str, Any]],
    status_by_serial: dict[str, dict[str, Any]],
    port_map_get: Callable[..., Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    cfg: dict[str, Any] = {}
    sta: dict[str, Any] = {}
    for variant in (port_id, f"port{port_id}", canonical_port_id(port_id)):
        found = port_map_get(ports_by_serial.get(serial), variant)
        if isinstance(found, dict) and found:
            cfg = dict(found)
            break
    for variant in (port_id, f"port{port_id}", canonical_port_id(port_id)):
        found = port_map_get(status_by_serial.get(serial), variant)
        if isinstance(found, dict) and found:
            sta = dict(found)
            break
    return cfg, sta


def _attach_downstream(
    owner: TopologyNode,
    clients: list[dict[str, Any]],
    nodes: dict[str, TopologyNode],
    links: list[TopologyLink],
    seen: set[tuple[str, str, str]],
    network: dict[str, Any],
    positions: dict[str, dict[str, float]],
) -> None:
    for client in clients:
        child = _ensure_client_node(client, nodes, network, positions, parent_id=owner.id)
        if _pair_linked(seen, owner.id, child.id):
            continue
        _add_link(
            links,
            seen,
            TopologyLink(
                id=f"downstream-{owner.id}-{child.id}",
                source=owner.id,
                target=child.id,
                source_port={},
                target_port={},
                link_type="wired",
                discovery_method="physical_downstream",
                last_seen=datetime.now(timezone.utc),
            ),
        )


def apply_physical_port_attachments(
    *,
    nodes: dict[str, TopologyNode],
    links: list[TopologyLink],
    wired_grouped: dict[tuple[str, str], list[dict[str, Any]]],
    ports_by_serial: dict[str, dict[str, Any]],
    status_by_serial: dict[str, dict[str, Any]],
    network: dict[str, Any],
    positions: dict[str, dict[str, float]] | None = None,
    port_map_get: Callable[..., Any] | None = None,
) -> tuple[dict[str, TopologyNode], list[TopologyLink], list[dict[str, Any]], dict[str, Any]]:
    """Identify the physical device on each switch port; hang extra MACs behind it."""
    positions = positions or {}
    port_map_get = port_map_get or (lambda mapping, key: (mapping or {}).get(str(key)))
    meraki_index = index_managed_devices(nodes)
    occupied = occupied_switch_ports(nodes, links)
    seen = _seen_from_links(links)
    peer_hints: list[dict[str, Any]] = []
    debug: dict[str, Any] = {
        "wired_port_groups": len(wired_grouped),
        "managed_on_port": 0,
        "occupied_infra": 0,
        "direct_leaves": 0,
        "physical_peers": 0,
        "unknown_downstream": 0,
        "skipped_wireless_duplicates": 0,
    }

    for (switch_serial, port_id), clients in wired_grouped.items():
        switch = nodes.get(switch_serial)
        if not switch:
            continue
        port_key = canonical_port_id(port_id)
        cfg, sta = _port_maps(switch_serial, port_key, ports_by_serial, status_by_serial, port_map_get)

        unique: dict[str, dict[str, Any]] = {}
        for client in clients:
            cid = str(client.get("id") or client.get("mac") or "")
            if cid and cid not in unique:
                unique[cid] = client
        remaining: list[dict[str, Any]] = []
        managed_owner: TopologyNode | None = None
        for client in unique.values():
            managed = resolve_managed_device(client, meraki_index)
            if managed:
                managed_owner = managed
                continue
            remaining.append(client)

        owner_id = occupied.get((switch_serial, port_key))
        owner = nodes.get(owner_id) if owner_id else None
        if managed_owner:
            owner = managed_owner
            debug["managed_on_port"] = int(debug["managed_on_port"]) + 1
            if not _pair_linked(seen, switch.id, owner.id):
                _add_link(
                    links,
                    seen,
                    TopologyLink(
                        id=f"phys-{switch_serial}-{port_key}-{owner.id}",
                        source=switch.id,
                        target=owner.id,
                        source_port={
                            "serial": switch_serial,
                            "portId": port_key,
                            "config": cfg,
                            "status": sta,
                        },
                        target_port={"serial": owner.id, "portId": "uplink"},
                        link_type="wired",
                        discovery_method="physical_attachment",
                        last_seen=datetime.now(timezone.utc),
                    ),
                )
                occupied[(switch_serial, port_key)] = owner.id
            peer_hints.append(
                {
                    "serial": switch_serial,
                    "port": port_key,
                    "peer_id": owner.id,
                    "peer_label": owner.label,
                    "kind": "managed_device",
                }
            )
            if remaining:
                _attach_downstream(owner, remaining, nodes, links, seen, network, positions)
            continue

        if owner and is_infra_node(owner):
            debug["occupied_infra"] = int(debug["occupied_infra"]) + 1
            peer_hints.append(
                {
                    "serial": switch_serial,
                    "port": port_key,
                    "peer_id": owner.id,
                    "peer_label": owner.label,
                    "kind": "lldp_owner",
                }
            )
            if remaining:
                _attach_downstream(owner, remaining, nodes, links, seen, network, positions)
            continue

        if not remaining:
            continue

        if len(remaining) == 1:
            debug["direct_leaves"] = int(debug["direct_leaves"]) + 1
            client = remaining[0]
            child = _ensure_client_node(client, nodes, network, positions, parent_id=switch.id)
            if looks_like_server(child.label):
                child.subtype = "server"
                child.type = "neighbor"
                child.device_class = "server"
            _add_link(
                links,
                seen,
                TopologyLink(
                    id=f"phys-{switch_serial}-{port_key}-{child.id}",
                    source=switch.id,
                    target=child.id,
                    source_port={
                        "serial": switch_serial,
                        "portId": port_key,
                        "config": cfg,
                        "status": sta,
                    },
                    target_port={},
                    link_type="wired",
                    discovery_method="physical_attachment",
                    last_seen=datetime.now(timezone.utc),
                ),
            )
            peer_hints.append(
                {
                    "serial": switch_serial,
                    "port": port_key,
                    "peer_id": child.id,
                    "peer_label": child.label,
                    "kind": "direct_leaf",
                }
            )
            continue

        label, subtype, device_class = _pick_physical_identity(remaining, port_key)
        peer_id = f"physical-{switch_serial}-{port_key}"
        if peer_id not in nodes:
            nodes[peer_id] = TopologyNode(
                id=peer_id,
                type="neighbor",
                subtype=subtype,
                label=label,
                managed=False,
                metadata={
                    "role": "physical_peer",
                    "switch_serial": switch_serial,
                    "port_id": port_key,
                    "port_config": cfg,
                    "port_status": sta,
                    "client_count": len(remaining),
                    "meraki_clients": remaining,
                },
                network=network,
                position=_next_position(nodes, positions, peer_id),
                hostname=label,
                device_class=device_class,
            )
        peer = nodes[peer_id]
        debug_key = "unknown_downstream" if subtype == "unknown_downstream" else "physical_peers"
        debug[debug_key] = int(debug[debug_key]) + 1
        _add_link(
            links,
            seen,
            TopologyLink(
                id=f"phys-{switch_serial}-{port_key}",
                source=switch.id,
                target=peer.id,
                source_port={
                    "serial": switch_serial,
                    "portId": port_key,
                    "config": cfg,
                    "status": sta,
                },
                target_port={"serial": peer.id, "portId": "uplink"},
                link_type="wired",
                discovery_method="physical_attachment",
                last_seen=datetime.now(timezone.utc),
            ),
        )
        peer_hints.append(
            {
                "serial": switch_serial,
                "port": port_key,
                "peer_id": peer.id,
                "peer_label": peer.label,
                "kind": subtype,
            }
        )
        _attach_downstream(peer, remaining, nodes, links, seen, network, positions)

    return nodes, links, peer_hints, debug


def prune_orphan_nodes(
    nodes: dict[str, TopologyNode],
    links: list[TopologyLink],
) -> tuple[dict[str, TopologyNode], list[TopologyLink]]:
    connected: set[str] = set()
    for link in links:
        connected.add(link.source)
        connected.add(link.target)
    keep: dict[str, TopologyNode] = {}
    for node_id, node in nodes.items():
        if node.managed or node.type in {"meraki", "neighbor"}:
            if node.managed or node_id in connected:
                keep[node_id] = node
            continue
        if node_id in connected:
            keep[node_id] = node
    kept_ids = set(keep)
    links = [link for link in links if link.source in kept_ids and link.target in kept_ids]
    return keep, links


def apply_entity_merges(
    nodes: dict[str, TopologyNode],
    links: list[TopologyLink],
    merges: list[dict[str, Any]],
) -> tuple[dict[str, TopologyNode], list[TopologyLink]]:
    """Collapse multiple chassis nodes into one persisted physical entity."""
    for merge in merges:
        survivor_id = str(merge.get("survivor_id") or "")
        member_ids = [str(item) for item in (merge.get("member_ids") or []) if str(item) and str(item) != survivor_id]
        if not survivor_id or survivor_id not in nodes or not member_ids:
            continue
        if any(member not in nodes for member in member_ids):
            continue
        survivor = nodes[survivor_id]
        interfaces = list(merge.get("interfaces") or [])
        label = str(merge.get("label") or survivor.label)
        survivor.label = label
        survivor.hostname = label
        survivor.device_class = str(merge.get("device_class") or survivor.device_class or "server")
        survivor.subtype = "server" if survivor.device_class == "server" else survivor.subtype
        if survivor.type == "client":
            survivor.type = "neighbor"
        extra = dict(survivor.metadata or {})
        extra["merged"] = True
        extra["merged_from"] = member_ids
        extra["physical_interfaces"] = interfaces
        extra["parent_id"] = extra.get("parent_id")
        survivor.metadata = extra

        role_by_port: dict[tuple[str, str], str] = {}
        for iface in interfaces:
            serial = str(iface.get("switch_serial") or "")
            port_id = canonical_port_id(str(iface.get("port_id") or ""))
            role = str(iface.get("role") or "")
            if port_id and role:
                role_by_port[(serial, port_id)] = role

        member_set = set(member_ids)
        rewritten: list[TopologyLink] = []
        seen: set[tuple[str, str, str]] = set()
        for link in links:
            source = survivor_id if link.source in member_set else link.source
            target = survivor_id if link.target in member_set else link.target
            if source == target:
                continue
            src_port = dict(link.source_port or {})
            tgt_port = dict(link.target_port or {})
            role = link.interface_role
            for port_blob in (src_port, tgt_port):
                serial = str(port_blob.get("serial") or "")
                port_id = canonical_port_id(str(port_blob.get("portId") or ""))
                found = role_by_port.get((serial, port_id)) or role_by_port.get(("", port_id))
                if found:
                    role = found
                    if port_blob is src_port:
                        src_port = {**src_port, "role": found, "label": found}
                    else:
                        tgt_port = {**tgt_port, "label": found, "role": found}
            port_key = canonical_port_id(str(src_port.get("portId") or tgt_port.get("portId") or ""))
            a, b = sorted((source, target))
            key = (a, b, port_key)
            if key in seen:
                continue
            seen.add(key)
            rewritten.append(
                link.model_copy(
                    update={
                        "id": f"{source}__{target}__{port_key or link.id}",
                        "source": source,
                        "target": target,
                        "source_port": src_port,
                        "target_port": tgt_port,
                        "interface_role": role,
                    }
                )
            )
        for node_id in member_ids:
            nodes.pop(node_id, None)
        for node in nodes.values():
            parent = str((node.metadata or {}).get("parent_id") or "")
            if parent in member_set:
                node.metadata = {**node.metadata, "parent_id": survivor_id}
        nodes[survivor_id] = survivor
        links = rewritten
    return nodes, links
