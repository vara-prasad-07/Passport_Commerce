import { Card, CardHead, EngineLegend, Icon, Pill, Skeleton, Stat } from "../components/ui.jsx";
import { formatMinorShort } from "../lib/format.js";

const QUESTIONS = [
  {
    q: "Who is this merchant?",
    a: "The signed `merchant` block — identity, domain, category and service regions, verified against an Ed25519 signature before anything else runs.",
  },
  {
    q: "What's available, at what price?",
    a: "A live, TTL-bound catalog published by the merchant. Cost and margin data is deliberately never in it.",
  },
  {
    q: "What evidence backs the merchant's claims?",
    a: "Attestations, each carrying an issuer and a status, so an agent can tell a self-declaration from a third-party proof.",
  },
  {
    q: "What is the agent allowed to do?",
    a: "Explicit capabilities and financial bounds — which actions are permitted, and the ceiling on each.",
  },
  {
    q: "Can it satisfy both buyer intent and merchant economics?",
    a: "MarginMind's job, and only MarginMind's. Deterministic code, enforced from the merchant's own trusted config.",
  },
];

const DIFFERENTIATORS = [
  {
    icon: "shield",
    tone: "sky",
    title: "The merchant is verifiable, not scraped",
    body: "Agents today guess at prices and policies by scraping pages. Here the merchant publishes a signed, versioned contract at a well-known URL, and the buyer agent verifies the signature and freshness itself before it will transact.",
  },
  {
    icon: "scale",
    tone: "amber",
    title: "The buyer decides what trustworthy means",
    body: "A passport publishes evidence, never a trust score — so the buyer agent runs its own deterministic risk policy over that evidence. A merchant with a flawless signature is still refused if it offers a shorter refund window than this buyer accepts, and no field a merchant can publish will turn that rule off.",
  },
  {
    icon: "activity",
    tone: "gold",
    title: "The visualisation is the event stream",
    body: "The pipeline streams a typed event per real hop, with the elapsed time it actually took. The canvas is a rendering of that stream — not an animation timed to look plausible — and the same events are the rows in the audit log. Playback can be slowed to a quarter speed; the latencies never change.",
  },
  {
    icon: "cpu",
    tone: "emerald",
    title: "No LLM ever decides money",
    body: "Margin floor, discount ceiling and order cap are enforced by MarginMind in plain deterministic code, re-derived from its own config. A forged passport snapshot from a caller changes nothing.",
  },
  {
    icon: "route",
    tone: "violet",
    title: "Negotiation that cannot overreach",
    body: "When a request is declined for a buyer-side reason, a tool-calling agent gets a capped number of attempts to relax one soft preference at a time. It cannot touch a merchant bound — the tool does not accept them.",
  },
  {
    icon: "card",
    tone: "gold",
    title: "Consent before money, always",
    body: "The basket is repriced from the trusted catalog at confirm time, capabilities are re-checked, and a Razorpay order is created only after an explicit click. Payment is confirmed by server-side HMAC, never by the model.",
  },
  {
    icon: "file",
    tone: "sky",
    title: "One append-only audit trail",
    body: "Every passport fetch, decision, negotiation, order and payment lands in a single correlation-id-linked log spanning all three services — including the failures.",
  },
  {
    icon: "ban",
    tone: "rose",
    title: "Twelve attacks you can fire yourself",
    body: "Not one staged failure — a Red Team console where anyone can tamper with the passport, forge a price, forge the bounds, replay a charge, revoke a capability, or hide instructions in a product name. Each runs through the ordinary code path, and the scoreboard reports a control that fails as loudly as one that holds.",
  },
  {
    icon: "store",
    tone: "emerald",
    title: "A merchant console, not a JSON file",
    body: "Drag the margin floor and the passport is re-signed on the spot with a new version and a visibly different signature — and MarginMind, which re-reads that same config on every decision, enforces the new number on the very next query. No cache to invalidate, no restart to hide behind.",
  },
  {
    icon: "search",
    tone: "sky",
    title: "A registry, not a single merchant",
    body: "Two merchants, each with their own Ed25519 keypair, each verified independently and judged separately against the buyer's policy. One request goes to both, both quote, and deterministic code picks the winner — because which merchant receives the money is a decision, and decisions are code here.",
  },
];

