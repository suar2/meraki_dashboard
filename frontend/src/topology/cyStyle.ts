import type { Core, StylesheetJson } from "cytoscape";
import { DEVICE_CLASS_ORDER, asDeviceClass, classVisuals } from "./deviceClass";

export function buildCyStyle(isDark: boolean): StylesheetJson {
  const edgeColor = getComputedStyle(document.documentElement).getPropertyValue("--cy-edge").trim() || "#545868";
  const nodeBorder = getComputedStyle(document.documentElement).getPropertyValue("--cy-node-border").trim() || "#101219";
  const textOutline = getComputedStyle(document.documentElement).getPropertyValue("--cy-text-outline").trim() || "#101219";
  const textBg = getComputedStyle(document.documentElement).getPropertyValue("--cy-text-bg").trim() || "#101219";
  const textColor = getComputedStyle(document.documentElement).getPropertyValue("--cy-text-color").trim() || "#e4e5e9";
  const textBgOp = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cy-text-bg-op")) || 0.75;

  return [
    {
      selector: "node",
      style: {
        "background-color": "data(color)",
        width: "data(size)",
        height: "data(size)",
        "border-width": 2,
        "border-color": nodeBorder,
        label: "data(label)",
        color: textColor,
        "font-family": "ui-monospace,Menlo,monospace",
        "font-size": 9,
        "font-weight": 500,
        "text-valign": "bottom",
        "text-halign": "center",
        "text-margin-y": 5,
        "text-outline-color": textOutline,
        "text-outline-width": 2.4,
        "text-background-color": textBg,
        "text-background-opacity": textBgOp,
        "text-background-padding": "2px",
        "text-background-shape": "roundrectangle",
        "text-max-width": "120px",
        "min-zoomed-font-size": 7,
        "z-index": 10,
        shape: "ellipse",
        "background-image": "data(healthDot)",
        "background-fit": "contain",
        "background-clip": "none",
        "background-repeat": "no-repeat",
        "transition-property": "opacity,border-color,border-width",
        "transition-duration": 150,
      },
    },
    {
      selector: 'node[type="core"]',
      style: {
        "font-size": 11,
        "font-weight": 700,
        "border-width": 3,
        "text-margin-y": 7,
      },
    },
    {
      selector: 'node[type="mx"], node[type="wlc"], node[type="server"]',
      style: { "font-size": 10, "font-weight": 600, "text-margin-y": 6 },
    },
    {
      selector: 'node[type="ap"], node[type="phone"], node[type="client"], node[type="mv"]',
      style: { "text-opacity": 0 },
    },
    { selector: ".showlabel", style: { "text-opacity": 1 } },
    { selector: "node[isGroup = 1]", style: { "text-opacity": 1, "font-size": 9, "font-weight": 600, "text-max-width": "140px", shape: "round-rectangle" } },
    {
      selector: "edge",
      style: {
        width: 1.4,
        "line-color": edgeColor,
        opacity: isDark ? 0.45 : 0.7,
        "curve-style": "bezier",
        "control-point-step-size": 18,
        "overlay-padding": 10,
        "overlay-opacity": 0,
        "overlay-color": "#9da9ff",
        "z-index": 20,
        events: "yes",
        "transition-property": "opacity,line-color,width",
        "transition-duration": 150,
      },
    },
    {
      selector: 'edge[linkType="wired"], edge[linkType="discovered_partial"]',
      style: { "z-index": 30, "overlay-padding": 12 },
    },
    {
      selector: 'edge[linkType="wireless"]',
      style: { "line-style": "dashed", width: 1.2, "z-index": 5, "overlay-padding": 4 },
    },
    {
      selector: 'edge[kind="uplink"]',
      style: { width: 2.2, "z-index": 40, "overlay-padding": 14, opacity: isDark ? 0.7 : 0.85 },
    },
    {
      selector: 'edge[health="warning"]',
      style: { "line-color": "#fac22b", opacity: 0.85, width: 1.6 },
    },
    {
      selector: 'edge[health="critical"]',
      style: { "line-color": "#dc3146", opacity: 0.95, width: 2 },
    },
    {
      selector: ".bb-hi",
      style: { width: 2.2, "line-color": "#808aff", opacity: 0.85 },
    },
    {
      selector: "node.sel",
      style: {
        "border-color": "#ffffff",
        "border-width": 3,
        "overlay-color": "data(color)",
        "overlay-opacity": 0.22,
        "overlay-padding": 6,
        "overlay-shape": "ellipse",
        "z-index": 99,
        "text-opacity": 1,
        color: "#ffffff",
        "font-weight": 700,
      },
    },
    {
      selector: "node.nbr",
      style: {
        "border-color": "#9da9ff",
        "border-width": 2.4,
        "text-opacity": 1,
        "z-index": 50,
      },
    },
    {
      selector: "edge.hi",
      style: { "line-color": "#9da9ff", opacity: 0.95, width: 2.6, "z-index": 90 },
    },
    {
      selector: "edge.sel",
      style: { "line-color": "#ffffff", opacity: 1, width: 3, "z-index": 95 },
    },
    {
      selector: "edge.trace",
      style: { "line-color": "#7ee0c3", opacity: 1, width: 3.2, "z-index": 96 },
    },
    {
      selector: "node.trace",
      style: { "border-color": "#7ee0c3", "border-width": 3, "text-opacity": 1, "z-index": 97 },
    },
    {
      selector: ".faded",
      style: { opacity: isDark ? 0.22 : 0.42, "text-opacity": 0 },
    },
  ];
}

export function applyCyTheme(cy: Core, isDark: boolean): void {
  cy.style().fromJson(buildCyStyle(isDark)).update();
}

export function classColor(type: string): string {
  return classVisuals(asDeviceClass(type)).color;
}

export function classTier(type: string): number {
  return classVisuals(asDeviceClass(type)).tier;
}

export function sortClassIds(a: string, b: string): number {
  return DEVICE_CLASS_ORDER.indexOf(asDeviceClass(a)) - DEVICE_CLASS_ORDER.indexOf(asDeviceClass(b));
}
