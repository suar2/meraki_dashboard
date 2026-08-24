import React from "react";
import cytoscape, { type Core, type EventObject } from "cytoscape";
import fcose from "cytoscape-fcose";
import { Icon } from "./Icon";
import { DetailDrawer, type MergeRequest } from "./DetailDrawer";
import { buildCyElements, linkPassesOpsFilters, nodePassesOpsFilters } from "../topology/buildCyElements";
import { applyCyTheme, classColor, classTier } from "../topology/cyStyle";
import { asDeviceClass, DEVICE_CLASSES } from "../topology/deviceClass";
import type { LayoutMode, UiPrefs } from "../topology/prefs";
import { branchForPort, groupIdForHiddenMember, peersOnSwitchPort, presentGraph } from "../topology/presentGraph";
import { type TraceHop, traceToInternet } from "../topology/tracePath";
import { saveLayout } from "../api/client";
import type { RemediationAction, TopologyGraph, TopologyLink, TopologyNode } from "../types/topology";

cytoscape.use(fcose);

const LAYOUT_SAVE_MS = 400;

const LAYOUTS: Record<LayoutMode, Record<string, unknown>> = {
  fcose: {
    name: "fcose",
    quality: "proof",
    randomize: true,
    animate: true,
    animationDuration: 700,
    animationEasing: "ease-out",
    fit: true,
    padding: 60,
    nodeSeparation: 190,
    nodeRepulsion: 17000,
    idealEdgeLength: 150,
    edgeElasticity: 0.45,
    gravity: 0.15,
    gravityRange: 2.8,
    numIter: 3000,
    tile: true,
    tilingPaddingVertical: 24,
    tilingPaddingHorizontal: 24,
    nodeDimensionsIncludeLabels: true,
    packComponents: true,
  },
  breadthfirst: {
    name: "breadthfirst",
    animate: true,
    animationDuration: 650,
    fit: true,
    padding: 60,
    directed: true,
    spacingFactor: 1.15,
    grid: false,
    circle: false,
    maximal: false,
    avoidOverlap: true,
    nodeDimensionsIncludeLabels: true,
  },
};

export interface StageHandle {
  exportPNG: () => void;
  exportCSV: () => void;
  exportJSON: () => void;
  selectNode: (id: string, recenter?: boolean) => void;
  getVisibleCount: () => number;
  highlightPort: (serial: string, portId: string) => void;
}

interface Props {
  graph: TopologyGraph | null;
  orgId: string;
  networkId: string;
  prefs: UiPrefs;
  setPrefs: (patch: Partial<UiPrefs>) => void;
  onVisibleCount: (n: number) => void;
  onSearchIndex: (hits: { id: string; label: string; ip: string; type: string; color: string }[]) => void;
  onRemediation: (action: RemediationAction) => void;
  onMerge?: (request: MergeRequest) => void;
  emptyTitle: string;
  emptySub: string;
}

