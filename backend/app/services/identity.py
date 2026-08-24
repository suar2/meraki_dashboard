"""Resolve Meraki identities: serial first, then MAC, then topology derivedId / LLDP/CDP."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

_MAC_HEX = re.compile(r"[^0-9a-f]")
_IPV4 = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")
GENERIC_PORTS = frozenset({"", "unknown", "uplink", "wired", "down", "none", "n/a", "null", "ethernet"})


def normalize_mac(value: Any) -> str:
    raw = _MAC_HEX.sub("", str(value or "").strip().lower())
    if len(raw) != 12:
        return ""
    return ":".join(raw[i : i + 2] for i in range(0, 12, 2))


def is_derived_id(value: Any) -> bool:
    text = str(value or "").strip()
    return bool(text) and text.isdigit() and len(text) >= 8


def _norm(value: Any) -> str:
    return str(value or "").strip().lower()


def _first(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text and text.lower() not in {"none", "unknown", "null"}:
            return text
    return ""


@dataclass
class IdentityHit:
    node_id: str
    method: str
    evidence: dict[str, Any] = field(default_factory=dict)


class ManagedInventory:
    """Indexes managed Meraki equipment so clients/LLDP never spawn duplicates."""

    def __init__(self, devices: list[dict[str, Any]] | None = None) -> None:
        self.by_serial: dict[str, dict[str, Any]] = {}
        self.by_mac: dict[str, dict[str, Any]] = {}
        self.by_name: dict[str, dict[str, Any]] = {}
        self.by_lan_ip: dict[str, dict[str, Any]] = {}
        self.by_derived_id: dict[str, dict[str, Any]] = {}
        for device in devices or []:
            self.add_device(device)

    def add_device(self, device: dict[str, Any]) -> None:
        serial = str(device.get("serial") or "").strip()
        if not serial:
            return
        self.by_serial[serial] = device
        self.by_serial[_norm(serial)] = device
        for mac in (device.get("mac"), device.get("macAddress"), device.get("lanMac"), device.get("wan1Mac")):
            self.index_mac(mac, device)
        for name in (device.get("name"), device.get("hostname"), device.get("serial")):
            key = _norm(name)
            if key:
                self.by_name[key] = device
            tail = str(name or "").split(" - ")[-1].strip()
            if _norm(tail):
                self.by_name[_norm(tail)] = device
        for ip in (device.get("lanIp"), device.get("wan1Ip"), device.get("wan2Ip"), device.get("ip")):
            key = _norm(ip)
            if key:
                self.by_lan_ip[key] = device

    def index_mac(self, mac: Any, device: dict[str, Any]) -> None:
        key = normalize_mac(mac)
        if key:
            self.by_mac[key] = device

    def bind_link_layer_nodes(self, topology: dict[str, Any]) -> dict[str, dict[str, Any]]:
        """Index topology.nodes first; bind derivedId/MAC onto managed serials."""
        indexed = index_link_layer_nodes(topology)
        for derived, raw in indexed.items():
            device = topology_node_device(raw)
            serial = str(device.get("serial") or "").strip()
            mac = normalize_mac(raw.get("mac") or device.get("mac"))
            discovered = raw.get("discovered") if isinstance(raw.get("discovered"), dict) else {}
            lldp = discovered.get("lldp") if isinstance(discovered.get("lldp"), dict) else {}
            name = device.get("name") or lldp.get("systemName")
            if serial and serial not in self.by_serial:
                synth = {**device, "mac": mac or device.get("mac"), "name": name or device.get("name")}
                self.add_device(synth)
            target = self.by_serial.get(serial) if serial else None
            if target is None:
                hit = self.resolve(mac=mac, name=name, ip=device.get("lanIp"), derived_id=derived)
                target = self.by_serial.get(hit.node_id) if hit else None
            if target is None:
                continue
            self.bind_derived_id(derived, target)
            if mac:
                self.index_mac(mac, target)
            if name:
                self.by_name[_norm(name)] = target
                tail = str(name).split(" - ")[-1].strip()
                if _norm(tail):
                    self.by_name[_norm(tail)] = target
        return indexed

    def bind_derived_id(self, derived_id: str, device: dict[str, Any]) -> None:
        if derived_id:
            self.by_derived_id[str(derived_id)] = device

    def resolve(
        self,
        *,
        serial: Any = None,
        mac: Any = None,
        name: Any = None,
        ip: Any = None,
        derived_id: Any = None,
    ) -> IdentityHit | None:
        serial_key = str(serial or "").strip()
        if serial_key and serial_key in self.by_serial:
            device = self.by_serial[serial_key]
            return IdentityHit(str(device.get("serial")), "serial_match", {"serial": serial_key})
        mac_key = normalize_mac(mac)
        if mac_key and mac_key in self.by_mac:
            device = self.by_mac[mac_key]
            return IdentityHit(str(device.get("serial")), "mac_match", {"mac": mac_key})
        derived = str(derived_id or "").strip()
        if derived and derived in self.by_derived_id:
            device = self.by_derived_id[derived]
            return IdentityHit(str(device.get("serial")), "topology_derivedId", {"derivedId": derived})
        name_key = _norm(name)
        if name_key and name_key in self.by_name:
            device = self.by_name[name_key]
            return IdentityHit(str(device.get("serial")), "name_match", {"name": name})
        if name_key:
            tail = name_key.split(" - ")[-1].strip()
            if tail and tail in self.by_name:
                device = self.by_name[tail]
                return IdentityHit(str(device.get("serial")), "name_match", {"name": name})
            compact = name_key.replace(" ", "").replace("-", "")
            for key, device in self.by_name.items():
                if key.replace(" ", "").replace("-", "") == compact and compact:
                    return IdentityHit(str(device.get("serial")), "name_match", {"name": name})
            model = str(name or "")
            if model.upper().startswith("MV") or "camera" in name_key:
                for device in self.by_serial.values():
                    dmodel = str(device.get("model") or "").upper()
                    dproduct = str(device.get("productType") or "").lower()
                    if dmodel.startswith("MV") or dproduct == "camera":
                        if _norm(device.get("name")) in name_key or name_key in _norm(device.get("name")):
                            return IdentityHit(str(device.get("serial")), "name_match", {"name": name})
        ip_key = _norm(ip)
        if ip_key and ip_key in self.by_lan_ip:
            device = self.by_lan_ip[ip_key]
            return IdentityHit(str(device.get("serial")), "lan_ip_match", {"ip": ip})
        return None

    def resolve_client(self, client: dict[str, Any]) -> IdentityHit | None:
        return self.resolve(
            serial=client.get("serial"),
            mac=client.get("mac") or client.get("macAddress"),
            name=client.get("description") or client.get("name") or client.get("dhcpHostname"),
            ip=client.get("ip") or client.get("ipAddress"),
        )

    def resolve_lldp(self, port_data: dict[str, Any]) -> IdentityHit | None:
        lldp = port_data.get("lldp") if isinstance(port_data.get("lldp"), dict) else {}
        cdp = port_data.get("cdp") if isinstance(port_data.get("cdp"), dict) else {}
        hit = self.resolve(
            serial=port_data.get("serial"),
            mac=port_data.get("deviceMac") or lldp.get("chassisId") or cdp.get("deviceId"),
            name=lldp.get("systemName") or cdp.get("deviceId") or cdp.get("platform"),
        )
        if hit:
            evidence = dict(hit.evidence)
            if port_data.get("deviceMac"):
                evidence["deviceMac"] = normalize_mac(port_data.get("deviceMac"))
                if hit.method == "mac_match":
                    hit.method = "lldp_deviceMac"
            if lldp.get("chassisId"):
                evidence["lldp_chassisId"] = lldp.get("chassisId")
            if lldp.get("systemName"):
                evidence["lldp_systemName"] = lldp.get("systemName")
            if cdp.get("deviceId"):
                evidence["cdp_deviceId"] = cdp.get("deviceId")
            hit.evidence = evidence
        return hit


def looks_like_mac(value: Any) -> bool:
    if isinstance(value, dict):
        return False
    text = str(value or "").strip()
    if not text:
        return False
    if normalize_mac(text):
        return True
    compact = _MAC_HEX.sub("", text.lower())
    return len(compact) == 12 and all(ch in "0123456789abcdef" for ch in compact)


def looks_like_ip(value: Any) -> bool:
    text = str(value or "").strip()
    return bool(_IPV4.match(text))


def canonical_port_id(port_id: Any) -> str:
    text = str(port_id or "").strip()
    if not text:
        return text
    low = text.lower()
    if low.startswith("port") and low[4:].isdigit():
        return str(int(low[4:]))
    if text.isdigit():
        return str(int(text))
    return text


def is_generic_port(port_id: Any) -> bool:
    pid = canonical_port_id(port_id)
    return (not pid) or pid.lower() in GENERIC_PORTS


def physical_port_id(port_id: Any) -> str:
    """Canonical port id, empty when the value is not a real interface identity."""
    pid = canonical_port_id(port_id)
    return "" if is_generic_port(pid) else pid


def normalize_hostname(value: Any) -> str:
    """Stable chassis hostname key: domain stripped, Meraki prefix stripped, alnum only."""
    text = str(value or "").strip().lower()
    if not text or looks_like_mac(text) or looks_like_ip(text):
        return ""
    if text.startswith("unknown downstream"):
        return ""
    if " - " in text:
        text = text.split(" - ")[-1].strip()
    if "." in text and not looks_like_ip(text):
        text = text.split(".")[0]
    return re.sub(r"[^a-z0-9]+", "", text)


def _flatten_name_candidate(value: Any) -> list[Any]:
    if isinstance(value, dict):
        device = topology_node_device(value)
        discovered = value.get("discovered") if isinstance(value.get("discovered"), dict) else {}
        lldp = discovered.get("lldp") if isinstance(discovered.get("lldp"), dict) else {}
        if not lldp and isinstance(value.get("lldp"), dict):
            lldp = value.get("lldp") or {}
        cdp = discovered.get("cdp") if isinstance(discovered.get("cdp"), dict) else {}
        if not cdp and isinstance(value.get("cdp"), dict):
            cdp = value.get("cdp") or {}
        return [
            device.get("name"),
            lldp.get("systemName"),
            cdp.get("deviceId"),
            cdp.get("platform"),
            value.get("description"),
            value.get("dhcpHostname"),
            value.get("mdnsName"),
            value.get("deviceTypePrediction"),
            value.get("ip") or value.get("ipAddress") or device.get("lanIp"),
            value.get("mac") or device.get("mac") or lldp.get("chassisId"),
        ]
    return [value]


def best_identity_name(*candidates: Any) -> str:
    """Resolve a visible name. Raw MAC is the last fallback.

    Order: managed/LLDP/CDP/description/DHCP/mDNS/deviceTypePrediction, then IP, then MAC.
    """
    skipped_ip: list[str] = []
    skipped_mac: list[str] = []
    for candidate in candidates:
        for value in _flatten_name_candidate(candidate):
            text = _first(value)
            if not text or is_derived_id(text) or (text.isdigit() and len(text) >= 6):
                continue
            if looks_like_mac(text):
                skipped_mac.append(normalize_mac(text) or text)
                continue
            if looks_like_ip(text):
                skipped_ip.append(text)
                continue
            if text.lower() in {"client", "unknown", "unnamed"}:
                continue
            return text
    if skipped_ip:
        return skipped_ip[0]
    if skipped_mac:
        return skipped_mac[0]
    return ""


def human_label(*candidates: Any) -> str:
    """Never return a numeric topology derivedId as a visible hostname."""
    return best_identity_name(*candidates)


def unmanaged_node_id(*, mac: Any = None, label: Any = None, derived_id: Any = None) -> str:
    """Stable neighbor id. Never use a raw numeric derivedId as the node id."""
    mac_key = normalize_mac(mac)
    if mac_key:
        return f"neighbor-{mac_key.replace(':', '')}"
    text = human_label(label)
    if text:
        slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in text).strip("-")
        slug = "-".join(part for part in slug.split("-") if part)[:48]
        if slug and not is_derived_id(slug):
            return f"neighbor-{slug}"
    tail = str(derived_id or "host")[-6:]
    return f"neighbor-discovered-{tail}"


def extract_end_derived_id(end: dict[str, Any]) -> str:
    node = end.get("node") if isinstance(end.get("node"), dict) else {}
    return str(end.get("derivedId") or node.get("derivedId") or "").strip()


def extract_end_port(end: dict[str, Any]) -> str:
    discovered = end.get("discovered") if isinstance(end.get("discovered"), dict) else {}
    port = end.get("port") if isinstance(end.get("port"), dict) else {}
    lldp = discovered.get("lldp") if isinstance(discovered.get("lldp"), dict) else {}
    cdp = discovered.get("cdp") if isinstance(discovered.get("cdp"), dict) else {}
    return _first(
        discovered.get("port"),
        port.get("portId"),
        port.get("name"),
        lldp.get("portId"),
        cdp.get("portId"),
        cdp.get("portIdFormatted"),
        end.get("portId"),
    )


def is_wireless_client(client: dict[str, Any], ap_serials: set[str] | None = None) -> bool:
    connection = str(
        client.get("recentDeviceConnection") or client.get("connection") or client.get("Connection") or ""
    ).lower()
    if connection == "wireless" or "wifi" in connection or "wi-fi" in connection:
        return True
    ssid = str(client.get("ssid") or "").strip()
    serial = str(client.get("recentDeviceSerial") or "").strip()
    if ssid and (not ap_serials or serial in ap_serials):
        return True
    return False


def hierarchy_rank(subtype: str, *, topology_root: bool = False, device_class: str = "") -> int:
    if topology_root:
        return -1
    key = str(subtype or "").lower()
    cls = str(device_class or "").lower()
    if key in {"firewall"} or cls == "mx":
        return 0
    if key in {"switch", "core_switch", "access_switch"} or cls in {"core", "access"}:
        return 1
    if key in {"access_point", "ap", "camera", "cellular", "gateway"} or cls in {"ap", "mv", "mg"}:
        return 2
    if key in {"server", "physical_peer", "unknown_downstream"} or cls == "server":
        return 3
    if key in {"client", "wireless", "wired"} or cls == "client":
        return 4
    return 3


def topology_node_device(raw: dict[str, Any]) -> dict[str, Any]:
    device = raw.get("device")
    return device if isinstance(device, dict) else {}


def index_link_layer_nodes(topology: dict[str, Any]) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for raw in topology.get("nodes") or []:
        if not isinstance(raw, dict):
            continue
        derived = str(raw.get("derivedId") or "").strip()
        if derived:
            indexed[derived] = raw
    return indexed


def resolve_link_end(
    end: dict[str, Any],
    inventory: ManagedInventory,
    topology_by_derived_id: dict[str, dict[str, Any]],
) -> tuple[IdentityHit | None, dict[str, Any], dict[str, Any]]:
    """Return (hit, topology_node, discovered) for one linkLayer end."""
    node = end.get("node") if isinstance(end.get("node"), dict) else {}
    discovered = end.get("discovered") if isinstance(end.get("discovered"), dict) else {}
    lldp = discovered.get("lldp") if isinstance(discovered.get("lldp"), dict) else {}
    cdp = discovered.get("cdp") if isinstance(discovered.get("cdp"), dict) else {}
    derived = extract_end_derived_id(end)
    topo = topology_by_derived_id.get(derived) or node or end
    device = topology_node_device(topo) or topology_node_device(node)
    hit = inventory.resolve(
        serial=device.get("serial") or end.get("serial"),
        mac=topo.get("mac")
        or node.get("mac")
        or lldp.get("chassisId")
        or discovered.get("deviceMac")
        or end.get("mac"),
        name=device.get("name") or lldp.get("systemName") or cdp.get("deviceId"),
        ip=device.get("lanIp"),
        derived_id=derived,
    )
    if hit:
        extra = dict(hit.evidence)
        if derived:
            extra["topology_derivedId"] = derived
        extra["sourcePort"] = extract_end_port(end)
        hit.evidence = extra
    return hit, topo if isinstance(topo, dict) else {}, discovered


SOURCE_RANK = {
    "topology_link_layer": 50,
    "lldp_cdp": 50,
    "device_lldp_cdp": 40,
    "lldp_cdp_inferred": 40,
    "switch_port_status": 30,
    "wired_client_switchport": 20,
    "physical_attachment": 20,
    "wireless_association": 20,
    "physical_downstream": 10,
    "inferred": 5,
}


def source_rank(link_or_method: Any) -> int:
    if isinstance(link_or_method, str):
        methods = [link_or_method]
    else:
        methods = list(getattr(link_or_method, "discovery_sources", None) or [])
        methods.append(str(getattr(link_or_method, "discovery_method", "") or ""))
    return max((SOURCE_RANK.get(m, 0) for m in methods), default=0)
