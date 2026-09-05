import { useState } from "react";
import { pretty } from "../lib/format.js";

/* ============================ icons ============================
   Inline strokes on currentColor so every icon inherits the colour of the
   element it sits in and works in both themes with no extra rules. */

function Svg({ size = 16, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  shield: (p) => (
    <Svg {...p}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </Svg>
  ),
  shieldCheck: (p) => (
    <Svg {...p}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  ),
  check: (p) => (
    <Svg {...p}>
      <path d="m20 6-11 11-5-5" />
    </Svg>
  ),
  x: (p) => (
    <Svg {...p}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  ),
  sun: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M5 5l1.5 1.5M17.5 17.5 19 19M2 12h2M20 12h2M5 19l1.5-1.5M17.5 6.5 19 5" />
    </Svg>
  ),
  moon: (p) => (
    <Svg {...p}>
      <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" />
    </Svg>
  ),
  menu: (p) => (
    <Svg {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  ),
  arrowRight: (p) => (
    <Svg {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  ),
  sparkles: (p) => (
    <Svg {...p}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4" />
    </Svg>
  ),
  cpu: (p) => (
    <Svg {...p}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </Svg>
  ),
  lock: (p) => (
    <Svg {...p}>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Svg>
  ),
  card: (p) => (
    <Svg {...p}>
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <path d="M2 10h20" />
    </Svg>
  ),
  refresh: (p) => (
    <Svg {...p}>
      <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
    </Svg>
  ),
  copy: (p) => (
    <Svg {...p}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </Svg>
  ),
  chevron: (p) => (
    <Svg {...p}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  ),
  search: (p) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  ),
  activity: (p) => (
    <Svg {...p}>
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </Svg>
  ),
  scale: (p) => (
    <Svg {...p}>
      <path d="M12 3v18M7 21h10M5 7h14l-2.5 6a3.5 3.5 0 0 1-4.5 0L5 7z" />
      <path d="M12 3 5 7M12 3l7 4" />
    </Svg>
  ),
  file: (p) => (
    <Svg {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </Svg>
  ),
  clock: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </Svg>
  ),
  alert: (p) => (
    <Svg {...p}>
      <path d="M10.3 3.9 2.4 17.5A1.9 1.9 0 0 0 4 20.4h16a1.9 1.9 0 0 0 1.6-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </Svg>
  ),
  store: (p) => (
    <Svg {...p}>
      <path d="M3 9.5 4.5 4h15L21 9.5M3 9.5h18M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v8h14v-8" />
    </Svg>
  ),
  bot: (p) => (
    <Svg {...p}>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 4v4M9 14h.01M15 14h.01" />
    </Svg>
  ),
  route: (p) => (
    <Svg {...p}>
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M15.5 5H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H8.5" />
    </Svg>
  ),
  ban: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </Svg>
  ),
  plus: (p) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  panelLeft: (p) => (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9.5 4v16" />
    </Svg>
  ),
  chevronsLeft: (p) => (
    <Svg {...p}>
      <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />
    </Svg>
  ),
  send: (p) => (
    <Svg {...p}>
      <path d="M4.5 4.5 20 12 4.5 19.5 8 12z" />
    </Svg>
  ),
  history: (p) => (
    <Svg {...p}>
      <path d="M3 12a9 9 0 1 0 2.8-6.5" />
      <path d="M3 4v5h5M12 7v5l3.5 2" />
    </Svg>
  ),
};

/* ============================ primitives ============================ */

export function Card({ children, className = "", ...rest }) {
  return (
    <div className={`card ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardHead({ title, sub, icon, action, plain = false }) {
  return (
    <div className={`card-head${plain ? " plain" : ""}`}>
      <div style={{ minWidth: 0 }}>
        <div className="card-title">
          {icon}
          {title}
        </div>
        {sub && <p className="card-sub">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Pill({ tone = "", children, pulse = false }) {
  return (
    <span className={`pill ${tone} ${pulse ? "idle" : ""}`.trim()}>
      <span className="dot" />
      {children}
    </span>
  );
}

export function Stat({ label, value, foot, tone, icon }) {
  return (
    <Card className="stat">
      <span className="stat-label">
        {icon}
        {label}
      </span>
      <span className={`stat-value ${tone ? `text-${tone}` : ""}`}>{value}</span>
      {foot && <span className="stat-foot">{foot}</span>}
    </Card>
  );
}

export function Empty({ icon = "◦", children }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      {children}
    </div>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return (
    <p className="error-text">
      <Icon.alert size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </p>
  );
}

/**
 * A range input with a real filled track, computed from the value itself.
 *
 * A bare <input type="range"> paints its track one flat colour end to end —
 * there is no CSS-only way to know how far along it is, since that depends
 * on a value only JS has. This computes the percentage once and hands it to
 * the CSS as a custom property, so the track can render a gradient split at
 * exactly that point instead of a dot floating on a line that never seems to
 * move relative to anything.
 */
export function RangeSlider({ id, min, max, step, value, onChange, disabled }) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={onChange}
      style={{ "--pct": `${pct}%` }}
    />
  );
}

export function Skeleton({ height = 14, width = "100%", style }) {
  return <div className="skeleton" style={{ height, width, ...style }} />;
}

/** Copy-to-clipboard button that confirms inline instead of via an alert. */
export function CopyButton({ value, label = "Copy" }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked (insecure origin / permissions) — stay silent */
    }
  }

  return (
    <button className="btn btn-sm btn-ghost" onClick={copy} title="Copy to clipboard">
      {copied ? <Icon.check size={13} /> : <Icon.copy size={13} />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function JsonBlock({ value, maxHeight }) {
  return (
    <pre className="json-block" style={maxHeight ? { maxHeight } : undefined}>
      {pretty(value)}
    </pre>
  );
}

/* The engine that performed a step. This vocabulary is used identically on the
   overview legend, the pipeline trace and the audit feed, so "who decided
   this?" is answerable at a glance anywhere in the product. */
export const ENGINES = {
  llm: { label: "LLM", tone: "violet", icon: Icon.sparkles, blurb: "Reasons and talks. Never decides money." },
  code: { label: "Deterministic", tone: "emerald", icon: Icon.cpu, blurb: "Enforces every bound. No model in the path." },
  crypto: { label: "Cryptography", tone: "sky", icon: Icon.lock, blurb: "Ed25519 signature and freshness checks." },
  money: { label: "Payment", tone: "gold", icon: Icon.card, blurb: "Razorpay, only after explicit consent." },
};

export function EngineTag({ engine }) {
  const e = ENGINES[engine];
  if (!e) return null;
  const I = e.icon;
  return (
    <span className={`tag ${e.tone}`}>
      <I size={11} />
      {e.label}
    </span>
  );
}

export function EngineLegend() {
  return (
    <div className="legend">
      {Object.entries(ENGINES).map(([key, e]) => (
        <span className="legend-item" key={key}>
          <span className="legend-swatch" style={{ background: `var(--${e.tone})` }} />
          <b style={{ color: `var(--${e.tone})`, fontWeight: 600 }}>{e.label}</b>
          <span className="dim">— {e.blurb}</span>
        </span>
      ))}
    </div>
  );
}
