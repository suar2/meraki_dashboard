# Architecture

## Backend layout

- `backend/app/config.py`: environment loading and validation
- `backend/app/services/meraki_client.py`: Meraki API transport wrapper
- `backend/app/services/topology_service.py`: data normalization into graph model
- `backend/app/services/validation_service.py`: mismatch/fault rules and remediations
- `backend/app/services/remediation_service.py`: safe apply workflow and guardrails
- `backend/app/services/layout_service.py`: node layout storage/retrieval
- `backend/app/services/audit_service.py`: change log persistence
- `backend/app/api/routes.py`: API endpoints used by frontend

## Frontend layout

- `frontend/src/main.tsx`: app shell, org/network selector, topology canvas, remediation UX
- `frontend/src/components/Filters.tsx`: search + topology filters
- `frontend/src/components/DetailsPanel.tsx`: node/link detail pane
- `frontend/src/components/RemediationModal.tsx`: apply confirmation modal
- `frontend/src/api/client.ts`: backend API adapter
- `frontend/src/types/topology.ts`: normalized graph contracts

## Data model summary

- Node: managed/unmanaged network entity with metadata and persistent position
- Link: wired/wireless/discovered link with endpoint metadata and health
- Issue: classified fault/mismatch with severity/remediable metadata
- RemediationAction: executable safe change payload with before/after state

## Runtime notes

- Wired topology is sourced from Meraki link-layer topology and augmented with per-device LLDP/CDP neighbors.
- Wireless client links come only from client association data, not LLDP/CDP.
- Remediation endpoints enforce a strict allow-list of configuration keys.
- Layout persistence and audit records are scoped to organization/network context.

