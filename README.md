# Meraki Network Operations Dashboard

Production-oriented full-stack dashboard for Cisco Meraki topology visualization, link validation, fault visibility, and safe remediation workflows.

## Stack

- Frontend: React + TypeScript + Vite + React Flow
- Backend: FastAPI + httpx
- Persistence: JSON-backed storage for layout and audit logs (`backend/data/`)
- Topology source of truth: Meraki LLDP/CDP link-layer topology endpoint

## Prerequisites

- Python 3.11+
- Node.js 20+ and npm
- Cisco Meraki organization-level API key

## Environment Configuration

Create `.env` in project root from `.env.example`:

```bash
copy .env.example .env
```

Required/standardized variables:

- `MERAKI_API_KEY`: Meraki org API key (can be left empty in development if you set it via the dashboard; placeholder text is rejected; never logged raw). If set at startup, the backend validates it with a live `/organizations` call.
- `MERAKI_BASE_URL`: API base URL (`https://api.meraki.com/api/v1`)
- `APP_ENV`: `development` or `production`
- `LOG_LEVEL`: `DEBUG|INFO|WARNING|ERROR`
- `FRONTEND_PORT`: frontend dev server port
- `BACKEND_PORT`: backend API port
- `TOPOLOGY_REFRESH_SECONDS`: refresh-related interval for topology/client windows
- `REQUEST_TIMEOUT_SECONDS`: per-request timeout to Meraki APIs
- `MAX_RETRIES`: retry count for transient/rate-limit failures
- `RETRY_BACKOFF_SECONDS`: exponential retry base delay
- `DATA_DIR`: persistence path for layout, audit, and topology cache
- `SECRET_KEY`: required; must not be default in production
- `CORS_ORIGINS`: comma-separated origin list (for API CORS)
- `CACHE_TTL_SECONDS`: topology cache TTL

Frontend (`frontend/.env` optional for local dev):

- **Development:** Vite proxies `/api` to the backend (see `frontend/vite.config.ts` via `VITE_API_PROXY_TARGET`, default `http://localhost:8000`). Set `FRONTEND_PORT` to match the port you use; add that origin to backend `CORS_ORIGINS` if the browser shows CORS errors.
- **Production / preview:** serve the Vite build behind your reverse proxy, or set env so API calls match your API host.

`MERAKI_API_KEY` stays backend-only and is never exposed to browser code.

## Backend run

```bash
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

Backend endpoints (all under `/api` as implemented in `backend/app/api/routes.py`):
- `GET /api/organizations`
- `GET /api/organizations/{org_id}/networks`
- `GET /api/topology/{org_id}/{network_id}`
- `POST /api/layout` — body: `{ "org_id", "network_id", "positions" }`
- `GET /api/layout/{org_id}/{network_id}`
- `POST /api/meraki-api-key` — body: `{ "api_key" }` (sets key for this backend process; frontend uses this in dev)
- `POST /api/remediation/execute` — body: `RemediationExecuteRequest` (`org_id`, `network_id`, `action`, `actor`)
- `GET /api/audit`
- `GET /health` — global app health (no prefix)
- `GET /config-check` — Pydantic settings validation

## Frontend run

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## One-command runner (background)

From project root:

```bash
python run_dashboard.py
```

This starts backend + frontend in the background and writes logs to `backend/data/logs/`.

Useful commands:

```bash
python run_dashboard.py status
python run_dashboard.py stop
```

## Docker Compose run

From project root:

```bash
docker compose up --build
```

Host ports follow root `.env` (defaults in `docker-compose.yml` if unset):
- **Backend:** `http://localhost:${BACKEND_PORT:-7700}` maps to **8000** inside the container (uvicorn listens on 8000 in the image).
- **Frontend:** `http://localhost:${FRONTEND_PORT:-7070}` — Vite dev server; it proxies `/api` to the backend using `VITE_API_PROXY_TARGET` (set to `http://backend:8000` in Compose).

Useful commands:

```bash
docker compose down
docker compose logs -f
```

Notes:
- Keep root `.env` configured; Compose passes it to both services. Set `CORS_ORIGINS` to include the URL you use to open the UI (e.g. `http://localhost:7070` if you use the default front port).
- Backend runtime data is stored in the named volume `backend_data`.
- For local *non-Docker* dev, the frontend does not use `VITE_API_BASE_URL` for API calls: the browser calls same-origin `/api` and Vite proxies to the backend.

## Production build

Frontend:

```bash
cd frontend
npm run build
```

Backend:
- Deploy with `uvicorn` workers or behind Gunicorn/ASGI process manager.
- Keep `.env` on server and never expose API key client-side.

## Startup validation and fail-fast behavior

On import, Pydantic loads `.env` from the process working directory and validates required fields. Global startup (`lifespan` in `app/main.py`):
- `DATA_DIR` is created/validated for write access
- If `MERAKI_API_KEY` is **non-empty**, the backend calls Meraki `/organizations` once; on invalid key or hard API failure, startup **raises** and the app does not serve.
- If `MERAKI_API_KEY` is **empty**, startup logs a warning and continues (dashboard can set the key via `POST /api/meraki-api-key`).
- `MERAKI_API_KEY` must not be the literal placeholder from `.env.example`.
- `SECRET_KEY` is required; default value is blocked when `APP_ENV=production`
- `GET /config-check` returns validation errors as JSON if settings cannot be loaded

