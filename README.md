# Meraki Network Operations Dashboard

Production-oriented full-stack dashboard for Cisco Meraki topology visualization, link validation, fault visibility, and safe remediation workflows.

The topology canvas uses Cytoscape with Tree/Force layouts, dark-first chrome, and category colors. Meraki remains the operational source of truth (health, VLANs, mismatches, clients, remediation).

## Stack

- Frontend: React + TypeScript + Vite + Cytoscape + cytoscape-fcose
- Backend: FastAPI + httpx
- Persistence: browser-owned workspace storage for layouts, saved views, logical groups, and merge mappings; backend runs in strict zero-retention mode for customer credentials/topology data.
- Topology source of truth: `GET /networks/{id}/topology/linkLayer` nodes first, then links, validated with per-device LLDP/CDP and switch port status. Clients enrich the graph; they do not invent duplicate managed devices.

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

- `MERAKI_BASE_URL`: API base URL (`https://api.meraki.com/api/v1`)
- `APP_ENV`: `development` or `production`
- `LOG_LEVEL`: `DEBUG|INFO|WARNING|ERROR`
- `FRONTEND_PORT`: frontend dev server port
- `BACKEND_PORT`: backend API port
- `TOPOLOGY_REFRESH_SECONDS`: cache refresh interval for topology builds
- `MERAKI_CLIENT_LOOKBACK_SECONDS`: Meraki client history window (default `86400` / 24 hours; Cisco allows up to 31 days). This is independent of the cache TTL — do not derive it from the refresh interval.
- `REQUEST_TIMEOUT_SECONDS`: per-request timeout to Meraki APIs
- `MAX_RETRIES`: retry count for transient/rate-limit failures
- `RETRY_BACKOFF_SECONDS`: exponential retry base delay
- `DATA_DIR`: optional temporary path; production Compose mounts temporary state on tmpfs and does not create a persistent data volume
- `SECRET_KEY`: required for production; must not be default when `APP_ENV=production`
- `CORS_ORIGINS`: comma-separated origin list (for API CORS)
- `CACHE_TTL_SECONDS`: topology cache TTL

Frontend (`frontend/.env` optional for local dev):

- **Development:** Vite proxies `/api` to the backend (see `frontend/vite.config.ts` via `VITE_API_PROXY_TARGET`, default `http://localhost:8000`). Set `FRONTEND_PORT` to match the port you use; add that origin to backend `CORS_ORIGINS` if the browser shows CORS errors.
- **Production / preview:** serve the Vite build behind your reverse proxy, or set env so API calls match your API host.

Meraki API keys are entered in the browser and sent per request as `X-Meraki-Api-Key`. The backend never stores a customer key and never reads one from server configuration.

## Backend run

```bash
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

Backend endpoints (all under `/api` as implemented in `backend/app/api/routes.py`):
- `GET /api/organizations`
- `GET /api/organizations/{org_id}/networks`
- `GET /api/topology/{org_id}/{network_id}`
- `GET /api/topology/{org_id}/{network_id}/changes?window=1h|24h|7d` — empty in strict privacy mode; keep personal history in browser storage
- `GET /api/topology/{org_id}/{network_id}/validate` — live lab adjacency fixture (FW-01↔MS130, MS130 p2↔MR36, …)
- `GET /api/views/{org_id}/{network_id}` / `POST` / `DELETE /api/views/{org_id}/{network_id}/{view_id}` — shared/server views are unavailable in strict privacy mode
- `GET /api/groups/{org_id}/{network_id}` / `POST` / `DELETE /api/groups/{org_id}/{network_id}/{group_id}` — shared/server groups are unavailable in strict privacy mode
- `GET /api/entities/merges/{org_id}/{network_id}` / `POST /api/entities/merge` / `DELETE` — server-side merge persistence is unavailable; the frontend stores merge mappings locally
- `POST /api/layout` / `GET /api/layout/{org_id}/{network_id}` — compatibility no-op; the frontend stores positions locally
- `POST /api/remediation/execute` — body: `RemediationExecuteRequest` (`org_id`, `network_id`, `action`, `actor`)
- `GET /api/audit` — empty in strict privacy mode
- `GET /health` — global app health (no prefix)
- `GET /config-check` — Pydantic settings validation

Meraki-dependent endpoints require `X-Meraki-Api-Key` on every request.

## Frontend run

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:43123`. Without a Meraki API key, use **Load sample topology** to preview the canvas against a unified topology fixture.

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

