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

- `MERAKI_API_KEY`: Meraki org API key (required, validated, never logged raw)
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

Frontend environment (`frontend/.env`) should define:

```bash
VITE_API_BASE_URL=http://localhost:8000
FRONTEND_PORT=3000
```

`MERAKI_API_KEY` stays backend-only and is never exposed to browser code.

## Backend run

```bash
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

Backend endpoints:
- `GET /api/organizations`
- `GET /api/organizations/{org_id}/networks`
- `GET /api/topology/{org_id}/{network_id}`
- `POST /api/layout`
- `GET /api/layout/{org_id}/{network_id}`
- `POST /api/remediation/execute`
- `GET /api/audit`

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

This starts both services in containers:
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`

Useful commands:

```bash
docker compose down
docker compose logs -f
```

Notes:
- Keep root `.env` configured; Compose passes it to both services.
- Backend runtime data is stored in the named volume `backend_data`.
- Frontend API base is set automatically to `http://localhost:${BACKEND_PORT}`.

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

On backend startup, config is validated strictly:

- `MERAKI_API_KEY` must exist and not be placeholder
- `MERAKI_BASE_URL` must be a valid URL
- `BACKEND_PORT` and other numeric fields must be valid ints
- `SECRET_KEY` is required, and default is blocked in production
- `DATA_DIR` is created/validated for write access
- `CORS_ORIGINS` is parsed into a list and used by middleware

Backend also performs a startup Meraki credential test call (`/organizations`). If invalid credentials or hard API failures occur, startup fails with actionable errors.

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
- Admin state mismatch
- PoE admin mismatch
- Incomplete/peer unmanaged detection
- Operational status warnings from reported port errors/uplink anomalies

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
- Confirmation required before apply
- Log success and failed attempts

## Layout persistence

- Drag nodes in topology
- Save layout to backend (`org + network` scoped)
- Restored during next topology load and across app restarts

## Audit logging

Logged fields:
- timestamp
- actor
- device/port
- issue id
- previous config
- new config
- outcome
- API response summary

Stored in `backend/data/audit_log.json`.

## Known limitations

- Meraki API endpoint availability can differ by product type/firmware.
- Some low-level counters (CRC/flapping detail) are exposed only where available in Meraki responses.
- Current persistence is JSON file based; for scale, replace with PostgreSQL or similar datastore.
- No RBAC/auth layer yet; architecture is structured for future role-ready expansion.

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