export const CytoscapeStage = React.forwardRef<StageHandle, Props>(function CytoscapeStage(
  { graph, orgId, networkId, prefs, setPrefs, onVisibleCount, onSearchIndex, onRemediation, onMerge, emptyTitle, emptySub },
  ref
) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const cyRef = React.useRef<Core | null>(null);
  const tooltipRef = React.useRef<HTMLDivElement | null>(null);
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutName = React.useRef<LayoutMode>(prefs.layout);
  const appliedSaved = React.useRef(false);
  const [selectedNode, setSelectedNode] = React.useState<TopologyNode | undefined>();
  const [selectedLink, setSelectedLink] = React.useState<TopologyLink | undefined>();
  const [neighbors, setNeighbors] = React.useState<{ id: string; label: string; color: string; type: string; myIf: string; theirIf: string }[]>([]);
  const [traceHops, setTraceHops] = React.useState<TraceHop[]>([]);
  const [ctxMenu, setCtxMenu] = React.useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [portHighlight, setPortHighlight] = React.useState<string>("");
  const pendingSelect = React.useRef<string | null>(null);
  const pendingFocus = React.useRef<{ nodeIds: string[]; linkIds: string[] } | null>(null);

  const presented = React.useMemo(() => {
    if (!graph) return null;
    return presentGraph(graph, presentOpts(prefs));
  }, [graph, prefs.visibilityMode, prefs.collapseWireless, prefs.collapseDownstream, prefs.expandedGroups]);

  const nodeById = React.useMemo(() => new Map((presented?.nodes || graph?.nodes || []).map((n) => [n.id, n])), [presented, graph]);
  const linkById = React.useMemo(() => new Map((presented?.links || graph?.links || []).map((l) => [l.id, l])), [presented, graph]);
  const nodeByIdRef = React.useRef(nodeById);
  const linkByIdRef = React.useRef(linkById);
  nodeByIdRef.current = nodeById;
  linkByIdRef.current = linkById;

  const portPanel = React.useMemo(
    () => resolvePortPanel(graph, selectedNode, selectedLink),
    [graph, selectedNode, selectedLink]
  );
  const peersByPort = React.useMemo(() => {
    if (!graph || !portPanel) return {};
    const map: Record<string, Array<{ id: string; label: string }>> = {};
    for (const port of portPanel.ports) {
      const id = String(port.portId || "");
      if (!id) continue;
      map[id] = peersOnSwitchPort(graph, portPanel.serial, id);
    }
    return map;
  }, [graph, portPanel]);
  const mergeCandidates = React.useMemo(() => {
    if (!graph || !selectedNode) return [];
    if (selectedNode.managed || selectedNode.subtype === "wireless") return [];
    return graph.nodes.filter(
      (n) => n.id !== selectedNode.id && !n.managed && n.subtype !== "wireless" && n.type !== "meraki"
    );
  }, [graph, selectedNode]);

  const persistPositions = React.useCallback(
    (cy: Core) => {
      if (!orgId || !networkId || orgId === "O_DEMO") return;
      const positions: Record<string, { x: number; y: number }> = {};
      cy.nodes().forEach((n) => {
        const p = n.position();
        positions[n.id()] = { x: p.x, y: p.y };
      });
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveLayout(orgId, networkId, positions).catch((err) => console.warn("[topology] layout save failed", err));
      }, LAYOUT_SAVE_MS);
    },
    [orgId, networkId]
  );
  const persistPositionsRef = React.useRef(persistPositions);
  persistPositionsRef.current = persistPositions;

  const pickRoots = React.useCallback((cy: Core) => {
    const visible = (n: cytoscape.NodeSingular) => n.style("display") !== "none";
    const mxs = cy.nodes().filter((n) => n.data("type") === "mx" && visible(n));
    if (mxs.length) return mxs;
    const cores = cy.nodes().filter((n) => n.data("type") === "core" && visible(n));
    if (cores.length) return cores;
    let best: cytoscape.NodeSingular | null = null;
    cy.nodes(":visible").forEach((n) => {
      if (!best) {
        best = n;
        return;
      }
      const bt = classTier(best.data("type"));
      const nt = classTier(n.data("type"));
      if (nt > bt || (nt === bt && (n.data("deg") || 0) > (best.data("deg") || 0))) best = n;
    });
    return best || cy.nodes();
  }, []);

  const runLayout = React.useCallback(
    (cy: Core, name: LayoutMode, animate = true) => {
      layoutName.current = name;
      const vis = cy.nodes(":visible");
      const eles = (vis.length ? vis : cy.nodes()).union(cy.edges(":visible"));
      if (name === "breadthfirst") {
        (vis.length ? vis : cy.nodes()).layout({ name: "grid", animate: false }).run();
      }
      const opts: Record<string, unknown> = { ...LAYOUTS[name], eles, animate };
      if (name === "breadthfirst") {
        const roots = pickRoots(cy);
        if (!("empty" in roots) || !(roots as cytoscape.NodeCollection).empty()) opts.roots = roots;
      }
      cy.layout(opts as unknown as cytoscape.LayoutOptions).run();
    },
    [pickRoots]
  );

  const applyFilters = React.useCallback(
    (cy: Core) => {
      if (!graph) return;
      const hiddenTypes = new Set(prefs.hiddenTypes);
      const hiddenPlat = new Set(prefs.platforms);
      const hiddenFw = new Set(prefs.firmware);
      const passing = new Set<string>();
      cy.batch(() => {
        cy.nodes().forEach((n) => {
          const raw = nodeById.get(n.id());
          if (!raw) {
            n.style("display", "none");
            return;
          }
          const incident = (presented || graph).links.filter((l) => l.source === raw.id || l.target === raw.id);
          const okType = !hiddenTypes.has(String(n.data("type")));
          const okPlat = hiddenPlat.size === 0 || !hiddenPlat.has(String(n.data("platform")));
          const okFw = hiddenFw.size === 0 || !hiddenFw.has(String(n.data("sw_version"))) || n.data("sw_version") === "—";
          const okOps = nodePassesOpsFilters(raw, incident, {
            unmanagedOnly: prefs.unmanagedOnly,
            clientsOnly: prefs.clientsOnly,
            showMismatchesOnly: prefs.showMismatchesOnly,
            severityFilter: prefs.severityFilter,
            search: "",
          });
          const show = okType && okPlat && okFw && okOps;
          if (show) passing.add(n.id());
          n.style("display", show ? "element" : "none");
        });
        cy.edges().forEach((e) => {
          const raw = linkById.get(e.id());
          const srcOk = passing.has(e.source().id());
          const tgtOk = passing.has(e.target().id());
          const ops = raw
            ? linkPassesOpsFilters(raw, {
                showWireless: prefs.showWireless,
                wiredOnly: prefs.wiredOnly,
                wirelessOnly: prefs.wirelessOnly,
                showMismatchesOnly: prefs.showMismatchesOnly,
                severityFilter: prefs.severityFilter,
              })
            : true;
          e.style("display", srcOk && tgtOk && ops ? "element" : "none");
        });
      });
      onVisibleCount(cy.nodes(":visible").length);
      cy.nodes().removeClass("showlabel");
      if (prefs.allLabels) {
        cy.nodes('[type="ap"],[type="phone"],[type="client"],[type="mv"]').addClass("showlabel");
      } else {
        // Managed AP/camera chassis should stay labeled; clients stay quiet unless All labels is on.
        cy.nodes().filter((n) => {
          const type = String(n.data("type") || "");
          return Boolean(n.data("managed")) && (type === "ap" || type === "mv");
        }).addClass("showlabel");
      }
      if (prefs.backbone) cy.edges('[kind="backbone"]').addClass("bb-hi");
      else cy.edges('[kind="backbone"]').removeClass("bb-hi");
    },
    [graph, presented, nodeById, linkById, prefs, onVisibleCount]
  );

  const clearSel = React.useCallback(
    (cy: Core) => {
      cy.elements().removeClass("sel nbr hi faded trace");
      setSelectedNode(undefined);
      setSelectedLink(undefined);
      setNeighbors([]);
      setTraceHops([]);
      setPortHighlight("");
      setCtxMenu(null);
      setPrefs({ selectedId: null, selectedKind: null });
    },
    [setPrefs]
  );

  const expandGroup = React.useCallback(
    (groupId: string) => {
      const next = new Set(prefs.expandedGroups || []);
      next.add(groupId);
      setPrefs({ expandedGroups: [...next] });
    },
    [prefs.expandedGroups, setPrefs]
  );

  const expandForNode = React.useCallback(
    (id: string) => {
      if (!graph) return false;
      const gid = groupIdForHiddenMember(graph, id, {
        collapseWireless: prefs.collapseWireless !== false,
        collapseDownstream: prefs.collapseDownstream !== false,
        expandedGroups: prefs.expandedGroups || [],
      });
      if (!gid) return false;
      pendingSelect.current = id;
      expandGroup(gid);
      return true;
    },
    [graph, prefs.collapseWireless, prefs.collapseDownstream, prefs.expandedGroups, expandGroup]
  );

  const selectNode = React.useCallback(
    (id: string, recenter = false) => {
      const cy = cyRef.current;
      if (!cy) return;
      const rawPresented = nodeByIdRef.current.get(id);
      if (rawPresented?.type === "group") {
        expandGroup(id);
        return;
      }
      if (expandForNode(id)) return;
      const node = cy.getElementById(id);
      if (!node || node.empty()) {
        if (graph && graph.nodes.some((n) => n.id === id)) expandForNode(id);
        return;
      }
      if (node.style("display") === "none") node.style("display", "element");
      cy.elements().removeClass("sel nbr hi faded trace");
      const nhood = node.closedNeighborhood();
      cy.elements().not(nhood).addClass("faded");
      node.neighborhood("node").addClass("nbr");
      node.connectedEdges().addClass("hi");
      node.addClass("sel");
      const raw = nodeByIdRef.current.get(id) || graph?.nodes.find((n) => n.id === id);
      setSelectedNode(raw);
      setSelectedLink(undefined);
      setPortHighlight("");
      const rows: typeof neighbors = [];
      node.connectedEdges().forEach((e) => {
        const ed = e.data();
        const otherId = ed.source === id ? ed.target : ed.source;
        const other = cy.getElementById(otherId);
        rows.push({
          id: otherId,
          label: other.data("label") || otherId,
          color: other.data("color"),
          type: other.data("type"),
          myIf: ed.source === id ? ed.sourceIf : ed.targetIf,
          theirIf: ed.source === id ? ed.targetIf : ed.sourceIf,
        });
      });
      rows.sort((a, b) => classTier(b.type) - classTier(a.type) || a.label.localeCompare(b.label));
      setNeighbors(rows);
      setPrefs({ selectedId: id, selectedKind: "node" });
      if (recenter) {
        const visNhood = nhood.filter(":visible");
        cy.animate({ fit: { eles: visNhood, padding: 80 } }, { duration: 380 });
      }
    },
    [setPrefs, expandGroup, expandForNode, graph]
  );

  const selectLink = React.useCallback(
    (id: string) => {
      const cy = cyRef.current;
      if (!cy) return;
      const edge = cy.getElementById(id);
      if (!edge || edge.empty()) return;
      cy.elements().removeClass("sel nbr hi faded trace");
      const nhood = edge.connectedNodes().union(edge);
      cy.elements().not(nhood).addClass("faded");
      edge.addClass("sel hi");
      edge.connectedNodes().addClass("nbr");
      setSelectedLink(linkByIdRef.current.get(id));
      setSelectedNode(undefined);
      setNeighbors([]);
      setPrefs({ selectedId: id, selectedKind: "link" });
    },
    [setPrefs]
  );

  const applyFocus = React.useCallback((nodeIds: string[], linkIds: string[]) => {
    const cy = cyRef.current;
    if (!cy) return;
    const keep = new Set([...nodeIds, ...linkIds]);
    cy.nodes().forEach((n) => {
      if (keep.has(n.id())) return;
      const members = (n.data("memberIds") as string[] | undefined) || [];
      if (members.some((id) => keep.has(id))) keep.add(n.id());
    });
    cy.edges().forEach((e) => {
      if (keep.has(e.source().id()) && keep.has(e.target().id())) keep.add(e.id());
    });
    cy.elements().removeClass("sel nbr hi faded trace");
    cy.elements().forEach((el) => {
      if (keep.has(el.id())) el.addClass("trace");
      else el.addClass("faded");
    });
  }, []);

  const runTrace = React.useCallback(
    (nodeId: string) => {
      if (!graph) return;
      const hops = traceToInternet(graph, nodeId);
      const start = graph.nodes.find((n) => n.id === nodeId) || nodeByIdRef.current.get(nodeId);
      if (start?.type === "group") {
        expandGroup(start.id);
        setCtxMenu(null);
        return;
      }
      setTraceHops(hops);
      setCtxMenu(null);
      const nodeIds = hops.map((h) => h.nodeId).filter((id) => id !== "internet");
      const linkIds = hops.map((h) => h.linkId || "").filter(Boolean);
      const extra: string[] = [];
      for (const id of nodeIds) {
        const gid = groupIdForHiddenMember(graph, id, {
          collapseWireless: prefs.collapseWireless !== false,
          collapseDownstream: prefs.collapseDownstream !== false,
          expandedGroups: prefs.expandedGroups || [],
        });
        if (gid) extra.push(gid);
      }
      if (start) {
        setSelectedNode(start);
        setSelectedLink(undefined);
        setPrefs({ selectedId: nodeId, selectedKind: "node" });
      }
      if (extra.length) {
        pendingFocus.current = { nodeIds, linkIds };
        pendingSelect.current = nodeId;
        setPrefs({ expandedGroups: [...new Set([...(prefs.expandedGroups || []), ...extra])] });
        return;
      }
      applyFocus(nodeIds, linkIds);
    },
    [graph, applyFocus, prefs.collapseWireless, prefs.collapseDownstream, prefs.expandedGroups, setPrefs, expandGroup]
  );

  const highlightPort = React.useCallback(
    (serial: string, portId: string) => {
      if (!graph) return;
      const branch = branchForPort(graph, serial, portId);
      setPortHighlight(portId);
      setTraceHops([]);
      applyFocus(branch.nodeIds, branch.linkIds);
    },
    [graph, applyFocus]
  );

  const selectNodeRef = React.useRef(selectNode);
  const selectLinkRef = React.useRef(selectLink);
  const clearSelRef = React.useRef(clearSel);
  const runTraceRef = React.useRef(runTrace);
  selectNodeRef.current = selectNode;
  selectLinkRef.current = selectLink;
  clearSelRef.current = clearSel;
  runTraceRef.current = runTrace;

  React.useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      wheelSensitivity: 1,
      minZoom: 0.12,
      maxZoom: 3.5,
      style: [],
    });
    cyRef.current = cy;
    applyCyTheme(cy, document.documentElement.getAttribute("data-theme") !== "light");

    cy.on("tap", "node", (e: EventObject) => {
      setCtxMenu(null);
      selectNodeRef.current(e.target.id(), true);
    });
    cy.on("tap", "edge", (e: EventObject) => {
      setCtxMenu(null);
      selectLinkRef.current(e.target.id());
    });
    cy.on("tap", (e: EventObject) => {
      if (e.target === cy) {
        setCtxMenu(null);
        clearSelRef.current(cy);
      }
    });
    cy.on("cxttap", "node", (e: EventObject) => {
      const orig = e.originalEvent as MouseEvent | undefined;
      if (orig?.preventDefault) orig.preventDefault();
      const stage = containerRef.current?.parentElement;
      const r = stage?.getBoundingClientRect();
      const x = orig && r ? orig.clientX - r.left : 24;
      const y = orig && r ? orig.clientY - r.top : 24;
      setCtxMenu({ x, y, nodeId: e.target.id() });
    });
    cy.on("mouseover", "node", () => {
      document.body.style.cursor = "pointer";
    });
    cy.on("mouseout", "node", () => {
      document.body.style.cursor = "default";
    });
    cy.on("dragfree", "node", () => persistPositionsRef.current(cy));

    const tip = tooltipRef.current;
    const stage = containerRef.current.parentElement;
    const place = (evt: MouseEvent) => {
      if (!tip || !stage) return;
      const r = stage.getBoundingClientRect();
      let x = evt.clientX - r.left + 14;
      const y = evt.clientY - r.top - 14;
      if (x + tip.offsetWidth > stage.clientWidth - 10) x = evt.clientX - r.left - tip.offsetWidth - 14;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    };
    cy.on("mouseover", "edge", (e: EventObject) => {
      if (!tip || e.target.hasClass("faded")) return;
      const d = e.target.data();
      tip.innerHTML = `<div class="tt-line"><span class="tt-host">${esc(d.source)}:</span><span class="tt-if">${esc(d.sourceIf)}</span><span style="color:var(--txt-mid);margin:0 8px">&lt;-&gt;</span><span class="tt-host">${esc(d.target)}:</span><span class="tt-if">${esc(d.targetIf)}</span></div>`;
      place(e.originalEvent as MouseEvent);
      tip.style.display = "block";
    });
    cy.on("mousemove", "edge", (e: EventObject) => place(e.originalEvent as MouseEvent));
    cy.on("mouseout", "edge", () => {
      if (tip) tip.style.display = "none";
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
    // select handlers are stable enough; we recreate only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !graph || !presented) {
      cyRef.current?.elements().remove();
      return;
    }
    appliedSaved.current = false;
    cy.elements().remove();
    cy.add(buildCyElements(presented));
    applyCyTheme(cy, prefs.theme !== "light");
    applyFilters(cy);

    const saved = graph.nodes.filter((n) => n.position && (n.position.x || n.position.y));
    const useSaved = saved.length > graph.nodes.length * 0.5 && presented.nodes.length === graph.nodes.length;
    if (useSaved) {
      cy.nodes().forEach((n) => {
        const raw = nodeById.get(n.id());
        if (raw?.position) n.position({ x: raw.position.x, y: raw.position.y });
      });
      cy.fit(undefined, 55);
      appliedSaved.current = true;
    } else {
      runLayout(cy, prefs.layout, true);
    }

    const hits = graph.nodes.map((n) => ({
      id: n.id,
      label: n.hostname || n.label,
      ip: n.management_ip || "—",
      type: String(n.device_class),
      color: classColor(String(n.device_class)),
    }));
    onSearchIndex(hits);

    if (pendingFocus.current) {
      const focus = pendingFocus.current;
      pendingFocus.current = null;
      applyFocus(focus.nodeIds, focus.linkIds);
    }
    if (pendingSelect.current) {
      const id = pendingSelect.current;
      pendingSelect.current = null;
      selectNode(id, true);
    }
  }, [graph, presented]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    applyCyTheme(cy, prefs.theme !== "light");
  }, [prefs.theme]);

  React.useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !graph) return;
    applyFilters(cy);
    runLayout(cy, prefs.layout, false);
  }, [
    prefs.hiddenTypes,
    prefs.platforms,
    prefs.firmware,
    prefs.showWireless,
    prefs.wiredOnly,
    prefs.wirelessOnly,
    prefs.unmanagedOnly,
    prefs.clientsOnly,
    prefs.showMismatchesOnly,
    prefs.severityFilter,
    prefs.allLabels,
    prefs.backbone,
    graph,
    applyFilters,
    runLayout,
  ]);

  React.useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !graph) return;
    runLayout(cy, prefs.layout, true);
  }, [prefs.layout]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useImperativeHandle(ref, () => ({
    exportPNG: () => {
      const cy = cyRef.current;
      if (!cy) return;
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg-0").trim() || "#101219";
      const png = cy.png({ output: "blob", bg, full: true, scale: 2 }) as unknown as Blob;
      download(png, `topology.png`);
    },
    exportCSV: () => {
      const cy = cyRef.current;
      if (!cy) return;
      const rows = [["hostname", "ip", "category", "platform", "serial", "firmware", "health", "issues"]];
      cy.nodes(":visible").forEach((n) => {
        const d = n.data();
        const raw = nodeById.get(n.id());
        rows.push([d.label, d.ip, DEVICE_CLASSES[asDeviceClass(d.type)].label, d.platform, d.serial, d.sw_version, raw?.health.state || "", String(raw?.issue_count || 0)]);
      });
      const csv = rows.map((r) => r.map(csvField).join(",")).join("\n");
      download(new Blob([csv], { type: "text/csv" }), "topology.csv");
    },
    exportJSON: () => {
      if (!graph) return;
      download(new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" }), "topology.json");
    },
    selectNode: (id: string, recenter?: boolean) => selectNode(id, recenter),
    getVisibleCount: () => cyRef.current?.nodes(":visible").length || 0,
    highlightPort: (serial: string, portId: string) => highlightPort(serial, portId),
  }));

  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.animate({ zoom: cy.zoom() * factor, center: { eles: cy.nodes(":visible") } }, { duration: 180 });
  };

  const hasGraph = Boolean(graph);
  const visible = cyRef.current?.nodes(":visible").length ?? 0;

  return (
    <main id="stage">
      <div id="cy" ref={containerRef} onContextMenu={(e) => e.preventDefault()} />
      {!hasGraph && (
        <div id="import-state" className="show">
          <Icon name="search" />
          <div className="is-title">{emptyTitle}</div>
          <div className="is-sub">{emptySub}</div>
        </div>
      )}
      {hasGraph && visible === 0 && (
        <div id="empty-state" className="show">
          <Icon name="filter-x" />
          <div className="es-title">No devices match your filters</div>
          <div className="es-sub">They're filtered out, not gone — adjust or reset the filters to bring them back.</div>
        </div>
      )}
      <div id="edge-tooltip" ref={tooltipRef} />
      {ctxMenu && (
        <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} role="menu">
          <button type="button" onClick={() => runTrace(ctxMenu.nodeId)}>
            Trace to Internet
          </button>
        </div>
      )}
      <div id="statusbar">
        <span>
          <span className="st-k">NODE</span> <b>{selectedNode?.hostname || selectedLink?.id || "None"}</b>
        </span>
        <span className="sdiv" />
        <span>
          <span className="st-k">SHOWN</span> <b>{hasGraph ? visible : 0}</b>
        </span>
      </div>
      <div id="zoomctl">
        <button type="button" className="zbtn has-tip tip-left" data-tip="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(1.35)}>
          <Icon name="plus" />
        </button>
        <button type="button" className="zbtn has-tip tip-left" data-tip="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.35)}>
          <Icon name="minus" />
        </button>
        <button
          type="button"
          className="zbtn has-tip tip-left"
          data-tip="Fit content"
          aria-label="Fit content"
          onClick={() => cyRef.current?.fit(undefined, 55)}
        >
          <Icon name="maximize" />
        </button>
      </div>
      <DetailDrawer
        node={selectedNode}
        link={selectedLink}
        neighbors={neighbors}
        open={Boolean(selectedNode || selectedLink)}
        onClose={() => {
          if (cyRef.current) clearSel(cyRef.current);
        }}
        onGoto={(id) => selectNode(id, true)}
        onRemediation={onRemediation}
        switchPorts={portPanel?.ports}
        switchSerial={portPanel?.serial}
        highlightPortId={portHighlight || portPanel?.highlightPortId}
        peersByPort={peersByPort}
        onPortClick={(portId) => {
          if (portPanel?.serial) highlightPort(portPanel.serial, portId);
        }}
        onTrace={runTrace}
        onExpandGroup={expandGroup}
        traceHops={traceHops}
        graph={graph}
        mergeCandidates={mergeCandidates}
        onMerge={onMerge}
      />
    </main>
  );
});

