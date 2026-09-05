# Passport Commerce

### Merchant Passport + MarginMind

**Razorpay AI Buildathon — Track 01: AI Growth & Agentic Commerce**

> Everyone else is building the AI shopper. We built the reason an AI shopper can safely trust and transact with the seller.

---

## Objectives

AI buyer agents are starting to shop for people, but today they do it by scraping websites and guessing — at prices, at policies, at whether a merchant can be trusted at all. This project solves that:

1. **Verifiable merchant identity.** A merchant publishes a signed (Ed25519), versioned, TTL-bound **Passport** — identity, live catalog, policies, capabilities, spending bounds — at a well-known URL. A buyer agent verifies it cryptographically, never scrapes it.
2. **Code makes money decisions, not the model.** **MarginMind** enforces margin floor, discount ceiling, and order cap from its own trusted config — never from anything a caller sends it. An LLM parses intent and explains outcomes; it never decides a number.
3. **The buyer gets a say too.** A passport publishes evidence, not a trust score. A deterministic, buyer-side risk policy decides whether that evidence is good enough to spend money against — a cryptographically perfect merchant can still be refused.
4. **Guarded failure, not staged success.** An agent that tries to exceed its authority is stopped *before* any money moves, with a structured, auditable reason — proven by twelve live red-team attacks anyone can fire from the dashboard.

**LLM reasons and talks, code enforces and pays.**

---

## Architecture

Three independent FastAPI services + a React dashboard, talking over real HTTP:

| Service | Port | Role |
|---|---|---|
| `passport/` | 8001 | Generates, signs (Ed25519), and serves merchant passports. Also hosts the merchant control plane. |
| `marginmind/` | 8002 | Deterministic pricing/decision engine — margin floor, discount ceiling, order cap. |
| `buyer-agent/` | 8003 | Orchestrator: verifies the passport, applies the buyer's risk policy, parses intent via Groq/LangChain, negotiates, drives Razorpay payment. Streams every hop as a typed event. |
| `dashboard/` | 5173 | React + Vite frontend — orchestration canvas, registry, passport view, merchant console, risk policy, red team, audit trail. |

```
Passport/
├── passport/       Merchant Passport generator, signer, server
├── marginmind/     Deterministic decision engine + tests
├── buyer-agent/    Agent pipeline, risk policy, red team, payments
├── shared/         Common contracts, signature/freshness checks, audit log
├── dashboard/      React frontend
├── scripts/        preflight_check.py — end-to-end health check
└── .env.example    Copy to .env — GROQ_API_KEY, optional Razorpay test keys
```

See [PITCH.md](PITCH.md) for the design rationale and build challenges, and [START.md](START.md) for the full demo script.

---

## Local setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- A **Groq API key** ([console.groq.com](https://console.groq.com)) — required for the buyer agent's LLM steps
- Optional: **Razorpay test-mode** Key ID + Secret — without these, payments run in a simulated mode that exercises the same code paths (including real HMAC signature verification)

### Install

```powershell
cd Passport

# Python deps
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt

# Frontend deps
cd dashboard
npm install
cd ..

# Secrets
copy .env.example .env
notepad .env   # fill in GROQ_API_KEY, and Razorpay keys if you have them
```

`.env`, private keys under `passport/`, and generated `passport*.json` files are gitignored — they're generated, not source.

### Run

One command (opens 3 PowerShell windows + the dashboard):

```powershell
.\run_services.ps1
```

Or manually, one terminal each:

```powershell
cd passport      ; ..\.venv\Scripts\python -m uvicorn server:app --port 8001 --reload
cd marginmind    ; ..\.venv\Scripts\python -m uvicorn server:app --port 8002 --reload
cd buyer-agent   ; ..\.venv\Scripts\python -m uvicorn server:app --port 8003 --reload
cd dashboard     ; npm run dev
```

Then open **http://localhost:5173**. Each backend also serves interactive API docs at `/docs`.

> On Windows, `localhost` resolves to `::1` before `127.0.0.1`, adding a ~2s delay per internal call. All inter-service URLs already use `127.0.0.1` — don't change that back.

### Verify

```powershell
# Unit tests — no API keys needed
.venv\Scripts\python -m pytest marginmind/test_scoring.py -v

# Full end-to-end health check, with all services running
.venv\Scripts\python scripts\preflight_check.py
```

Full walkthrough, demo script, and troubleshooting: [START.md](START.md).

---

## Status

- [x] Passport: schema, Ed25519 signing, well-known server, self-verifying refresh
- [x] Multi-merchant: per-merchant keypairs, namespaced URLs, independent verification
- [x] Merchant control plane: live edits that re-sign the passport instantly
- [x] MarginMind: scoring, basket ranking, bounds enforcement, repricing, unit tests
- [x] Buyer agent: intent parsing, passport verification, negotiation, explanation
- [x] Buyer risk policy: deterministic, buyer-side, live-evaluated
- [x] Streamed pipeline: SSE events with measured latencies, driving the canvas
- [x] Cross-merchant sourcing: one request, every merchant quotes, code picks
- [x] Red team: twelve attacks, all currently blocked, each reporting its own outcome
- [x] Payments: dual-mode Razorpay (real test-mode API + Checkout.js, or simulated)
- [x] Audit trail: cross-service, correlation-id-linked, append-only
- [x] Dashboard: orchestration canvas, merchant console, risk policy, red team, audit
</content>
</invoke>
