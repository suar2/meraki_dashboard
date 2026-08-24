import { SAMPLE_GRAPH } from "../sampleTopology";
import { presentGraph } from "./presentGraph";
import { traceToInternet } from "./tracePath";

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

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

console.log("topology presentation regressions ok");
