import { computeDiagnostics } from "./diagnostics";
import {
  INITIAL_CANVAS_INTERACTION_STATE,
  canvasInteractionCapabilities,
  isMarqueeDrag,
  nodeClickSelectionMode,
  reduceCanvasInteractionState,
} from "./interactionState";
import { SAMPLE_GRAPH } from "../sampleTopology";
import { validateExpectations } from "./liveExpectations";
import { focusKeepIds, presentGraph } from "./presentGraph";
import { nodeHaystack } from "./searchIndex";
import { traceToInternet } from "./tracePath";
import {
  applyMerakiApiKeyHeader,
  clearClientMerakiKey,
  getClientMerakiKey,
  layoutStorageKey,
  loadLayout,
  saveLayout,
  setClientMerakiKey,
} from "../api/client";
import { loadEntityMerges, saveEntityMergeRecord } from "./entityMerge";
import type { TopologyGraph, TopologyNode } from "../types/topology";

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  values(): string[] {
    return Array.from(this.data.values());
  }
}

const browserGlobals = globalThis as unknown as { sessionStorage: Storage; localStorage: Storage };
const session = new MemoryStorage();
const local = new MemoryStorage();
browserGlobals.sessionStorage = session;
browserGlobals.localStorage = local;

let interaction = INITIAL_CANVAS_INTERACTION_STATE;
let caps = canvasInteractionCapabilities(interaction);
assert(!caps.userPanningEnabled && caps.marqueeEnabled, "selection mode disables user panning and enables marquee");
interaction = reduceCanvasInteractionState(interaction, { type: "spaceDown" });
caps = canvasInteractionCapabilities(interaction);
assert(interaction.spacePressed && caps.userPanningEnabled && !caps.marqueeEnabled, "Space enters pan mode only");
interaction = reduceCanvasInteractionState(interaction, { type: "spaceUp" });
caps = canvasInteractionCapabilities(interaction);
assert(!interaction.spacePressed && !caps.userPanningEnabled && caps.marqueeEnabled, "Space release restores selection mode");
interaction = reduceCanvasInteractionState(interaction, { type: "spaceDown" });
interaction = reduceCanvasInteractionState(interaction, { type: "forceSelection" });
caps = canvasInteractionCapabilities(interaction);
assert(!interaction.spacePressed && !caps.userPanningEnabled && caps.marqueeEnabled, "lost Space events force selection mode");
assert(!isMarqueeDrag({ x: 10, y: 10 }, { x: 14, y: 10 }), "tiny empty-canvas movement stays a click");
assert(isMarqueeDrag({ x: 10, y: 10 }, { x: 16, y: 10 }), "drag threshold starts marquee selection");
assert(nodeClickSelectionMode([], "a") === "replace", "first normal node click selects the node");
assert(nodeClickSelectionMode(["a"], "b") === "add", "normal node clicks add to an existing selection");
assert(nodeClickSelectionMode(["a", "b"], "a") === "toggle", "normal click on a selected node removes it");

clearClientMerakiKey();
setClientMerakiKey(" browser-secret ");
assert(getClientMerakiKey() === "browser-secret", "client key is trimmed and kept in memory");
assert(session.getItem("meraki-ops-session-api-key") === "browser-secret", "client key is sessionStorage-only");
assert(!local.values().some((value) => value.includes("browser-secret")), "client key is never stored in localStorage");
const headerConfig: { headers: Record<string, string> } = { headers: {} };
applyMerakiApiKeyHeader(headerConfig);
assert(headerConfig.headers["X-Meraki-Api-Key"] === "browser-secret", "Axios interceptor attaches Meraki key header");
const noHeaderConfig: { url: string; headers: Record<string, string> } = { url: "/audit", headers: {} };
applyMerakiApiKeyHeader(noHeaderConfig);
assert(!noHeaderConfig.headers["X-Meraki-Api-Key"], "Axios interceptor does not attach Meraki key to non-Meraki endpoints");
clearClientMerakiKey();
assert(!session.getItem("meraki-ops-session-api-key"), "clearing key removes sessionStorage value");

