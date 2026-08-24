from __future__ import annotations

import re
from typing import Any, Literal

DeviceClass = Literal[
    "mx",
    "core",
    "access",
    "wlc",
    "ap",
    "server",
    "mv",
    "mg",
    "phone",
    "client",
    "unmanaged",
    "unknown",
]

DEVICE_CLASS_ORDER: list[DeviceClass] = [
    "mx",
    "core",
    "access",
    "wlc",
    "ap",
    "server",
    "mv",
    "mg",
    "phone",
    "client",
    "unmanaged",
    "unknown",
]

DEVICE_CLASS_LABELS: dict[DeviceClass, str] = {
    "mx": "MX Firewall",
    "core": "Core",
    "access": "Access",
    "wlc": "WLC",
    "ap": "Wireless",
    "server": "Server",
    "mv": "Camera",
    "mg": "Cellular",
    "phone": "VoIP Phone",
    "client": "Client",
    "unmanaged": "Unmanaged",
    "unknown": "Unknown",
}

# Platform rules first; Meraki product families after.
# First match wins.
_PLATFORM_RULES: list[tuple[DeviceClass, re.Pattern[str]]] = [
    ("core", re.compile(r"c9500", re.I)),
    ("wlc", re.compile(r"c9800|wireless.?lan.?controller|\bwlc\b", re.I)),
    ("ap", re.compile(r"\bc91|cw91|\bair-?\b|\bmr\d|\baccess.?point", re.I)),
    ("mx", re.compile(r"\bmx\d|security.?appliance|\bfirewall|\basa\b|\bftd\b", re.I)),
    ("mv", re.compile(r"\bmv\d|\bcamera", re.I)),
    ("mg", re.compile(r"\bmg\d|cellular|lte.?gateway", re.I)),
    ("access", re.compile(r"c1000|c2960|c9200|c9300|ie-3000|c3560|\bms\d|\bgs\d|\bswitch", re.I)),
    ("phone", re.compile(r"ip phone|cisco phone|\bsep\b", re.I)),
]


def _txt(value: Any) -> str:
    return "" if value is None else str(value).strip()


def classify_device(
    *,
    hostname: str = "",
    platform: str = "",
    product_type: str = "",
    subtype: str = "",
    node_type: str = "",
    managed: bool = True,
    is_core_switch: bool = False,
) -> DeviceClass:
    """Classify a node using platform rules, extended for Meraki families."""
    host = _txt(hostname)
    plat = _txt(platform)
    product = _txt(product_type).lower()
    sub = _txt(subtype).lower()
    ntype = _txt(node_type).lower()
    blob = " ".join(part for part in (host, plat, product, sub, ntype) if part)

    if ntype == "client" or sub == "client":
        return "client"
    if sub == "wireless" and ntype == "client":
        return "client"
    if sub in {"server"} or ntype == "server":
        return "server"
    if re.search(r"proxmox|esxi|vmware|truenas|synology|qnap|unraid|\bnas\b|\bserver\b", blob, re.I):
        if ntype != "client":
            return "server"
    if re.match(r"^SEP", host, re.I):
        return "phone"

    if sub in {"camera"} or product in {"camera"}:
        return "mv"
    if sub in {"cellular", "cellulargateway"} or product in {"cellular gateway", "cellulargateway"}:
        return "mg"
    if sub in {"firewall"} or product in {"appliance", "securityappliance"}:
        return "mx"
    if sub in {"access_point", "ap"} or product in {"wireless", "ap"}:
        if ntype != "client":
            return "ap"
    if sub in {"core_switch"} or is_core_switch:
        return "core"
    if sub in {"access_switch", "switch"}:
        return "core" if is_core_switch else "access"

    for device_class, pattern in _PLATFORM_RULES:
        if pattern.search(blob):
            if device_class == "access" and is_core_switch:
                return "core"
            return device_class

    if not managed or ntype in {"neighbor"} or sub in {"unmanaged"}:
        return "unmanaged"
    return "unknown"


def elect_core_switch_ids(nodes: list[dict[str, Any]], degree: dict[str, int]) -> set[str]:
    """Choose core switches preferring Catalyst-class platforms, generalized for MS."""
    switch_ids: list[str] = []
    forced: set[str] = set()
    for node in nodes:
        node_id = _txt(node.get("id"))
        if not node_id:
            continue
        subtype = _txt(node.get("subtype")).lower()
        product = _txt(node.get("product_type") or node.get("productType")).lower()
        platform = _txt(node.get("platform") or node.get("model"))
        label = _txt(node.get("hostname") or node.get("label") or node.get("name"))
        is_switch = (
            subtype in {"switch", "core_switch", "access_switch"}
            or product == "switch"
            or re.search(r"\bms\d|\bgs\d|c9500|c9300|c9200|catalyst", f"{platform} {label}", re.I) is not None
        )
        if not is_switch:
            continue
        switch_ids.append(node_id)
        if re.search(r"c9500|\bcore\b", f"{platform} {label}", re.I):
            forced.add(node_id)
        if subtype == "core_switch":
            forced.add(node_id)
    if forced:
        return forced
    if not switch_ids:
        return set()
    if len(switch_ids) == 1:
        return {switch_ids[0]}
    ranked = sorted(switch_ids, key=lambda i: degree.get(i, 0), reverse=True)
    top = degree.get(ranked[0], 0)
    if top <= 1:
        return {ranked[0]}
    return {i for i in ranked if degree.get(i, 0) == top}
