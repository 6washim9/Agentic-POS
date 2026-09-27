#!/bin/bash
set -e
cd "$(dirname "$0")"

# Start FastAPI backend
PYTHONPATH=backend python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000 &

# Start Vite frontend (exposed preview port)
cd frontend
if [ ! -d node_modules ]; then
  npm install
fi
npm run dev
