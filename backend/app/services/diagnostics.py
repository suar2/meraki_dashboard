"""Topology confidence and identity diagnostics."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.models.schemas import TopologyGraph


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
    return {
        "physical_edges": len(wired),
        "wireless_edges": len([link for link in graph.links if link.link_type == "wireless"]),
        "high_confidence": conf_counts["high"],
        "medium_confidence": conf_counts["medium"],
        "low_confidence": conf_counts["low"],
        "unknown_confidence": conf_counts["unknown"],
        "unresolved_nodes": len(unresolved),
        "duplicate_identities": len(duplicates),
        "orphans": len(orphans),
        "total_nodes": len(graph.nodes),
        "managed_nodes": len([n for n in graph.nodes if n.managed]),
        "duplicates": duplicates,
        "orphan_ids": [item["id"] for item in orphans],
    }
