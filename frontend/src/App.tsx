import React from "react";
import {
  executeRemediation,
  fetchChanges,
  fetchTopology,
  listGroups,
  listViews,
  saveEntityMerge,
  saveGroup as saveSharedGroup,
  saveView as saveSharedView,
} from "./api/client";
import { CytoscapeStage, type StageHandle } from "./components/CytoscapeStage";
import { RemediationModal } from "./components/RemediationModal";
import { Sidebar, type ChangeWindow } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { TopologyDebugPanel } from "./components/TopologyDebugPanel";
import { WorkspaceDialog } from "./components/WorkspaceDialog";
import { clearMerakiRequestCaches, getNetworksForOrg, getOrganizationsForApiKey } from "./merakiSession";
import { SAMPLE_GRAPH } from "./sampleTopology";
import type { MergeRequest } from "./components/DetailDrawer";
import { applyLocalEntityMerge, switchPortOfNode } from "./topology/entityMerge";
import { DEVICE_CLASS_ORDER, DEVICE_CLASSES, asDeviceClass } from "./topology/deviceClass";
import { computeDiagnostics } from "./topology/diagnostics";
import { validateExpectations } from "./topology/liveExpectations";
import { applyTheme, loadPrefs, savePrefs, type UiPrefs } from "./topology/prefs";
import { filterChanges, sampleChanges } from "./topology/sampleChanges";
import { filterSearchHits } from "./topology/searchIndex";
import {
  defaultDemoGroups,
  defaultDemoViews,
  loadPersonalGroups,
  loadPersonalViews,
  mergeViews,
  prefsFromView,
  savePersonalGroups,
  savePersonalViews,
  viewFromWorkspace,
} from "./topology/workspace";
import type { LogicalGroup, RemediationAction, SavedView, SearchHit, TopologyChange, TopologyDiagnostics, TopologyGraph } from "./types/topology";

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
  const [searchIndex, setSearchIndex] = React.useState<SearchHit[]>([]);
  const [visibleCount, setVisibleCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [changes, setChanges] = React.useState<TopologyChange[]>([]);
  const [changeWindow, setChangeWindow] = React.useState<ChangeWindow>("24h");
  const [views, setViews] = React.useState<SavedView[]>([]);
  const [groups, setGroups] = React.useState<LogicalGroup[]>([]);
  const [activeViewId, setActiveViewId] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<null | "view" | "group">(null);
  const [pendingGroupIds, setPendingGroupIds] = React.useState<string[]>([]);
  const stageRef = React.useRef<StageHandle>(null);

  const isDemo = orgId === "O_DEMO" || graph?.organization.id === "O_DEMO";

  const loadWorkspace = React.useCallback(async (oid: string, nid: string, demo: boolean) => {
    if (!oid || !nid) return;
    if (demo) {
      let personal = loadPersonalViews(oid, nid);
      if (!personal.length) {
        personal = defaultDemoViews();
        savePersonalViews(oid, nid, personal);
      }
      setViews(personal);
      let localGroups = loadPersonalGroups(oid, nid);
      if (!localGroups.length) {
        localGroups = defaultDemoGroups();
        savePersonalGroups(oid, nid, localGroups);
      }
      setGroups(localGroups);
      return;
    }
    const personal = loadPersonalViews(oid, nid);
    try {
      const shared = await listViews(oid, nid);
      setViews(mergeViews(Array.isArray(shared) ? shared : [], personal));
    } catch {
      setViews(personal);
    }
    const personalGroups = loadPersonalGroups(oid, nid);
    try {
      const sharedGroups = await listGroups(oid, nid);
      const seen = new Set((Array.isArray(sharedGroups) ? sharedGroups : []).map((g) => g.id));
      setGroups([...(Array.isArray(sharedGroups) ? sharedGroups : []), ...personalGroups.filter((g) => !seen.has(g.id))]);
    } catch {
      setGroups(personalGroups);
    }
  }, []);

  const loadTopology = React.useCallback(async () => {
    if (!orgId || !networkId || orgId === "O_DEMO") return;
    setLoading(true);
    try {
      const data = await fetchTopology(orgId, networkId);
      setGraph(data);
      setApiError("");
      await loadWorkspace(orgId, networkId, false);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } }; message?: string };
      setApiError(err?.response?.data?.detail || err?.message || "Failed to load topology.");
    } finally {
      setLoading(false);
    }
  }, [orgId, networkId, loadWorkspace]);

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
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } }; message?: string };
      const detail = err?.response?.data?.detail || err?.message || "Failed to validate API key.";
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
    if (!apiConnected || !orgId || !networkId || orgId === "O_DEMO") return;
    void loadTopology();
  }, [apiConnected, orgId, networkId, loadTopology]);

  React.useEffect(() => {
    if (!orgId || !networkId || orgId === "O_DEMO" || !graph) return;
    let cancelled = false;
    fetchChanges(orgId, networkId, changeWindow)
      .then((hist) => {
        if (!cancelled) setChanges(hist.changes || []);
      })
      .catch(() => {
        if (!cancelled) setChanges([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, networkId, changeWindow, graph]);

  React.useEffect(() => {
    if (!isDemo || !graph) return;
    setChanges(filterChanges(sampleChanges(), changeWindow));
  }, [isDemo, graph, changeWindow]);

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

  const mergeEntities = async (request: MergeRequest) => {
    if (!graph) return;
    const survivorPort = switchPortOfNode(graph, request.survivorId);
    const memberPort = switchPortOfNode(graph, request.memberId);
    const payload = {
      org_id: orgId || String(graph.organization.id),
      network_id: networkId || String(graph.network.id),
      survivor_id: request.survivorId,
      member_ids: [request.memberId],
      label: request.label,
      device_class: "server",
      interfaces: [
        {
          switch_serial: survivorPort?.serial || "",
          port_id: survivorPort?.portId || "",
          role: request.survivorRole,
          member_id: request.survivorId,
        },
        {
          switch_serial: memberPort?.serial || "",
          port_id: memberPort?.portId || "",
          role: request.memberRole,
          member_id: request.memberId,
        },
      ],
    };
    if (graph.organization.id === "O_DEMO") {
      setGraph(applyLocalEntityMerge(graph, payload));
      return;
    }
    await saveEntityMerge(payload);
    await loadTopology();
  };

  const hits = React.useMemo(() => filterSearchHits(searchIndex, search), [search, searchIndex]);

  const diagnostics = React.useMemo<TopologyDiagnostics | null>(() => {
    if (!graph) return null;
    const local = computeDiagnostics(graph);
    const fromDebug = graph.topology_debug?.diagnostics as TopologyDiagnostics | undefined;
    if (fromDebug && typeof fromDebug.physical_edges === "number") return { ...local, ...fromDebug };
    return local;
  }, [graph]);

  const labChecks = React.useMemo(() => (graph ? validateExpectations(graph) : null), [graph]);

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
    setChanges(filterChanges(sampleChanges(), changeWindow));
    void loadWorkspace("O_DEMO", "N_DEMO", true);
  };

  const applyView = React.useCallback(
    (view: SavedView) => {
      setActiveViewId(view.id);
      setPrefs(prefsFromView(view, prefs));
      window.setTimeout(() => {
        stageRef.current?.applyCamera(view);
        if (view.selected_nodes?.length) stageRef.current?.selectNodes(view.selected_nodes, true);
        const port = view.selected_ports?.[0];
        if (port && port.includes(":")) {
          const [serial, portId] = port.split(":");
          stageRef.current?.highlightPort(serial, portId);
        }
      }, 120);
    },
    [prefs, setPrefs]
  );

  const persistView = async (value: { name: string; shared: boolean; starred: boolean }) => {
    const oid = orgId || String(graph?.organization.id || "O_DEMO");
    const nid = networkId || String(graph?.network.id || "N_DEMO");
    const camera = stageRef.current?.getCamera() || { zoom: 1, pan: { x: 0, y: 0 }, positions: {} };
    const selected = stageRef.current?.getSelectedIds() || [];
    const view = viewFromWorkspace(value.name, prefs, camera, selected, {
      shared: value.shared,
      starred: value.starred,
    });
    if (value.shared) {
      try {
        const saved = await saveSharedView(oid, nid, view);
        setViews((prev) => mergeViews([saved], prev.filter((v) => !v.shared || v.id !== saved.id)));
        setActiveViewId(saved.id);
        setDialog(null);
        return;
      } catch {
        /* fall through to personal */
      }
    }
    const next = [...loadPersonalViews(oid, nid).filter((v) => v.id !== view.id), { ...view, shared: false }];
    savePersonalViews(oid, nid, next);
    setViews((prev) => mergeViews(prev.filter((v) => v.shared), next));
    setActiveViewId(view.id);
    setDialog(null);
  };

  const starView = async (view: SavedView) => {
    const oid = orgId || "O_DEMO";
    const nid = networkId || "N_DEMO";
    const patched = { ...view, starred: !view.starred, updated_at: new Date().toISOString() };
    if (view.shared) {
      try {
        const saved = await saveSharedView(oid, nid, patched);
        setViews((prev) => mergeViews([saved], prev.filter((v) => v.id !== saved.id)));
        return;
      } catch {
        /* personal fallback */
      }
    }
    const next = loadPersonalViews(oid, nid).map((v) => (v.id === view.id ? patched : v));
    if (!next.some((v) => v.id === view.id)) next.push(patched);
    savePersonalViews(oid, nid, next);
    setViews((prev) => prev.map((v) => (v.id === view.id ? patched : v)).sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred))));
  };

  const persistGroup = async (value: { name: string }) => {
    const oid = orgId || "O_DEMO";
    const nid = networkId || "N_DEMO";
    const memberIds = pendingGroupIds.length ? pendingGroupIds : stageRef.current?.getSelectedIds() || [];
    const group: LogicalGroup = { id: `grp-${Date.now()}`, name: value.name, member_ids: memberIds };
    if (memberIds.length) {
      try {
        const saved = await saveSharedGroup(oid, nid, group);
        setGroups((prev) => [...prev.filter((g) => g.id !== saved.id), saved]);
        setDialog(null);
        setPendingGroupIds([]);
        return;
      } catch {
        /* personal */
      }
    }
    const next = [...loadPersonalGroups(oid, nid).filter((g) => g.id !== group.id), group];
    savePersonalGroups(oid, nid, next);
    setGroups(next);
    setDialog(null);
    setPendingGroupIds([]);
  };

  const pickChange = (change: TopologyChange) => {
    if (change.node_id) {
      stageRef.current?.selectNode(change.node_id, true);
      stageRef.current?.runTrace(change.node_id);
    }
    if (change.port && change.port.includes(":")) {
      const [serial, portId] = change.port.split(":");
      stageRef.current?.highlightPort(serial, portId);
    }
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
            setSearchOpen(false);
            stageRef.current?.selectNode(id, true);
            stageRef.current?.runTrace(id);
          }}
          categories={categories}
          platforms={platforms}
          firmware={firmware}
          visibleCount={visibleCount}
          changes={changes}
          changeWindow={changeWindow}
          setChangeWindow={setChangeWindow}
          onPickChange={pickChange}
          diagnostics={diagnostics}
          labChecks={labChecks}
          views={views}
          activeViewId={activeViewId}
          onApplyView={applyView}
          onSaveView={() => setDialog("view")}
          onStarView={(view) => void starView(view)}
          groups={groups}
          onApplyGroup={(group) => stageRef.current?.selectNodes(group.member_ids, true)}
          onCreateGroup={() => {
            setPendingGroupIds(stageRef.current?.getSelectedIds() || []);
            setDialog("group");
          }}
          onShowAll={() => setPrefs({ focusIds: [], hiddenNodeIds: [] })}
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
          onMerge={(req) => void mergeEntities(req)}
          emptyTitle={loading ? "Loading topology…" : "Explore your network"}
          emptySub={
            loading
              ? "Fetching devices, LLDP/CDP links, ports and clients from Meraki."
              : "Connect a Meraki API key and choose an organization + network, or load the sample topology to preview the physical map."
          }
          changes={changes}
          onRequestSaveView={() => setDialog("view")}
          onRequestCreateGroup={(ids) => {
            setPendingGroupIds(ids);
            setDialog("group");
          }}
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
          Meraki Ops <b>v1.2</b>
        </span>
      </footer>
      <RemediationModal action={pendingAction} onConfirm={applyAction} onClose={() => setPendingAction(undefined)} />
      <TopologyDebugPanel graph={graph} open={topoDebugOpen} onClose={() => setTopoDebugOpen(false)} />
      <WorkspaceDialog
        open={dialog === "view"}
        title="Save dashboard view"
        submitLabel="Save view"
        showScope
        onClose={() => setDialog(null)}
        onSubmit={(value) => void persistView(value)}
      />
      <WorkspaceDialog
        open={dialog === "group"}
        title="Create group"
        submitLabel="Create group"
        nameLabel="Group name"
        onClose={() => {
          setDialog(null);
          setPendingGroupIds([]);
        }}
        onSubmit={(value) => void persistGroup(value)}
      />
    </div>
  );
}
