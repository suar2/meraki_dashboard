"""Topology confidence and identity diagnostics."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.models.schemas import TopologyGraph, TopologyLink
from app.services.identity import looks_like_mac, physical_port_id
from app.services.physical_topology import detect_duplicate_chassis


def _specific_ports(link: TopologyLink) -> dict[str, str]:
    ports: dict[str, str] = {}
    for node_id, blob in ((link.source, link.source_port or {}), (link.target, link.target_port or {})):
        pid = physical_port_id((blob or {}).get("portId"))
        if node_id and pid:
            ports[node_id] = pid
    return ports


def _ports_conflict(left: dict[str, str], right: dict[str, str]) -> bool:
    for node_id, port in left.items():
        other = right.get(node_id)
        if other and other != port:
            return True
    return False


def _duplicate_physical_edges(links: list[TopologyLink]) -> tuple[int, list[dict[str, Any]]]:
    groups: dict[tuple[str, str], list[TopologyLink]] = defaultdict(list)
    for link in links:
        if link.link_type not in {"wired", "discovered_partial"}:
            continue
        if str(link.discovery_method or "") == "physical_downstream":
            continue
        pair = tuple(sorted((link.source, link.target)))
        groups[(pair[0], pair[1])].append(link)
    extras = 0
    details: list[dict[str, Any]] = []
    for pair, group in groups.items():
        clusters: list[list[TopologyLink]] = []
        for link in group:
            ports = _specific_ports(link)
            placed = False
            for cluster in clusters:
                cports: dict[str, str] = {}
                for item in cluster:
                    cports.update(_specific_ports(item))
                if _ports_conflict(ports, cports):
                    continue
                cluster.append(link)
                placed = True
                break
            if not placed:
                clusters.append([link])
        for cluster in clusters:
            if len(cluster) > 1:
                extras += len(cluster) - 1
                details.append(
                    {
                        "pair": [pair[0], pair[1]],
                        "count": len(cluster),
                        "ids": [item.id for item in cluster],
                    }
                )
    return extras, details


def _unresolved_identity(graph: TopologyGraph) -> tuple[int, list[dict[str, str]]]:
    items: list[dict[str, str]] = []
    for node in graph.nodes:
        label = str(node.hostname or node.label or "").strip()
        if node.managed and node.type == "meraki" and not looks_like_mac(label):
            continue
        weak = looks_like_mac(label) or label.lower().startswith("unknown downstream") or label.lower().startswith(
            "discovered neighbor"
        )
        if weak:
            items.append({"id": node.id, "label": label})
    return len(items), items


def compute_diagnostics(graph: TopologyGraph) -> dict[str, Any]:
    wired = [link for link in graph.links if link.link_type in {"wired", "discovered_partial"}]
    conf_counts = {"high": 0, "medium": 0, "low": 0, "unknown": 0}
    for link in wired:
        key = str(link.confidence or "unknown").lower()
        if key not in conf_counts:
            key = "unknown"
        conf_counts[key] += 1

    macs: dict[str, list[str]] = defaultdict(list)
    serials: dict[str, list[str]] = defaultdict(list)
    for node in graph.nodes:
        mac = str((node.metadata or {}).get("mac") or (node.metadata or {}).get("macAddress") or "").strip().lower()
        if mac:
            macs[mac].append(node.id)
        serial = str(node.serial or "").strip().lower()
        if serial:
            serials[serial].append(node.id)
    duplicates = []
    for key, ids in {**{f"mac:{k}": v for k, v in macs.items()}, **{f"serial:{k}": v for k, v in serials.items()}}.items():
        unique = sorted(set(ids))
        if len(unique) > 1:
            duplicates.append({"key": key, "node_ids": unique})

    linked = {link.source for link in graph.links} | {link.target for link in graph.links}
    orphans = [
        {"id": node.id, "label": node.hostname or node.label}
        for node in graph.nodes
        if node.id not in linked and not (node.metadata or {}).get("topologyRoot") and node.subtype != "firewall"
    ]
    unresolved = list((graph.topology_debug or {}).get("unresolved_nodes") or [])
    node_map = {node.id: node for node in graph.nodes}
    chassis_candidates = detect_duplicate_chassis(node_map, list(graph.links))
    dup_edges, dup_edge_details = _duplicate_physical_edges(list(graph.links))
    unresolved_identity, unresolved_identity_ids = _unresolved_identity(graph)
    return {
        "physical_edges": len(wired),
        "wireless_edges": len([link for link in graph.links if link.link_type == "wireless"]),
        "high_confidence": conf_counts["high"],
        "medium_confidence": conf_counts["medium"],
        "low_confidence": conf_counts["low"],
        "unknown_confidence": conf_counts["unknown"],
        "unresolved_nodes": len(unresolved),
        "duplicate_identities": len(duplicates),
        "duplicate_chassis_candidates": len(chassis_candidates),
        "duplicate_physical_edges": dup_edges,
        "unresolved_identity_count": unresolved_identity,
        "orphans": len(orphans),
        "total_nodes": len(graph.nodes),
        "managed_nodes": len([n for n in graph.nodes if n.managed]),
        "duplicates": duplicates,
        "orphan_ids": [item["id"] for item in orphans],
        "duplicate_chassis": chassis_candidates,
        "duplicate_physical_edge_groups": dup_edge_details,
        "unresolved_identities": unresolved_identity_ids,
    }
