import React from "react";
import { Icon } from "./Icon";
import { DEVICE_CLASS_ORDER, DEVICE_CLASSES } from "../topology/deviceClass";
import type { LayoutMode, UiPrefs } from "../topology/prefs";
import { formatChangeTime } from "../topology/sampleChanges";
import type { LogicalGroup, SavedView, SearchHit, TopologyChange, TopologyDiagnostics } from "../types/topology";

interface MultiOption {
  value: string;
  label: string;
  count?: number;
}

export type ChangeWindow = "1h" | "24h" | "7d";

interface Props {
  prefs: UiPrefs;
  setPrefs: (patch: Partial<UiPrefs>) => void;
  search: string;
  setSearch: (v: string) => void;
  searchHits: SearchHit[];
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  onPickSearch: (id: string) => void;
  categories: MultiOption[];
  platforms: MultiOption[];
  firmware: MultiOption[];
  visibleCount: number;
  changes: TopologyChange[];
  changeWindow: ChangeWindow;
  setChangeWindow: (w: ChangeWindow) => void;
  onPickChange: (change: TopologyChange) => void;
  diagnostics?: TopologyDiagnostics | null;
  labChecks?: { passed: number; applicable: number; ok: boolean; wireless_under_ap?: boolean } | null;
  views: SavedView[];
  activeViewId?: string | null;
  onApplyView: (view: SavedView) => void;
  onSaveView: () => void;
  onStarView: (view: SavedView) => void;
  groups: LogicalGroup[];
  onApplyGroup: (group: LogicalGroup) => void;
  onCreateGroup: () => void;
  onShowAll: () => void;
}

function ToggleRow({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="toggle-row" role="switch" tabIndex={0} aria-checked={on} onClick={onToggle} onKeyDown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggle();
      }
    }}>
      <span>{label}</span>
      <div className={`sw${on ? " on" : ""}`} />
    </div>
  );
}

