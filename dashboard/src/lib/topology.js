/*
 * The orchestration canvas's map of the world.
 *
 * Node ids here MUST match the ones the buyer agent emits (see
 * buyer-agent/trace.py). That coupling is deliberate: the canvas can only
 * draw what the pipeline actually reports, so a service that stops
 * participating disappears from the diagram instead of lingering as a box
 * that no longer means anything.
 *
 * The layout is a deliberate 3x3 grid rather than an organic scatter. Three
 * columns, each one a party:
 *
 *     MERCHANT          BUYER              CALLED BY THE BUYER
 *     control plane     risk policy        Groq LLM
 *     passport          buyer agent        MarginMind
 *     registry          audit log          Razorpay
 *
 * A grid reads instantly from across a room, never collides with itself at
 * any viewport, and gives every packet a straight or gently curved path
 * instead of a diagonal crossing three other wires. The earlier freeform
 * arrangement looked more "designed" and was much harder to actually read.
 */

export const STAGE_W = 1220;
export const STAGE_H = 620;

const W = 168;
const H = 76;

/* Column and row centres. Everything else is derived, so the grid cannot
   drift out of alignment when a node is added or moved. */
const COL = { merchant: 220, buyer: 610, service: 1000 };
const ROW = { top: 110, middle: 310, bottom: 510 };

const at = (cx, cy, w = W, h = H) => ({ x: cx - w / 2, y: cy - h / 2, w, h });

export const NODES = {
  control_plane: {
    id: "control_plane",
    ...at(COL.merchant, ROW.top),
    label: "Control Plane",
    sub: "catalog · bounds",
    tone: "emerald",
    icon: "store",
    blurb: "Where the merchant sets the rules. Editing anything here re-signs the passport.",
  },
  passport: {
    id: "passport",
    ...at(COL.merchant, ROW.middle),
    label: "Passport",
    sub: ":8001 · well-known",
    tone: "sky",
    icon: "shieldCheck",
    blurb: "Signs and serves the merchant's passport. Ed25519, versioned, TTL-bound.",
  },
  registry: {
    id: "registry",
    ...at(COL.merchant, ROW.bottom),
    label: "Registry",
    sub: "merchant namespace",
    tone: "sky",
    icon: "search",
    blurb: "Every merchant, each verified against its own key.",
  },
  policy: {
    id: "policy",
    ...at(COL.buyer, ROW.top),
    label: "Risk Policy",
    sub: "buyer-side rules",
    tone: "amber",
    icon: "scale",
    blurb: "The buyer's own rules. A merchant cannot publish a field that turns one off.",
  },
  buyer_agent: {
    id: "buyer_agent",
    ...at(COL.buyer, ROW.middle, 196, 92),
    label: "Buyer Agent",
    sub: ":8003 · orchestrator",
    tone: "violet",
    icon: "bot",
    hero: true,
    blurb: "Verifies, reasons, asks, and waits for consent. It never decides a number itself.",
  },
  audit: {
    id: "audit",
    ...at(COL.buyer, ROW.bottom),
    label: "Audit Log",
    sub: "append-only",
    tone: "slate",
    icon: "file",
    blurb: "Every hop on this canvas is also a row here. Same stream, two renderings.",
  },
  llm: {
    id: "llm",
    ...at(COL.service, ROW.top),
    label: "Groq LLM",
    sub: "reasons and talks",
    tone: "violet",
    icon: "sparkles",
    blurb: "Parses intent, negotiates, explains. It is never on a path that moves money.",
  },
  marginmind: {
    id: "marginmind",
    ...at(COL.service, ROW.middle),
    label: "MarginMind",
    sub: ":8002 · decisions",
    tone: "emerald",
    icon: "cpu",
    blurb: "Deterministic. Enforces every bound from its OWN config, never the caller's.",
  },
  razorpay: {
    id: "razorpay",
    ...at(COL.service, ROW.bottom),
    label: "Razorpay",
    sub: "test mode",
    tone: "gold",
    icon: "card",
    blurb: "Reached only after an explicit human click, with an amount MarginMind re-derived.",
  },
};

/* The world does not appear all at once. Only these two exist while the agent
   decides whether the message is even a shopping request — so an off-topic
   message never spins up a merchant, visually or actually. */
export const HANDSHAKE_NODES = ["buyer_agent", "llm"];

/* Assembly order once a request is accepted. The buyer agent is already on
   screen; the rest arrive outward from it, nearest relationships first, so
   the build reads as the agent reaching out rather than a list appearing. */
