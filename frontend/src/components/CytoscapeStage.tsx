import React from "react";
import cytoscape, { type Core, type EventObject } from "cytoscape";
import fcose from "cytoscape-fcose";
import { Icon } from "./Icon";
import { DetailDrawer } from "./DetailDrawer";
import { buildCyElements, linkPassesOpsFilters, nodePassesOpsFilters } from "../topology/buildCyElements";
import { applyCyTheme, classColor, classTier } from "../topology/cyStyle";
import { asDeviceClass, DEVICE_CLASSES } from "../topology/deviceClass";
import type { LayoutMode, UiPrefs } from "../topology/prefs";
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
    directed: false,
    spacingFactor: 1.1,
    grid: true,
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
  emptyTitle: string;
  emptySub: string;
}

export const CytoscapeStage = React.forwardRef<StageHandle, Props>(function CytoscapeStage(
  { graph, orgId, networkId, prefs, setPrefs, onVisibleCount, onSearchIndex, onRemediation, emptyTitle, emptySub },
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

  const nodeById = React.useMemo(() => new Map((graph?.nodes || []).map((n) => [n.id, n])), [graph]);
  const linkById = React.useMemo(() => new Map((graph?.links || []).map((l) => [l.id, l])), [graph]);

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

  const pickRoots = React.useCallback((cy: Core) => {
    const cores = cy.nodes().filter((n) => n.data("type") === "core" && n.style("display") !== "none");
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
          const incident = graph.links.filter((l) => l.source === raw.id || l.target === raw.id);
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
      if (prefs.allLabels) cy.nodes('[type="ap"],[type="phone"],[type="client"],[type="mv"]').addClass("showlabel");
      else cy.nodes().removeClass("showlabel");
      if (prefs.backbone) cy.edges('[kind="backbone"]').addClass("bb-hi");
      else cy.edges('[kind="backbone"]').removeClass("bb-hi");
    },
    [graph, nodeById, linkById, prefs, onVisibleCount]
  );

  const clearSel = React.useCallback(
    (cy: Core) => {
      cy.elements().removeClass("sel nbr hi faded");
      setSelectedNode(undefined);
      setSelectedLink(undefined);
      setNeighbors([]);
      setPrefs({ selectedId: null, selectedKind: null });
    },
    [setPrefs]
  );

  const selectNode = React.useCallback(
    (id: string, recenter = false) => {
      const cy = cyRef.current;
      if (!cy) return;
      const node = cy.getElementById(id);
      if (!node || node.empty()) return;
      if (node.style("display") === "none") node.style("display", "element");
      cy.elements().removeClass("sel nbr hi faded");
      const nhood = node.closedNeighborhood();
      cy.elements().not(nhood).addClass("faded");
      node.neighborhood("node").addClass("nbr");
      node.connectedEdges().addClass("hi");
      node.addClass("sel");
      const raw = nodeById.get(id);
      setSelectedNode(raw);
      setSelectedLink(undefined);
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
    [nodeById, setPrefs]
  );

  const selectLink = React.useCallback(
    (id: string) => {
      const cy = cyRef.current;
      if (!cy) return;
      const edge = cy.getElementById(id);
      if (!edge || edge.empty()) return;
      cy.elements().removeClass("sel nbr hi faded");
      const nhood = edge.connectedNodes().union(edge);
      cy.elements().not(nhood).addClass("faded");
      edge.addClass("sel hi");
      edge.connectedNodes().addClass("nbr");
      setSelectedLink(linkById.get(id));
      setSelectedNode(undefined);
      setNeighbors([]);
      setPrefs({ selectedId: id, selectedKind: "link" });
    },
    [linkById, setPrefs]
  );

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

    cy.on("tap", "node", (e: EventObject) => selectNode(e.target.id(), true));
    cy.on("tap", "edge", (e: EventObject) => selectLink(e.target.id()));
    cy.on("tap", (e: EventObject) => {
      if (e.target === cy) clearSel(cy);
    });
    cy.on("mouseover", "node", () => {
      document.body.style.cursor = "pointer";
    });
    cy.on("mouseout", "node", () => {
      document.body.style.cursor = "default";
    });
    cy.on("dragfree", "node", () => persistPositions(cy));

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
    if (!cy || !graph) {
      cyRef.current?.elements().remove();
      return;
    }
    appliedSaved.current = false;
    cy.elements().remove();
    cy.add(buildCyElements(graph));
    applyCyTheme(cy, prefs.theme !== "light");
    applyFilters(cy);

    const saved = graph.nodes.filter((n) => n.position && (n.position.x || n.position.y));
    const useSaved = saved.length > graph.nodes.length * 0.5;
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
  }, [graph]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div id="cy" ref={containerRef} />
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
      />
    </main>
  );
});

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
