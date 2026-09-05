import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { formatMinor } from "../lib/format.js";
import { Card, CardHead, ErrorText, Icon, RangeSlider, Skeleton } from "../components/ui.jsx";

/*
 * The buyer's own risk policy.
 *
 * The passport deliberately refuses to claim "this merchant is trustworthy".
 * It publishes evidence — attestations with issuers, a refund window, granted
 * capabilities, declared bounds — and somebody still has to decide whether
 * that evidence is good enough to spend money against. That decision belongs
 * to the buyer.
 *
 * Which makes this page the other half of the trust story, and the half
 * almost nobody builds. Drag a threshold and the verdict re-runs against the
 * live merchant immediately, so the interesting case is easy to reach: a
 * perfectly signed, perfectly fresh merchant that this buyer still refuses.
 */

const TOGGLES = [
  {
    key: "require_valid_signature",
    label: "Require a valid Ed25519 signature",
    help: "Off would mean transacting with an unverifiable merchant. It exists as a switch to make the point that it is a choice.",
  },
  {
    key: "require_fresh_passport",
    label: "Require the passport to be inside its own TTL",
    help: "The merchant's own declared freshness window.",
  },
  {
    key: "require_buyer_confirmation_for_orders",
    label: "Refuse merchants that allow orders without buyer confirmation",
    help: "Reads backwards until you think about it: a merchant being MORE permissive is a risk to the buyer, not a convenience.",
  },
];

const SLIDERS = [
  {
    key: "max_passport_age_seconds",
    label: "Maximum passport age",
    help: "The buyer's own staleness ceiling, independent of whatever TTL the merchant chose for itself.",
    min: 60,
    max: 7200,
    step: 60,
    format: (v) => `${Math.round(v / 60)} min`,
  },
  {
    key: "min_refund_window_days",
    label: "Minimum refund window",
    help: "Raise this above what the merchant offers and a valid merchant gets refused. That is the point.",
    min: 0,
    max: 30,
    step: 1,
    format: (v) => `${v} days`,
  },
  {
    key: "max_autonomous_spend_minor",
    label: "Buyer's own autonomous spend cap",
    help: "Separate from the merchant's cap. Two independent parties each enforce their own ceiling; neither can raise the other's.",
    min: 10000,
    max: 500000,
    step: 10000,
    format: (v) => formatMinor(v),
  },
];

const KNOWN_ATTESTATIONS = ["payment_provider_connected", "refund_policy_declared"];
const KNOWN_CAPABILITIES = ["discover", "quote", "create_order", "request_payment", "request_refund"];

function ChipSet({ label, help, options, selected, onToggle }) {
  return (
    <div className="rp-chipset">
      <span className="rp-field-label">{label}</span>
      <div className="rp-chips">
        {options.map((option) => {
          const on = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              className={`rp-chip${on ? " is-on" : ""}`}
              onClick={() => onToggle(option)}
              aria-pressed={on}
            >
              {on ? <Icon.check size={11} /> : <Icon.plus size={11} />}
              {option}
            </button>
          );
        })}
      </div>
      <p className="rp-field-help">{help}</p>
    </div>
  );
}

function Verdict({ verdict, evaluating }) {
  if (!verdict) return <Skeleton height={260} />;
  return (
    <Card className={`rp-verdict${verdict.passed ? "" : " is-failed"}`}>
      <CardHead
        title={verdict.passed ? "This buyer will transact" : "This buyer refuses"}
        sub={verdict.summary}
        icon={verdict.passed ? <Icon.shieldCheck size={15} /> : <Icon.ban size={15} />}
        action={evaluating ? <span className="spinner" /> : null}
      />
      <ul className="rp-checks">
        {verdict.checks.map((check) => (
          <li key={check.rule} className={check.passed ? "is-pass" : "is-fail"}>
            <span className="rp-check-mark">
              {check.passed ? <Icon.check size={12} /> : <Icon.x size={12} />}
            </span>
            <div>
              <b>{check.title}</b>
              <span className="dim xs">{check.detail}</span>
            </div>
          </li>
        ))}
      </ul>
      {!verdict.passed && (
        <p className="rp-verdict-note">
          The merchant's passport is cryptographically fine. It simply does not satisfy this buyer's
          rules — and a merchant cannot publish a field that turns one of these off.
        </p>
      )}
    </Card>
  );
}