await saveLayout("O1", "N1", { a: { x: 12, y: 24 } });
const storedLayout = await loadLayout("O1", "N1");
assert(storedLayout.a?.x === 12 && storedLayout.a?.y === 24, "layout persists in browser storage");
assert(Boolean(local.getItem(layoutStorageKey("O1", "N1"))), "layout uses local browser workspace storage");

saveEntityMergeRecord({
  org_id: "O1",
  network_id: "N1",
  survivor_id: "server-a",
  member_ids: ["server-b"],
  label: "Server",
  device_class: "server",
  interfaces: [],
});
assert(loadEntityMerges("O1", "N1").length === 1, "entity merges persist in browser storage");

const physical = presentGraph(SAMPLE_GRAPH, {
  visibilityMode: "physical",
  collapseWireless: true,
  collapseDownstream: true,
  expandedGroups: [],
});
assert(
  physical.nodes.every((n) => n.subtype !== "wireless" && n.type !== "group"),
  "physical mode hides wireless clients"
);
assert(
  physical.nodes.some((n) => n.label === "Main - camera"),
  "camera stays in physical mode"
);
assert(
  physical.nodes.some((n) => n.label === "Pi4") && physical.nodes.some((n) => n.label === "NAS"),
  "Pi and NAS stay in physical mode"
);
assert(
  !physical.nodes.some((n) => n.label === "Suars-iPhone"),
  "phones are hidden in physical mode"
);

const clients = presentGraph(SAMPLE_GRAPH, {
  visibilityMode: "physical_clients",
  collapseWireless: true,
  collapseDownstream: true,
  expandedGroups: [],
});
const wifiGroup = clients.nodes.find((n) => n.subtype === "wireless_group");
assert(wifiGroup?.label === "4 Wireless Clients", `expected collapsed wifi group, got ${wifiGroup?.label}`);
assert(
  clients.nodes.some((n) => n.subtype === "downstream_group"),
  "downstream VMs collapse under the server"
);

const hops = traceToInternet(SAMPLE_GRAPH, "client-iphone");
assert(hops[0]?.label === "Suars-iPhone", "trace starts at the phone");
assert(hops.some((h) => h.via === "Wi-Fi"), "trace names the Wi-Fi hop");
assert(hops.some((h) => h.via === "Port 2"), "trace names the AP uplink port");
assert(hops[hops.length - 1]?.label === "Internet", "trace ends at Internet");

const apUplink = SAMPLE_GRAPH.links.find((l) => l.id === "sw-ap");
assert(apUplink?.link_type === "wired" && apUplink.target === "Q2XX-AP-0001", "sample keeps a single MS↔MR wired uplink");
assert(SAMPLE_GRAPH.nodes.some((n) => n.id === "Q2XX-MV-0001"), "sample camera is on the canvas");
assert(
  SAMPLE_GRAPH.links.some((l) => l.id === "sw-camera" && l.source === "Q2XX-MS-0001"),
  "sample camera is adjacent on a switch port"
);

const lab = validateExpectations(SAMPLE_GRAPH);
assert(lab.ok, `sample lab edges should pass, got ${JSON.stringify(lab.checks.filter((c) => c.status !== "pass"))}`);
assert(lab.applicable === 7, `expected 7 applicable lab edges, got ${lab.applicable}`);
assert(lab.wireless_under_ap, "wireless clients parent to the AP");

const keep = focusKeepIds(SAMPLE_GRAPH, ["Q2XX-MS-0001", "SERVER-01", "client-nas", "client-rpi5"]);
assert(keep.has("SERVER-01") && keep.has("client-nas") && keep.has("client-rpi5"), "focus keeps the selected set");
assert(keep.has("client-ha") && keep.has("client-vm"), "focus expands server workloads");
assert(!keep.has("Q2XX-AP-0001") && !keep.has("client-iphone"), "focusing the switch does not pull the AP or Wi-Fi clients");

const focused = presentGraph(SAMPLE_GRAPH, {
  visibilityMode: "physical_clients",
  collapseWireless: true,
  collapseDownstream: true,
  expandedGroups: [],
  focusIds: ["Q2XX-MS-0001", "SERVER-01", "client-nas", "client-rpi5"],
});
assert(
  !focused.nodes.some((n) => n.id === "Q2XX-AP-0001" || n.subtype === "wireless_group"),
  "focus selection hides the rest of the fabric"
);

