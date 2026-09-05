import { useState } from "react";
import { api } from "../api.js";
import { formatMinor } from "../lib/format.js";
import { Card, CardHead, ErrorText, Icon, Pill } from "../components/ui.jsx";

/* Every claim below is backed by code in this repo, and the `proof` line names
   the file or test that enforces it — a guarantee nobody can check is just a
   marketing bullet. */
const GUARANTEES = [
  {
    title: "Cost and margin data never leaves the merchant",
    body: "The generator allowlists which catalog fields go into the public signed passport, and cost_minor is never one of them. MarginMind reads cost from merchant_data.json directly, on the merchant's side of the wire.",
    proof: "passport/generator.py",
  },
  {
    title: "A buyer agent cannot forge its own bounds",
    body: "MarginMind ignores whatever bounds a caller's passport snapshot claims and re-derives every limit from its own merchant_store before deciding anything.",
    proof: "test_forged_passport_snapshot_cannot_raise_the_effective_cap",
  },
  {
    title: "A buyer agent cannot forge a basket's price",
    body: "validate_order reprices every line item from the trusted catalog by SKU before checking bounds or creating a Razorpay order. A client-supplied unit price is discarded, not trusted.",
    proof: "test_validate_order_ignores_forged_prices",
  },
  {
    title: "Payment confirmation is server-verified, never model- or client-asserted",
    body: "POST /api/payments/verify checks the Razorpay HMAC signature server-side. Nothing is marked paid on any other basis — including in simulated mode, which uses the identical HMAC scheme.",
    proof: "buyer-agent/payments/razorpay_client.py",
  },
  {
    title: "Order creation is idempotent",
    body: "A repeated confirm click, or a retried request, replays the same order through an idempotency key instead of creating a second one and charging twice.",
    proof: "buyer-agent/orders_store.py",
  },
  {
    title: "The passport cannot go silently stale",
    body: "A deliberately short 300-second TTL makes the freshness check demonstrable, and the passport server re-signs on read when its cached copy has expired — so a buyer never rejects an idle but otherwise valid merchant.",
    proof: "shared/verify.py · verify_freshness",
  },
];

function BoundsGauge({ requested, permitted, currency }) {
  if (!requested || !permitted) return null;
  const span = Math.max(requested, permitted);
  const permittedPct = (permitted / span) * 100;
  const requestedPct = (requested / span) * 100;
  const overBy = requested - permitted;

  return (
    <div className="gauge">
      <div className="gauge-labels">
        <span className="gauge-flag">
          <Icon.card size={13} className="text-rose" />
          Requested <b className="text-rose">{formatMinor(requested, currency)}</b>
        </span>
        <span className="gauge-flag">
          Permitted <b className="text-emerald">{formatMinor(permitted, currency)}</b>
          <Icon.shield size={13} className="text-emerald" />
        </span>
      </div>

      <div className="gauge-track">
        <div className="gauge-permitted" style={{ width: `${permittedPct}%` }} />
        <div className="gauge-requested" style={{ width: `${requestedPct}%` }} />
      </div>

      <div className="gauge-labels">
        <span className="dim xs">₹0</span>
        <span className="xs">
          <b className="text-rose">{formatMinor(overBy, currency)}</b>{" "}
          <span className="dim">over the merchant's autonomous cap</span>
        </span>
      </div>
    </div>
  );
}

