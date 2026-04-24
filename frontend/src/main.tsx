import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { executeRemediation, fetchTopology, listNetworks, listOrganizations, setMerakiApiKey } from "./api/client";
import { DetailsPanel } from "./components/DetailsPanel";
import { Filters } from "./components/Filters";
import { RemediationModal } from "./components/RemediationModal";
import { TopologyCanvas } from "./components/TopologyCanvas";
import { RemediationAction, TopologyGraph, TopologyLink, TopologyNode } from "./types/topology";

function App() {
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
  const [apiKey, setApiKey] = React.useState("");
  const [apiConnected, setApiConnected] = React.useState(false);
  const [apiError, setApiError] = React.useState("");

  const load = React.useCallback(async () => {
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
      await setMerakiApiKey(apiKey.trim());
      localStorage.setItem("merakiApiKey", apiKey.trim());
      const organizations = await listOrganizations();
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

  React.useEffect(() => {
    const savedKey = localStorage.getItem("merakiApiKey");
    if (!savedKey) return;
    setApiKey(savedKey);
    setMerakiApiKey(savedKey)
      .then(() => listOrganizations())
      .then((organizations) => {
        setOrgs(organizations);
        setApiConnected(true);
      })
      .catch(() => setApiConnected(false));
  }, []);

  React.useEffect(() => {
    if (orgId && apiConnected) listNetworks(orgId).then(setNets).catch(console.error);
  }, [orgId, apiConnected]);

  React.useEffect(() => {
    if (apiConnected) load().catch(console.error);
  }, [load, apiConnected]);

  const applyAction = async (action: RemediationAction) => {
    if (!orgId || !networkId || !graph) return;
    await executeRemediation(orgId, networkId, action, "dashboard-operator");
    setPendingAction(undefined);
    await load();
  };

  return (
    <div className="app">
      <header className="header">
        <h2 className="header-title">Meraki Network Operations Dashboard</h2>
        <input type="password" placeholder="Enter Meraki API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <button onClick={() => connectApiKey()}>{apiConnected ? "Reconnect key" : "Connect key"}</button>
        <select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
          <option value="">Select organization</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={networkId} onChange={(e) => setNetworkId(e.target.value)}>
          <option value="">Select network</option>
          {nets.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <button onClick={() => load()}>Refresh topology</button>
        {graph && (
          <div className="summary-inline">
            <span>Nodes: {graph.summary.total_nodes}</span>
            <span>Wired: {graph.summary.total_wired_links}</span>
            <span>Wireless: {graph.summary.total_wireless_links}</span>
            <span>Mismatches: {graph.summary.total_mismatches}</span>
            <span>Critical: {graph.summary.total_critical_issues}</span>
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
      />

      <main className="main">
        <section className="canvas">
          <TopologyCanvas
            graph={graph}
            search={search}
            showMismatchesOnly={showMismatchesOnly}
            showWireless={showWireless}
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
            <button key={a.id} onClick={() => setPendingAction(a)}>{a.label}</button>
          ))}
        </div>
      )}
      <RemediationModal action={pendingAction} onConfirm={applyAction} onClose={() => setPendingAction(undefined)} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
