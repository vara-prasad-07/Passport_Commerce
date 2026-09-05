import { useEffect } from "react";
import { CopyButton, ErrorText, Icon, JsonBlock } from "./ui.jsx";
import { ENGINE_LABEL, ENGINE_TONE, NODES } from "../lib/topology.js";
import { formatMinor } from "../lib/format.js";

/*
 * One panel, two things to say.
 *
 * The results used to be a sheet floating over the middle of the canvas,
 * which meant the moment the agent finished was also the moment you could no
 * longer see the agent. Here the panel is a sibling of the stage rather than
 * an overlay: the canvas gets the remaining width and re-fits itself, so
 * nothing is ever hidden behind anything.
 *
 * Clicking a packet pushes the inspector OVER the result rather than
 * replacing it, with a back arrow — inspecting a message is a detour from
 * reading the answer, not a different destination.
 */

const nodeLabel = (id) => NODES[id]?.label ?? id;

function IntentChips({ intent }) {
  if (!intent) return null;
  const chips = [];
  if (intent.dietary_include?.length) chips.push(["include", intent.dietary_include.join(", ")]);
  if (intent.dietary_exclude?.length) chips.push(["exclude", intent.dietary_exclude.join(", ")]);
  if (intent.meal_type) chips.push(["meal", intent.meal_type]);
  if (intent.people_count) chips.push(["people", intent.people_count]);
  if (intent.budget_max_minor) chips.push(["budget", formatMinor(intent.budget_max_minor, intent.currency)]);
  if (intent.region) chips.push(["region", intent.region]);
  if (intent.delivery_window) chips.push(["delivery", intent.delivery_window]);
  if (!chips.length) return null;
  return (
    <div className="intent-chips">
      {chips.map(([k, v]) => (
        <span className="intent-chip" key={k}>
          <b>{k}</b>
          {String(v)}
        </span>
      ))}
    </div>
  );
}

