import { useEffect, useMemo, useRef, useState } from "react";
import { EngineTag, Icon } from "./ui.jsx";
import { formatMinor, humanize } from "../lib/format.js";

/*
 * Renders one agent run as an ordered, TIME-STAGED trace: steps appear one at
 * a time rather than all at once, with a "working" indicator between them, so
 * a response that already arrived from the server still reads as something
 * happening live. Every step also declares WHICH engine performed it — the
 * whole argument of the project made visual: violet is the model reasoning,
 * and every step that touches money or a bound is emerald, deterministic
 * code, no model in the path.
 */

// How long to hold on the "working" indicator before the NEXT step appears,
// keyed by that next step's engine — a rough, honest proxy for what that kind
// of step actually costs (an LLM call is slower than a bounds check).
const STEP_DELAY_MS = { crypto: 360, llm: 720, code: 460, money: 320 };
const WORKING_LABEL = {
  crypto: "Verifying signature…",
  llm: "Thinking…",
  code: "Checking against merchant bounds…",
  money: "Preparing…",
};

function Step({ status, engine, title, detail, children }) {
  const mark =
    status === "bad" ? <Icon.x size={13} /> : status === "run" ? <Icon.clock size={13} /> : <Icon.check size={13} />;
  return (
    <div className={`pstep ${status}`}>
      <div className="pstep-marker">{mark}</div>
      <div className="pstep-body">
        <div className="pstep-head">
          <span className="pstep-title">{title}</span>
          <EngineTag engine={engine} />
        </div>
        {detail && <div className="pstep-detail">{detail}</div>}
        {children}
      </div>
    </div>
  );
}

function WorkingStep({ engine }) {
  return (
    <div className="pstep run">
      <div className="pstep-marker">
        <span className="dots">
          <span />
          <span />
          <span />
        </span>
      </div>
      <div className="pstep-body">
        <div className="pstep-title dim">{WORKING_LABEL[engine] ?? "Working…"}</div>
      </div>
    </div>
  );
}

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