Open `http://SERVER_IP:5500`, for example `http://10.1.1.12:5500` or `http://192.168.1.50:5500`.

- Only frontend/nginx is published: `0.0.0.0:5500:80`.
- FastAPI listens on `8000` inside the private Compose network only.
- nginx serves the Vite build and proxies `/api/*` to `http://backend:8000/api/*`.

Useful commands:

```bash
docker compose down
docker compose logs -f
```

Notes:
- Set `SECRET_KEY` before starting production Compose; the default is rejected when `APP_ENV=production`.
- If the Docker host firewall is enabled, allow inbound TCP/5500 from the LAN.
- No backend named volume is created. Temporary backend paths are tmpfs-backed and disappear on container restart.
- For local *non-Docker* dev, the browser calls same-origin `/api` and Vite proxies to the backend using `VITE_API_PROXY_TARGET`.

## Production build

Frontend:

```bash
cd frontend
npm run build
```

Backend:
- Deploy with the production Dockerfile or an equivalent `uvicorn` production process.
- Customer Meraki keys stay in the user's browser memory/session storage and are sent only as request headers.

## Startup validation and fail-fast behavior

On import, Pydantic loads `.env` from the process working directory and validates required fields. Global startup (`lifespan` in `app/main.py`):
- `SECRET_KEY` default value is blocked when `APP_ENV=production`
- `GET /config-check` returns validation errors as JSON if settings cannot be loaded

`BACKEND_PORT` in `.env` is used by `run_dashboard.py` and your shell for local development. Production Compose keeps backend port 8000 internal only.

## How topology data is built

- Loads org + network + devices from Meraki APIs.
- Pulls LLDP/CDP-derived link layer topology and creates wired links.
- Adds non-Meraki discovered peers as unmanaged nodes.
- Pulls wireless client associations and hangs them under the AP (`recentDeviceSerial`), not under the switch uplink.
- Fetches Meraki clients over a **24-hour** lookback (`MERAKI_CLIENT_LOOKBACK_SECONDS`) so port groups match Dashboard, not a 10-minute slice.
- Builds **physical topology** (what chassis is on each switch port, and what sits behind it) using this authority order: managed Meraki identity → LLDP/CDP → switch client table → downstream inference. **Every wired client learned on a port is retained.** If a neighbor already owns the jack, extra MACs hang behind that chassis; they are never collapsed into a single NIC MAC. Unidentified multi-MAC ports become a chassis still linked to that port, with the full client group underneath. Orphan nodes are never rendered.
- Switch **port diagrams** (all physical interfaces, including unused) stay on the node/link detail panel. Topology only draws meaningful connections. Clicking a topology link highlights the matching jack.
- Multi-NIC chassis (for example server management + fabric) can be merged with **Merge as same physical device**. Merge joins the NICs and **keeps the downstream client group** under the server. The association is stored in the user's browser per org/network and reapplied after topology fetches.
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
5. Refresh topology.

Safety guardrails:
- Only allow safe keys (`type`, `vlan`, `nativeVlan`, `allowedVlans`, `enabled`, `poeEnabled`)
- If the proposal omits `type` but changes another safe field, the current port `type` is added to the Meraki payload so partial updates (e.g. admin/PoE) are accepted
- Confirmation required before apply
- Strict privacy mode does not persist remediation audit entries on the server

## Layout persistence

