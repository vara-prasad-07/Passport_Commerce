# Passport Commerce — Start Here

**Razorpay AI Buildathon, Track 01: AI Growth & Agentic Commerce**

> "Everyone else is building the shopper. We are building the reason an AI shopper
> can safely trust and transact with the seller."

This document is the single source of truth for running, testing, and demoing
what's built. If you only read one section, read **"The 5-minute demo script"**.

---

## 1. What's built

A merchant publishes a **signed, machine-readable passport** — identity, live catalog,
policies, capabilities, and spending bounds — at a well-known URL. An AI buyer agent
fetches it, **verifies** it (not scrapes it), applies **its own risk policy** to the
evidence inside it, asks **MarginMind** (the merchant's deterministic pricing brain)
for a margin-safe basket, explains the result in plain language, gets explicit buyer
consent, and only then moves money through Razorpay — in test mode, fully audited,
with every bound enforced in code, never by an LLM's good judgment.

Four services:

| Service | Port | What it does |
|---|---|---|
| **passport** | 8001 | Generates, signs (Ed25519), and serves merchant passports — one keypair per merchant. Also hosts the **merchant control plane**. |
| **marginmind** | 8002 | Deterministic decision engine. Filters the catalog, ranks baskets, enforces order cap / margin floor / discount ceiling — from its own trusted config, never from what a caller sends it. |
| **buyer-agent** | 8003 | The orchestrator and API gateway. Streams the pipeline as real events, runs the buyer's risk policy, drives Groq for intent/negotiation/explanation, and performs Razorpay payment gated on explicit consent. |
| **dashboard** | 5173 | React app: the live orchestration canvas, registry, passport view, merchant console, risk policy, red team, audit trail. |

Everything talks over real HTTP between real separate FastAPI processes — this is not
one monolith pretending to be three services.

### The five questions the buyer agent answers before it ever spends money

1. **Who is this merchant?** — passport `merchant` block, signature-verified.
2. **What's available, at what price?** — the live, TTL-bound `catalog`.
3. **What evidence backs the merchant's claims?** — `attestations`, each with a source and status.
4. **What is the agent allowed to do?** — `capabilities` and `bounds`.
5. **Can it build a basket that satisfies both buyer intent and merchant economics?** — MarginMind's job, and only MarginMind's.

### The three things that make this more than a chatbot

- **The visualisation is the event stream.** The pipeline emits a typed event per
  real hop with the elapsed time it actually took. The canvas renders those events;
  the audit log stores the same ones. There is no second "for the animation" code
  path — see `buyer-agent/trace.py`.
- **The buyer has its own policy.** A passport publishes evidence, never a trust
  score, so the buyer agent runs deterministic rules over that evidence. A merchant
  with a flawless signature can still be refused.
- **Failure is operable, not staged.** Twelve attacks anyone can fire from the
  dashboard, each through the ordinary code path.

---

## 2. Prerequisites

- Python 3.11+ (a project-local virtualenv is already set up at `.venv/`)
- Node.js 18+ (dashboard uses Vite + React)
- A **Groq API key** (console.groq.com) — required for the buyer agent's
  LLM steps (intent parsing, negotiation, explanation).
- Optional: **Razorpay TEST-mode** Key ID + Key Secret. Without these, payments run
  in a clearly-labeled **simulated mode** that exercises the exact same code paths
  (including real HMAC signature verification) — the demo works either way.

## 3. First-time setup

```powershell
cd Passport

# Python deps — already isolated in .venv/, but if setting up fresh:
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt

# Frontend deps
cd dashboard
npm install
cd ..

# Secrets
copy .env.example .env
notepad .env   # fill in GROQ_API_KEY, and RAZORPAY_KEY_ID/SECRET if you have them
```

`.env` is gitignored. Never commit it. Private keys under `passport/` and
`passport/keys/`, and the generated `passport*.json`, are gitignored too — they're
generated, not source.

## 4. Running it

**One command** (opens 3 PowerShell windows + the dashboard):

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

Then open **http://localhost:5173**.

Each backend also serves interactive API docs at `/docs`
(e.g. http://localhost:8003/docs) — worth showing judges directly, it proves the
"separate services" claim.

> **A note on `127.0.0.1` vs `localhost`.** All inter-service URLs use `127.0.0.1`
> deliberately. On Windows, `localhost` resolves to `::1` first; uvicorn bound to
> IPv4 doesn't answer there, so every internal call paid a **~2.1s** connection
> timeout before falling back — measured at 2095ms via `localhost` against 0.9ms via
> `127.0.0.1`. That was two thirds of a demo run spent on a name lookup, and it made
> the deterministic services look slower than the LLM calls. Don't change it back.

## 5. Verifying it works

### Automated tests (no API keys needed)

```powershell
cd Passport
.venv\Scripts\python -m pytest marginmind/test_scoring.py -v
```

Covers deterministic scoring, margin-floor / order-cap / discount-ceiling
enforcement, and — the two that matter most for a security-minded judge — that a
**forged passport snapshot** claiming a higher order cap is still rejected, and that a
basket **lying about its own price** gets repriced from the merchant's trusted catalog
before anything is accepted.

### The whole red team from the command line (no Groq key needed)

```powershell
curl -X POST http://127.0.0.1:8003/api/redteam/run -H "Content-Type: application/json" -d "{\"attack_id\":\"forge_bounds\"}"
```

Valid `attack_id` values come from `GET /api/redteam/attacks`. All twelve currently
report `"outcome": "blocked"`. **If any ever reports `"allowed"`, that is a real
finding, not a display bug** — the console is built to say so.

### Full happy path (needs `GROQ_API_KEY` in `.env`)

In the dashboard, open **Live Demo** and click the first preset, or type:

> Find me vegetarian, high-protein breakfast for two people under ₹900, delivered tomorrow, in Bangalore.

---

## 6. The 5-minute demo script

The dashboard has eight pages in the top nav. This script walks the five that
carry the argument.

| Time | Page | What to show |
|---|---|---|
| 0:00–0:35 | **Overview** | Read the one-liner: *"Everyone is building the AI shopper. We built the reason an AI shopper can safely trust and transact with the seller."* Point at the LLM-vs-deterministic-code strip — that split is the whole pitch. |
| 0:35–1:45 | **Live Demo** | Set playback to **0.5×** before you start. Click the **Happy path** preset and narrate the packets: sky = the signature check, amber = *the buyer's own* policy gate, violet = the model parsing intent, emerald = MarginMind ranking and enforcing bounds. Then say the line that matters: **"this isn't an animation — it's the event stream, and those millisecond figures are measured."** Click any packet mid-run to show the JSON that crossed that wire. Pick a basket → **Confirm & pay**. |
| 1:45–2:45 | **Red Team** | Hit **Run all 12**. Let the scoreboard fill. Then pick two and tell the story properly: **Forge a higher order cap** (fails twice — cryptography catches the tampered passport, and then MarginMind ignores a *validly signed* passport's forged snapshot because it re-derives bounds from its own config), and **Hide instructions in a product name** (real hostile text written into the live catalog, defanged before any model sees it, then restored). Point out that "GOT THROUGH" is a state this page can display. |
| 2:45–3:30 | **Merchant** | Drag the **margin floor** up and hit **Publish & re-sign**. Show the before/after signature — a genuinely different document. Then go back to **Live Demo**, run the same query, and get a different answer. No restart, no cache. |
| 3:30–4:15 | **Registry** | Two merchants, each with their **own keypair**, verified independently. Run **Source across the registry**: one request, both quote, and deterministic code picks the winner. Say why that's code and not a model: *which merchant gets the money is a decision.* |
| 4:15–5:00 | **Audit Trail** | Expand a row. One correlation id links passport fetch → policy verdict → MarginMind decision → order → payment across three processes, and declines sit in the same append-only feed as successes. Close on the roadmap. |

**Bonus if there's time:** the **Tight budget** preset runs the LangChain negotiator.
Watch it bounce off MarginMind two or three times on the canvas and then stop. The
story is better than a rescue: *the agent could not overreach even when it wanted to.*

**Bonus for a security-minded judge:** the **Risk Policy** page. Drag the minimum
refund window to 14 days and watch a cryptographically perfect merchant get refused.

**If a step fails mid-demo:** every LLM call surfaces as a clean 502 with the reason,
not a stack trace, and the run stops before any money action. Say so and move on —
the failure path is part of the pitch.

---

## 7. What's real vs. simulated

| Piece | Real | Simulated fallback |
|---|---|---|
| Passport signing/verification | Always real (Ed25519), one keypair per merchant | — |
| MarginMind's bounds enforcement | Always real, always code, never an LLM | — |
| Buyer risk policy | Always real, deterministic, buyer-side | — |
| Pipeline event stream + latencies | Measured on the server, streamed as SSE | Playback speed is adjustable; **the reported latencies never change** |
| Red team attacks | Real tampered bytes over real HTTP, real forged requests, real catalog mutation (restored afterwards) | — |
| Groq calls (intent, negotiation, explanation) | Real, needs `GROQ_API_KEY` | None — these fail loudly with a clear 503 rather than faking a response |
| Razorpay order creation + Checkout | Real Razorpay TEST-mode API + Checkout.js, if keys are set | A fabricated order/payment using the **identical HMAC-SHA256 scheme** — the verification path is genuinely exercised either way. Every simulated id is prefixed `SIMULATED`. |

## 8. Security guardrails actually implemented

Each is exercised by a button on the Red Team page.

- **Cost/margin data never leaves the merchant.** `generator.py` uses an *allowlist*
  of catalog fields — so a new internal field is private by default rather than
  public until someone notices. `cost_minor` is never published.
- **A buyer agent cannot forge its own bounds.** MarginMind re-derives every limit
  from its own `merchant_store` and ignores the caller's passport snapshot entirely.
- **A buyer agent cannot forge a basket's price.** `validate_order` reprices every
  line from the trusted catalog by SKU before checking bounds or creating an order.
- **A basket cannot be repriced against the wrong merchant.** The basket cache stores
  the merchant id *with* the basket; a client cannot restate it at confirm time.
- **Catalog text is data, never instructions.** Merchant-controlled strings are
  scanned and defanged before reaching any prompt — and the attempt is surfaced
  rather than silently swallowed, so the merchant learns their catalog was tampered
  with (`buyer-agent/sanitize.py`).
- **Payment confirmation is server-verified**, never LLM- or client-asserted.
- **Idempotent order creation** — a repeated confirm replays the same order.
- **The passport can't go silently stale** — short TTL, lazy re-sign on read.

## 9. Known limitations (explicitly out of scope)

- **`rate_limit_per_agent_per_hour`** is declared in `bounds` but not enforced —
  there's no per-agent identity system in this MVP to rate-limit against.
- **Refunds** are declared (`requires_merchant_approval`) but no refund flow is wired.
- **No authentication on `/admin`.** Deliberate and bounded: the control plane exists
  so a judge can change a bound mid-demo. In anything real it is merchant-authenticated
  and the buyer agent has no route to it — note that the buyer agent never calls it.
- **No persistent database** — the audit log is an append-only file, orders and
  baskets are in memory.
- **Two merchants, not a federated registry.** Namespacing, per-merchant keys and
  independent verification are real; discovery across origins is not.

## 10. Troubleshooting

- **"GROQ_API_KEY is not set"** — copy `.env.example` to `.env` and fill it in.
  `/health` on the buyer agent reports `llm_configured`.
- **Everything is mysteriously slow (~2s per hop)** — something reintroduced
  `localhost` into a service URL. See the note in section 4.
- **Passport shows as "rejected"** — check the passport service (8001) is running;
  `GET /api/passport/summary` returns the specific failure reason.
- **A red team attack says the catalog could not be restored** — open the **Merchant**
  page and fix the product name, or re-run the attack.
- **Port already in use** — check for stray `uvicorn`/`node` processes.
- **Real Razorpay Checkout doesn't open** — confirm `razorpay_live: true` on `/health`;
  both key vars must be set together.

---

See [README.md](README.md) for the full repo layout and design rationale.
