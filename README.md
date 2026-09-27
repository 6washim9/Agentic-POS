# Arat POS

Voice-first, offline-first agentic POS for fruit wholesale (arat) yards.

Dark magenta admin chrome on desktop (sidebar, KPI dashboard, data tables). On a phone the same app uses a magenta header, Today's Sales, a 2x2 action grid, and a bottom tab bar.

## Stack

- Frontend: Vite + React + TypeScript
- Backend: FastAPI (Python)
- Local store: AES-256-GCM encrypted snapshot in the browser
- Sync: timestamped event queue with append-only stock and credit rules
- RBAC: two-layer `caps` + owner overrides; missing key = deny
- Baki: first-class cash `collection` (never a sale); khata is derived

## Run

```bash
# Backend
cd backend
PYTHONPATH=. uvicorn app.main:app --host 0.0.0.0 --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

API calls from the UI are proxied through `/api`.

## Tests

```bash
# Domain engines
PYTHONPATH=backend python3 -m pytest backend/tests -q

# Frontend domain tests
cd frontend && npm test
```
