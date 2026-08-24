import React from "react";
import { asDeviceClass, DEVICE_CLASSES } from "../topology/deviceClass";
import type { TopologyNode } from "../types/topology";

interface Props {
  nodes: TopologyNode[];
  onFocus: () => void;
  onFit: () => void;
  onTrace: () => void;
  onSave: () => void;
  onGroup: () => void;
  onHide: () => void;
  onHideOthers: () => void;
  onClear: () => void;
  onGoto: (id: string) => void;
}

export function SelectionPanel({ nodes, onFocus, onFit, onTrace, onSave, onGroup, onHide, onHideOthers, onClear, onGoto }: Props) {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const cls = asDeviceClass(String(node.device_class));
    const label = DEVICE_CLASSES[cls]?.label || cls;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return (
    <aside id="detail" className="open">
      <div className="d-head">
        <button type="button" className="d-close" onClick={onClear} aria-label="Clear selection">
          ×
        </button>
        <div className="d-type">
          <span className="label">Selected devices</span>
        </div>
        <div className="d-name">{nodes.length} nodes</div>
      </div>
      <div className="d-body">
        <div className="ops-grid">
          {[...counts.entries()].map(([label, n]) => (
            <div className="ops-cell" key={label}>
              <b>{n}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div className="d-sub">
          <span className="bar" />
          <span className="t">Actions</span>
        </div>
        <div className="sel-actions">
          <button type="button" className="fix-btn" onClick={onFocus}>
            Focus selection
          </button>
          <button type="button" className="fix-btn ghost" onClick={onFit}>
            Fit to selection
          </button>
          <button type="button" className="fix-btn ghost" onClick={onTrace}>
            Trace relationships
          </button>
          <button type="button" className="fix-btn ghost" onClick={onSave}>
            Save as view
          </button>
          <button type="button" className="fix-btn ghost" onClick={onGroup}>
            Create group
          </button>
          <button type="button" className="fix-btn ghost" onClick={onHide}>
            Hide selected
          </button>
          <button type="button" className="fix-btn ghost" onClick={onHideOthers}>
            Hide others
          </button>
          <button type="button" className="fix-btn ghost" onClick={onClear}>
            Clear
          </button>
        </div>
        <div className="d-sub">
          <span className="bar" />
          <span className="t">Members</span>
        </div>
        <div id="d-nbrs">
          {nodes.map((node) => (
            <div key={node.id} className="nbr" role="button" tabIndex={0} onClick={() => onGoto(node.id)} onKeyDown={(e) => e.key === "Enter" && onGoto(node.id)}>
              <div className="nbr-main">
                <div className="nbr-name">{node.hostname || node.label}</div>
                <div className="nbr-path">{node.platform || node.device_class}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
