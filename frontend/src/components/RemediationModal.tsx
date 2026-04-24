import { RemediationAction } from "../types/topology";

interface Props {
  action?: RemediationAction;
  onConfirm: (action: RemediationAction) => void;
  onClose: () => void;
}

export function RemediationModal({ action, onConfirm, onClose }: Props) {
  if (!action) {
    return null;
  }
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>{action.label}</h3>
        <p>Target: {action.target_device_serial} / port {action.target_port_id}</p>
        <h4>Current</h4>
        <pre>{JSON.stringify(action.current_values, null, 2)}</pre>
        <h4>Proposed</h4>
        <pre>{JSON.stringify(action.proposed_values, null, 2)}</pre>
        <div className="modal-actions">
          <button onClick={() => onConfirm(action)}>Apply remediation</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