function presentOpts(prefs: UiPrefs) {
  return {
    visibilityMode: prefs.visibilityMode || "physical_clients",
    collapseWireless: prefs.collapseWireless !== false,
    collapseDownstream: prefs.collapseDownstream !== false,
    expandedGroups: prefs.expandedGroups || [],
  } as const;
}

function csvField(f: string): string {
  return /[",\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function canonicalPort(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  const low = text.toLowerCase();
  if (low.startsWith("port") && /^\d+$/.test(low.slice(4))) return String(parseInt(low.slice(4), 10));
  if (/^\d+$/.test(text)) return String(parseInt(text, 10));
  return text;
}

function resolvePortPanel(
  graph: TopologyGraph | null,
  node?: TopologyNode,
  link?: TopologyLink
): { serial: string; ports: Array<Record<string, unknown>>; highlightPortId?: string } | null {
  if (!graph?.switch_ports) return null;
  const catalogs = graph.switch_ports;
  if (node && catalogs[node.id]) {
    return { serial: node.id, ports: catalogs[node.id] };
  }
  if (!link) return null;
  const srcSerial = String(link.source_port?.serial || link.source || "");
  const tgtSerial = String(link.target_port?.serial || link.target || "");
  if (catalogs[srcSerial]) {
    return {
      serial: srcSerial,
      ports: catalogs[srcSerial],
      highlightPortId: canonicalPort(link.source_port?.portId || link.source_interface),
    };
  }
  if (catalogs[tgtSerial]) {
    return {
      serial: tgtSerial,
      ports: catalogs[tgtSerial],
      highlightPortId: canonicalPort(link.target_port?.portId || link.target_interface),
    };
  }
  return null;
}
