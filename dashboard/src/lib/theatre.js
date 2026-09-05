/*
 * The playback engine behind the orchestration canvas.
 *
 * The important idea: events arrive from the server as fast as the pipeline
 * actually produces them, and playback is a SEPARATE clock that drains them
 * at a chosen pace. That separation is what makes the slow-motion control
 * honest — it slows down how the run is *shown*, and cannot change what
 * happened or how long it really took. Every packet still reports the true
 * millisecond figure the server measured.
 *
 * Two consequences worth understanding:
 *
 *   * If the pipeline outruns playback (it usually does), events queue and
 *     the canvas plays them in order at its own speed. Nothing is dropped.
 *   * If playback outruns the pipeline — a two-second Groq call, say — the
 *     packet lands at its target and sits there while that node pulses, until
 *     the real `hop_end` arrives. The waiting you see is the waiting that
 *     happened.
 *
 * This is a plain class rather than a hook because it runs a requestAnimation
 * -Frame loop at 60fps. Only the canvas subscribes, so only the canvas
 * re-renders that often; the rest of the page updates on real events.
 */

const BASE = {
  travel: 900, // a packet crossing a wire
  endOk: 480, // the beat after a successful hop
  endBlocked: 1100, // longer — a refusal is the thing worth looking at
  endError: 900,
  returnTrip: 640, // the reply coming back
  note: 340,
  runStart: 260,
};

export const SPEEDS = [
  { id: "live", label: "1×", name: "Live", factor: 1 },
  { id: "slow", label: "0.5×", name: "Slow", factor: 0.5 },
  { id: "cinema", label: "0.25×", name: "Cinematic", factor: 0.25 },
];

let uid = 0;
const nextId = () => `pk_${++uid}`;

export class Theatre {
  constructor({ speed = 0.5 } = {}) {
    this.speed = speed;
    this.listeners = new Set();
    this.raf = null;
    this.reset();
  }