export default function RiskPolicy({ onChanged }) {
  const [policy, setPolicy] = useState(null);
  const [verdict, setVerdict] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const evaluate = useCallback(async () => {
    setEvaluating(true);
    try {
      setVerdict(await api.evaluatePolicy());
    } catch (e) {
      setError(e.message);
    } finally {
      setEvaluating(false);
    }
  }, []);

  useEffect(() => {
    api
      .getPolicy()
      .then((data) => setPolicy(data.policy))
      .catch((e) => setError(e.message));
    evaluate();
  }, [evaluate]);

  /* The policy is buyer-side config, so an edit is saved and re-evaluated
     rather than staged behind a Save button. Watching the verdict flip while
     you drag a threshold is the whole argument of the page; a save step in
     between would bury it. */
  const update = useCallback(
    (patch) => {
      setPolicy((prev) => ({ ...prev, ...patch }));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        try {
          await api.putPolicy(patch);
          await evaluate();
          onChanged?.();
        } catch (e) {
          setError(e.message);
        }
      }, 350);
    },
    [evaluate, onChanged]
  );

  const toggleIn = useCallback(
    (key, option) => {
      setPolicy((prev) => {
        const list = prev[key] ?? [];
        const next = list.includes(option) ? list.filter((v) => v !== option) : [...list, option];
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(async () => {
          try {
            await api.putPolicy({ [key]: next });
            await evaluate();
            onChanged?.();
          } catch (e) {
            setError(e.message);
          }
        }, 350);
        return { ...prev, [key]: next };
      });
    },
    [evaluate, onChanged]
  );

  async function resetAll() {
    try {
      const data = await api.resetPolicy();
      setPolicy(data.policy);
      await evaluate();
    } catch (e) {
      setError(e.message);
    }
  }

  if (!policy) {
    return (
      <div className="page">
        <ErrorText>{error}</ErrorText>
        <Skeleton height={320} />
      </div>
    );
  }

  return (
    <div className="page rp-page">
      <header className="page-head">
        <div>
          <span className="tag amber">
            <Icon.scale size={11} /> Buyer risk policy
          </span>
          <h1>The buyer decides what "trustworthy" means</h1>
          <p>
            A passport publishes evidence, not a trust score. These are the buyer agent's own rules for
            reading that evidence — deterministic, buyer-side, and impossible for a merchant to relax.
            Change one and the verdict re-runs against the live merchant.
          </p>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={resetAll}>
          <Icon.refresh size={13} /> Reset to defaults
        </button>
      </header>

      <ErrorText>{error}</ErrorText>

      <div className="rp-layout">
        <div className="rp-main">
          <Card>
            <CardHead title="Integrity and freshness" icon={<Icon.lock size={15} />} />
            {TOGGLES.map((toggle) => (
              <label className="rp-toggle" key={toggle.key}>
                <input
                  type="checkbox"
                  checked={Boolean(policy[toggle.key])}
                  onChange={(e) => update({ [toggle.key]: e.target.checked })}
                />
                <span className="rp-toggle-box">
                  <Icon.check size={11} />
                </span>
                <span>
                  <b>{toggle.label}</b>
                  <span className="rp-field-help">{toggle.help}</span>
                </span>
              </label>
            ))}
          </Card>

          <Card>
            <CardHead title="Thresholds" icon={<Icon.activity size={15} />} />
            {SLIDERS.map((slider) => (
              <div className="rp-slider" key={slider.key}>
                <div className="rp-slider-head">
                  <label htmlFor={slider.key}>{slider.label}</label>
                  <output>{slider.format(policy[slider.key])}</output>
                </div>
                <RangeSlider
                  id={slider.key}
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={policy[slider.key]}
                  onChange={(e) => update({ [slider.key]: Number(e.target.value) })}
                />
                <p className="rp-field-help">{slider.help}</p>
              </div>
            ))}
          </Card>

          <Card>
            <CardHead title="Required evidence" icon={<Icon.file size={15} />} />
            <ChipSet
              label="Attestations the merchant must present"
              help="An absent attestation is a failure, not a neutral. A merchant who declares nothing is exactly the merchant these rules exist for."
              options={KNOWN_ATTESTATIONS}
              selected={policy.required_attestations ?? []}
              onToggle={(v) => toggleIn("required_attestations", v)}
            />
            <ChipSet
              label="Capabilities the passport must grant"
              help="The buyer will not begin a purchase it knows the merchant would refuse to complete."
              options={KNOWN_CAPABILITIES}
              selected={policy.required_capabilities ?? []}
              onToggle={(v) => toggleIn("required_capabilities", v)}
            />
          </Card>
        </div>

        <aside className="rp-side">
          <Verdict verdict={verdict} evaluating={evaluating} />
        </aside>
      </div>
    </div>
  );
}
