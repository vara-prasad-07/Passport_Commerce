# Merchant Passport + MarginMind

Razorpay AI Buildathon — Track 01: AI Growth & Agentic Commerce

**Full setup, run, and demo instructions are in [START.md](START.md).** This file is
the design pitch and repo map; START.md is the operational guide.

## What this is

Three services, one signed protocol between them:

- **Merchant Passport** (`passport/`) — a signed, machine-readable contract a merchant
  publishes (`/.well-known/agent-commerce.json`) describing identity, catalog, policies,
  capabilities, and financial bounds. Ed25519-signed, versioned, TTL-bound, one keypair
  per merchant. Also hosts the merchant control plane that produces it.
- **MarginMind** (`marginmind/`) — the merchant-side decision engine. Deterministic,
  code-only. Enforces margin floor / discount ceiling / order cap from its OWN trusted
  config, never from anything a caller sends it. Never an LLM making money decisions.
- **Buyer Agent** (`buyer-agent/`) — the buyer-side agent. Verifies the passport, applies
  **its own risk policy** to the evidence in it, parses intent with an LLM (Groq, via
  LangChain), *negotiates* on soft preferences when declined (never on merchant bounds),
  and drives Razorpay test-mode payment after explicit buyer consent. Streams every hop
  as a typed event.

The split matters: **LLM reasons and talks, code enforces and pays.**

## The three ideas worth stealing

**1. The visualisation is the event stream.** The dashboard's orchestration canvas
doesn't animate a diagram of the architecture — it renders the pipeline's own typed
events, each carrying the elapsed time actually measured on the server. The same
events are the rows in the audit log. Playback can be slowed to a quarter speed for a
demo; the reported latencies never change. See `buyer-agent/trace.py`.

**2. A passport publishes evidence, not a trust score — so the buyer needs a policy.**
Somebody has to decide whether "Razorpay account connected, 7-day refund window,
create_order granted" is good enough to spend money against, and that decision belongs
to the buyer, not the merchant. `buyer-agent/risk_policy.py` is deterministic,
buyer-side, fails closed, and cannot be relaxed by anything a merchant publishes. A
cryptographically perfect merchant can still be refused.

**3. Failure is operable, not staged.** `buyer-agent/redteam.py` is twelve attacks
anyone can fire from the dashboard, each running through the ordinary code path — real
tampered bytes over real HTTP, real forged prices, real hostile text written into the
live catalog and restored afterwards. Every attack reports an `outcome`, and `allowed`
is a legal value: a console that can only report good news is a decoration.

## Repo layout

```
Passport/
├── passport/            Merchant Passport generator + signer + server (port 8001)
│   ├── merchant_data.json       raw config for the default merchant (incl. cost_minor)
│   ├── merchant_data.<id>.json  any additional merchant — adding one is a file drop
│   ├── merchants.py             per-merchant paths, lazy keypair generation
│   ├── keys.py                  Ed25519 keypair generation (default merchant)
│   ├── generator.py             builds + signs passports (allowlists public fields)
│   ├── server.py                well-known endpoints, tamper modes, control plane
│   └── verify.py                merchant-side self-test
│
├── marginmind/           Deterministic decision engine, its own service (port 8002)
│   ├── scoring.py                pure scoring function, unit-testable, no I/O
│   ├── engine.py                 filtering, basket generation, bounds, repricing
│   ├── merchant_store.py         MarginMind's OWN trusted read of merchant config
│   ├── server.py                 recommend / validate_order / bounds
│   └── test_scoring.py           pytest — determinism, bounds, forged-input rejection
│
├── buyer-agent/          The agentic side, API gateway for the dashboard (port 8003)
│   ├── trace.py                  the event stream behind the canvas AND the audit log
│   ├── pipeline.py               the pipeline, expressed once, as traced hops
│   ├── risk_policy.py            the BUYER's own deterministic trust rules
│   ├── sanitize.py               catalog text is data, never instructions
│   ├── redteam.py                twelve real attacks against the running system
│   ├── passport_client.py        fetch + verify signature + freshness
│   ├── marginmind_client.py      HTTP client to MarginMind
│   ├── intent_parser.py          Groq: free text -> structured BuyerIntent
│   ├── negotiator.py             LangChain tool-calling agent, bounded retries
│   ├── explainer.py              Groq: narrates a final decision, invents nothing
│   ├── orders_store.py           in-memory idempotent order records
│   ├── payments/                 dual-mode Razorpay + webhook verification
│   └── server.py                 SSE streams, policy API, red team API, registry
│
├── shared/               Common code imported by all three services
│   ├── models.py                 Pydantic contracts
│   ├── verify.py                 canonical signature/freshness checks
│   ├── audit.py                  append-only audit log
│   └── ids.py                    correlation/order ids, content hashing
│
├── dashboard/            React + Vite frontend (port 5173)
│   └── src/
│       ├── pages/                Overview, Demo, Registry, Passport, ControlPlane,
│       │                         RiskPolicy, RedTeam, Audit
│       ├── components/           AgentCanvas, TracePanels, Nav, CheckoutModal, ui
│       ├── lib/                  topology, theatre (playback), useAgentRun, format
│       └── styles/               tokens, base, app, canvas, pages
├── audit/                audit.log lives here at runtime (gitignored)
└── .env.example          copy to .env — GROQ_API_KEY, optional Razorpay test keys
```

## Status

- [x] Passport: schema, Ed25519 signing, well-known server, self-verifying refresh
- [x] Multi-merchant: per-merchant keypairs, namespaced URLs, independent verification
- [x] Merchant control plane: live edits that re-sign the passport and take effect immediately
- [x] MarginMind: scoring, basket ranking, bounds enforcement, repricing, unit tests
- [x] Buyer agent: intent parsing, passport verification, negotiation, explanation
- [x] Buyer risk policy: deterministic, buyer-side, live-evaluated
- [x] Streamed pipeline: SSE events with measured latencies, driving the canvas
- [x] Cross-merchant sourcing: one request, every merchant quotes, code picks
- [x] Red team: twelve attacks, all currently blocked, each reporting its own outcome
- [x] Payments: dual-mode Razorpay (real test-mode API + Checkout.js, or simulated)
- [x] Audit trail: cross-service, correlation-id-linked, append-only
- [x] Dashboard: orchestration canvas, merchant console, risk policy, red team, audit

See [START.md](START.md) for how to run it and the demo script.