- Drag nodes in topology; positions are saved in this browser, scoped by `org` + `network`.
- The canvas applies saved browser coordinates on top of the default layered layout, so hand-adjusted layout survives refresh in the same browser.

## Audit logging

Server-side audit persistence is disabled in strict privacy mode. `/api/audit` returns an empty list.

## Known limitations

- Meraki API endpoint availability can differ by product type/firmware.
- Some low-level counters (CRC/flapping detail) are exposed only where available in Meraki responses.
- Link-level operational diagnostics depend on product/firmware endpoint coverage in Meraki APIs.
- Shared server workspace persistence is disabled in strict privacy mode.
- No RBAC/auth layer yet; architecture is structured for future role-ready expansion.

## Filters and map controls

The sidebar supports three visibility modes:

- **Physical** — firewall, switch, AP, camera, server, NAS, and Pi chassis only
- **Physical + Clients** — physical devices plus wired and wireless endpoints (default). Dense wireless and downstream VM leaves collapse to a single group such as `24 Wireless Clients` until you expand them
- **Full** — inferred WAN CPE and other unmanaged neighbors as well

The sidebar also has:

- **Changes (1h / 24h / 7d)** — appeared, disappeared, port moves, AP moves, uplink changes, LLDP neighbors, access↔trunk, VLAN/native VLAN, firmware, and material client-count shifts. Click an event to focus the device and path.
- **Diagnostics** — physical vs wireless edges, high/medium/low confidence, unresolved nodes, duplicate identities, orphans, plus lab-check results when the expected live relationships are present.
- **Saved views** — personal to this browser. A view restores mode, filters, expanded groups, focus/hidden sets, camera, and selection.
- **Logical groups** — named member sets that Meraki itself does not have (for example Server Infrastructure).

Tree view defaults to collapsed client groups. Drag on empty canvas to box-select; Ctrl/Cmd-click toggles, Shift-click adds, Esc/click-empty clears, Ctrl/Cmd-A selects visible nodes. Multi-select opens Focus / Fit / Trace / Save view / Create group / Hide. **Focus selection** hides everything except the selection and descendants of non-switch members (server workloads stay; the rest of the switch fabric does not). Selecting a switch opens a physical port strip with config, status, PoE, VLANs, LLDP/CDP, errors, learned clients, topology peer, and last changes. Right-click a node or use **Trace to Internet** to fade everything except the path to the MX/WAN. Physical links show confidence plus an evidence checklist (linkLayer, LLDP, deviceMac, switch port status, client history).

Search matches hostname, MAC, IP, serial, port, VLAN, model, and SSID, then focuses the device and traces the path upstream.

Other topology filters:
- Mismatches only
- Show wireless links
- Wired only / Wireless only
- Unmanaged only
- Clients only
- Severity filter: `all | critical | warning | healthy`

## Troubleshooting

- **Invalid API key**
  - Ensure the key entered in the dashboard is org-scoped and valid for the selected organization.
- **CORS errors in browser**
  - Add frontend origin to `CORS_ORIGINS`, e.g. `http://localhost:3000`.
  - Use comma-separated list for multiple origins.
- **Port conflicts**
  - Change `BACKEND_PORT` and/or `FRONTEND_PORT`.
  - Update `VITE_API_PROXY_TARGET` to match backend port.
- **Missing env variables**
  - Copy from `.env.example` and fill required values.
  - Backend fails fast on critical misconfiguration and prints exact field errors.

## Backend validation tests

Run backend unit tests (fixture-based, no live Meraki dependency):

```bash
python -m unittest discover -s backend/tests -p "test_*.py"
```

Covered checks include topology normalization, change detection diffs, lab adjacency fixtures, saved views, validation rules, remediation allow-list enforcement, and audit payload completeness. Frontend presentation regressions (`npm test` in `frontend/`) cover sample adjacencies, focus selection, search haystacks, and 250/1,000-client collapse.

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

