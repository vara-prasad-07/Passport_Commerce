#!/usr/bin/env bash
# Starts passport (8001), marginmind (8002), and buyer-agent (8003) in the
# background (Git Bash / WSL / macOS / Linux), logging each to .run_logs/.
#
# Run from the repo root:  ./run_services.sh
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VENV_PY="$ROOT/.venv/Scripts/python.exe"   # Windows venv layout
if [ ! -f "$VENV_PY" ]; then
  VENV_PY="$ROOT/.venv/bin/python"          # macOS/Linux venv layout
fi

if [ ! -f "$VENV_PY" ]; then
  echo "No .venv found. Set it up first:"
  echo "  python -m venv .venv"
  echo "  .venv/bin/pip install -r requirements.txt   (or .venv\\Scripts\\pip on Windows)"
  exit 1
fi

if [ ! -f "$ROOT/.env" ]; then
  echo "No .env found — copy .env.example to .env and fill in GROQ_API_KEY (and Razorpay test keys, if you have them) before using the buyer agent."
fi

mkdir -p "$ROOT/.run_logs"

(cd "$ROOT/passport" && "$VENV_PY" -m uvicorn server:app --port 8001 --reload > "$ROOT/.run_logs/passport.log" 2>&1 &)
(cd "$ROOT/marginmind" && "$VENV_PY" -m uvicorn server:app --port 8002 --reload > "$ROOT/.run_logs/marginmind.log" 2>&1 &)
(cd "$ROOT/buyer-agent" && "$VENV_PY" -m uvicorn server:app --port 8003 --reload > "$ROOT/.run_logs/buyer-agent.log" 2>&1 &)

echo "Started passport (8001), marginmind (8002), buyer-agent (8003) in the background."
echo "Logs: $ROOT/.run_logs/*.log"
echo ""
echo "Now start the dashboard:"
echo "  cd dashboard && npm install && npm run dev"
echo ""
echo "Then open http://localhost:5173"