function MultiSelect({
  label,
  allLabel,
  options,
  hidden,
  onToggle,
  onOpenChange,
  open,
}: {
  label: string;
  allLabel: string;
  options: MultiOption[];
  hidden: Set<string>;
  onToggle: (value: string, checked: boolean) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (options.length < 2) return null;
  const visibleTotal = options.length;
  const hiddenCount = options.filter((o) => hidden.has(o.value)).length;
  const text = hiddenCount === 0 ? allLabel : `${visibleTotal - hiddenCount} / ${visibleTotal} selected`;
  return (
    <div className="section">
      <div className="sec-head">
        <span className="bar" />
        <span className="sec-title">{label}</span>
      </div>
      <div className="platform-wrap">
        <button
          type="button"
          className={`platform-btn${hiddenCount > 0 ? " active" : ""}`}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            onOpenChange(!open);
          }}
        >
          <span>{text}</span>
          <Icon name="chevron-down" className="pb-arrow" />
        </button>
        <div className={`platform-drop${open ? " open" : ""}`} onClick={(e) => e.stopPropagation()}>
          {options.map((opt) => {
            const checked = !hidden.has(opt.value);
            return (
              <div
                key={opt.value}
                className={`plat-item${checked ? " on" : ""}`}
                onClick={() => onToggle(opt.value, !checked)}
              >
                <input className="plat-cb" type="checkbox" checked={checked} readOnly />
                <span>{opt.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  prefs,
  setPrefs,
  search,
  setSearch,
  searchHits,
  searchOpen,
  setSearchOpen,
  onPickSearch,
  categories,
  platforms,
  firmware,
  visibleCount,
  changes,
  changeWindow,
  setChangeWindow,
  onPickChange,
  diagnostics,
  labChecks,
  views,
  activeViewId,
  onApplyView,
  onSaveView,
  onStarView,
  groups,
  onApplyGroup,
  onCreateGroup,
  onShowAll,
}: Props) {
  const hits = searchHits || [];
  const changeList = changes || [];
  const viewList = views || [];
  const groupList = groups || [];
  const hiddenTypes = new Set(prefs.hiddenTypes || []);
  const hiddenPlat = new Set(prefs.platforms || []);
  const hiddenFw = new Set(prefs.firmware || []);
  const filtersActive =
    (prefs.hiddenTypes || []).length + (prefs.platforms || []).length + (prefs.firmware || []).length > 0 ||
    prefs.wiredOnly ||
    prefs.wirelessOnly ||
    prefs.unmanagedOnly ||
    prefs.clientsOnly ||
    prefs.showMismatchesOnly ||
    prefs.severityFilter !== "all";
  const [openDrop, setOpenDrop] = React.useState<string | null>(null);
  const focused = Boolean(prefs.focusIds?.length || prefs.hiddenNodeIds?.length);

  React.useEffect(() => {
    const close = () => setOpenDrop(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const toggleSet = (key: "hiddenTypes" | "platforms" | "firmware", value: string, checked: boolean) => {
    const cur = new Set(prefs[key]);
    if (checked) cur.delete(value);
    else cur.add(value);
    setPrefs({ [key]: Array.from(cur) });
  };

  return (
    <aside id="sidebar">
      <div className="sidebar-top">
        <div className="section">
          <div className="sec-head">
            <span className="bar" />
            <span className="sec-title">Search</span>
          </div>
          <div className="search-wrap">
            <Icon name="search" className="ic" />
            <input
              id="search"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search hostname, MAC, IP, serial, port, VLAN, SSID"
              placeholder=" "
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => search && setSearchOpen(true)}
            />
            {!search && (
              <div className="search-ph" aria-hidden="true">
                <span>Host, MAC, IP, VLAN…</span>
                <span className="kbds">
                  <kbd>ctrl</kbd>
                  <kbd>K</kbd>
                </span>
              </div>
            )}
            <div id="results" className={searchOpen ? "on" : ""}>
              {hits.length === 0 && search ? (
                <div className="res-empty">No matching device</div>
              ) : (
                hits.map((hit) => (
                  <div key={hit.id} className="res-item" onClick={() => onPickSearch(hit.id)}>
                    <span className="res-dot" style={{ background: hit.color }} />
                    <span className="res-name">{hit.label}</span>
                    <span className="res-meta">{hit.ip}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="section">
          <div className="sec-head">
            <span className="bar" />
            <span className="sec-title">Changes</span>
          </div>
          <div className="seg">
            {(["1h", "24h", "7d"] as ChangeWindow[]).map((w) => (
              <button type="button" key={w} className={changeWindow === w ? "on" : ""} onClick={() => setChangeWindow(w)}>
                {w === "1h" ? "1h" : w === "7d" ? "7d" : "24h"}
              </button>
            ))}
          </div>
          <div className="chg-list">
            {changeList.length === 0 ? (
              <div className="chg-empty">No topology changes in this window.</div>
            ) : (
              changeList.map((change) => (
                <button type="button" key={change.id} className={`chg-item sev-${change.severity || "info"}`} onClick={() => onPickChange(change)}>
                  <span className="chg-time">{formatChangeTime(change.at)}</span>
                  <span className="chg-sum">{change.summary}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {diagnostics && (
          <div className="section">
            <div className="sec-head">
              <span className="bar" />
              <span className="sec-title">Diagnostics</span>
            </div>
            <dl className="diag-grid">
              <div><dt>Physical edges</dt><dd>{diagnostics.physical_edges}</dd></div>
              <div><dt>High confidence</dt><dd>{diagnostics.high_confidence}</dd></div>
              <div><dt>Medium confidence</dt><dd>{diagnostics.medium_confidence}</dd></div>
              <div><dt>Low confidence</dt><dd>{diagnostics.low_confidence}</dd></div>
              <div><dt>Unresolved nodes</dt><dd>{diagnostics.unresolved_nodes}</dd></div>
              <div><dt>Duplicate identities</dt><dd>{diagnostics.duplicate_identities}</dd></div>
              <div><dt>Orphans</dt><dd>{diagnostics.orphans}</dd></div>
            </dl>
            {labChecks && labChecks.applicable > 0 && (
              <div className={`lab-check${labChecks.ok ? " ok" : " bad"}`}>
                Lab checks {labChecks.passed}/{labChecks.applicable}
                {labChecks.wireless_under_ap === false ? " · Wi-Fi parent mismatch" : ""}
              </div>
            )}
          </div>
        )}

        <div className="section">
          <div className="sec-head">
            <span className="bar" />
            <span className="sec-title">Saved views</span>
          </div>
          <div className="view-list">
            {viewList.length === 0 && <div className="chg-empty">No saved views yet.</div>}
            {viewList.map((view) => (
              <div key={view.id} className={`view-item${activeViewId === view.id ? " on" : ""}`}>
                <button type="button" className="view-star" title={view.starred ? "Unstar" : "Star"} onClick={() => onStarView(view)}>
                  {view.starred ? "★" : "☆"}
                </button>
                <button type="button" className="view-name" onClick={() => onApplyView(view)}>
                  {view.name}
                  {view.shared ? <span className="view-tag">shared</span> : <span className="view-tag">personal</span>}
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="side-add" onClick={onSaveView}>
            + Save current view
          </button>
        </div>

        <div className="section">
          <div className="sec-head">
            <span className="bar" />
            <span className="sec-title">Groups</span>
          </div>
          <div className="view-list">
            {groupList.length === 0 && <div className="chg-empty">No logical groups yet.</div>}
            {groupList.map((group) => (
              <button type="button" key={group.id} className="view-name group-btn" onClick={() => onApplyGroup(group)}>
                {group.name}
                <span className="view-tag">{(group.member_ids || []).length}</span>
              </button>
            ))}
          </div>
          <button type="button" className="side-add" onClick={onCreateGroup}>
            + Create group
          </button>
        </div>

        {focused && (
          <div className="section">
            <button type="button" className="fix-btn" onClick={onShowAll}>
              Show all
            </button>
          </div>
        )}

        <div className="section">
          <div className="sec-head">
            <span className="bar" />
            <span className="sec-title">View</span>
          </div>
          <div className="seg vis-stack">
            <button
              type="button"
              className={prefs.visibilityMode === "physical" ? "on" : ""}
              title="Firewall, switch, AP, camera, server, NAS, Pi"
              onClick={() => setPrefs({ visibilityMode: "physical", expandedGroups: [] })}
            >
              Physical
            </button>
            <button
              type="button"
              className={prefs.visibilityMode === "physical_clients" ? "on" : ""}
              title="Physical devices plus wired and wireless clients"
              onClick={() => setPrefs({ visibilityMode: "physical_clients" })}
            >
              Physical + Clients
            </button>
            <button
              type="button"
              className={prefs.visibilityMode === "full" ? "on" : ""}
              title="Everything including inferred WAN and unmanaged neighbors"
              onClick={() => setPrefs({ visibilityMode: "full" })}
            >
              Full
            </button>
          </div>
          <ToggleRow
            label="Collapse wireless clients"
            on={prefs.collapseWireless}
            onToggle={() => setPrefs({ collapseWireless: !prefs.collapseWireless, expandedGroups: [] })}
          />
          <ToggleRow
            label="Collapse downstream clients"
            on={prefs.collapseDownstream}
            onToggle={() => setPrefs({ collapseDownstream: !prefs.collapseDownstream, expandedGroups: [] })}
          />
        </div>

        <div className="section">
          <div className="sec-head">
            <span className="bar" />
            <span className="sec-title">Display</span>
          </div>
          <ToggleRow label="All node labels" on={prefs.allLabels} onToggle={() => setPrefs({ allLabels: !prefs.allLabels })} />
          <ToggleRow label="Highlight uplinks" on={prefs.backbone} onToggle={() => setPrefs({ backbone: !prefs.backbone })} />
        </div>

        <div className="section">
          <div className="sec-head">
            <span className="bar" />
            <span className="sec-title">Topology</span>
          </div>
          <ToggleRow label="Mismatches only" on={prefs.showMismatchesOnly} onToggle={() => setPrefs({ showMismatchesOnly: !prefs.showMismatchesOnly })} />
          <ToggleRow label="Show wireless links" on={prefs.showWireless} onToggle={() => setPrefs({ showWireless: !prefs.showWireless })} />
          <ToggleRow label="Wired only" on={prefs.wiredOnly} onToggle={() => setPrefs({ wiredOnly: !prefs.wiredOnly, wirelessOnly: false })} />
          <ToggleRow label="Wireless only" on={prefs.wirelessOnly} onToggle={() => setPrefs({ wirelessOnly: !prefs.wirelessOnly, wiredOnly: false })} />
          <ToggleRow label="Unmanaged only" on={prefs.unmanagedOnly} onToggle={() => setPrefs({ unmanagedOnly: !prefs.unmanagedOnly })} />
          <ToggleRow label="Clients only" on={prefs.clientsOnly} onToggle={() => setPrefs({ clientsOnly: !prefs.clientsOnly })} />
          <label className="severity-row">
            Severity
            <select
              value={prefs.severityFilter}
              onChange={(e) => setPrefs({ severityFilter: e.target.value as UiPrefs["severityFilter"] })}
            >
              <option value="all">All</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="healthy">Healthy</option>
            </select>
          </label>
        </div>

        <MultiSelect
          label="Firmware"
          allLabel="All versions"
          options={firmware}
          hidden={hiddenFw}
          open={openDrop === "fw"}
          onOpenChange={(o) => setOpenDrop(o ? "fw" : null)}
          onToggle={(v, checked) => toggleSet("firmware", v, checked)}
        />
        <MultiSelect
          label="Platform"
          allLabel="All platforms"
          options={platforms}
          hidden={hiddenPlat}
          open={openDrop === "plat"}
          onOpenChange={(o) => setOpenDrop(o ? "plat" : null)}
          onToggle={(v, checked) => toggleSet("platforms", v, checked)}
        />
        <MultiSelect
          label="Categories"
          allLabel="All categories"
          options={categories.length ? categories : DEVICE_CLASS_ORDER.map((c) => ({ value: c, label: DEVICE_CLASSES[c].label }))}
          hidden={hiddenTypes}
          open={openDrop === "cat"}
          onOpenChange={(o) => setOpenDrop(o ? "cat" : null)}
          onToggle={(v, checked) => toggleSet("hiddenTypes", v, checked)}
        />

        <div className="reset-wrap">
          <button
            type="button"
            id="reset-filters"
            className={filtersActive ? "visible" : ""}
            onClick={() =>
              setPrefs({
                hiddenTypes: [],
                platforms: [],
                firmware: [],
                wiredOnly: false,
                wirelessOnly: false,
                unmanagedOnly: false,
                clientsOnly: false,
                showMismatchesOnly: false,
                showWireless: true,
                severityFilter: "all",
              })
            }
          >
            <Icon name="rotate-ccw" />
            Reset filters
          </button>
        </div>
      </div>

      <div className="sidebar-bottom">
        <div className="section">
          <div className="sec-head">
            <span className="bar" />
            <span className="sec-title">Layout</span>
          </div>
          <div className="seg" id="layoutseg">
            <button
              type="button"
              className={prefs.layout === "breadthfirst" ? "on" : ""}
              onClick={() => setPrefs({ layout: "breadthfirst" as LayoutMode })}
            >
              Tree
            </button>
            <button
              type="button"
              className={prefs.layout === "fcose" ? "on" : ""}
              onClick={() => setPrefs({ layout: "fcose" as LayoutMode })}
            >
              Force
            </button>
          </div>
        </div>
        <div className="vis-note">
          Shown <b>{visibleCount}</b>
        </div>
      </div>
    </aside>
  );
}
