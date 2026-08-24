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

- `frontend/src/App.tsx`: Packet Express shell (top bar, sidebar, stage, footer)
- `frontend/src/components/CytoscapeStage.tsx`: Cytoscape + fCoSE topology renderer
- `frontend/src/components/Sidebar.tsx`: search, display, topology, platform/firmware/category filters, Tree/Force
- `frontend/src/components/DetailDrawer.tsx`: node/link detail + Meraki health/remediation
- `frontend/src/components/RemediationModal.tsx`: apply confirmation modal
- `frontend/src/api/client.ts`: backend API adapter
- `frontend/src/types/topology.ts`: unified graph contracts
- `frontend/src/topology/deviceClass.ts`: Packet Express classes extended for MX/MS/MR/MV/MG

## Data model summary

- Node: managed/unmanaged entity with Packet Express inventory fields (hostname, management IP, platform, firmware, serial, stack members, device class, degree, interfaces) plus Meraki health/issues/metadata
- Link: wired/wireless/discovered adjacency with both-side interface identity, port config/status, mismatches, faults, remediation
- Issue: classified fault/mismatch with severity/remediable metadata
- RemediationAction: executable safe change payload with before/after state

## Runtime notes

- Wired topology is sourced from Meraki link-layer topology and augmented with per-device LLDP/CDP neighbors.
- Wireless client links come only from client association data, not LLDP/CDP.
- Remediation endpoints enforce a strict allow-list of configuration keys.
- Layout persistence and audit records are scoped to organization/network context.