export default function Guardrails({ onResult }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.demoOverlimit();
      setResult(data);
      onResult?.(data.correlation_id);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const gw = result?.gateway_response;

  return (
    <div className="page">
      <div className="page-head">
        <div className="eyebrow">Guardrails</div>
        <h1 className="section-title">Break it on purpose</h1>
        <p>
          The interesting question is not whether the happy path works — it's what happens when an agent asks for
          something it isn't allowed to have. This runs a real request straight at the real bounds gate. No LLM is
          involved, so it reproduces identically every single time.
        </p>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 18, alignItems: "start" }}>
        <Card>
          <CardHead
            title="Over-limit order attempt"
            icon={<Icon.ban size={16} />}
            sub="Deliberately requests a basket priced well above the merchant's autonomous order cap."
          />
          <div className="card-body">
            <button className="btn btn-danger btn-block btn-lg" onClick={run} disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner" /> Attempting…
                </>
              ) : (
                <>
                  <Icon.alert size={15} /> Attempt an order above the cap
                </>
              )}
            </button>

            <ErrorText>{error}</ErrorText>

            {gw && (
              <div style={{ marginTop: 18 }} className="fade">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                  <Pill tone="bad">declined</Pill>
                  <Pill tone="ok">no money action taken</Pill>
                  <Pill tone="warn">escalation required</Pill>
                </div>

                <BoundsGauge
                  requested={gw.requested_amount_minor}
                  permitted={gw.permitted_amount_minor}
                  currency={result?.attempted_basket?.currency}
                />

                <div className="callout decline" style={{ marginTop: 18 }}>
                  <div className="callout-code">{gw.code}</div>
                  <div>{gw.message}</div>
                </div>

                <hr className="divider" />

                <dl className="kv">
                  <dt>Money action taken</dt>
                  <dd className={gw.money_action_taken ? "text-rose" : "text-emerald"}>
                    {String(gw.money_action_taken)}
                  </dd>
                  <dt>Razorpay orders created</dt>
                  <dd className="text-emerald">{result.orders_created_by_this_call}</dd>
                  <dt>Escalation required</dt>
                  <dd>{String(gw.escalation_required)}</dd>
                  <dt>Audit id</dt>
                  <dd className="xs">{gw.audit_id}</dd>
                  <dt>Correlation id</dt>
                  <dd className="xs">{result.correlation_id}</dd>
                </dl>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHead
            title="Why this is the important demo"
            icon={<Icon.shieldCheck size={16} />}
          />
          <div className="card-body">
            <p className="small muted">
              An agent that only works when everything goes right is not trustworthy — it is lucky. The claim worth
              making is that the failure is <b>structural</b>: the decline comes from MarginMind's own configuration,
              on the merchant's side of the wire, before any Razorpay call exists.
            </p>

            <hr className="divider" />

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="pstep ok" style={{ paddingBottom: 0 }}>
                <div className="pstep-marker">
                  <Icon.check size={13} />
                </div>
                <div className="pstep-body">
                  <div className="pstep-title">Caught before the money path</div>
                  <div className="pstep-detail">
                    No internal order record and no Razorpay order are created — the gate runs first.
                  </div>
                </div>
              </div>

              <div className="pstep ok" style={{ paddingBottom: 0 }}>
                <div className="pstep-marker">
                  <Icon.check size={13} />
                </div>
                <div className="pstep-body">
                  <div className="pstep-title">Structured, not a stack trace</div>
                  <div className="pstep-detail">
                    A typed decline with a machine-readable code, the permitted ceiling, and an escalation flag —
                    something a calling agent can actually act on.
                  </div>
                </div>
              </div>

              <div className="pstep ok" style={{ paddingBottom: 0 }}>
                <div className="pstep-marker">
                  <Icon.check size={13} />
                </div>
                <div className="pstep-body">
                  <div className="pstep-title">Logged like everything else</div>
                  <div className="pstep-detail">
                    The attempt lands in the same append-only audit feed as the successes. Failures are not
                    quarantined into a separate view.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead
          title="Guarantees actually implemented"
          icon={<Icon.lock size={16} />}
          sub="Things a naive version of this demo would get wrong. Each line names the code or test that enforces it."
        />
        <div className="card-body">
          {GUARANTEES.map((g) => (
            <div className="guarantee" key={g.title}>
              <span className="guarantee-mark">
                <Icon.check size={12} />
              </span>
              <div>
                <h4>{g.title}</h4>
                <p>{g.body}</p>
                <span className="proof">
                  <Icon.file size={11} />
                  {g.proof}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 18 }}>
        <CardHead
          title="Known limitations"
          icon={<Icon.alert size={16} />}
          sub="Stated plainly, because a demo that claims to have solved everything is the least believable kind."
        />
        <div className="card-body">
          <div className="small muted" style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            <span>
              <b className="text-amber">Rate limiting</b> is declared in the passport's bounds but not enforced —
              there is no per-agent identity system in this build to rate-limit against.
            </span>
            <span>
              <b className="text-amber">Refunds</b> are exposed as a capability requiring merchant approval, but no
              refund flow is wired up.
            </span>
            <span>
              <b className="text-amber">No persistent database</b> — the audit log is an append-only file and orders
              are in memory. One merchant, deeply implemented, rather than a shallow registry.
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
