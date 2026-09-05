import { useCallback, useEffect, useRef, useState } from "react";
import { STREAM_URLS, api } from "../api.js";
import { SPEEDS } from "../lib/theatre.js";
import { useAgentRun } from "../lib/useAgentRun.js";
import { formatMinor, truncateMiddle } from "../lib/format.js";
import AgentCanvas from "../components/AgentCanvas.jsx";
import ChatInputBar from "../components/ChatInputBar.jsx";
import { HopInspector, PaceControl, TraceRail } from "../components/TracePanels.jsx";
import { Card, CardHead, ErrorText, Icon, Pill, Skeleton } from "../components/ui.jsx";

/*
 * The registry — the passport idea doing what a passport is for.
 *
 * A buyer agent that has never met either merchant can establish who they
 * are, judge each against its OWN policy, take one request to both, and
 * choose. Every merchant is verified against its own key, so one merchant
 * passing tells you nothing about another; and a merchant that fails is
 * listed as failing rather than quietly dropped, because a registry you
 * cannot audit is not worth having.
 *
 * The choice itself is made in deterministic code. Which merchant receives
 * the buyer's money is a decision, and in this system decisions are code.
 */

const DEFAULT_QUERY =
  "Vegetarian high-protein breakfast for two, delivered tomorrow in Bangalore, under ₹900.";

