interface Props {
  search: string;
  setSearch: (value: string) => void;
  showMismatchesOnly: boolean;
  setShowMismatchesOnly: (value: boolean) => void;
  showWireless: boolean;
  setShowWireless: (value: boolean) => void;
  wiredOnly: boolean;
  setWiredOnly: (value: boolean) => void;
  wirelessOnly: boolean;
  setWirelessOnly: (value: boolean) => void;
  unmanagedOnly: boolean;
  setUnmanagedOnly: (value: boolean) => void;
  clientsOnly: boolean;
  setClientsOnly: (value: boolean) => void;
  severityFilter: "all" | "critical" | "warning" | "healthy";
  setSeverityFilter: (value: "all" | "critical" | "warning" | "healthy") => void;
}

export function Filters({
  search,
  setSearch,
  showMismatchesOnly,
  setShowMismatchesOnly,
  showWireless,
  setShowWireless,
  wiredOnly,
  setWiredOnly,
  wirelessOnly,
  setWirelessOnly,
  unmanagedOnly,
  setUnmanagedOnly,
  clientsOnly,
  setClientsOnly,
  severityFilter,
  setSeverityFilter,
}: Props) {
  return (
    <div className="toolbar">
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search node, serial, model, port" />
      <label>
        <input type="checkbox" checked={showMismatchesOnly} onChange={(e) => setShowMismatchesOnly(e.target.checked)} />
        Mismatches only
      </label>
      <label>
        <input type="checkbox" checked={showWireless} onChange={(e) => setShowWireless(e.target.checked)} />
        Show wireless links
      </label>
      <label>
        <input type="checkbox" checked={wiredOnly} onChange={(e) => setWiredOnly(e.target.checked)} />
        Wired only
      </label>
      <label>
        <input type="checkbox" checked={wirelessOnly} onChange={(e) => setWirelessOnly(e.target.checked)} />
        Wireless only
      </label>
      <label>
        <input type="checkbox" checked={unmanagedOnly} onChange={(e) => setUnmanagedOnly(e.target.checked)} />
        Unmanaged only
      </label>
      <label>
        <input type="checkbox" checked={clientsOnly} onChange={(e) => setClientsOnly(e.target.checked)} />
        Clients only
      </label>
      <label>
        Severity
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as "all" | "critical" | "warning" | "healthy")}>
          <option value="all">All</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="healthy">Healthy</option>
        </select>
      </label>
    </div>
  );
}
