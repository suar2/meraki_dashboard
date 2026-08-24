import { Icon } from "./Icon";

interface Org {
  id: string;
  name: string;
}

interface Net {
  id: string;
  name: string;
}

interface Props {
  apiKey: string;
  setApiKey: (v: string) => void;
  apiConnected: boolean;
  onConnect: () => void;
  orgs: Org[];
  nets: Net[];
  orgId: string;
  networkId: string;
  setOrgId: (v: string) => void;
  setNetworkId: (v: string) => void;
  onRefresh: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onExport: (kind: "png" | "csv" | "json") => void;
  onDebug: () => void;
  exportOpen: boolean;
  setExportOpen: (v: boolean) => void;
}

export function TopBar({
  apiKey,
  setApiKey,
  apiConnected,
  onConnect,
  orgs,
  nets,
  orgId,
  networkId,
  setOrgId,
  setNetworkId,
  onRefresh,
  theme,
  onToggleTheme,
  onExport,
  onDebug,
  exportOpen,
  setExportOpen,
}: Props) {
  return (
    <header id="topbar">
      <div className="brand">
        <Icon
          name="audio-lines"
          style={{
            width: 22,
            height: 22,
            stroke: "var(--teal)",
            flex: "none",
            filter: "drop-shadow(0 0 6px var(--glow))",
          }}
        />
        <div className="brand-txt">
          <span className="brand-name">Meraki Ops</span>
        </div>
      </div>
      <div className="tb-main">
        <input
          type="password"
          className="tb-input"
          placeholder="Meraki API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          aria-label="Meraki API key"
        />
        <button type="button" id="connectbtn" onClick={onConnect}>
          <Icon name="key" />
          {apiConnected ? "Reconnect" : "Connect"}
        </button>
        <select className="tb-select" value={orgId} onChange={(e) => setOrgId(e.target.value)} aria-label="Organization">
          <option value="">Organization</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select className="tb-select" value={networkId} onChange={(e) => setNetworkId(e.target.value)} aria-label="Network">
          <option value="">Network</option>
          {nets.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <button type="button" className="tb-iconbtn has-tip" data-tip="Refresh topology" onClick={onRefresh} aria-label="Refresh topology">
          <Icon name="refresh" />
        </button>
      </div>
      <div className="tb-actions">
        <button
          type="button"
          id="theme-toggle"
          className="has-tip tip-left"
          data-tip={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={onToggleTheme}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
        <div className="export-wrap">
          <button
            type="button"
            id="exportbtn"
            aria-haspopup="true"
            aria-expanded={exportOpen}
            onClick={(e) => {
              e.stopPropagation();
              setExportOpen(!exportOpen);
            }}
          >
            <Icon name="download" />
            Export
            <Icon name="chevron-down" className="exp-arrow" />
          </button>
          <div className={`export-menu${exportOpen ? " open" : ""}`} id="export-menu" role="menu">
            <button type="button" className="export-opt" role="menuitem" onClick={() => onExport("png")}>
              <Icon name="image" />
              PNG image
            </button>
            <button type="button" className="export-opt" role="menuitem" onClick={() => onExport("csv")}>
              <Icon name="table" />
              CSV (visible)
            </button>
            <button type="button" className="export-opt" role="menuitem" onClick={() => onExport("json")}>
              <Icon name="braces" />
              JSON (visible)
            </button>
          </div>
        </div>
        <button type="button" className="tb-iconbtn has-tip tip-left" data-tip="Topology debug" onClick={onDebug} aria-label="Topology debug">
          <Icon name="bug" />
        </button>
      </div>
    </header>
  );
}
