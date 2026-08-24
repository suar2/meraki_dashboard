"""Expected live lab adjacencies used as a regression fixture.

Names follow the home-lab inventory (FW-01, MS130, MR36, Main - camera).
When a named device is absent from a graph the check is skipped rather than failed.
"""

from __future__ import annotations

from typing import Any

from app.models.schemas import TopologyGraph

LAB_EDGES: list[dict[str, str]] = [
    {"left": "FW-01", "right": "MS130", "port": "1", "id": "fw-ms"},
    {"left": "MS130", "right": "MR36", "port": "2", "id": "ms-mr"},
    {"left": "MS130", "right": "Main - camera", "port": "8", "id": "ms-mv"},
    {"left": "MS130", "right": "NAS", "port": "7", "id": "ms-nas"},
    {"left": "MS130", "right": "Pi4", "port": "5", "id": "ms-pi"},
    {"left": "MS130", "right": "SERVER", "port": "4", "id": "ms-server-mgmt"},
    {"left": "MS130", "right": "SERVER", "port": "14", "id": "ms-server-fabric"},
]

SAMPLE_ALIASES = {
    "FW-01": ("MX-EDGE", "FW-01"),
    "MS130": ("MS-MAIN", "MS130"),
    "MR36": ("MR36 AP", "MR36"),
    "Main - camera": ("Main - camera",),
    "NAS": ("NAS",),
    "Pi4": ("Pi4",),
    "SERVER": ("Server", "SERVER"),
}


def _aliases(name: str) -> tuple[str, ...]:
    return SAMPLE_ALIASES.get(name, (name,))


def _canonical_port(value: Any) -> str:
    text = str(value or "").strip()
    if text.isdigit():
        return str(int(text))
    low = text.lower()
    if low.startswith("port") and low[4:].isdigit():
        return str(int(low[4:]))
    return text


def _index_nodes(graph: TopologyGraph) -> dict[str, str]:
    by_label: dict[str, str] = {}
    for node in graph.nodes:
        for key in (node.id, node.label, node.hostname, node.serial, str((node.metadata or {}).get("name") or "")):
            if key:
                by_label[str(key).strip().lower()] = node.id
    return by_label


def _find(index: dict[str, str], name: str) -> str | None:
    for alias in _aliases(name):
        hit = index.get(alias.lower())
        if hit:
            return hit
    return None


def _ports_between(graph: TopologyGraph, left_id: str, right_id: str) -> set[str]:
    ports: set[str] = set()
    pair = {left_id, right_id}
    for link in graph.links:
        if link.link_type == "wireless":
            continue
        if {link.source, link.target} != pair:
            continue
        ports.add(_canonical_port((link.source_port or {}).get("portId") or link.source_interface))
        ports.add(_canonical_port((link.target_port or {}).get("portId") or link.target_interface))
    return {p for p in ports if p}


def validate_expectations(graph: TopologyGraph, edges: list[dict[str, str]] | None = None) -> dict[str, Any]:
    checks = edges or LAB_EDGES
    index = _index_nodes(graph)
    results: list[dict[str, Any]] = []
    applicable = 0
    passed = 0
    for spec in checks:
        left = _find(index, spec["left"])
        right = _find(index, spec["right"])
        if not left or not right:
            results.append({**spec, "status": "skipped", "reason": "device not in graph"})
            continue
        applicable += 1
        want = _canonical_port(spec.get("port"))
        have = _ports_between(graph, left, right)
        ok = want in have if want else bool(have)
        if ok:
            passed += 1
        results.append(
            {
                **spec,
                "status": "pass" if ok else "fail",
                "left_id": left,
                "right_id": right,
                "observed_ports": sorted(have),
            }
        )
    wifi_parents = {link.source for link in graph.links if link.link_type == "wireless"}
    ap_ids = [n.id for n in graph.nodes if str(n.device_class) == "ap" or n.subtype in {"access_point", "ap"}]
    wifi_ok = not wifi_parents or wifi_parents <= set(ap_ids)
    return {
        "applicable": applicable,
        "passed": passed,
        "failed": applicable - passed,
        "ok": applicable == 0 or passed == applicable,
        "wireless_under_ap": wifi_ok,
        "checks": results,
    }
