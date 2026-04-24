import React from "react";
import { executeRemediation, fetchTopology } from "./api/client";
import { DetailsPanel } from "./components/DetailsPanel";
import { Filters } from "./components/Filters";
import { RemediationModal } from "./components/RemediationModal";
import { TopologyCanvas } from "./components/TopologyCanvas";
import { TopologyDebugPanel } from "./components/TopologyDebugPanel";
import { clearMerakiRequestCaches, getNetworksForOrg, getOrganizationsForApiKey } from "./merakiSession";
import { RemediationAction, TopologyGraph, TopologyLink, TopologyNode } from "./types/topology";

export function App() {
  const [orgs, setOrgs] = React.useState<any[]>([]);
  const [nets, setNets] = React.useState<any[]>([]);
  const [orgId, setOrgId] = React.useState("");
  const [networkId, setNetworkId] = React.useState("");
  const [graph, setGraph] = React.useState<TopologyGraph | null>(null);
  const [selectedNode, setSelectedNode] = React.useState<TopologyNode | undefined>();
  const [selectedLink, setSelectedLink] = React.useState<TopologyLink | undefined>();
  const [pendingAction, setPendingAction] = React.useState<RemediationAction>();
  const [search, setSearch] = React.useState("");
  const [showMismatchesOnly, setShowMismatchesOnly] = React.useState(false);
  const [showWireless, setShowWireless] = React.useState(true);
  const [wiredOnly, setWiredOnly] = React.useState(false);
  const [wirelessOnly, setWirelessOnly] = React.useState(false);
  const [unmanagedOnly, setUnmanagedOnly] = React.useState(false);
  const [clientsOnly, setClientsOnly] = React.useState(false);
  const [severityFilter, setSeverityFilter] = React.useState<"all" | "critical" | "warning" | "healthy">("all");
  const [apiKey, setApiKey] = React.useState("");
  const [apiConnected, setApiConnected] = React.useState(false);
  const [apiError, setApiError] = React.useState("");
  const [topoDebugOpen, setTopoDebugOpen] = React.useState(false);

  const loadTopology = React.useCallback(async () => {
    if (!orgId || !networkId) return;
    const data = await fetchTopology(orgId, networkId);
    setGraph(data);
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
      const organizations = (await getOrganizationsForApiKey(trimmed)) as any[];
      setOrgs(organizations);
      setApiConnected(true);
      setApiError("");
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Failed to validate API key. Check frontend-to-backend connectivity.";
      setApiConnected(false);
      setApiError(detail);
      setOrgs([]);
      setNets([]);
      setOrgId("");
      setNetworkId("");
    }
  }, [apiKey]);

  /** One-time startup: read stored key, validate, load orgs. Uses a shared in-flight request so HMR/StrictMode do not double-call the API. */
  React.useEffect(() => {
    const savedKey = localStorage.getItem("merakiApiKey");
    if (!savedKey) return;
    setApiKey(savedKey);
    let cancelled = false;
    getOrganizationsForApiKey(savedKey)
      .then((organizations) => {
        if (cancelled) return;
        setOrgs(organizations as any[]);
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
        if (!cancelled) setNets(n as any[]);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [orgId, apiConnected]);

  React.useEffect(() => {
    if (!apiConnected || !orgId || !networkId) return;
    let cancelled = false;
    fetchTopology(orgId, networkId)
      .then((data) => {
        if (!cancelled) setGraph(data);
      })
      .catch((e) => console.error(e));
    return () => {
      cancelled = true;
    };
  }, [apiConnected, orgId, networkId]);

  const applyAction = async (action: RemediationAction) => {
    if (!orgId || !networkId || !graph) return;
    await executeRemediation(orgId, networkId, action, "dashboard-operator");
    setPendingAction(undefined);
    await loadTopology();
  };

  return (
    <div className="app">
      <header className="header">
        <h2 className="header-title">Meraki Network Operations Dashboard</h2>
        <input type="password" placeholder="Enter Meraki API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <button type="button" onClick={() => void connectApiKey()}>
          {apiConnected ? "Reconnect key" : "Connect key"}
        </button>
        <select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
          <option value="">Select organization</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select value={networkId} onChange={(e) => setNetworkId(e.target.value)}>
          <option value="">Select network</option>
          {nets.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void loadTopology()}>
          Refresh topology
        </button>
        <button type="button" onClick={() => setTopoDebugOpen((o) => !o)} style={{ fontSize: 12 }}>
          Topology debug
        </button>
        {graph && (
          <div className="summary-inline">
            <span>Nodes: {graph.summary.total_nodes}</span>
            <span>Meraki: {graph.nodes.filter((n) => n.managed).length}</span>
            <span>Unmanaged: {graph.summary.unmanaged_neighbors}</span>
            <span>Wired: {graph.summary.total_wired_links}</span>
            <span>Wireless: {graph.summary.total_wireless_links}</span>
            <span>Issues: {graph.issues.length}</span>
            <span>Critical: {graph.summary.total_critical_issues}</span>
            <span>Warning: {graph.summary.total_warning_issues}</span>
            <span>Fixable: {graph.summary.remediable_issues}</span>
            <span>Manual: {graph.summary.manual_investigation_issues}</span>
          </div>
        )}
      </header>
      {apiError && <div className="api-error">{apiError}</div>}

      <Filters
        search={search}
        setSearch={setSearch}
        showMismatchesOnly={showMismatchesOnly}
        setShowMismatchesOnly={setShowMismatchesOnly}
        showWireless={showWireless}
        setShowWireless={setShowWireless}
        wiredOnly={wiredOnly}
        setWiredOnly={setWiredOnly}
        wirelessOnly={wirelessOnly}
        setWirelessOnly={setWirelessOnly}
        unmanagedOnly={unmanagedOnly}
        setUnmanagedOnly={setUnmanagedOnly}
        clientsOnly={clientsOnly}
        setClientsOnly={setClientsOnly}
        severityFilter={severityFilter}
        setSeverityFilter={setSeverityFilter}
      />

      <main className="main">
        <section className="canvas">
          <TopologyCanvas
            graph={graph}
            orgId={orgId}
            networkId={networkId}
            search={search}
            showMismatchesOnly={showMismatchesOnly}
            showWireless={showWireless}
            wiredOnly={wiredOnly}
            wirelessOnly={wirelessOnly}
            unmanagedOnly={unmanagedOnly}
            clientsOnly={clientsOnly}
            severityFilter={severityFilter}
            onNodeSelect={setSelectedNode}
            onLinkSelect={setSelectedLink}
            onRemediationTrigger={setPendingAction}
          />
        </section>
        <DetailsPanel node={selectedNode} link={selectedLink} allNodes={graph?.nodes || []} allLinks={graph?.links || []} />
      </main>

      {selectedLink && (selectedLink.remediable_actions?.length ?? 0) > 0 && (
        <div className="fixbar">
          {selectedLink.remediable_actions.map((a: RemediationAction) => (
            <button key={a.id} type="button" onClick={() => setPendingAction(a)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      <RemediationModal action={pendingAction} onConfirm={applyAction} onClose={() => setPendingAction(undefined)} />
      <TopologyDebugPanel graph={graph} open={topoDebugOpen} onClose={() => setTopoDebugOpen(false)} />
    </div>
  );
}
