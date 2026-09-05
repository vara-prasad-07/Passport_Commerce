import { useEffect, useState } from "react";
import { api } from "../api.js";
import { formatMinor } from "../lib/format.js";
import { ErrorText, Icon } from "./ui.jsx";

function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Could not load Razorpay checkout.js — check your internet connection."));
    document.body.appendChild(script);
  });
}

export default function CheckoutModal({ order, onClose, onPaid }) {
  const [status, setStatus] = useState("idle"); // idle | processing | success | failed
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const basket = order.basket;

  // Escape closes, but never mid-payment — dismissing a Razorpay round-trip
  // halfway would leave the order in an ambiguous state on screen.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && status !== "processing") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, onClose]);

  async function payReal() {
    setStatus("processing");
    setError(null);
    try {
      await loadRazorpayScript();
      const rzp = new window.Razorpay({
        key: order.razorpay_key_id,
        amount: order.amount_minor,
        currency: order.currency,
        name: "GreenBowl Foods — TEST MODE",
        description: basket.items.map((i) => `${i.quantity}x ${i.name}`).join(", "),
        order_id: order.razorpay_order_id,
        theme: { color: "#f4b740" },
        handler: async (response) => {
          try {
            const verifyResult = await api.paymentsVerify({
              order_id: order.order_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            if (verifyResult.status === "paid") {
              setStatus("success");
              setResult(verifyResult.order);
              onPaid(verifyResult.order);
            } else {
              setStatus("failed");
              setError("Signature verification failed server-side.");
            }
          } catch (e) {
            setStatus("failed");
            setError(e.message);
          }
        },
        modal: { ondismiss: () => setStatus("idle") },
      });
      rzp.on("payment.failed", (resp) => {
        setStatus("failed");
        setError(resp.error?.description || "Payment failed");
      });
      rzp.open();
    } catch (e) {
      setStatus("failed");
      setError(e.message);
    }
  }

  async function paySimulated() {
    setStatus("processing");
    setError(null);
    try {
      const verifyResult = await api.paymentsSimulate(order.order_id);
      if (verifyResult.status === "paid") {
        setStatus("success");
        setResult(verifyResult.order);
        onPaid(verifyResult.order);
      } else {
        setStatus("failed");
        setError(verifyResult.reason || "Payment failed");
      }
    } catch (e) {
      setStatus("failed");
      setError(e.message);
    }
  }

  const done = status === "success";

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && status !== "processing" && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal">
        <div className="modal-head">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {order.simulated ? (
              <span className="tag amber">
                <Icon.alert size={11} /> Simulated — no Razorpay keys
              </span>
            ) : (
              <span className="tag sky">
                <Icon.card size={11} /> Razorpay test mode
              </span>
            )}
            <span className="tag emerald">
              <Icon.cpu size={11} /> Repriced by MarginMind
            </span>
          </div>
          <h3>{done ? "Payment complete" : "Confirm payment"}</h3>
          <p>
            Order <code className="code-inline">{order.order_id}</code>
          </p>
        </div>

        <div className="modal-body">
          {!done && (
            <>
              <div className="line-items">
                {basket.items.map((i) => (
                  <div className="line-item" key={i.sku}>
                    <span className="li-name">
                      <span className="mono dim" style={{ marginRight: 6 }}>
                        {i.quantity}×
                      </span>
                      {i.name}
                    </span>
                    <span className="li-amt">{formatMinor(i.line_total_minor, order.currency)}</span>
                  </div>
                ))}

                {basket.discount_minor > 0 && (
                  <div className="line-item">
                    <span className="li-name">Bundle discount</span>
                    <span className="li-amt text-emerald">
                      −{formatMinor(basket.discount_minor, order.currency)}
                    </span>
                  </div>
                )}

                <div className="line-item total">
                  <span>Total</span>
                  <span className="li-amt">{formatMinor(order.amount_minor, order.currency)}</span>
                </div>
              </div>

              <hr className="divider" />

              {order.simulated ? (
                <div className="field">
                  <label>Test card — pre-filled, not a real card</label>
                  <input value="4111 1111 1111 1111" readOnly />
                </div>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  Razorpay's official Checkout will open. Use test card{" "}
                  <code className="code-inline">4111 1111 1111 1111</code>, any future expiry, any CVV.
                </p>
              )}
            </>
          )}

          {done && result && (
            <div className="pay-success">
              <div className="check">
                <Icon.check size={26} />
              </div>
              <div className="amount">{formatMinor(result.amount_minor, result.currency)}</div>
              <p className="muted small" style={{ marginTop: 6 }}>
                Signature verified server-side
              </p>
              <p className="dim xs mono" style={{ marginTop: 8, overflowWrap: "anywhere" }}>
                {result.razorpay_payment_id}
                {result.simulated ? " (simulated)" : ""}
              </p>
            </div>
          )}

          <ErrorText>{error}</ErrorText>
        </div>

        <div className="modal-foot">
          {!done && (
            <button
              className="btn btn-primary btn-block btn-lg"
              disabled={status === "processing"}
              onClick={order.simulated ? paySimulated : payReal}
            >
              {status === "processing" ? (
                <>
                  <span className="spinner" /> Processing…
                </>
              ) : (
                <>
                  <Icon.lock size={15} /> Pay {formatMinor(order.amount_minor, order.currency)}
                </>
              )}
            </button>
          )}
          <button className="btn btn-block" disabled={status === "processing"} onClick={onClose}>
            {done ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
