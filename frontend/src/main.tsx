import React from "react";
import ReactDOM from "react-dom/client";
import { ReactFlow, Background, Controls, MiniMap, Node, Edge, useNodesState, useEdgesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { executeRemediation, fetchTopology, listNetworks, listOrganizations, saveLayout, setMerakiApiKey } from "./api/client";
import { DetailsPanel } from "./components/DetailsPanel";
import { Filters } from "./components/Filters";
import { RemediationModal } from "./components/RemediationModal";
import { RemediationAction, TopologyGraph, TopologyNode } from "./types/topology";

const LAYERS = {
  WAN: 0,
  FIREWALL: 100,
  CORE: 200,
  PORTS: 320,
  DEVICES: 430,
  CLIENTS: 540,
};

type NodeKind =
  | "internet"
  | "firewall"
  | "switch"
  | "switchPort"
  | "accessPoint"
  | "server"
  | "clientGroup"
  | "client"
  | "unknownDevice";

type EdgeKind = "uplink" | "portConnection" | "wirelessAssociation" | "clientConnection";

interface FlowNodeData {
  label: string;
  nodeType: NodeKind;
  collapsible?: boolean;
  collapsed?: boolean;
  details?: Record<string, unknown>;
}

function App() {
  const [orgs, setOrgs] = React.useState<any[]>([]);
  const [nets, setNets] = React.useState<any[]>([]);
  const [orgId, setOrgId] = React.useState("");
  const [networkId, setNetworkId] = React.useState("");
  const [graph, setGraph] = React.useState<TopologyGraph | null>(null);
  const [selectedNode, setSelectedNode] = React.useState<Node<FlowNodeData>>();
  const [selectedLink, setSelectedLink] = React.useState<any>();
  const [pendingAction, setPendingAction] = React.useState<RemediationAction>();
  const [search, setSearch] = React.useState("");
  const [showMismatchesOnly, setShowMismatchesOnly] = React.useState(false);
  const [showWireless, setShowWireless] = React.useState(true);
  const [apiKey, setApiKey] = React.useState("");
  const [apiConnected, setApiConnected] = React.useState(false);
  const [apiError, setApiError] = React.useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [collapsedIds, setCollapsedIds] = React.useState<Set<string>>(new Set());

  const edgeStyleFor = (kind: EdgeKind): Partial<Edge> => ({
    type: "smoothstep",
    animated: false,
    style: {
      stroke: "#00FFAA",
      strokeWidth: 2,
      strokeDasharray: kind === "wirelessAssociation" ? "6 4" : undefined,
    },
    data: { edgeType: kind },
  });

  const inferNodeKind = (n: TopologyNode): NodeKind => {
    if (n.subtype === "firewall") return "firewall";
    if (n.subtype === "switch") return "switch";
    if (n.subtype === "access_point" || n.subtype === "wireless") return "accessPoint";
    if (n.subtype === "server") return "server";
    if (n.subtype === "client") return "client";
    return "unknownDevice";
  };

  const coreSwitch = (data: TopologyGraph): TopologyNode | undefined => {
    const switches = data.nodes.filter((n) => n.subtype === "switch");
    if (switches.length === 0) return undefined;
    const degree = (id: string) => data.links.filter((l) => l.source === id || l.target === id).length;
    return switches.sort((a, b) => degree(b.id) - degree(a.id))[0];
  };

  const buildTree = (data: TopologyGraph): { nodes: Node<FlowNodeData>[]; edges: Edge[] } => {
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const firewall = data.nodes.find((n) => n.subtype === "firewall");
    const core = coreSwitch(data);
    if (!core) return { nodes: [], edges: [] };

    const resultNodes: Node<FlowNodeData>[] = [];
    const resultEdges: Edge[] = [];

    const pushNode = (node: Node<FlowNodeData>) => {
      if (!resultNodes.some((n) => n.id === node.id)) resultNodes.push(node);
    };

    const addNode = (id: string, label: string, nodeType: NodeKind, x: number, y: number, details?: Record<string, unknown>, collapsible = false) => {
      const collapsed = collapsedIds.has(id);
      pushNode({
        id,
        type: "default",
        position: { x, y },
        data: { label: collapsible ? `${label} ${collapsed ? "(+)" : "(-)"}` : label, nodeType, collapsible, collapsed, details },
        style: {
          border: `2px solid ${nodeType === "server" ? "#7b4dff" : nodeType === "switchPort" ? "#4ba3ff" : "#288f5a"}`,
          borderRadius: nodeType === "accessPoint" ? 24 : 8,
          background: nodeType === "server" ? "#2b2250" : nodeType === "switchPort" ? "#10283f" : "#0b1f3a",
          color: "#fff",
          padding: 8,
          fontSize: 12,
          maxWidth: 260,
        },
      });
    };

    addNode("internet", "Internet / WAN", "internet", 0, LAYERS.WAN);
    if (firewall) addNode(firewall.id, firewall.label, "firewall", 0, LAYERS.FIREWALL, firewall.metadata);
    addNode(core.id, core.label, "switch", 0, LAYERS.CORE, core.metadata);
    if (firewall) resultEdges.push({ id: "uplink-fw", source: "internet", target: firewall.id, ...edgeStyleFor("uplink") });
    resultEdges.push({ id: "uplink-core", source: firewall ? firewall.id : "internet", target: core.id, ...edgeStyleFor("uplink") });

    const interfaces = ((core.metadata.connected_interfaces as Array<Record<string, unknown>>) || []).slice();
    interfaces.sort((a, b) => String(a.portId || "").localeCompare(String(b.portId || "")));
    const spacing = 240;
    const startX = -((Math.max(interfaces.length, 1) - 1) * spacing) / 2;

    interfaces.forEach((entry, idx) => {
      const portId = String(entry.portId || "unknown");
      const peers = ((entry.connectedPeers as Array<Record<string, unknown>>) || []).slice();
      const portNodeId = `port-${core.id}-${portId}`;
      const x = startX + idx * spacing;
      const portConfig = (((entry as any).config || {}) as Record<string, unknown>);
      const portStatus = (((entry as any).status || {}) as Record<string, unknown>);
      const portLabel = `Port ${portId}\n${String(portConfig.type || "unknown")} | VLAN ${String(portConfig.vlan || portConfig.nativeVlan || "-")} | ${peers.length} peers`;
      addNode(portNodeId, portLabel, "switchPort", x, LAYERS.PORTS, { portId, config: portConfig, status: portStatus, connectedPeers: peers }, true);
      resultEdges.push({ id: `edge-core-${portNodeId}`, source: core.id, target: portNodeId, ...edgeStyleFor("portConnection") });
      if (collapsedIds.has(portNodeId)) return;

      peers.forEach((peer, pIdx) => {
        const peerId = String(peer.peer_id || peer.peer_label || `${portNodeId}-peer-${pIdx}`);
        const mapped = byId.get(peerId);
        const nodeType = mapped ? inferNodeKind(mapped) : "unknownDevice";
        const peerLabel = mapped?.label || String(peer.peer_label || peerId);
        const peerNodeId = `peer-${portNodeId}-${peerId}`;
        addNode(peerNodeId, peerLabel, nodeType, x, LAYERS.DEVICES + pIdx * 54, mapped?.metadata || peer);
        resultEdges.push({ id: `edge-${portNodeId}-${peerNodeId}`, source: portNodeId, target: peerNodeId, ...edgeStyleFor("portConnection") });

        if (mapped && (mapped.subtype === "access_point" || mapped.subtype === "wireless")) {
          const clients = data.links
            .filter((l) => l.link_type === "wireless" && (l.source === mapped.id || l.target === mapped.id))
            .map((l) => (l.source === mapped.id ? l.target : l.source))
            .map((id) => byId.get(id))
            .filter(Boolean) as TopologyNode[];

          const groups = [
            { key: "wifi", label: "WiFi Clients", items: clients.filter((c) => c.subtype === "wireless") },
            { key: "iot", label: "IoT Devices", items: clients.filter((c) => c.subtype === "client" && /iot|camera|sensor/i.test(c.label)) },
            { key: "unknown", label: "Unknown", items: clients.filter((c) => c.subtype === "client" && !/iot|camera|sensor/i.test(c.label)) },
          ].filter((g) => g.items.length > 0);

          groups.forEach((group, gIdx) => {
            const groupId = `group-${peerNodeId}-${group.key}`;
            addNode(groupId, `${group.label} (${group.items.length})`, "clientGroup", x + (gIdx - 1) * 130, LAYERS.CLIENTS, { items: group.items }, true);
            resultEdges.push({ id: `edge-${peerNodeId}-${groupId}`, source: peerNodeId, target: groupId, ...edgeStyleFor("wirelessAssociation") });
            if (collapsedIds.has(groupId)) return;
            group.items.forEach((client, cIdx) => {
              const clientNodeId = `client-${groupId}-${client.id}`;
              addNode(clientNodeId, `${client.label} (${(client.metadata.ip as string) || "-"})`, "client", x + (gIdx - 1) * 130, LAYERS.CLIENTS + 70 + cIdx * 48, client.metadata);
              resultEdges.push({ id: `edge-${groupId}-${clientNodeId}`, source: groupId, target: clientNodeId, ...edgeStyleFor("clientConnection") });
            });
          });
        }
      });
    });

    const mappedClientIds = new Set(
      resultNodes.filter((n) => n.id.startsWith("client-")).map((n) => n.id.split("-").slice(-1)[0])
    );
    const unmapped = data.nodes.filter((n) => n.subtype === "client" && !mappedClientIds.has(n.id));
    if (unmapped.length > 0) {
      const unmappedId = `group-${core.id}-unmapped`;
      addNode(unmappedId, `Unmapped Clients (${unmapped.length})`, "clientGroup", 0, LAYERS.CLIENTS, { items: unmapped }, true);
      resultEdges.push({ id: `edge-${core.id}-${unmappedId}`, source: core.id, target: unmappedId, ...edgeStyleFor("clientConnection") });
      if (!collapsedIds.has(unmappedId)) {
        unmapped.forEach((client, idx) => {
          const clientNodeId = `client-${unmappedId}-${client.id}`;
          addNode(clientNodeId, `${client.label} (${(client.metadata.ip as string) || "-"})`, "client", 0, LAYERS.CLIENTS + 70 + idx * 48, client.metadata);
          resultEdges.push({ id: `edge-${unmappedId}-${clientNodeId}`, source: unmappedId, target: clientNodeId, ...edgeStyleFor("clientConnection") });
        });
      }
    }

    return { nodes: resultNodes, edges: resultEdges };
  };

  const load = React.useCallback(async () => {
    if (!orgId || !networkId) return;
    const data = await fetchTopology(orgId, networkId);
    setGraph(data);
    const tree = buildTree(data);
    setNodes(tree.nodes);
    setEdges(tree.edges);
  }, [orgId, networkId, collapsedIds, setEdges, setNodes]);

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
      .catch(() => {
        setApiConnected(false);
      });
  }, []);

  React.useEffect(() => {
    if (orgId && apiConnected) listNetworks(orgId).then(setNets).catch(console.error);
  }, [orgId, apiConnected]);
  React.useEffect(() => {
    if (apiConnected) load().catch(console.error);
  }, [load, apiConnected]);

  const filteredNodes = nodes.filter((n) => String(n.data.label).toLowerCase().includes(search.toLowerCase()));
  const filteredEdges = edges.filter((e) => {
    if (!showWireless && e.data?.edgeType === "wirelessAssociation") return false;
    if (showMismatchesOnly) return e.data?.edgeType !== "clientConnection";
    return true;
  });

  const persistLayout = async () => {
    if (!orgId || !networkId) return;
    const positions: Record<string, { x: number; y: number }> = {};
    nodes.forEach((n) => {
      positions[n.id] = n.position;
    });
    await saveLayout(orgId, networkId, positions);
  };

  const onEdgeClick = (_: React.MouseEvent, edge: Edge) => {
    const found = graph?.links.find((l) => l.id === edge.id);
    setSelectedLink(found);
    setSelectedNode(undefined);
  };
  const onNodeClick = (_: React.MouseEvent, node: Node<FlowNodeData>) => {
    if (node.data.collapsible) {
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        return next;
      });
      return;
    }
    setSelectedNode(node);
    setSelectedLink(undefined);
  };

  const applyAction = async (action: RemediationAction) => {
    if (!orgId || !networkId || !graph) return;
    await executeRemediation(orgId, networkId, action, "dashboard-operator");
    setPendingAction(undefined);
    await load();
  };

  return (
    <div className="app">
      <header className="header">
        <h2>Meraki Network Operations Dashboard</h2>
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
        <button onClick={persistLayout}>Save layout</button>
      </header>
      {apiError && <div className="api-error">{apiError}</div>}

      {graph && (
        <div className="summary">
          <span>Nodes: {graph.summary.total_nodes}</span>
          <span>Wired: {graph.summary.total_wired_links}</span>
          <span>Wireless: {graph.summary.total_wireless_links}</span>
          <span>Mismatches: {graph.summary.total_mismatches}</span>
          <span>Critical: {graph.summary.total_critical_issues}</span>
        </div>
      )}

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
          <ReactFlow
            nodes={filteredNodes}
            edges={filteredEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            fitView
            fitViewOptions={{ padding: 0.25 }}
          >
            <MiniMap />
            <Controls />
            <Background />
          </ReactFlow>
        </section>
        <DetailsPanel node={selectedNode} link={selectedLink} allNodes={graph?.nodes || []} allLinks={graph?.links || []} />
      </main>

      {selectedLink?.remediable_actions?.length > 0 && (
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