function MerchantCard({ merchant }) {
  const bounds = merchant.bounds ?? {};
  const policies = merchant.policies ?? {};
  return (
    <Card className={`reg-card${merchant.trusted ? "" : " is-untrusted"}`}>
      <div className="reg-card-head">
        <div>
          <h3>{merchant.name}</h3>
          <span className="mono xs dim">{merchant.domain}</span>
        </div>
        <Pill tone={merchant.trusted ? "ok" : "bad"}>{merchant.trusted ? "verified" : "rejected"}</Pill>
      </div>

      <div className="reg-card-verify">
        <span className={merchant.signature_ok ? "text-emerald" : "text-rose"}>
          {merchant.signature_ok ? <Icon.check size={12} /> : <Icon.x size={12} />} signature
        </span>
        <span className={merchant.freshness_ok ? "text-emerald" : "text-rose"}>
          {merchant.freshness_ok ? <Icon.check size={12} /> : <Icon.x size={12} />} freshness
        </span>
        <span className="mono xs dim">key {merchant.key_id}</span>
      </div>

      <dl className="reg-facts">
        <div>
          <dt>Order cap</dt>
          <dd>{formatMinor(bounds.max_order_value_minor)}</dd>
        </div>
        <div>
          <dt>Margin floor</dt>
          <dd>{bounds.min_margin_percent}%</dd>
        </div>
        <div>
          <dt>Refund window</dt>
          <dd>{policies.refund_window_days} days</dd>
        </div>
        <div>
          <dt>Catalog</dt>
          <dd>{merchant.catalog?.items?.length ?? merchant.catalog_size} SKUs</dd>
        </div>
        <div>
          <dt>Regions</dt>
          <dd>{(merchant.service_regions ?? []).join(", ") || "—"}</dd>
        </div>
        <div>
          <dt>Attestations</dt>
          <dd>{merchant.attestations?.length ?? 0}</dd>
        </div>
      </dl>

      {merchant.attestations?.length > 0 && (
        <div className="reg-attest">
          {merchant.attestations.map((a) => (
            <span key={a.type} className={`tag ${a.status === "verified" ? "emerald" : ""}`} title={`issuer: ${a.issuer}`}>
              {a.type}
              <span className="dim"> · {a.issuer}</span>
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

function QuoteRow({ quote, winner }) {
  const isWinner = quote.rank === 0;
  return (
    <div className={`reg-quote${isWinner ? " is-winner" : ""}`}>
      <div className="reg-quote-rank">{isWinner ? <Icon.check size={13} /> : `#${quote.rank + 1}`}</div>
      <div className="reg-quote-body">
        <b>{quote.name}</b>
        <span className="dim xs">
          {quote.best.items.map((li) => `${li.quantity}× ${li.name}`).join(" · ")}
        </span>
      </div>
      <div className="reg-quote-meta">
        <span className="tag emerald">margin {quote.best.estimated_margin_percent}%</span>
        <span className="dim xs">{(quote.policies ?? {}).refund_window_days}d refund</span>
      </div>
      <div className="reg-quote-total">
        {formatMinor(quote.total_minor)}
        {!isWinner && winner && (
          <span className="reg-quote-delta">+{formatMinor(quote.total_minor - winner.total_minor)}</span>
        )}
      </div>
    </div>
  );
}

export default function Registry({ onActivity }) {
  const [merchants, setMerchants] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(DEFAULT_QUERY);
  const [selectedHopId, setSelectedHopId] = useState(null);
  const [compare, setCompare] = useState(null);

  const runner = useAgentRun({ speed: 0.5 });
  const { theatre, run, speed, setSpeed, busy, result, error: runError } = runner;
  const handledRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await api.registry();
      setMerchants(data.merchants);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!result || handledRef.current === result) return;
    handledRef.current = result;
    setCompare(result);
    onActivity?.();
  }, [result, onActivity]);

  const source = useCallback(async () => {
    if (!message.trim() || busy) return;
    setCompare(null);
    setSelectedHopId(null);
    handledRef.current = null;
    await run(STREAM_URLS.compare, { message: message.trim() });
  }, [message, busy, run]);

  return (
    <div className="page reg-page">
      <header className="page-head">
        <div>
          <span className="tag sky">
            <Icon.search size={11} /> Passport registry
          </span>
          <h1>One request, every merchant, each verified separately</h1>
          <p>
            A buyer agent that has never met these merchants establishes who they are, applies its own
            risk policy to each, asks both for a basket, and chooses. Every passport is checked against
            that merchant's own key — one merchant passing tells you nothing about another.
          </p>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={load}>
          <Icon.refresh size={13} /> Re-verify all
        </button>
      </header>

      <ErrorText>{error}</ErrorText>

      {merchants === null ? (
        <Skeleton height={220} />
      ) : (
        <div className="reg-grid">
          {merchants.map((m) => (
            <MerchantCard key={m.merchant_id} merchant={m} />
          ))}
        </div>
      )}

      <Card className="reg-sourcing">
        <CardHead
          title="Source across the registry"
          sub="The intent is parsed once and carried to every merchant unchanged, so the comparison is between merchants — not between paraphrases of the request."
          icon={<Icon.route size={15} />}
          action={<PaceControl speed={speed} onChange={setSpeed} speeds={SPEEDS} totalMs={theatre?.snapshot().totalMs} />}
        />

        <div className="reg-input">
          <ChatInputBar
            value={message}
            onChange={setMessage}
            onSend={source}
            disabled={busy}
            loading={busy}
            placeholder="What should the agent source across all merchants?"
          />
        </div>

        <div className="reg-stage">
          <AgentCanvas theatre={theatre} activeHopId={selectedHopId} onSelectHop={setSelectedHopId} />
          <TraceRail theatre={theatre} activeHopId={selectedHopId} onSelect={setSelectedHopId} />
          <HopInspector theatre={theatre} hopId={selectedHopId} onClose={() => setSelectedHopId(null)} />
        </div>

        <ErrorText>{runError}</ErrorText>

        {compare?.quotes?.length > 0 && (
          <div className="reg-results rise">
            <h4>
              <Icon.scale size={13} /> Quotes, ranked by deterministic code
            </h4>
            {compare.quotes.map((q) => (
              <QuoteRow key={q.merchant_id} quote={q} winner={compare.winner} />
            ))}
            {compare.explanation && (
              <div className="cinema-explain" style={{ marginTop: 14 }}>
                <span className="tag violet">
                  <Icon.sparkles size={11} /> Explained by the model
                </span>
                <p>{compare.explanation}</p>
              </div>
            )}
          </div>
        )}

        {compare?.rejected?.length > 0 && (
          <div className="reg-rejected">
            <h4>
              <Icon.ban size={13} /> Not quoted
            </h4>
            {compare.rejected.map((r, i) => (
              <div key={`${r.merchant_id}-${i}`} className="reg-rejected-row">
                <b>{r.name ?? r.merchant_id}</b>
                <span className="tag rose">{r.stage}</span>
                <span className="dim xs">{r.reason}</span>
              </div>
            ))}
          </div>
        )}

        {compare && !compare.quotes?.length && compare.message && (
          <div className="callout decline" style={{ marginTop: 14 }}>
            <div>{compare.message}</div>
          </div>
        )}
      </Card>
    </div>
  );
}
