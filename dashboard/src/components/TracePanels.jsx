import { useEffect, useReducer } from "react";
import { Icon } from "./ui.jsx";
import { ENGINE_TONE } from "../lib/topology.js";
import { HopDetail } from "./SidePanel.jsx";

/*
 * The two panels that turn the canvas from a diagram into an instrument.
 *
 * TraceRail is the run as a strip of completed hops, each carrying the true
 * measured latency. HopInspector is what you get when you click one: the
 * actual JSON that travelled on that wire, in both directions.
 *
 * Showing the payload matters more than it might seem. A judge watching an
 * animation has to take it on trust; a judge who can click a packet and read
 * the signed passport that crossed it does not.
 */

export function TraceRail({ theatre, activeHopId, onSelect }) {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => (theatre ? theatre.subscribe(force) : undefined), [theatre]);

  const hops = theatre?.snapshot().hops ?? [];
  if (!hops.length) return null;

  return (
    <div className="trace-rail">
      <div className="trace-rail-scroll">
        {hops.map((hop) => {
          const tone = ENGINE_TONE[hop.engine] ?? "sky";
          return (
            <button
              key={hop.hopId}
              type="button"
              className={`trace-chip tone-${tone} is-${hop.status}${activeHopId === hop.hopId ? " is-active" : ""}`}
              onClick={() => onSelect?.(hop.hopId)}
              title={hop.summary || hop.label}
            >
              <span className="trace-chip-dot" />
              <span className="trace-chip-label">{hop.label}</span>
              {hop.durationMs != null ? (
                <span className="trace-chip-ms">{Math.round(hop.durationMs)}ms</span>
              ) : (
                <span className="trace-chip-ms is-pending">…</span>
              )}
              {hop.status === "blocked" && <Icon.ban size={11} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function HopInspector({ theatre, hopId, onClose }) {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => (theatre ? theatre.subscribe(force) : undefined), [theatre]);

  const hops = theatre?.snapshot().hops ?? [];
  const hop = hops.find((h) => h.hopId === hopId) ?? null;
  const open = Boolean(hop);

  // Escape closes it — this panel covers content while a demo is being
  // narrated, so getting out must not require aiming at a small target.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!hop) return null;

  // Same body as the Live Demo's side panel — one place decides how a message
  // is presented, so the two never drift into describing a hop differently.
  return (
    <aside className="inspector" role="dialog" aria-label="Message detail">
      <HopDetail hop={hop} onBack={onClose} />
    </aside>
  );
}

/** The pacing control. Labelled honestly: it changes playback, not reality. */
export function PaceControl({ speed, onChange, speeds, totalMs }) {
  return (
    <div className="pace">
      <span className="pace-label">
        <Icon.clock size={12} /> Playback
      </span>
      <div className="pace-btns">
        {speeds.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`pace-btn${speed === s.factor ? " is-on" : ""}`}
            onClick={() => onChange(s.factor)}
            title={`${s.name} — playback speed only; the latencies shown are real`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {totalMs != null && (
        <span className="pace-real" title="Actual wall-clock time the pipeline took on the server">
          real: {(totalMs / 1000).toFixed(2)}s
        </span>
      )}
    </div>
  );
}
