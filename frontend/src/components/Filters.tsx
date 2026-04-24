interface Props {
  search: string;
  setSearch: (value: string) => void;
  showMismatchesOnly: boolean;
  setShowMismatchesOnly: (value: boolean) => void;
  showWireless: boolean;
  setShowWireless: (value: boolean) => void;
}

export function Filters({
  search,
  setSearch,
  showMismatchesOnly,
  setShowMismatchesOnly,
  showWireless,
  setShowWireless,
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
    </div>
  );
}
