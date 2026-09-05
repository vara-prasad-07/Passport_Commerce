import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { Icon } from "./ui.jsx";
import {
  ENGINE_TONE,
  HANDSHAKE_NODES,
  NODES,
  STAGE_H,
  STAGE_W,
  STATIC_EDGES,
  angleOnCurve,
  bootIndex,
  curveFor,
  nodeBox,
  pointOnCurve,
} from "../lib/topology.js";

/*
 * The orchestration canvas.
 *
 * Node cards are HTML (crisp text, easy rich content) and the wires and
 * packets are SVG, both inside one stage scaled as a whole to fit. Sharing a
 * single coordinate system is what keeps a packet landing exactly on a card's
 * edge at every zoom level, with no measurement pass.
 *
 * The world is not static. It ASSEMBLES:
 *
 *   idle       nothing. The page is just an input.
 *   handshake  the buyer agent and the model, alone, while the agent decides
 *              whether the message is a shopping request at all.
 *   live       the rest arrives outward from the buyer agent, staggered, and
 *              the wires draw themselves before any traffic runs.
 *
 * That sequence is not decoration — it is the honest shape of the pipeline.
 * An off-topic message really does stop after one hop, and a canvas showing a
 * merchant that was never contacted would be a lie told in pixels.
 *
 * The visual grammar stays small, because it has to be readable from across a
 * room while somebody talks over it:
 *
 *   a packet moving      a real message, coloured by which engine sent it
 *   a node ringed        that service is working right now
 *   a packet returning   a reply came back
 *   a packet SHATTERING  a rule refused it, and it stops at the boundary,
 *                        on the wire, never reaching the far side
 */

const EASE = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function NodeCard({ node, runtime, onSelect, quiet }) {
  const box = nodeBox(node.id);
  const state = runtime?.state ?? "idle";
  const IconComp = Icon[node.icon] ?? Icon.cpu;

  return (
    <button
      type="button"
      className={`cnode tone-${node.tone} is-${state}${node.hero ? " is-hero" : ""}${quiet ? " is-quiet" : ""}`}
      style={{
        left: node.x,
        top: node.y,
        width: box.w,
        height: box.h,
        // Drives the assembly stagger. Set as a variable rather than an inline
        // animation-delay so the CSS owns the timing curve in one place.
        "--boot-i": bootIndex(node.id),
      }}
      onClick={() => onSelect?.(node.id)}
      title={node.blurb}
    >
      <span className="cnode-ring" aria-hidden="true" />
      <span className="cnode-icon">
        <IconComp size={node.hero ? 19 : 16} />
      </span>
      <span className="cnode-body">
        <span className="cnode-label">{node.label}</span>
        <span className="cnode-sub">{node.sub}</span>
      </span>
      {runtime?.lastMs != null && state !== "busy" && (
        <span className="cnode-ms">{Math.round(runtime.lastMs)} ms</span>
      )}
      {state === "busy" && <span className="cnode-working">working</span>}
      {state === "blocked" && runtime?.code && <span className="cnode-code">{runtime.code}</span>}
    </button>
  );
}

function Packet({ packet, onSelect }) {
  const curve = curveFor(packet.from, packet.to);
  if (!curve) return null;

  const tone = ENGINE_TONE[packet.engine] ?? "sky";

  if (packet.phase === "burst") {
    // A refusal stops the packet ON the wire, just short of the target, and
    // breaks it. Letting it reach the card would say "it got in, then was
    // undone"; stopping it at the boundary says "it never got in".
    const at = pointOnCurve(curve, 0.84);
    const t = Math.min(1, packet.t);
    const ring = 8 + t * 46;
    return (
      <g
        className={`pk pk-burst tone-${tone}`}
        transform={`translate(${at.x} ${at.y})`}
        onClick={() => onSelect?.(packet.hopId)}
      >
        <circle className="pk-burst-ring" r={ring} style={{ opacity: 0.5 * (1 - t) }} />
        <circle className="pk-burst-ring2" r={ring * 0.58} style={{ opacity: 0.36 * (1 - t) }} />
        <g className="pk-burst-mark" style={{ opacity: Math.min(1, t * 5) }}>
          <circle className="pk-burst-core" r="12" />
          <path d="M -4.5 -4.5 L 4.5 4.5 M 4.5 -4.5 L -4.5 4.5" />
        </g>
        {packet.label && (
          <text className="pk-burst-text" x="0" y="32" textAnchor="middle">
            {packet.label}
          </text>
        )}
      </g>
    );
  }

  const eased = EASE(packet.t);
  const pos = packet.reverse ? 1 - eased : eased;
  const at = pointOnCurve(curve, pos);
  const angle = angleOnCurve(curve, pos);
  const isReply = packet.phase === "reply";

  // A short trail sampled behind the head — cheaper and steadier than a
  // stroked sub-path, and it reads as motion at any playback speed.
  const trail = [0.04, 0.08, 0.125].map((back, i) => {
    const tt = Math.max(0, Math.min(1, pos + (packet.reverse ? back : -back)));
    const p = pointOnCurve(curve, tt);
    return { ...p, r: (isReply ? 2.8 : 4) - i * 0.85, o: (isReply ? 0.28 : 0.42) - i * 0.1 };
  });

  return (
    <g className={`pk tone-${tone}${isReply ? " is-reply" : ""}`} onClick={() => onSelect?.(packet.hopId)}>
      {trail.map((p, i) => (
        <circle key={i} className="pk-trail" cx={p.x} cy={p.y} r={p.r} style={{ opacity: p.o }} />
      ))}
      <g transform={`translate(${at.x} ${at.y})`}>
        <circle className="pk-glow" r={isReply ? 10 : 15} />
        <circle className="pk-core" r={isReply ? 3.4 : 5.2} />
        {!isReply && (
          <path className="pk-chevron" d="M -1.9 -3.2 L 2.5 0 L -1.9 3.2" transform={`rotate(${angle})`} />
        )}
      </g>
      {!isReply && packet.label && (
        <text className="pk-label" x={at.x} y={at.y - 22} textAnchor="middle">
          {packet.label.length > 34 ? `${packet.label.slice(0, 33)}…` : packet.label}
        </text>
      )}
    </g>
  );
}

