import type { LogicalGroup, SavedView } from "../types/topology";
import type { LayoutMode, UiPrefs, VisibilityMode } from "./prefs";

const MS = "Q2XX-MS-0001";
const MX = "Q2XX-MX-0001";
const AP = "Q2XX-AP-0001";
const CAM = "Q2XX-MV-0001";
const SERVER = "SERVER-01";

export function personalViewsKey(orgId: string, networkId: string): string {
  return `meraki-ops-personal-views-${orgId}-${networkId}`;
}

export function personalGroupsKey(orgId: string, networkId: string): string {
  return `meraki-ops-personal-groups-${orgId}-${networkId}`;
}

export function loadPersonalViews(orgId: string, networkId: string): SavedView[] {
  try {
    const raw = JSON.parse(localStorage.getItem(personalViewsKey(orgId, networkId)) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function savePersonalViews(orgId: string, networkId: string, views: SavedView[]): void {
  try {
    localStorage.setItem(personalViewsKey(orgId, networkId), JSON.stringify(views));
  } catch {
    /* ignore quota */
  }
}

export function loadPersonalGroups(orgId: string, networkId: string): LogicalGroup[] {
  try {
    const raw = JSON.parse(localStorage.getItem(personalGroupsKey(orgId, networkId)) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function savePersonalGroups(orgId: string, networkId: string, groups: LogicalGroup[]): void {
  try {
    localStorage.setItem(personalGroupsKey(orgId, networkId), JSON.stringify(groups));
  } catch {
    /* ignore quota */
  }
}

export function defaultDemoViews(): SavedView[] {
  const now = new Date().toISOString();
  return [
    {
      id: "v-main",
      name: "Main Infrastructure",
      starred: true,
      shared: false,
      view_mode: "physical_clients",
      selected_nodes: [],
      hidden_nodes: [],
      focus_nodes: [],
      expanded_groups: [],
      collapse_wireless: true,
      collapse_downstream: true,
      layout: "breadthfirst",
      created_at: now,
      updated_at: now,
    },
    {
      id: "v-server",
      name: "Server Infrastructure",
      starred: false,
      shared: false,
      view_mode: "physical_clients",
      selected_nodes: [MS, SERVER, "client-nas", "client-rpi5"],
      hidden_nodes: [],
      focus_nodes: [MS, SERVER, "client-nas", "client-rpi5"],
      expanded_groups: [],
      collapse_wireless: true,
      collapse_downstream: false,
      layout: "breadthfirst",
      created_at: now,
      updated_at: now,
    },
    {
      id: "v-wireless",
      name: "Wireless",
      starred: false,
      shared: false,
      view_mode: "physical_clients",
      selected_nodes: [AP],
      hidden_nodes: [],
      focus_nodes: [AP],
      expanded_groups: [],
      collapse_wireless: false,
      collapse_downstream: true,
      layout: "breadthfirst",
      created_at: now,
      updated_at: now,
    },
    {
      id: "v-cameras",
      name: "Cameras",
      starred: false,
      shared: false,
      view_mode: "physical",
      selected_nodes: [CAM],
      hidden_nodes: [],
      focus_nodes: [MS, CAM],
      expanded_groups: [],
      collapse_wireless: true,
      collapse_downstream: true,
      layout: "breadthfirst",
      created_at: now,
      updated_at: now,
    },
    {
      id: "v-p14",
      name: "Port 14 Troubleshooting",
      starred: false,
      shared: false,
      view_mode: "physical_clients",
      selected_nodes: [MS, SERVER],
      hidden_nodes: [],
      focus_nodes: [MS, SERVER],
      expanded_groups: [],
      selected_ports: [`${MS}:14`],
      collapse_wireless: true,
      collapse_downstream: false,
      layout: "breadthfirst",
      created_at: now,
      updated_at: now,
    },
  ];
}

export function defaultDemoGroups(): LogicalGroup[] {
  return [
    { id: "g-server", name: "Server Infrastructure", member_ids: [MS, SERVER, "client-nas", "client-rpi5"] },
    { id: "g-core", name: "Core / Uplinks", member_ids: [MX, MS, AP] },
    { id: "g-cameras", name: "Cameras", member_ids: [MS, CAM] },
  ];
}

export function mergeViews(shared: SavedView[], personal: SavedView[]): SavedView[] {
  const seen = new Set<string>();
  const out: SavedView[] = [];
  for (const view of [...shared.map((v) => ({ ...v, shared: true })), ...personal.map((v) => ({ ...v, shared: false }))]) {
    if (!view.id || seen.has(view.id)) continue;
    seen.add(view.id);
    out.push(view);
  }
  out.sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)) || a.name.localeCompare(b.name));
  return out;
}

export function prefsFromView(view: SavedView, prev: UiPrefs): Partial<UiPrefs> {
  const filters = view.filters || {};
  return {
    visibilityMode: (view.view_mode as VisibilityMode) || prev.visibilityMode,
    expandedGroups: view.expanded_groups || [],
    hiddenNodeIds: view.hidden_nodes || [],
    focusIds: view.focus_nodes || [],
    collapseWireless: view.collapse_wireless !== false,
    collapseDownstream: view.collapse_downstream !== false,
    layout: (view.layout as LayoutMode) || prev.layout,
    hiddenTypes: (filters.hiddenTypes as string[]) || prev.hiddenTypes,
    platforms: (filters.platforms as string[]) || prev.platforms,
    firmware: (filters.firmware as string[]) || prev.firmware,
    showWireless: filters.showWireless !== undefined ? Boolean(filters.showWireless) : prev.showWireless,
    wiredOnly: filters.wiredOnly !== undefined ? Boolean(filters.wiredOnly) : prev.wiredOnly,
    wirelessOnly: filters.wirelessOnly !== undefined ? Boolean(filters.wirelessOnly) : prev.wirelessOnly,
    unmanagedOnly: filters.unmanagedOnly !== undefined ? Boolean(filters.unmanagedOnly) : prev.unmanagedOnly,
    clientsOnly: filters.clientsOnly !== undefined ? Boolean(filters.clientsOnly) : prev.clientsOnly,
  };
}

export function viewFromWorkspace(
  name: string,
  prefs: UiPrefs,
  camera: { zoom: number; pan: { x: number; y: number }; positions: Record<string, { x: number; y: number }> },
  selectedNodes: string[],
  extra?: { shared?: boolean; starred?: boolean; selectedPorts?: string[] }
): SavedView {
  const now = new Date().toISOString();
  return {
    id: `view-${Date.now()}`,
    name,
    starred: Boolean(extra?.starred),
    shared: Boolean(extra?.shared),
    view_mode: prefs.visibilityMode,
    selected_nodes: selectedNodes,
    hidden_nodes: prefs.hiddenNodeIds || [],
    focus_nodes: prefs.focusIds || [],
    expanded_groups: prefs.expandedGroups || [],
    filters: {
      hiddenTypes: prefs.hiddenTypes,
      platforms: prefs.platforms,
      firmware: prefs.firmware,
      showWireless: prefs.showWireless,
      wiredOnly: prefs.wiredOnly,
      wirelessOnly: prefs.wirelessOnly,
      unmanagedOnly: prefs.unmanagedOnly,
      clientsOnly: prefs.clientsOnly,
    },
    positions: camera.positions,
    zoom: camera.zoom,
    pan: camera.pan,
    selected_ports: extra?.selectedPorts || [],
    layout: prefs.layout,
    collapse_wireless: prefs.collapseWireless,
    collapse_downstream: prefs.collapseDownstream,
    created_at: now,
    updated_at: now,
  };
}
