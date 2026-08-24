export type LayoutMode = "breadthfirst" | "fcose";
export type SeverityFilter = "all" | "critical" | "warning" | "healthy";
export type VisibilityMode = "physical" | "physical_clients" | "full";

export interface UiPrefs {
  theme: "dark" | "light";
  layout: LayoutMode;
  visibilityMode: VisibilityMode;
  collapseWireless: boolean;
  collapseDownstream: boolean;
  expandedGroups: string[];
  hiddenTypes: string[];
  platforms: string[];
  firmware: string[];
  allLabels: boolean;
  backbone: boolean;
  showWireless: boolean;
  wiredOnly: boolean;
  wirelessOnly: boolean;
  unmanagedOnly: boolean;
  clientsOnly: boolean;
  showMismatchesOnly: boolean;
  severityFilter: SeverityFilter;
  selectedId: string | null;
  selectedKind: "node" | "link" | null;
}

export const PREFS_KEY = "meraki-ops-ui-prefs";
export const THEME_KEY = "topology-theme";

export const defaultPrefs = (): UiPrefs => ({
  theme: "dark",
  layout: "breadthfirst",
  visibilityMode: "physical_clients",
  collapseWireless: true,
  collapseDownstream: true,
  expandedGroups: [],
  hiddenTypes: [],
  platforms: [],
  firmware: [],
  allLabels: false,
  backbone: true,
  showWireless: true,
  wiredOnly: false,
  wirelessOnly: false,
  unmanagedOnly: false,
  clientsOnly: false,
  showMismatchesOnly: false,
  severityFilter: "all",
  selectedId: null,
  selectedKind: null,
});

export function loadPrefs(): UiPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    const theme = (localStorage.getItem(THEME_KEY) as UiPrefs["theme"] | null) || raw?.theme || "dark";
    return { ...defaultPrefs(), ...(raw || {}), theme };
  } catch {
    return defaultPrefs();
  }
}

export function savePrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    localStorage.setItem(THEME_KEY, prefs.theme);
  } catch {
    /* ignore quota */
  }
}

export function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.setAttribute("data-theme", theme);
}