function ServiceNode({ port, name, role, engine, children }) {
  return (
    <div className="arch-node">
      <span className="arch-port">:{port}</span>
      <h4>{name}</h4>
      <p>{children}</p>
      <div className="arch-role">
        <span className={`tag ${engine}`}>{role}</span>
      </div>
    </div>
  );
}

export default function Overview({ navigate, health, healthError, passport, passportLoading }) {
  const bounds = passport?.bounds;
  const skuCount = passport?.catalog?.items?.length;

  return (
    <div className="page">
      {/* ---------------- hero ---------------- */}
      <section className="hero">
        <span className="hero-badge">
          <span className="tag gold">Razorpay AI Buildathon</span>
          Track 01 — AI Growth &amp; Agentic Commerce
        </span>

        <h1>
          The trust layer for <span className="accent">agentic commerce</span>
        </h1>

        <p className="hero-sub">
          Everyone is building the AI shopper. We built the reason an AI shopper can safely trust and transact with
          the seller — a signed, machine-readable merchant contract, and a deterministic engine that enforces the
          merchant's economics no matter what the model asks for.
        </p>

        <div className="hero-cta">
          <button className="btn btn-primary btn-lg" onClick={() => navigate("demo")}>
            Run the live demo <Icon.arrowRight size={16} />
          </button>
          <button className="btn btn-lg" onClick={() => navigate("redteam")}>
            <Icon.ban size={16} /> Attack it yourself
          </button>
        </div>

        <div className="thesis">
          <div className="thesis-half llm">
            <span className="tag violet">
              <Icon.sparkles size={11} /> LLM
            </span>
            <span className="thesis-role">Reasons and talks</span>
            <p>Parses intent, negotiates soft preferences, explains the outcome in plain language.</p>
          </div>
          <div className="thesis-sep" />
          <div className="thesis-half code">
            <span className="tag emerald">
              <Icon.cpu size={11} /> Deterministic code
            </span>
            <span className="thesis-role">Enforces and pays</span>
            <p>Verifies signatures, enforces every bound, reprices the basket, and moves the money.</p>
          </div>
        </div>
      </section>

      {/* ---------------- live status ---------------- */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Live system state</h2>
          <p>Read straight from the running services — nothing on this page is mocked.</p>
        </div>

        <div className="grid grid-4">
          <Stat
            icon={<Icon.bot size={13} />}
            label="Buyer agent"
            value={healthError ? "Offline" : health ? "Online" : "…"}
            tone={healthError ? "rose" : health ? "emerald" : undefined}
            foot={healthError ? "Start it on :8003" : "FastAPI on :8003"}
          />
          <Stat
            icon={<Icon.sparkles size={13} />}
            label="Groq LLM"
            value={health ? (health.llm_configured ? "Connected" : "Not configured") : "…"}
            tone={health ? (health.llm_configured ? "violet" : "rose") : undefined}
            foot={health?.llm_configured ? "Intent · negotiation · explanation" : "Set GROQ_API_KEY in .env"}
          />
          <Stat
            icon={<Icon.card size={13} />}
            label="Razorpay"
            value={health ? (health.razorpay_live ? "Test mode" : "Simulated") : "…"}
            tone={health ? (health.razorpay_live ? "gold" : "amber") : undefined}
            foot={health?.razorpay_live ? "Live test keys loaded" : "Same code path, HMAC still real"}
          />
          <Stat
            icon={<Icon.shieldCheck size={13} />}
            label="Merchant passport"
            value={passportLoading ? "…" : passport ? (passport.trusted ? "Verified" : "Rejected") : "Unreachable"}
            tone={passport?.trusted ? "emerald" : passportLoading ? undefined : "rose"}
            foot={passport ? `Ed25519 · ${passport.passport_id}` : "Passport service on :8001"}
          />
        </div>
      </section>

      {/* ---------------- merchant bounds ---------------- */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">The bounds this agent operates under</h2>
          <p>
            Published by the merchant, enforced by MarginMind from its own copy — a caller cannot raise a single one
            of these numbers by asking.
          </p>
        </div>

        <div className="grid grid-4">
          {passportLoading || !bounds ? (
            [0, 1, 2, 3].map((n) => (
              <Card key={n} className="stat">
                <Skeleton height={11} width="55%" />
                <Skeleton height={26} width="70%" style={{ marginTop: 8 }} />
              </Card>
            ))
          ) : (
            <>
              <Stat
                icon={<Icon.scale size={13} />}
                label="Autonomous order cap"
                value={formatMinorShort(bounds.max_order_value_minor)}
                foot="Above this, the agent must escalate"
              />
              <Stat
                icon={<Icon.scale size={13} />}
                label="Margin floor"
                value={`${bounds.min_margin_percent}%`}
                foot="No basket may price below it"
              />
              <Stat
                icon={<Icon.scale size={13} />}
                label="Discount ceiling"
                value={formatMinorShort(bounds.discount_ceiling_minor)}
                foot="Hard cap on any bundle discount"
              />
              <Stat
                icon={<Icon.store size={13} />}
                label="Catalog"
                value={`${skuCount ?? 0} SKUs`}
                foot={`TTL ${passport?.catalog?.ttl_seconds ?? "—"}s · no cost data published`}
              />
            </>
          )}
        </div>
      </section>

      {/* ---------------- architecture ---------------- */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Three services, one signed protocol</h2>
          <p>
            Real HTTP between real separate FastAPI processes — not one monolith pretending to be three. The split is
            the point: the side that reasons and the side that enforces cannot be the same process.
          </p>
        </div>

        <Card className="card-pad">
          <div className="arch">
            <ServiceNode port="8001" name="Merchant Passport" role="Cryptography" engine="sky">
              Generates, Ed25519-signs and serves the merchant contract at{" "}
              <code className="code-inline">/.well-known/agent-commerce.json</code>. Re-signs itself when its TTL
              expires.
            </ServiceNode>
            <ServiceNode port="8002" name="MarginMind" role="Deterministic" engine="emerald">
              The merchant-side decision engine. Filters the catalog, ranks baskets, and enforces order cap, margin
              floor and discount ceiling from its own trusted config.
            </ServiceNode>
            <ServiceNode port="8003" name="Buyer Agent" role="LLM + orchestration" engine="violet">
              Verifies the passport, parses intent, calls MarginMind, negotiates soft preferences, explains the
              outcome, and drives Razorpay after explicit consent.
            </ServiceNode>
          </div>

          <div className="arch-flow">
            <span className="arch-arrow">buyer intent</span>
            <Icon.arrowRight size={13} />
            <span className="arch-arrow">verify signature + freshness</span>
            <Icon.arrowRight size={13} />
            <span className="arch-arrow">rank + enforce bounds</span>
            <Icon.arrowRight size={13} />
            <span className="arch-arrow">explicit consent</span>
            <Icon.arrowRight size={13} />
            <span className="arch-arrow">Razorpay</span>
            <Icon.arrowRight size={13} />
            <span className="arch-arrow">audit</span>
          </div>

          <hr className="divider" />

          <p className="eyebrow" style={{ marginBottom: 10 }}>
            How to read every trace in this app
          </p>
          <EngineLegend />
        </Card>
      </section>

      {/* ---------------- five questions ---------------- */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">The five questions answered before money moves</h2>
          <p>Each one is answered from the signed passport, before the buyer agent will transact.</p>
        </div>

        <div className="qlist">
          {QUESTIONS.map((item) => (
            <div className="qitem" key={item.q}>
              <div>
                <h4>{item.q}</h4>
                <p>{item.a}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- differentiators ---------------- */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">What makes this different</h2>
        </div>

        <div className="grid grid-3">
          {DIFFERENTIATORS.map((d) => {
            const I = Icon[d.icon];
            return (
              <Card className="feature interactive" key={d.title}>
                <span className={`feature-icon ${d.tone}`}>
                  <I size={18} />
                </span>
                <h3>{d.title}</h3>
                <p>{d.body}</p>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ---------------- closing CTA ---------------- */}
      <section className="section">
        <Card className="card-pad" style={{ textAlign: "center", padding: "34px 24px" }}>
          <Pill tone="ok">end to end, in about ninety seconds</Pill>
          <h2 className="section-title" style={{ marginTop: 14 }}>
            Watch it verify, decide, negotiate and pay
          </h2>
          <p className="lead" style={{ maxWidth: "58ch", margin: "10px auto 0" }}>
            Then break it on purpose: request an order above the merchant's cap and watch the gate stop it before a
            single money action is taken.
          </p>
          <div className="hero-cta">
            <button className="btn btn-primary btn-lg" onClick={() => navigate("demo")}>
              Open the live demo <Icon.arrowRight size={16} />
            </button>
            <button className="btn btn-lg" onClick={() => navigate("passport")}>
              <Icon.file size={16} /> Inspect the signed passport
            </button>
          </div>
        </Card>
      </section>
    </div>
  );
}
