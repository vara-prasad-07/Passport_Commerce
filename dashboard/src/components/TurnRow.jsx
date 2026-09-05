import { formatMinor, timeOnly } from "../lib/format.js";
import { ErrorText, Icon } from "./ui.jsx";
import PipelineTrace from "./PipelineTrace.jsx";

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
        <span className="tag">score {option.score}</span>
      </span>
    </button>
  );
}

/** One request/response pair in the transcript: the buyer's message on the
 * left, the live agent workspace — trace, then baskets — on the right. */
export default function TurnRow({ turn, onTraceDone, onSelectBasket, onConfirm, highlighted }) {
  const options = turn.result?.decision?.options ?? [];

  return (
    <div id={`turn-${turn.id}`} className={`turn ${highlighted ? "highlighted" : ""}`}>
      <div className="turn-user">
        <div className="turn-bubble">
          <p>{turn.text}</p>
          <span className="turn-time">{timeOnly(turn.createdAt)}</span>
        </div>
      </div>

      <div className="turn-agent">
        {turn.status === "running" && !turn.result && (
          <div className="turn-waiting">
            <span className="dots">
              <span />
              <span />
              <span />
            </span>
            Verifying the passport…
          </div>
        )}

        {turn.status === "error" && <ErrorText>{turn.error}</ErrorText>}

        {turn.result && (
          <PipelineTrace result={turn.result} onDone={() => onTraceDone(turn.id)} />
        )}

        {turn.traceDone && options.length > 0 && (
          <div className="turn-baskets rise">
            <div className="turn-baskets-label">
              <Icon.store size={13} /> Choose a basket — ranked by MarginMind, priced by deterministic code
            </div>
            <div className="baskets">
              {options.map((opt, idx) => (
                <Basket
                  key={opt.basket_id}
                  option={opt}
                  rank={idx}
                  selected={turn.selectedBasketId === opt.basket_id}
                  onSelect={() => onSelectBasket(turn.id, opt.basket_id)}
                />
              ))}
            </div>

            {turn.alreadyPaidOrder ? (
              <div className="callout" style={{ marginTop: 14 }}>
                <div className="callout-title text-emerald">
                  <Icon.check size={12} /> Already paid
                </div>
                This basket was already paid as order{" "}
                <code className="code-inline">{turn.alreadyPaidOrder.order_id}</code>.
              </div>
            ) : (
              <button
                className="btn btn-primary btn-lg"
                style={{ marginTop: 14 }}
                onClick={() => onConfirm(turn.id)}
                disabled={turn.confirming || !turn.selectedBasketId}
              >
                {turn.confirming ? (
                  <>
                    <span className="spinner" /> Revalidating with MarginMind…
                  </>
                ) : (
                  <>
                    <Icon.lock size={15} /> Confirm basket &amp; pay
                  </>
                )}
              </button>
            )}

            <ErrorText>{turn.confirmError}</ErrorText>
          </div>
        )}
      </div>
    </div>
  );
}