  reset() {
    this.queue = [];
    this.packets = [];
    this.nodes = {};
    this.hops = [];
    this.hopIndex = new Map();
    this.current = null;
    this.finished = false;
    this.streamClosed = false;
    this.startedAt = null;
    this.totalMs = null;
    this.blocked = null;
    this.emit();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  setSpeed(factor) {
    this.speed = factor;
    this.emit();
  }

  dur(base) {
    return base / this.speed;
  }

  /** True while there is anything left to animate. */
  get busy() {
    return Boolean(this.current) || this.queue.length > 0 || this.packets.length > 0;
  }

  // -- ingestion --------------------------------------------------------

  feed(event) {
    if (!event) return;
    this.queue.push(event);
    if (this.startedAt === null) this.startedAt = performance.now();
    this.ensureRunning();
  }

  closeStream() {
    this.streamClosed = true;
    this.ensureRunning();
  }

  ensureRunning() {
    if (this.raf !== null) return;
    const frame = () => {
      const now = performance.now();
      this.step(now);
      this.emit();
      if (this.busy || !this.streamClosed) {
        this.raf = requestAnimationFrame(frame);
      } else {
        this.raf = null;
        this.finished = true;
        this.emit();
      }
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  // -- the scheduler ----------------------------------------------------

  step(now) {
    // Retire packets whose animation has fully elapsed. Burst packets hang
    // around a little longer than their motion so the refusal is readable.
    this.packets = this.packets.filter((p) => now - p.t0 < p.dur + (p.linger ?? 0));

    if (this.current && now - this.current.at >= this.current.dur) {
      this.current = null;
    }
    if (!this.current && this.queue.length) {
      const event = this.queue.shift();
      this.current = { event, at: now, dur: this.begin(event, now) };
    }
  }

  node(id) {
    if (!this.nodes[id]) {
      this.nodes[id] = { state: "idle", label: null, code: null, at: 0, hits: 0, totalMs: 0 };
    }
    return this.nodes[id];
  }

  begin(event, now) {
    switch (event.kind) {
      case "run_start":
        return this.dur(BASE.runStart);

      case "hop_start": {
        const dur = this.dur(BASE.travel);
        this.packets.push({
          id: nextId(),
          hopId: event.hop_id,
          from: event.src,
          to: event.dst,
          label: event.label,
          engine: event.engine,
          phase: "travel",
          t0: now,
          dur,
          reverse: false,
        });
        const target = this.node(event.dst);
        target.state = "busy";
        target.label = event.label;
        const source = this.node(event.src);
        if (source.state === "idle") source.state = "active";

        const hop = {
          hopId: event.hop_id,
          seq: event.seq,
          src: event.src,
          dst: event.dst,
          label: event.label,
          engine: event.engine,
          protocol: event.protocol,
          payload: event.payload,
          status: "running",
          startedAtMs: event.t_ms,
        };
        this.hops.push(hop);
        this.hopIndex.set(event.hop_id, hop);
        return dur;
      }

      case "hop_end": {
        const hop = this.hopIndex.get(event.hop_id);
        if (hop) {
          Object.assign(hop, {
            status: event.status,
            code: event.code,
            summary: event.summary,
            reply: event.reply,
            durationMs: event.duration_ms,
            detail: event.detail,
          });
        }

        // The packet that was in flight for this hop has arrived; how it
        // resolves is the whole visual vocabulary of the canvas.
        this.packets = this.packets.filter((p) => p.hopId !== event.hop_id);
        const target = this.node(event.dst);
        target.hits += 1;
        target.totalMs += event.duration_ms ?? 0;
        target.lastMs = event.duration_ms;
        target.code = event.code ?? null;

        if (event.status === "blocked") {
          target.state = "blocked";
          target.label = event.summary;
          this.blocked = {
            node: event.dst,
            code: event.code,
            summary: event.summary,
            hopId: event.hop_id,
          };
          this.packets.push({
            id: nextId(),
            hopId: event.hop_id,
            from: event.src,
            to: event.dst,
            engine: event.engine,
            label: event.code,
            phase: "burst",
            t0: now,
            dur: this.dur(BASE.endBlocked),
            linger: 0,
          });
          return this.dur(BASE.endBlocked);
        }

        if (event.status === "error") {
          target.state = "error";
          target.label = event.summary;
          this.packets.push({
            id: nextId(),
            hopId: event.hop_id,
            from: event.src,
            to: event.dst,
            engine: event.engine,
            label: "error",
            phase: "burst",
            t0: now,
            dur: this.dur(BASE.endError),
          });
          return this.dur(BASE.endError);
        }

        target.state = "ok";
        target.label = event.summary;
        // The reply travelling home is what makes a request/response hop read
        // as a round trip rather than a one-way broadcast.
        if (event.src !== event.dst) {
          this.packets.push({
            id: nextId(),
            hopId: `${event.hop_id}_reply`,
            from: event.dst,
            to: event.src,
            engine: event.engine,
            label: event.summary,
            phase: "reply",
            t0: now,
            dur: this.dur(BASE.returnTrip),
            reverse: true,
          });
        }
        return this.dur(BASE.endOk);
      }

      case "node": {
        const node = this.node(event.node);
        node.state = event.state;
        node.label = event.label ?? node.label;
        return this.dur(BASE.note);
      }

      case "note": {
        const node = this.node(event.node);
        node.label = event.text;
        return this.dur(BASE.note);
      }

      case "run_end":
        this.totalMs = event.total_ms;
        return 0;

      default:
        return 0;
    }
  }

  /** Positions and node states for this frame. */
  snapshot(now = performance.now()) {
    return {
      packets: this.packets.map((p) => {
        const raw = Math.min(1, Math.max(0, (now - p.t0) / p.dur));
        return { ...p, t: raw };
      }),
      nodes: this.nodes,
      hops: this.hops,
      blocked: this.blocked,
      totalMs: this.totalMs,
      busy: this.busy,
    };
  }
}

/* ------------------------------------------------------------------ */
/* SSE                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Consume a Server-Sent Events stream from a POST endpoint.
 *
 * `EventSource` can only issue GETs and cannot carry a body, which would mean
 * putting the buyer's message in a query string. fetch + a ReadableStream is
 * a few more lines and keeps the request shaped like what it is.
 */
export async function streamSSE(url, body, { onEvent, signal } = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = data?.detail || detail;
    } catch {
      /* a non-JSON error body is still an error; the status text will do */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  if (!response.body) throw new Error("This browser did not give us a readable stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line. Anything after the last
    // separator is a partial frame and stays in the buffer for the next read.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        onEvent?.(JSON.parse(line.slice(5).trim()));
      } catch {
        /* a malformed frame should not kill a run that is otherwise fine */
      }
    }
  }
}
