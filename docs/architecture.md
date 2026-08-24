# Architecture

## Backend layout

- `backend/app/config.py`: environment loading and validation
- `backend/app/services/meraki_client.py`: Meraki API transport wrapper
- `backend/app/services/topology_service.py`: data normalization into graph model
- `backend/app/services/validation_service.py`: mismatch/fault rules and remediations
- `backend/app/services/history_service.py`: compact topology snapshots and change events
- `backend/app/services/diagnostics.py`: confidence / identity / orphan counts
- `backend/app/services/live_expectations.py`: lab adjacency regression fixture
- `backend/app/services/view_service.py`: shared saved views and logical groups
- `backend/app/services/remediation_service.py`: safe apply workflow and guardrails
- `backend/app/services/layout_service.py`: node layout storage/retrieval
- `backend/app/services/audit_service.py`: change log persistence
- `backend/app/api/routes.py`: API endpoints used by frontend

## Frontend layout

- `frontend/src/App.tsx`: dashboard shell (top bar, sidebar, stage, footer)
- `frontend/src/components/CytoscapeStage.tsx`: Cytoscape + fCoSE topology renderer, box/multi-select
- `frontend/src/components/Sidebar.tsx`: search, changes, diagnostics, saved views, groups, filters, Tree/Force
- `frontend/src/components/DetailDrawer.tsx`: node/link detail + Meraki health/remediation
- `frontend/src/components/SelectionPanel.tsx`: multi-select actions
- `frontend/src/components/RemediationModal.tsx`: apply confirmation modal
- `frontend/src/api/client.ts`: backend API adapter
- `frontend/src/types/topology.ts`: unified graph contracts
- `frontend/src/topology/deviceClass.ts`: device classes for MX/MS/MR/MV/MG
- `frontend/src/topology/presentGraph.ts`: visibility, collapse, focus, hide
- `frontend/src/topology/workspace.ts`: personal/shared saved views and groups

## Data model summary

- Node: managed/unmanaged entity with inventory fields (hostname, management IP, platform, firmware, serial, stack members, device class, degree, interfaces) plus Meraki health/issues/metadata
- Link: wired/wireless/discovered adjacency with both-side interface identity, port config/status, mismatches, faults, remediation, confidence, and evidence
- Issue: classified fault/mismatch with severity/remediable metadata
- RemediationAction: executable safe change payload with before/after state
- Snapshot: compact node/link/port extract used for change detection (not the full graph)
- Saved view: operational workspace (mode, selection, focus/hidden, filters, positions, zoom/pan)
- Logical group: named member_id set independent of Meraki

## Runtime notes

- Wired topology is sourced from Meraki link-layer topology and augmented with per-device LLDP/CDP neighbors.
- Wireless client links come only from client association data, not LLDP/CDP.
- Each topology build stamps diagnostics and lab-expectation results, then records a snapshot when the compact fingerprint changed.
- Remediation endpoints enforce a strict allow-list of configuration keys.
- Layout, history, saved views, and audit records are scoped to organization/network context.
- Personal views live in `localStorage`; shared views are stored by the FastAPI backend.