const iphone = SAMPLE_GRAPH.nodes.find((n) => n.id === "client-iphone")!;
const hay = nodeHaystack(SAMPLE_GRAPH, iphone);
assert(hay.includes("10.1.2.83"), "search indexes management IP");
assert(hay.includes("a4:83:e7:00:00:83"), "search indexes MAC");
assert(hay.includes("home"), "search indexes SSID");
const ms = SAMPLE_GRAPH.nodes.find((n) => n.id === "Q2XX-MS-0001")!;
const msHay = nodeHaystack(SAMPLE_GRAPH, ms);
assert(msHay.includes("q2xx-ms-0001"), "search indexes serial");
assert(msHay.includes("14"), "search indexes switch ports");
assert(msHay.includes("10"), "search indexes VLAN");

function fatGraph(extraClients: number): TopologyGraph {
  const nodes: TopologyNode[] = SAMPLE_GRAPH.nodes.map((n) => ({ ...n, metadata: { ...n.metadata } }));
  const links = SAMPLE_GRAPH.links.map((l) => ({ ...l }));
  const template = SAMPLE_GRAPH.nodes.find((n) => n.id === "client-iphone")!;
  for (let i = 0; i < extraClients; i++) {
    const id = `wifi-load-${i}`;
    nodes.push({
      ...template,
      id,
      label: `Phone ${i}`,
      hostname: `Phone ${i}`,
      management_ip: `10.9.${Math.floor(i / 250)}.${i % 250}`,
      metadata: { ...template.metadata, parent_id: "Q2XX-AP-0001" },
    });
    links.push({
      ...SAMPLE_GRAPH.links.find((l) => l.id === "ap-iphone")!,
      id: `ap-load-${i}`,
      source: "Q2XX-AP-0001",
      target: id,
    });
  }
  return { ...SAMPLE_GRAPH, nodes, links };
}

const scaled = presentGraph(fatGraph(250), {
  visibilityMode: "physical",
  collapseWireless: true,
  collapseDownstream: true,
  expandedGroups: [],
});
assert(
  scaled.nodes.length === physical.nodes.length,
  `physical mode stays compact with 250 extra clients (${scaled.nodes.length} vs ${physical.nodes.length})`
);
const collapsedWifi = presentGraph(fatGraph(1000), {
  visibilityMode: "physical_clients",
  collapseWireless: true,
  collapseDownstream: true,
  expandedGroups: [],
});
assert(
  collapsedWifi.nodes.filter((n) => n.subtype === "wireless").length === 0,
  "1,000 wireless clients collapse instead of rendering individually"
);
assert(
  collapsedWifi.nodes.some((n) => n.subtype === "wireless_group"),
  "physical+clients still emits a single wireless group at 1,000 clients"
);

const diag = computeDiagnostics(SAMPLE_GRAPH);
assert(typeof diag.duplicate_chassis_candidates === "number", "diagnostics expose duplicate chassis candidates");
assert(typeof diag.duplicate_physical_edges === "number", "diagnostics expose duplicate physical edges");
assert(typeof diag.unresolved_identity_count === "number", "diagnostics expose unresolved identity count");
assert(diag.duplicate_physical_edges === 0, "sample graph has no duplicate physical evidence edges");
const fwMs = SAMPLE_GRAPH.links.filter((l) => {
  const pair = new Set([l.source, l.target]);
  return pair.has("Q2XX-MX-0001") && pair.has("Q2XX-MS-0001") && l.link_type === "wired";
});
const msMr = SAMPLE_GRAPH.links.filter((l) => {
  const pair = new Set([l.source, l.target]);
  return pair.has("Q2XX-MS-0001") && pair.has("Q2XX-AP-0001") && l.link_type === "wired";
});
assert(fwMs.length === 1, "sample FW-01↔MS130 is a single physical edge");
assert(msMr.length === 1, "sample MS130↔MR36 is a single physical edge");

console.log("topology presentation regressions ok");