/** Pure: turns one API response into an ordered list of {key, engine, node}. */
function buildStepList(result) {
  const pv = result.passport_verification ?? {};
  const decision = result.decision;
  const stage = result.stage;
  const passportOk = !!pv.trusted;

  const steps = [];

  steps.push({
    key: "passport",
    engine: "crypto",
    node: (
      <Step
        key="passport"
        status={passportOk ? "ok" : "bad"}
        engine="crypto"
        title={passportOk ? "Merchant passport verified" : "Merchant passport rejected"}
        detail={[pv.signature_reason, pv.freshness_reason].filter(Boolean).join(" · ")}
      >
        {stage === "passport_rejected" && (
          <div className="callout decline">
            <div className="callout-code">PASSPORT_NOT_TRUSTED</div>
            <div>{result.message}</div>
          </div>
        )}
      </Step>
    ),
  });

  if (result.intent) {
    steps.push({
      key: "intent",
      engine: "llm",
      node: (
        <Step
          key="intent"
          status="ok"
          engine="llm"
          title="Intent parsed into a structured filter"
          detail="Free text became typed constraints. This produces a request, never a decision."
        >
          <IntentChips intent={result.intent} />
        </Step>
      ),
    });
  }

  if (stage === "region_not_served") {
    steps.push({
      key: "region",
      engine: "code",
      node: (
        <Step key="region" status="bad" engine="code" title="Region check failed">
          <div className="callout decline">
            <div className="callout-code">REGION_NOT_SERVED</div>
            <div>{result.message}</div>
          </div>
        </Step>
      ),
    });
  }

  if (decision) {
    const accepted = decision.status === "accepted";
    steps.push({
      key: "marginmind",
      engine: "code",
      node: (
        <Step
          key="marginmind"
          status={accepted ? "ok" : "bad"}
          engine="code"
          title={`MarginMind ${accepted ? "accepted" : "declined"}${decision.code ? ` — ${decision.code}` : ""}`}
          detail={
            accepted
              ? `${decision.options.length} basket(s) ranked against the merchant's own margin floor, discount ceiling and order cap.`
              : "Enforced from MarginMind's own trusted config — not from anything the caller sent."
          }
        >
          {!accepted && (
            <div className="callout decline">
              <div className="callout-code">{decision.code}</div>
              <div>{decision.message}</div>
            </div>
          )}
        </Step>
      ),
    });
  }

  // Placed after the decision because `decision` above already holds the FINAL
  // outcome: when negotiation succeeds the server replaces the original decline
  // with the accepted result, so showing negotiation first would claim an
  // alternative was found before anything had been declined.
  if (result.negotiation) {
    const n = result.negotiation;
    const won = n.final_status === "accepted";
    steps.push({
      key: "negotiation",
      engine: "llm",
      node: (
        <Step
          key="negotiation"
          status={won ? "ok" : "bad"}
          engine="llm"
          title="Negotiator engaged after the initial decline"
          detail={
            won
              ? `${n.attempts_made} attempt(s). Relaxed soft preferences only — the accepted basket above is the result.`
              : `${n.attempts_made} attempt(s), then gave up cleanly. It may relax soft preferences only, never a merchant bound.`
          }
        >
          <div className="callout negotiate">
            <div className="callout-title">
              <Icon.route size={12} /> Negotiation
            </div>
            <div>{n.summary}</div>
            {n.relaxed_constraints?.length > 0 && (
              <div style={{ marginTop: 7 }}>
                <span className="dim xs">Relaxed: </span>
                {n.relaxed_constraints.map((c) => (
                  <span className="chip" key={c} style={{ marginRight: 5 }}>
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Step>
      ),
    });
  }

  if (result.explanation) {
    steps.push({
      key: "explain",
      engine: "llm",
      node: (
        <Step
          key="explain"
          status="ok"
          engine="llm"
          title="Decision explained to the buyer"
          detail="Narrates numbers that already exist in the decision. It cannot change one."
        >
          <div className="callout explain">
            <div className="callout-title">
              <Icon.sparkles size={12} /> Buyer explanation
            </div>
            <div>{result.explanation}</div>
          </div>
        </Step>
      ),
    });
  }

  if (stage === "ready_for_consent") {
    steps.push({
      key: "consent",
      engine: "money",
      node: (
        <Step
          key="consent"
          status="run"
          engine="money"
          title="Waiting for your explicit consent"
          detail="Nothing is charged and no Razorpay order exists until you confirm a basket below."
        />
      ),
    });
  }

  return steps;
}

/**
 * @param result   the API response for this turn (required)
 * @param animate  when false, renders every step immediately — used for
 *                 turns restored without a fresh "live" moment to represent
 * @param onDone   fires once, when the last step has been revealed
 */
export default function PipelineTrace({ result, animate = true, onDone }) {
  const steps = useMemo(() => (result ? buildStepList(result) : []), [result]);
  const [revealCount, setRevealCount] = useState(animate ? 0 : steps.length);

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (!steps.length) return undefined;

    const reduced =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (!animate || reduced) {
      setRevealCount(steps.length);
      onDoneRef.current?.();
      return undefined;
    }

    let cancelled = false;
    let i = 0;
    setRevealCount(0);

    const tick = () => {
      if (cancelled) return;
      i += 1;
      setRevealCount(i);
      if (i >= steps.length) {
        onDoneRef.current?.();
        return;
      }
      const delay = STEP_DELAY_MS[steps[i].engine] ?? 500;
      timer = setTimeout(tick, delay);
    };

    let timer = setTimeout(tick, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  if (!result) return null;

  const stage = result.stage;
  const working = revealCount < steps.length;

  return (
    <div className="pipeline">
      {steps.slice(0, revealCount).map((s) => s.node)}
      {working && <WorkingStep engine={steps[revealCount]?.engine} />}
      {!working && stage && (
        <div className="pstep-detail dim xs" style={{ marginTop: 14, paddingLeft: 40 }}>
          Stage: <code className="code-inline">{humanize(stage)}</code>
        </div>
      )}
    </div>
  );
}
