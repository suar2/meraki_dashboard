import React from "react";
import { executeRemediation, fetchTopology } from "./api/client";
import { CytoscapeStage, type StageHandle } from "./components/CytoscapeStage";
import { RemediationModal } from "./components/RemediationModal";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { TopologyDebugPanel } from "./components/TopologyDebugPanel";
import { clearMerakiRequestCaches, getNetworksForOrg, getOrganizationsForApiKey } from "./merakiSession";
import { SAMPLE_GRAPH } from "./sampleTopology";
import { DEVICE_CLASS_ORDER, DEVICE_CLASSES, asDeviceClass, classVisuals } from "./topology/deviceClass";
import { applyTheme, loadPrefs, savePrefs, type UiPrefs } from "./topology/prefs";
import type { RemediationAction, TopologyGraph } from "./types/topology";

export function App() {
  const [prefs, setPrefsState] = React.useState<UiPrefs>(() => {
    const p = loadPrefs();
    applyTheme(p.theme);
    return p;
  });
  const setPrefs = React.useCallback((patch: Partial<UiPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      if (patch.theme) applyTheme(patch.theme);
      return next;
    });
  }, []);

  const [orgs, setOrgs] = React.useState<{ id: string; name: string }[]>([]);
  const [nets, setNets] = React.useState<{ id: string; name: string }[]>([]);
  const [orgId, setOrgId] = React.useState("");
  const [networkId, setNetworkId] = React.useState("");
  const [graph, setGraph] = React.useState<TopologyGraph | null>(null);
  const [pendingAction, setPendingAction] = React.useState<RemediationAction>();
  const [apiKey, setApiKey] = React.useState("");
  const [apiConnected, setApiConnected] = React.useState(false);
  const [apiError, setApiError] = React.useState("");
  const [topoDebugOpen, setTopoDebugOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchIndex, setSearchIndex] = React.useState<{ id: string; label: string; ip: string; type: string; color: string }[]>([]);
  const [visibleCount, setVisibleCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const stageRef = React.useRef<StageHandle>(null);

  const loadTopology = React.useCallback(async () => {
    if (!orgId || !networkId || orgId === "O_DEMO") return;
    setLoading(true);
    try {
      const data = await fetchTopology(orgId, networkId);
      setGraph(data);
      setApiError("");
    } catch (error: any) {
      setApiError(error?.response?.data?.detail || error?.message || "Failed to load topology.");
    } finally {
      setLoading(false);
    }
  }, [orgId, networkId]);

  const connectApiKey = React.useCallback(async () => {
    if (!apiKey.trim()) {
      setApiError("Enter your Meraki API key first.");
      return;
    }
    try {
      clearMerakiRequestCaches();
      const trimmed = apiKey.trim();
      localStorage.setItem("merakiApiKey", trimmed);
      const organizations = (await getOrganizationsForApiKey(trimmed)) as { id: string; name: string }[];
      setOrgs(organizations);
      setApiConnected(true);
      setApiError("");
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Failed to validate API key.";
      setApiConnected(false);
      setApiError(detail);
      setOrgs([]);
      setNets([]);
      setOrgId("");
      setNetworkId("");
    }
  }, [apiKey]);

  React.useEffect(() => {
    const savedKey = localStorage.getItem("merakiApiKey");
    if (!savedKey) return;
    setApiKey(savedKey);
    let cancelled = false;
    getOrganizationsForApiKey(savedKey)
      .then((organizations) => {
        if (cancelled) return;
        setOrgs(organizations as { id: string; name: string }[]);
        setApiConnected(true);
        setApiError("");
      })
      .catch(() => {
        if (cancelled) return;
        setApiConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!orgId || !apiConnected) {
      if (!orgId) setNets([]);
      return;
    }
    let cancelled = false;
    getNetworksForOrg(orgId)
      .then((n) => {
        if (!cancelled) setNets(n as { id: string; name: string }[]);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [orgId, apiConnected]);

  React.useEffect(() => {
    if (!apiConnected || !orgId || !networkId) return;
    void loadTopology();
  }, [apiConnected, orgId, networkId, loadTopology]);

  React.useEffect(() => {
    const close = () => setExportOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      const isSlash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (!isK && !isSlash) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      e.preventDefault();
      document.getElementById("search")?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const applyAction = async (action: RemediationAction) => {
    if (!orgId || !networkId || !graph) return;
    if (graph.organization.id === "O_DEMO") {
      setPendingAction(undefined);
      return;
    }
    await executeRemediation(orgId, networkId, action, "dashboard-operator");
    setPendingAction(undefined);
    await loadTopology();
  };

  const hits = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return searchIndex
      .filter((h) => h.label.toLowerCase().includes(q) || h.ip.toLowerCase().includes(q) || h.id.toLowerCase().includes(q))
      .sort((a, b) => classVisuals(asDeviceClass(b.type)).tier - classVisuals(asDeviceClass(a.type)).tier)
      .slice(0, 10);
  }, [search, searchIndex]);

  const categories = React.useMemo(() => {
    const present = new Set((graph?.nodes || []).map((n) => asDeviceClass(String(n.device_class))));
    return DEVICE_CLASS_ORDER.filter((c) => present.has(c)).map((c) => ({ value: c, label: DEVICE_CLASSES[c].label }));
  }, [graph]);

  const platforms = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of graph?.nodes || []) {
      const p = n.platform || "—";
      if (p === "—") continue;
      counts.set(p, (counts.get(p) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value]) => ({ value, label: value }));
  }, [graph]);

  const firmware = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of graph?.nodes || []) {
      const v = n.software_version || "—";
      if (v === "—") continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value]) => ({ value, label: value }));
  }, [graph]);

  const loadSample = () => {
    setGraph(SAMPLE_GRAPH);
    setOrgId("O_DEMO");
    setNetworkId("N_DEMO");
    setOrgs([{ id: "O_DEMO", name: "Demo Org" }]);
    setNets([{ id: "N_DEMO", name: "HQ Demo" }]);
    setApiError("");
  };

  return (
    <div className={`app${graph ? "" : " no-data"}`} style={{ position: "relative" }}>
      <TopBar
        apiKey={apiKey}
        setApiKey={setApiKey}
        apiConnected={apiConnected}
        onConnect={() => void connectApiKey()}
        orgs={orgs}
        nets={nets}
        orgId={orgId}
        networkId={networkId}
        setOrgId={(v) => {
          setOrgId(v);
          setNetworkId("");
          setGraph(null);
        }}
        setNetworkId={setNetworkId}
        onRefresh={() => void loadTopology()}
        theme={prefs.theme}
        onToggleTheme={() => setPrefs({ theme: prefs.theme === "dark" ? "light" : "dark" })}
        onExport={(kind) => {
          setExportOpen(false);
          if (kind === "png") stageRef.current?.exportPNG();
          if (kind === "csv") stageRef.current?.exportCSV();
          if (kind === "json") stageRef.current?.exportJSON();
        }}
        onDebug={() => setTopoDebugOpen((o) => !o)}
        exportOpen={exportOpen}
        setExportOpen={setExportOpen}
      />
      {apiError && <div className="api-error">{apiError}</div>}
      <div id="body">
        <Sidebar
          prefs={prefs}
          setPrefs={setPrefs}
          search={search}
          setSearch={setSearch}
          searchHits={hits}
          searchOpen={searchOpen && Boolean(search)}
          setSearchOpen={setSearchOpen}
          onPickSearch={(id) => {
            setSearch(id);
            setSearchOpen(false);
            stageRef.current?.selectNode(id, true);
          }}
          categories={categories}
          platforms={platforms}
          firmware={firmware}
          visibleCount={visibleCount}
        />
        <CytoscapeStage
          ref={stageRef}
          graph={graph}
          orgId={orgId}
          networkId={networkId}
          prefs={prefs}
          setPrefs={setPrefs}
          onVisibleCount={setVisibleCount}
          onSearchIndex={setSearchIndex}
          onRemediation={setPendingAction}
          emptyTitle={loading ? "Loading topology…" : "Explore your network"}
          emptySub={
            loading
              ? "Fetching devices, LLDP/CDP links, ports and clients from Meraki."
              : "Connect a Meraki API key and choose an organization + network, or load the sample topology to preview the Packet Express experience."
          }
        />
      </div>
      {!graph && !loading && (
        <button type="button" className="sample-fab" onClick={loadSample}>
          Load sample topology
        </button>
      )}
      <footer id="appfooter">
        <span id="ft-meta">
          {graph ? (
            <>
              <b>{graph.network.name}</b>
              <span className="ft-sep">·</span>
              {graph.summary.total_nodes} nodes
              <span className="ft-sep">·</span>
              {graph.summary.total_wired_links} wired
              <span className="ft-sep">·</span>
              {graph.summary.total_wireless_links} wireless
              <span className="ft-sep">·</span>
              {graph.summary.total_critical_issues} critical
              <span className="ft-sep">·</span>
            </>
          ) : null}
        </span>
        <span>
          Meraki Ops <b>v1.1</b>
        </span>
        <span className="ft-sep">·</span>
        <span>Packet Express topology</span>
      </footer>
      <RemediationModal action={pendingAction} onConfirm={applyAction} onClose={() => setPendingAction(undefined)} />
      <TopologyDebugPanel graph={graph} open={topoDebugOpen} onClose={() => setTopoDebugOpen(false)} />
    </div>
  );
}
