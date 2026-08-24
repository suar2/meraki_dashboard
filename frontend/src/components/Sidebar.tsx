import React from "react";
import { Icon } from "./Icon";
import { DEVICE_CLASS_ORDER, DEVICE_CLASSES } from "../topology/deviceClass";
import type { LayoutMode, UiPrefs } from "../topology/prefs";

interface SearchHit {
  id: string;
  label: string;
  ip: string;
  type: string;
  color: string;
}

interface MultiOption {
  value: string;
  label: string;
  count?: number;
}

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
}: Props) {
  const hiddenTypes = new Set(prefs.hiddenTypes);
  const hiddenPlat = new Set(prefs.platforms);
  const hiddenFw = new Set(prefs.firmware);
  const filtersActive =
    prefs.hiddenTypes.length + prefs.platforms.length + prefs.firmware.length > 0 ||
    prefs.wiredOnly ||
    prefs.wirelessOnly ||
    prefs.unmanagedOnly ||
    prefs.clientsOnly ||
    prefs.showMismatchesOnly ||
    prefs.severityFilter !== "all";
  const [openDrop, setOpenDrop] = React.useState<string | null>(null);

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
              aria-label="Search host or IP"
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
                <span>Search</span>
                <span className="kbds">
                  <kbd>ctrl</kbd>
                  <kbd>K</kbd>
                </span>
              </div>
            )}
            <div id="results" className={searchOpen ? "on" : ""}>
              {searchHits.length === 0 && search ? (
                <div className="res-empty">No matching device</div>
              ) : (
                searchHits.map((hit) => (
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
