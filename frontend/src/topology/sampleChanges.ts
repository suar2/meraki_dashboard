import type { TopologyChange } from "../types/topology";

export function sampleChanges(now = Date.now()): TopologyChange[] {
  const iso = (offsetHours: number) => new Date(now - offsetHours * 3600 * 1000).toISOString();
  return [
    {
      id: "c1",
      at: iso(0.4),
      kind: "ap_moved",
      summary: "MR36 moved MS130 p2 → p8",
      node_id: "Q2XX-AP-0001",
      port: "Q2XX-MS-0001:8",
      severity: "warning",
      before: "Q2XX-MS-0001:2",
      after: "Q2XX-MS-0001:8",
    },
    {
      id: "c2",
      at: iso(2.7),
      kind: "appeared",
      summary: "Main-camera appeared on p8",
      node_id: "Q2XX-MV-0001",
      port: "Q2XX-MS-0001:8",
      severity: "info",
    },
    {
      id: "c3",
      at: iso(4.2),
      kind: "native_vlan",
      summary: "MS130 p14 native VLAN changed 1 → 10",
      port: "Q2XX-MS-0001:14",
      severity: "warning",
    },
    {
      id: "c4",
      at: iso(6.1),
      kind: "appeared",
      summary: "New device Pi5 detected on p5",
      node_id: "client-rpi5",
      port: "Q2XX-MS-0001:10",
      severity: "info",
    },
    {
      id: "c5",
      at: iso(9.4),
      kind: "lldp_neighbor",
      summary: "New LLDP neighbor Server fabric on MS130 p14",
      node_id: "SERVER-01",
      port: "Q2XX-MS-0001:14",
      severity: "info",
    },
    {
      id: "c6",
      at: iso(11.8),
      kind: "client_count",
      summary: "MS130 p2 client count 4 → 12",
      port: "Q2XX-MS-0001:2",
      severity: "info",
    },
  ];
}

export function formatChangeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function filterChanges(changes: TopologyChange[], window: string, now = Date.now()): TopologyChange[] {
  const ms = window === "1h" ? 3600_000 : window === "7d" ? 7 * 86400_000 : 86400_000;
  return changes.filter((c) => {
    const t = new Date(c.at).getTime();
    return Number.isFinite(t) && now - t <= ms;
  });
}
