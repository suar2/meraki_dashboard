# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Meraki Network Operations Dashboard — a full-stack app for Cisco Meraki network topology visualization, link fault detection, and guided remediation. The backend is FastAPI (Python 3.11+); the frontend is React 18 + TypeScript built with Vite.

## Development Commands

### Backend
```bash
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev        # Hot-reload dev server on port 3000
npm run build      # TypeScript check + Vite production build
```

### One-command launcher (starts both services)
```bash
python run_dashboard.py         # Start backend + frontend in background
python run_dashboard.py status  # Check running services
python run_dashboard.py stop    # Stop services
```

### Docker Compose
```bash
docker compose up --build   # Starts both services in containers
docker compose down
docker compose logs -f
```

Docker default ports differ from local dev: backend on `${BACKEND_PORT:-7700}`, frontend on `${FRONTEND_PORT:-7070}`. The root `.env` is passed to both containers; backend data is persisted in the `backend_data` named volume.

### Sanity checks (no test suite yet)
- `GET /health` → `{"status":"ok"}`
- `npm run build` must pass TypeScript compilation
- `GET /api/organizations` validates the Meraki API key

When adding tests, place backend tests under `backend/tests/` and frontend tests under `frontend/src/__tests__/`.

## Environment Setup

Copy `.env.example` to `.env`. Required variables:

| Variable | Purpose |
|---|---|
| `MERAKI_API_KEY` | Org-level Cisco Meraki API key (validated on startup, never logged raw) |
| `MERAKI_BASE_URL` | Meraki API base URL (`https://api.meraki.com/api/v1`) |
| `SECRET_KEY` | Arbitrary secret; default placeholder is rejected in production |
| `CORS_ORIGINS` | Comma-separated origins (must include the frontend origin) |
| `APP_ENV` | `development` or `production` |
| `LOG_LEVEL` | `DEBUG\|INFO\|WARNING\|ERROR` |
| `FRONTEND_PORT` / `BACKEND_PORT` | Service ports |
| `TOPOLOGY_REFRESH_SECONDS` | Topology cache refresh interval |
| `CACHE_TTL_SECONDS` | Topology cache TTL |
| `REQUEST_TIMEOUT_SECONDS` | Per-request timeout for Meraki API calls |
| `MAX_RETRIES` / `RETRY_BACKOFF_SECONDS` | Retry config for transient/rate-limit failures |
| `DATA_DIR` | Persistence root for layout, audit, and topology cache |

Frontend also needs `frontend/.env`:
```
VITE_API_BASE_URL=http://localhost:8000
FRONTEND_PORT=3000
```

`MERAKI_API_KEY` is backend-only and must never appear in frontend code.

Config is validated at startup by `backend/app/config.py` (Pydantic Settings). The backend also performs a live credential test call to `/organizations`; a failed check aborts startup with an actionable error.

## Architecture

### Request Flow
1. Frontend (React) → Axios client (`frontend/src/api/client.ts`) → FastAPI routes (`backend/app/api/routes.py`)
2. Routes delegate to the service layer — no business logic lives in routes
3. Services call `MerakiClient` for all external Cisco API I/O
4. `TopologyService` caches results for `TOPOLOGY_REFRESH_SECONDS`; serves the full graph to the frontend
5. Node positions are persisted to JSON via `LayoutService` (scoped per org+network)
6. All remediation actions are logged by `AuditService`

### Backend Service Responsibilities

| Service | Purpose |
|---|---|
| `meraki_client.py` | Async HTTP transport — auth headers, retries with exponential backoff, rate-limit handling |
| `topology_service.py` | Orchestrates Meraki API calls; builds normalised graph (nodes + links); applies validation; caches result |
| `validation_service.py` | Rules engine — compares both sides of each link for mode/VLAN/PoE mismatches; emits `Issue` and `RemediationAction` objects |
| `remediation_service.py` | Applies changes to Meraki; enforces whitelist of safe keys (`type`, `vlan`, `nativeVlan`, `allowedVlans`, `enabled`, `poeEnabled`); calls audit |
| `layout_service.py` | Read/write node positions (JSON, per org+network) |
| `audit_service.py` | Append-only change log; returns last 200 entries |
| `file_store.py` | Thin JSON file I/O wrapper used by layout and audit services |

### How Topology Is Built

1. Loads org + network + devices from Meraki APIs
2. Pulls LLDP/CDP-derived link-layer topology and creates wired links; adds non-Meraki discovered peers as unmanaged nodes
3. Pulls wireless client associations and renders them as wireless links (separate from LLDP/CDP wired topology)
4. Pulls switch port configuration + status for both sides of managed links, then runs validation

### Validation Rules (wired links)

Port mode mismatch, access VLAN mismatch, native VLAN mismatch, allowed VLAN mismatch, admin state mismatch, PoE admin mismatch, incomplete/peer-unmanaged detection, operational status warnings.

### Data Model (defined in `backend/app/models/schemas.py`)

- `TopologyNode` — managed/unmanaged network entity with metadata, `NodeHealth`, and persistent `position`
- `TopologyLink` — wired/wireless/discovered link with endpoint port metadata, `mismatches`, `faults`, and `remediable_actions`
- `Issue` — classified fault with `Severity` (`critical|warning|info`) and `IssueCategory` (`config_mismatch|operational_warning|physical_suspicion|poe_warning|unmanaged_ambiguity`)
- `RemediationAction` — executable safe-change payload with `current_values`/`proposed_values`; always `requires_confirmation`
- `TopologyGraph` — the full response from `GET /topology/{org_id}/{network_id}`: nodes + links + issues + `TopologySummary`
- `AuditLogEntry` — stored in `backend/data/audit_log.json`; includes before/after config, outcome, and API response

### Frontend Component Responsibilities

All state lives in `main.tsx` (org/network selection, topology data, filter state). Child components are mostly presentational:
- `Filters.tsx` — search box + mismatch/wireless toggle controls
- `DetailsPanel.tsx` — right-side panel showing selected node/link details and issue list
- `RemediationModal.tsx` — confirmation modal with before/after config diff before applying a fix
- React Flow renders the interactive topology canvas; custom node/edge types are defined inline in `main.tsx`
- `frontend/src/types/topology.ts` — TypeScript types mirroring the backend Pydantic schemas above

### Data Persistence

JSON files under `backend/data/` (path set by `DATA_DIR`). No database. `file_store.py` is the only persistence abstraction and is intentionally replaceable.

## API Endpoints

All prefixed `/api`:

| Endpoint | Purpose |
|---|---|
| `GET /organizations` | List orgs (also validates API key) |
| `GET /organizations/{org_id}/networks` | List networks |
| `GET /topology/{org_id}/{network_id}` | Full cached topology graph |
| `POST /layout` | Save node positions |
| `GET /layout/{org_id}/{network_id}` | Load node positions |
| `POST /remediation/execute` | Apply a remediation action (audited) |
| `GET /audit` | Last 200 audit log entries |
| `GET /health` | Health check |
| `GET /config-check` | Environment validation |

## Coding Conventions

- **Python:** 4-space indent, `snake_case` for functions/variables/modules, `PascalCase` for classes; explicit type annotations throughout
- **TypeScript/TSX:** 2-space indent, `PascalCase` for components, standard TS types mirroring backend Pydantic schemas
- Keep service modules small and route handlers thin
- Commits: short imperative subject, scoped to one feature/fix per commit
- Do not commit: `backend/data/`, `backend/data/logs/`, `__pycache__/`, `node_modules/`, `*.log`, `.env`
