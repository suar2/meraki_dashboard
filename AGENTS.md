# Repository Guidelines

## Project Structure & Module Organization
This repository is split into a FastAPI backend and a Vite/React frontend.

- `backend/app/`: API entrypoint, config, schemas, services, and JSON file storage.
- `backend/data/`: runtime data such as layout state, audit logs, and local logs.
- `frontend/src/`: React UI, API client code, shared types, and CSS.
- `docs/`: supporting project documentation.
- `run_dashboard.py`: starts backend and frontend together for local development.

Avoid committing generated content from `backend/data/logs/`, `__pycache__/`, or `frontend/node_modules/`.

## Build, Test, and Development Commands
- `pip install -r backend/requirements.txt`: install backend dependencies.
- `uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload`: run the API locally.
- `cd frontend && npm install`: install frontend dependencies.
- `cd frontend && npm run dev`: start the Vite development server.
- `cd frontend && npm run build`: run TypeScript compile checks and produce the frontend build.
- `python run_dashboard.py`: start both services in the background.
- `python run_dashboard.py status` and `python run_dashboard.py stop`: inspect or stop the local stack.

## Coding Style & Naming Conventions
Follow the existing code style: 4 spaces in Python, 2 spaces in frontend JSX/TSX blocks only if the file already uses it, otherwise match the current 2-space-free formatter-less style. Use `snake_case` for Python modules/functions, `PascalCase` for React components, and keep shared TypeScript types in `frontend/src/types/`.

Prefer small service modules in `backend/app/services/` and keep API route handlers thin. Use explicit type annotations in Python and TypeScript where practical.

## Testing Guidelines
There is no dedicated automated test suite checked in yet. Before opening a PR, verify:

- backend startup succeeds and `/health` returns `{"status":"ok"}`
- frontend runs with `npm run dev`
- frontend production build passes with `npm run build`

When adding tests, place backend tests under `backend/tests/` and frontend tests under `frontend/src/__tests__/`.

## Commit & Pull Request Guidelines
Git history is not available in this workspace snapshot, so use short imperative commit subjects such as `Add topology cache validation` or `Fix remediation modal state`. Keep commits focused by feature or bug.

PRs should include a concise summary, any environment or config changes, linked issue references when available, and screenshots or short recordings for UI changes.