function Basket({ option, selected, rank, onSelect }) {
  const marginPct = Math.max(0, Math.min(100, option.estimated_margin_percent ?? 0));
  return (
    <button
      className={`basket ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
      type="button"
    >
      <span className="basket-check">
        <Icon.check size={12} />
      </span>
      <span className="basket-rank">{rank === 0 ? "Best match" : `Alternative ${rank}`}</span>
      <span className="basket-total">{formatMinor(option.total_minor, option.currency)}</span>
      <span className="basket-items">
        {option.items.map((li) => (
          <span key={li.sku}>
            <span className="qty">{li.quantity}×</span>
            {li.name}
          </span>
        ))}
      </span>
      <span className="marginbar" title={`Merchant margin ${option.estimated_margin_percent}%`}>
        <span style={{ width: `${marginPct}%` }} />
      </span>
      <span className="basket-meta">
        <span className="tag emerald">margin {option.estimated_margin_percent}%</span>
        {option.discount_minor > 0 && (
          <span className="tag gold">−{formatMinor(option.discount_minor, option.currency)}</span>
        )}
      </span>
    </button>
  );
}

export function HopDetail({ hop, onBack }) {
  const tone = ENGINE_TONE[hop.engine] ?? "sky";
  const blocked = hop.status === "blocked";

  return (
    <div className={`sp-inspector tone-${tone}${blocked ? " is-blocked" : ""}`}>
      <header className="sp-head">
        <button className="sp-back" onClick={onBack} aria-label="Back">
          <Icon.chevronsLeft size={15} />
        </button>
        <div style={{ minWidth: 0 }}>
          <span className={`tag ${tone}`}>{ENGINE_LABEL[hop.engine] ?? hop.engine}</span>
          <h3>{hop.label}</h3>
        </div>
      </header>

      <p className="sp-route">
        <b>{nodeLabel(hop.src)}</b>
        <Icon.arrowRight size={12} />
        <b>{nodeLabel(hop.dst)}</b>
      </p>
      {hop.protocol && <p className="sp-protocol">{hop.protocol}</p>}

      <div className="sp-stats">
        <div>
          <span className="dim xs">Measured</span>
          <b>{hop.durationMs != null ? `${Math.round(hop.durationMs)} ms` : "in flight"}</b>
        </div>
        <div>
          <span className="dim xs">Outcome</span>
          <b className={blocked ? "text-rose" : hop.status === "error" ? "text-amber" : "text-emerald"}>
            {blocked ? "Blocked" : hop.status === "error" ? "Failed" : "OK"}
          </b>
        </div>
      </div>

      {hop.code && <div className="sp-code">{hop.code}</div>}

      {hop.summary && (
        <p className={`sp-summary${blocked ? " is-blocked" : ""}`}>
          {blocked && <Icon.ban size={13} />}
          <span>{hop.summary}</span>
        </p>
      )}

      {hop.payload != null && (
        <section className="sp-section">
          <div className="sp-section-head">
            <h4>Sent on the wire</h4>
            <CopyButton value={JSON.stringify(hop.payload, null, 2)} label="" />
          </div>
          <JsonBlock value={hop.payload} maxHeight={240} />
        </section>
      )}

      {hop.reply != null && (
        <section className="sp-section">
          <div className="sp-section-head">
            <h4>Came back</h4>
            <CopyButton value={JSON.stringify(hop.reply, null, 2)} label="" />
          </div>
          <JsonBlock value={hop.reply} maxHeight={300} />
        </section>
      )}
    </div>
  );
}

function ResultView({ result, selectedBasketId, onSelectBasket, onConfirm, confirming, confirmError }) {
  const options = result?.decision?.options ?? [];
  const declined = result && result.stage !== "ready_for_consent";

  return (
    <div className="sp-result">
      <header className="sp-head">
        <div>
          <span className={`tag ${declined ? "rose" : "emerald"}`}>
            {declined ? "Declined" : "Ready for your consent"}
          </span>
          <h3>{declined ? "No purchase was made" : "Choose a basket"}</h3>
        </div>
      </header>

      {result?.explanation && (
        <div className="sp-explain">
          <span className="tag violet">
            <Icon.sparkles size={11} /> Explained by the model
          </span>
          <p>{result.explanation}</p>
        </div>
      )}

      {result?.message && !result.explanation && (
        <div className={`callout ${declined ? "decline" : ""}`}>
          {result.code && <div className="callout-code">{result.code}</div>}
          <div>{result.message}</div>
        </div>
      )}

      <IntentChips intent={result?.intent} />

      {result?.policy && (
        <div className="sp-policy">
          <span className={`tag ${result.policy.passed ? "amber" : "rose"}`}>
            <Icon.scale size={11} /> Buyer policy
          </span>
          <span className="dim xs">{result.policy.summary}</span>
        </div>
      )}

      {options.length > 0 && (
        <div className="sp-baskets">
          {options.map((opt, idx) => (
            <Basket
              key={opt.basket_id}
              option={opt}
              rank={idx}
              selected={selectedBasketId === opt.basket_id}
              onSelect={() => onSelectBasket(opt.basket_id)}
            />
          ))}
        </div>
      )}

      {options.length > 0 && !declined && (
        <button className="btn btn-primary btn-lg sp-confirm" onClick={onConfirm} disabled={confirming || !selectedBasketId}>
          {confirming ? (
            <>
              <span className="spinner" /> Revalidating…
            </>
          ) : (
            <>
              <Icon.lock size={15} /> Confirm basket &amp; pay
            </>
          )}
        </button>
      )}

      <ErrorText>{confirmError}</ErrorText>
    </div>
  );
}

export default function SidePanel({
  open,
  hop,
  result,
  selectedBasketId,
  onSelectBasket,
  onConfirm,
  confirming,
  confirmError,
  onCloseHop,
  onClose,
}) {
  // Escape steps back one level: out of the inspector if it's open, out of
  // the panel entirely otherwise. Getting out must never require aiming at a
  // small target while somebody is narrating a demo.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (hop) onCloseHop?.();
      else onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hop, onCloseHop, onClose]);

  if (!open) return null;

  return (
    <aside className="side-panel" role="complementary">
      {hop ? (
        <HopDetail hop={hop} onBack={onCloseHop} />
      ) : (
        <ResultView
          result={result}
          selectedBasketId={selectedBasketId}
          onSelectBasket={onSelectBasket}
          onConfirm={onConfirm}
          confirming={confirming}
          confirmError={confirmError}
        />
      )}
    </aside>
  );
}
