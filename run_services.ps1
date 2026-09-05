# Starts passport (8001), marginmind (8002), and buyer-agent (8003), each in
# its own PowerShell window using the project's .venv, then starts the
# dashboard dev server if its dependencies are already installed.
#
# Run from the repo root:  .\run_services.ps1

$root = $PSScriptRoot
$venvPython = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "No .venv found at $venvPython" -ForegroundColor Red
    Write-Host "Set it up first:"
    Write-Host "  python -m venv .venv"
    Write-Host "  .venv\Scripts\pip install -r requirements.txt"
    exit 1
}

if (-not (Test-Path (Join-Path $root ".env"))) {
    Write-Host "No .env found - copy .env.example to .env and fill in GROQ_API_KEY (and Razorpay test keys, if you have them) before using the buyer agent." -ForegroundColor Yellow
}

Write-Host "Starting passport on :8001 ..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\passport'; & '$venvPython' -m uvicorn server:app --port 8001 --reload"

Write-Host "Starting marginmind on :8002 ..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\marginmind'; & '$venvPython' -m uvicorn server:app --port 8002 --reload"

Write-Host "Starting buyer-agent on :8003 ..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\buyer-agent'; & '$venvPython' -m uvicorn server:app --port 8003 --reload"

$dashboard = Join-Path $root "dashboard"
if (Test-Path (Join-Path $dashboard "node_modules")) {
    Write-Host "Starting dashboard on :5173 ..."
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$dashboard'; npm run dev"
} else {
    Write-Host "Dashboard dependencies not installed yet. In a new terminal, run:" -ForegroundColor Yellow
    Write-Host "  cd dashboard; npm install; npm run dev"
}

Write-Host ""
Write-Host "Once everything is up:"
Write-Host "  Dashboard:    http://localhost:5173"
Write-Host "  Passport:     http://localhost:8001/.well-known/agent-commerce.json"
Write-Host "  MarginMind:   http://localhost:8002/docs"
Write-Host "  Buyer agent:  http://localhost:8003/docs"
