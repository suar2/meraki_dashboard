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
npm run dev        # Hot-reload dev server (FRONTEND_PORT, default 43123)
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

Production Docker exposes only `0.0.0.0:5500:80` from the frontend/nginx container, so LAN clients can use `http://<HOST-IP>:5500`. FastAPI listens on port 8000 inside the private Compose network only, nginx proxies `/api/` to `http://backend:8000`, and backend temporary paths are tmpfs-backed with no named data volume. If the host firewall is enabled, allow inbound TCP/5500.

### Sanity checks (no test suite yet)
- `GET /health` → `{"status":"ok"}`
- `npm run build` must pass TypeScript compilation
- `GET /api/organizations` validates the Meraki API key

When adding tests, place backend tests under `backend/tests/` and frontend tests under `frontend/src/__tests__/`.

## Environment Setup

Copy `.env.example` to `.env`. Required variables:

| Variable | Purpose |
|---|---|
| `MERAKI_BASE_URL` | Meraki API base URL (`https://api.meraki.com/api/v1`) |
| `SECRET_KEY` | Arbitrary secret; default placeholder is rejected in production |
| `CORS_ORIGINS` | Comma-separated origins (must include the frontend origin) |
| `APP_ENV` | `development` or `production` |
| `LOG_LEVEL` | `DEBUG\|INFO\|WARNING\|ERROR` |
| `FRONTEND_PORT` / `BACKEND_PORT` | Service ports |
| `TOPOLOGY_REFRESH_SECONDS` | Topology cache refresh interval |
| `MERAKI_CLIENT_LOOKBACK_SECONDS` | Meraki client history window (default 86400) |
| `CACHE_TTL_SECONDS` | Topology cache TTL |
| `REQUEST_TIMEOUT_SECONDS` | Per-request timeout for Meraki API calls |
| `MAX_RETRIES` / `RETRY_BACKOFF_SECONDS` | Retry config for transient/rate-limit failures |
| `DATA_DIR` | Optional temporary path; production Compose uses tmpfs |

Frontend also needs `frontend/.env`:
```
VITE_API_PROXY_TARGET=http://localhost:8000
FRONTEND_PORT=43123
```

Meraki API keys are entered in the browser and sent per request as `X-Meraki-Api-Key`. Do not add server-side customer key persistence, server sessions, cookies, request-body key transport, or `localStorage` key storage.

Config is validated at startup by `backend/app/config.py` (Pydantic Settings). Meraki credentials are validated only through request-scoped API calls.

## Architecture

### Request Flow
1. Frontend (React) → Axios client (`frontend/src/api/client.ts`) → FastAPI routes (`backend/app/api/routes.py`)
2. Routes delegate to the service layer — no business logic lives in routes
3. Services call `MerakiClient` for all external Cisco API I/O
4. `TopologyService` serves the full graph to the frontend without persistent cache when used by production routes
5. Node positions, saved views, groups, and merge mappings live in browser workspace storage
6. Strict privacy mode does not persist remediation audit entries on the server

### Backend Service Responsibilities

| Service | Purpose |
|---|---|
| `meraki_client.py` | Async HTTP transport — auth headers, retries with exponential backoff, rate-limit handling |
| `topology_service.py` | Orchestrates Meraki API calls; builds normalised graph (nodes + links); applies validation; cache is disabled in production route wiring |
| `validation_service.py` | Rules engine — compares both sides of each link for mode/VLAN/PoE mismatches; emits `Issue` and `RemediationAction` objects |
| `remediation_service.py` | Applies changes to Meraki; enforces whitelist of safe keys (`type`, `vlan`, `nativeVlan`, `allowedVlans`, `enabled`, `poeEnabled`) |
| `layout_service.py` | Legacy JSON layout service; production frontend stores positions in browser storage |
| `audit_service.py` | Legacy append-only change log; production routes return empty audit history |
| `file_store.py` | Thin JSON file I/O wrapper used by legacy/local-only services |

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
- `AuditLogEntry` — legacy audit schema; strict privacy production routes do not persist these records

### Frontend Component Responsibilities

All state lives in `main.tsx` (org/network selection, topology data, filter state). Child components are mostly presentational:
- `Filters.tsx` — search box + mismatch/wireless toggle controls
- `DetailsPanel.tsx` — right-side panel showing selected node/link details and issue list
- `RemediationModal.tsx` — confirmation modal with before/after config diff before applying a fix
- Cytoscape + fCoSE render the interactive topology canvas (`frontend/src/components/CytoscapeStage.tsx`) using a unified TopologyGraph
- `frontend/src/types/topology.ts` — TypeScript types mirroring the backend Pydantic schemas above

### Data Persistence

Customer credentials and topology data must not be persisted server-side. Browser workspace storage owns layouts, saved views, groups, filters, camera state, and merge mappings. API keys may use memory/sessionStorage only.

## API Endpoints

All prefixed `/api`:

| Endpoint | Purpose |
|---|---|
| `GET /organizations` | List orgs (also validates API key) |
| `GET /organizations/{org_id}/networks` | List networks |
| `GET /topology/{org_id}/{network_id}` | Full request-scoped topology graph |
| `POST /layout` | Compatibility no-op; frontend stores node positions |
| `GET /layout/{org_id}/{network_id}` | Compatibility empty response |
| `POST /remediation/execute` | Apply a remediation action with request-scoped key |
| `GET /audit` | Empty in strict privacy mode |
| `GET /health` | Health check |
| `GET /config-check` | Environment validation |

## Coding Conventions

- **Python:** 4-space indent, `snake_case` for functions/variables/modules, `PascalCase` for classes; explicit type annotations throughout
- **TypeScript/TSX:** 2-space indent, `PascalCase` for components, standard TS types mirroring backend Pydantic schemas
- Keep service modules small and route handlers thin
- Commits: short imperative subject, scoped to one feature/fix per commit
- Do not commit: `backend/data/`, `backend/data/logs/`, `__pycache__/`, `node_modules/`, `*.log`, `.env`