`BACKEND_PORT` in `.env` is used by `run_dashboard.py` and your shell; the Docker image still listens on 8000 inside the container and maps host `BACKEND_PORT` to 8000.

## How topology data is built

- Loads org + network + devices from Meraki APIs.
- Pulls LLDP/CDP-derived link layer topology and creates wired links.
- Adds non-Meraki discovered peers as unmanaged nodes.
- Pulls wireless client associations and renders them as wireless links (separate from LLDP/CDP wired topology).
- Pulls switch port configuration + switch port status for both sides when managed, then validates link parity.

## Validation/rule engine

Current wired-link rules:
- Port mode mismatch (trunk vs access)
- Access VLAN mismatch
- Native VLAN mismatch
- Allowed VLAN mismatch
- Missing/undefined VLAN on peer
- Admin state mismatch
- PoE admin mismatch
- Disabled port on one side
- Incomplete/peer unmanaged detection
- Operational status warnings from reported port errors/uplink anomalies
- CRC / physical suspicion (diagnostic-only)
- PoE fault status warnings (diagnostic-only)

Each issue includes severity, category, description, remediable status, and suggested actions.

## Remediation workflow

1. Select problematic link in topology.
2. Open generated suggested action from link detail.
3. Review current vs proposed configuration in confirmation modal.
4. Apply remediation (server-side Meraki API call).
5. Save audit entry (success/failure).
6. Refresh topology.

Safety guardrails:
- Only allow safe keys (`type`, `vlan`, `nativeVlan`, `allowedVlans`, `enabled`, `poeEnabled`)
- If the proposal omits `type` but changes another safe field, the current port `type` is added to the Meraki payload so partial updates (e.g. admin/PoE) are accepted
- Confirmation required before apply
- Log success and failed attempts

## Layout persistence

- Drag nodes in topology; positions are `POST`ed to the backend (scoped by `org` + `network`)
- The canvas `GET`s `/api/layout/{org_id}/{network_id}` and applies any saved node coordinates on top of the default layered layout, so hand-adjusted layout survives refresh in the same session
- The topology builder also injects the same file into each node for Meraki fetches, so the two paths stay consistent after a new topology build

## Audit logging

Logged fields:
- timestamp
- actor
- org/network
- device/port
- issue id/category
- previous config
- proposed config
- final applied config
- outcome
- API response summary

Stored in `backend/data/audit_log.json`.

## Known limitations

- Meraki API endpoint availability can differ by product type/firmware.
- Some low-level counters (CRC/flapping detail) are exposed only where available in Meraki responses.
- Link-level operational diagnostics depend on product/firmware endpoint coverage in Meraki APIs.
- Current persistence is JSON file based; for scale, replace with PostgreSQL or similar datastore.
- No RBAC/auth layer yet; architecture is structured for future role-ready expansion.

## Filters and map controls

The topology toolbar supports:
- Search by device label/serial/model/MAC/IP/port metadata
- Mismatches only
- Show wireless links
- Wired only / Wireless only
- Unmanaged only
- Clients only
- Severity filter: `all | critical | warning | healthy`

## Troubleshooting

- **Invalid API key**
  - Ensure `MERAKI_API_KEY` in `.env` is org-scoped and not placeholder text.
  - Restart backend after changes.
- **CORS errors in browser**
  - Add frontend origin to `CORS_ORIGINS`, e.g. `http://localhost:3000`.
  - Use comma-separated list for multiple origins.
- **Port conflicts**
  - Change `BACKEND_PORT` and/or `FRONTEND_PORT`.
  - Update `VITE_API_BASE_URL` to match backend port.
- **Missing env variables**
  - Copy from `.env.example` and fill required values.
  - Backend fails fast on critical misconfiguration and prints exact field errors.

## Backend validation tests

Run backend unit tests (fixture-based, no live Meraki dependency):

```bash
python -m unittest discover -s backend/tests -p "test_*.py"
```

Covered checks include topology normalization edge-cases (alias matching + dedupe), validation rules, remediation allow-list enforcement, and audit payload completeness.

## Production readiness (manual / CI)

Suggested checks before deploy:

**Backend**
```bash
python -m compileall backend/app
python -m unittest discover -s backend/tests -p "test_*.py"
cd backend
python -c "from app.main import app; print(app.title)"
```

**Frontend**
```bash
cd frontend
npm install
npm run build
```

**Topology build resilience:** If Meraki returns errors for optional endpoints (linkLayer, clients, switch ports), the backend logs warnings and returns a partial graph when possible; it should not crash the process.

**Remaining runtime risks**
- Meraki rate limits, outages, and partial JSON from devices.
- CORS must include every browser origin you use to load the UI.
- JSON audit/layout files on disk are not suitable for high-concurrency multi-writer production without a real database.

