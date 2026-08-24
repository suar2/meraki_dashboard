"""Confidence and evidence for a physical topology edge."""

from __future__ import annotations

from typing import Any

from app.models.schemas import TopologyLink

EVIDENCE_ITEMS = (
    ("topology_link_layer", "Meraki linkLayer", ("topology_link_layer", "lldp_cdp")),
    ("lldp", "LLDP", ("device_lldp_cdp", "lldp_cdp", "lldp_cdp_inferred")),
    ("device_mac", "deviceMac match", ()),
    ("switch_port_status", "Switch port status", ("switch_port_status",)),
    ("client_history", "Client history", ("wired_client_switchport", "physical_attachment", "wireless_association")),
)


def _sources(link: TopologyLink) -> set[str]:
    return {str(s) for s in (link.discovery_sources or []) if s} | {str(link.discovery_method or "")}


def _device_mac_ok(link: TopologyLink, sources: set[str]) -> bool:
    resolution = link.identity_resolution or {}
    blob = str(resolution).lower()
    if "lldp_devicemac" in blob or "devicemac" in blob and "00:" in blob:
        return True
    if resolution.get("method") in {"lldp_deviceMac", "mac_match"}:
        return True
    nested = resolution.get("source") if isinstance(resolution.get("source"), dict) else {}
    if nested.get("method") in {"mac_match", "lldp_deviceMac"}:
        return True
    return False


def stamp_link_evidence(link: TopologyLink) -> TopologyLink:
    sources = _sources(link)
    items: list[dict[str, Any]] = []
    for key, label, methods in EVIDENCE_ITEMS:
        if key == "device_mac":
            ok = _device_mac_ok(link, sources)
        else:
            ok = any(method in sources for method in methods)
        items.append({"key": key, "label": label, "ok": ok})
    ok_keys = {item["key"] for item in items if item["ok"]}
    if "topology_link_layer" in ok_keys and ("lldp" in ok_keys or "device_mac" in ok_keys):
        confidence = "high"
        summary = "Confirmed by Meraki linkLayer and LLDP/MAC."
    elif "lldp" in ok_keys or "device_mac" in ok_keys or "switch_port_status" in ok_keys:
        confidence = "high" if "lldp" in ok_keys and "switch_port_status" in ok_keys else "medium"
        summary = "Confirmed by LLDP or switch port status."
    elif "client_history" in ok_keys:
        confidence = "medium"
        summary = "Inferred from switchport + client MAC."
    else:
        confidence = "low"
        summary = "Inferred with limited evidence."
    if link.link_type == "wireless":
        confidence = "high" if "client_history" in ok_keys else confidence
        summary = "Wireless association from the client table."
    link.confidence = confidence
    link.evidence = items
    extra = dict(link.identity_resolution or {})
    extra["confidence"] = confidence
    extra["confidence_summary"] = summary
    link.identity_resolution = extra
    return link