export default function AgentCanvas({
  theatre,
  stage = "live",
  onSelectHop,
  onSelectNode,
  className = "",
}) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [, force] = useReducer((x) => x + 1, 0);

  // The theatre emits on every animation frame while a run is playing, so
  // only this component re-renders at 60fps — the rest of the page updates
  // on real events.
  useEffect(() => (theatre ? theatre.subscribe(force) : undefined), [theatre]);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (!width || !height) return;
    setScale(Math.min(width / STAGE_W, height / STAGE_H));
  }, []);

  useLayoutEffect(() => {
    fit();
    const observer = new ResizeObserver(fit);
    if (wrapRef.current) observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, [fit]);

  const visible = useMemo(() => {
    if (stage === "idle") return new Set();
    // "rejecting" is the beat between the gate refusing and the room
    // emptying. The pair stays on screen so the refusal is something you
    // watch happen rather than something you infer from an empty stage.
    if (stage === "handshake" || stage === "rejecting") return new Set(HANDSHAKE_NODES);
    return new Set(Object.keys(NODES));
  }, [stage]);

  const snap = theatre ? theatre.snapshot() : { packets: [], nodes: {}, hops: [] };
  const liveEdges = new Set(snap.packets.map((p) => `${p.from}->${p.to}`));

  if (stage === "idle") return <div className={`canvas-wrap is-idle ${className}`} ref={wrapRef} />;

  return (
    <div className={`canvas-wrap ${className}`} ref={wrapRef} data-stage={stage}>
      <div
        className="canvas-stage"
        style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}
      >
        <svg
          className="canvas-svg"
          width={STAGE_W}
          height={STAGE_H}
          viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
          aria-hidden="true"
        >
          {/* the shape of the system, drawn before anything runs */}
          {STATIC_EDGES.map(([from, to, label]) => {
            if (!visible.has(from) || !visible.has(to)) return null;
            const curve = curveFor(from, to);
            if (!curve) return null;
            const live = liveEdges.has(`${from}->${to}`) || liveEdges.has(`${to}->${from}`);
            return (
              <path
                key={`${from}-${to}`}
                className={`cedge${live ? " is-live" : ""}`}
                style={{ "--boot-i": Math.max(bootIndex(from), bootIndex(to)) }}
                d={curve.d}
                aria-label={label}
              />
            );
          })}

          {/* wires only used by the run in progress (retries, self-checks) */}
          {[...liveEdges].map((key) => {
            const [from, to] = key.split("->");
            if (STATIC_EDGES.some(([a, b]) => (a === from && b === to) || (a === to && b === from))) return null;
            const curve = curveFor(from, to);
            if (!curve) return null;
            return <path key={key} className="cedge is-live is-adhoc" d={curve.d} />;
          })}

          {snap.packets.map((packet) => (
            <Packet key={packet.id} packet={packet} onSelect={onSelectHop} />
          ))}
        </svg>

        {Object.values(NODES).map((node) =>
          visible.has(node.id) ? (
            <NodeCard
              key={node.id}
              node={node}
              runtime={snap.nodes[node.id]}
              onSelect={onSelectNode}
              quiet={!snap.nodes[node.id]}
            />
          ) : null
        )}
      </div>
    </div>
  );
}
