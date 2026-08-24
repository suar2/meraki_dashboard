import React from "react";

interface Props {
  open: boolean;
  title: string;
  submitLabel: string;
  nameLabel?: string;
  showScope?: boolean;
  onClose: () => void;
  onSubmit: (value: { name: string; shared: boolean; starred: boolean }) => void;
}

export function WorkspaceDialog({ open, title, submitLabel, nameLabel = "Name", showScope, onClose, onSubmit }: Props) {
  const [name, setName] = React.useState("");
  const [shared, setShared] = React.useState(true);
  const [starred, setStarred] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName("");
      setShared(true);
      setStarred(false);
    }
  }, [open]);

  if (!open) return null;
  return (
    <div className="ws-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ws-card">
        <div className="ws-title">{title}</div>
        <label className="ws-field">
          {nameLabel}
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Server Infrastructure" />
        </label>
        {showScope && (
          <div className="ws-scope">
            <button type="button" className={!shared ? "on" : ""} onClick={() => setShared(false)}>
              Personal
            </button>
            <button type="button" className={shared ? "on" : ""} onClick={() => setShared(true)}>
              Shared
            </button>
          </div>
        )}
        {showScope && (
          <label className="ws-check">
            <input type="checkbox" checked={starred} onChange={(e) => setStarred(e.target.checked)} />
            Star this view
          </label>
        )}
        <div className="ws-actions">
          <button type="button" className="fix-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="fix-btn"
            disabled={!name.trim()}
            onClick={() => onSubmit({ name: name.trim(), shared, starred })}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