export const BOOT_ORDER = [
  "buyer_agent",
  "llm",
  "passport",
  "policy",
  "marginmind",
  "audit",
  "razorpay",
  "control_plane",
  "registry",
];

export const bootIndex = (id) => {
  const i = BOOT_ORDER.indexOf(id);
  return i === -1 ? BOOT_ORDER.length : i;
};

/* Drawn underneath the live traffic so the shape of the system is legible
   before anything has run — an empty canvas should still explain itself. */
export const STATIC_EDGES = [
  ["control_plane", "passport", "signs"],
  ["passport", "registry", "lists"],
  ["passport", "buyer_agent", "signed passport"],
  ["buyer_agent", "policy", "risk gate"],
  ["buyer_agent", "llm", "reasoning"],
  ["buyer_agent", "marginmind", "decisions"],
  ["buyer_agent", "razorpay", "money"],
  ["buyer_agent", "audit", "records"],
];

export function nodeBox(id) {
  const node = NODES[id];
  if (!node) return null;
  return { ...node, cx: node.x + node.w / 2, cy: node.y + node.h / 2 };
}

/**
 * Where a line leaving `box` toward (tx, ty) crosses the card's edge.
 *
 * Packets are launched and landed on the boundary rather than the centre so
 * they visibly emerge from and strike the node, instead of appearing to be
 * swallowed by it — which is what makes a blocked packet stopping *at* a
 * boundary read as being refused by that service.
 */
function edgeAnchor(box, tx, ty, pad = 7) {
  const dx = tx - box.cx;
  const dy = ty - box.cy;
  if (dx === 0 && dy === 0) return { x: box.cx, y: box.cy };
  const hw = box.w / 2 + pad;
  const hh = box.h / 2 + pad;
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: box.cx + dx * s, y: box.cy + dy * s };
}

function cubic(p0, p1, p2, p3) {
  return {
    p0,
    p1,
    p2,
    p3,
    d: `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`,
  };
}

/**
 * The curve a packet travels from one node to another.
 *
 * A hop whose source and target are the same node (a local deterministic
 * check — "region check", "capability check") gets a loop above the card.
 * Those steps are as load-bearing as the network hops and hiding them would
 * quietly overstate how much of the safety story lives in other services.
 */
export function edgeCurve(fromId, toId) {
  const a = nodeBox(fromId);
  const b = nodeBox(toId);
  if (!a || !b) return null;

  if (fromId === toId) {
    const r = 44;
    return cubic(
      { x: a.cx - 30, y: a.y - 7 },
      { x: a.cx - r, y: a.y - r - 24 },
      { x: a.cx + r, y: a.y - r - 24 },
      { x: a.cx + 30, y: a.y - 7 }
    );
  }

  const start = edgeAnchor(a, b.cx, b.cy);
  const end = edgeAnchor(b, a.cx, a.cy);
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // A straight grid neighbour gets a straight wire; only diagonals bend.
  // Curving a horizontal neighbour for the sake of it just adds noise.
  const straight = Math.abs(dx) < 1 || Math.abs(dy) < 1;
  const bend = straight ? 0.34 : 0.46;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return cubic(
      start,
      { x: start.x + dx * bend, y: start.y },
      { x: end.x - dx * bend, y: end.y },
      end
    );
  }
  return cubic(
    start,
    { x: start.x, y: start.y + dy * bend },
    { x: end.x, y: end.y - dy * bend },
    end
  );
}

/** Point at parameter t along a cubic bezier. */
export function pointOnCurve(curve, t) {
  const { p0, p1, p2, p3 } = curve;
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** Tangent angle in degrees, so a packet can point where it's going. */
export function angleOnCurve(curve, t) {
  const ahead = pointOnCurve(curve, Math.min(1, t + 0.01));
  const behind = pointOnCurve(curve, Math.max(0, t - 0.01));
  return (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI;
}

const CURVE_CACHE = new Map();

export function curveFor(fromId, toId) {
  const key = `${fromId}->${toId}`;
  if (!CURVE_CACHE.has(key)) CURVE_CACHE.set(key, edgeCurve(fromId, toId));
  return CURVE_CACHE.get(key);
}

/* Engine -> colour token. The same vocabulary the trace rail and audit feed
   use, so "who did this?" is answerable identically everywhere. */
export const ENGINE_TONE = {
  crypto: "sky",
  llm: "violet",
  code: "emerald",
  policy: "amber",
  money: "gold",
};

export const ENGINE_LABEL = {
  crypto: "Cryptography",
  llm: "LLM",
  code: "Deterministic",
  policy: "Buyer policy",
  money: "Payment",
};
