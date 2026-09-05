"""
Pipeline tracing — the single event stream behind BOTH the live orchestration
canvas in the dashboard and the append-only audit log.

This module exists to kill a specific piece of demo theater. The dashboard
used to fake the feeling of a live pipeline with `setTimeout` constants on the
client, which meant the animation was a drawing of the architecture rather
than a recording of it. Every packet the canvas now moves between two nodes
corresponds to a real message that really crossed a real process boundary, and
carries the real elapsed time it took.

The design is deliberately small:

    tracer = Tracer(correlation_id, sink=queue.put)

    with tracer.hop(src=NODE_BUYER, dst=NODE_MARGINMIND,
                    label="recommend(intent)", engine="code",
                    protocol="POST /marginmind/recommend",
                    payload=intent.model_dump()) as hop:
        decision = marginmind_client.recommend(...)
        hop.ok(summary=f"{len(decision.options)} baskets ranked",
               reply=decision.model_dump())

A hop emits `hop_start` the instant the call begins and `hop_end` when it
returns, so a slow Groq call shows as a packet genuinely in flight for as long
as it genuinely is. `duration_ms` is measured, never assumed. The dashboard's
pacing control slows *playback* of these events; it never invents them, and
the true millisecond figure is always displayed next to the animation.

Audit rows are written from the same call, so "the animation and the audit
trail are the same event stream" is a literal statement about this file rather
than a claim in a slide.
"""

from __future__ import annotations

import os
import sys
import time
import uuid
from contextlib import contextmanager
from typing import Any, Callable, Iterator, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shared.audit import append_event  # noqa: E402

# ---------------------------------------------------------------------------
# Node vocabulary — the canvas draws exactly these, and nothing that isn't
# here can appear on screen. Keeping the ids in one place on the server means
# the dashboard's topology can never drift into showing a box for a service
# that no longer participates in the pipeline.
# ---------------------------------------------------------------------------

NODE_CONTROL_PLANE = "control_plane"  # merchant's own catalog / bounds console
NODE_PASSPORT = "passport"            # :8001 signed passport service
NODE_REGISTRY = "registry"            # multi-merchant passport registry
NODE_POLICY = "policy"                # buyer's OWN risk policy gate
NODE_BUYER = "buyer_agent"            # :8003 orchestrator
NODE_LLM = "llm"                      # Groq — reasoning, never deciding money
NODE_MARGINMIND = "marginmind"        # :8002 deterministic decision engine
NODE_RAZORPAY = "razorpay"            # payment rails
NODE_AUDIT = "audit"                  # append-only log

# Which engine performed a step. Load-bearing, not decorative: the entire
# argument of the project is that violet (a model) never appears on a step
# that moves money, and the canvas colours packets by this field.
ENGINE_CRYPTO = "crypto"   # Ed25519 signature / freshness
ENGINE_LLM = "llm"         # a model reasoning or talking
ENGINE_CODE = "code"       # deterministic merchant-side enforcement
ENGINE_POLICY = "policy"   # deterministic buyer-side risk policy
ENGINE_MONEY = "money"     # a real money action


# ---------------------------------------------------------------------------
# payload trimming
# ---------------------------------------------------------------------------

_MAX_STR = 600
_MAX_LIST = 12


def trim(value: Any, _depth: int = 0) -> Any:
    """Shrink a payload to something worth putting on a wire preview.

    The canvas lets a viewer click any packet and read the JSON that actually
    travelled on that edge, so these previews need to stay honest — the shape
    and the real values are preserved, only absurd lengths are cut, and a cut
    always announces itself rather than silently pretending the data ended.
    """
    if _depth > 6:
        return "…"
    if isinstance(value, str):
        return value if len(value) <= _MAX_STR else value[:_MAX_STR] + f"… (+{len(value) - _MAX_STR} chars)"
    if isinstance(value, dict):
        return {k: trim(v, _depth + 1) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        items = [trim(v, _depth + 1) for v in list(value)[:_MAX_LIST]]
        if len(value) > _MAX_LIST:
            items.append(f"… (+{len(value) - _MAX_LIST} more)")
        return items
    return value


# ---------------------------------------------------------------------------
# Hop
# ---------------------------------------------------------------------------


class Hop:
    """One message in flight from one node to another.

    A hop is finished exactly once, by `ok()`, `blocked()` or `failed()`. The
    distinction between `blocked` and `failed` is the whole guarded-failure
    story and the canvas renders them completely differently: `blocked` means
    a rule did its job and the packet stops dead at the boundary; `failed`
    means something broke. Conflating them would turn a working safety
    control into what looks like a bug.
    """

    def __init__(self, tracer: "Tracer", hop_id: str, src: str, dst: str, engine: str):
        self._tracer = tracer
        self.hop_id = hop_id
        self.src = src
        self.dst = dst
        self.engine = engine
        self._started = time.perf_counter()
        self._finished = False

    @property
    def elapsed_ms(self) -> float:
        return round((time.perf_counter() - self._started) * 1000, 1)

    def _finish(
        self,
        status: str,
        *,
        summary: Optional[str] = None,
        reply: Any = None,
        code: Optional[str] = None,
        detail: Optional[dict] = None,
    ) -> None:
        if self._finished:
            return
        self._finished = True
        self._tracer._emit(
            kind="hop_end",
            hop_id=self.hop_id,
            src=self.src,
            dst=self.dst,
            engine=self.engine,
            status=status,
            code=code,
            duration_ms=self.elapsed_ms,
            summary=summary,
            reply=trim(reply) if reply is not None else None,
            detail=detail or {},
        )

    def ok(self, *, summary: Optional[str] = None, reply: Any = None, detail: Optional[dict] = None) -> None:
        self._finish("ok", summary=summary, reply=reply, detail=detail)

    def blocked(
        self, *, code: str, summary: str, reply: Any = None, detail: Optional[dict] = None
    ) -> None:
        """A rule refused the request. No money moved. This is a success of
        the system, and the canvas says so in those words."""
        self._finish("blocked", summary=summary, reply=reply, code=code, detail=detail)

    def failed(self, *, summary: str, code: Optional[str] = None) -> None:
        self._finish("error", summary=summary, code=code or "ERROR")


# ---------------------------------------------------------------------------
# Tracer
# ---------------------------------------------------------------------------


class Tracer:
    """Collects pipeline events, pushes them at a sink the moment they happen,
    and mirrors the durable ones into the audit log.

    `sink` is called from whatever thread is running the pipeline. The SSE
    endpoint passes `queue.Queue.put` so events reach the browser as they
    occur; the plain JSON endpoint passes a list's `append` and drains at the
    end. Same pipeline code, one implementation, two transports.
    """

    def __init__(self, correlation_id: str, sink: Optional[Callable[[dict], None]] = None):
        self.correlation_id = correlation_id
        self._sink = sink
        self._events: list[dict] = []
        self._seq = 0
        self._t0 = time.perf_counter()

    # -- emission ---------------------------------------------------------

    def _emit(self, **fields: Any) -> dict:
        self._seq += 1
        event = {
            "seq": self._seq,
            "t_ms": round((time.perf_counter() - self._t0) * 1000, 1),
            "correlation_id": self.correlation_id,
            **fields,
        }
        self._events.append(event)
        if self._sink is not None:
            self._sink(event)
        return event

    @property
    def events(self) -> list[dict]:
        return list(self._events)

    @property
    def elapsed_ms(self) -> float:
        return round((time.perf_counter() - self._t0) * 1000, 1)

    # -- lifecycle --------------------------------------------------------

    def run_start(self, *, label: str, detail: Optional[dict] = None) -> None:
        self._emit(kind="run_start", label=label, detail=detail or {})

    def run_end(self, *, stage: str, result: Optional[dict] = None) -> None:
        self._emit(kind="run_end", stage=stage, total_ms=self.elapsed_ms, result=result)

    def note(self, *, node: str, text: str, tone: str = "neutral") -> None:
        """A line of narration pinned to a node. Used where something true and
        interesting happened that wasn't itself a message between services."""
        self._emit(kind="note", node=node, text=text, tone=tone)

    def node_state(self, node: str, state: str, *, label: Optional[str] = None) -> None:
        self._emit(kind="node", node=node, state=state, label=label)

    # -- hops -------------------------------------------------------------

    @contextmanager
    def hop(
        self,
        *,
        src: str,
        dst: str,
        label: str,
        engine: str,
        protocol: Optional[str] = None,
        payload: Any = None,
        audit: Optional[str] = None,
    ) -> Iterator[Hop]:
        """Trace one message from `src` to `dst`.

        If the body raises, the hop is closed as an error rather than left
        dangling — an unfinished hop would leave a packet stuck mid-flight on
        the canvas forever, which reads as a hang rather than a failure.
        """
        hop_id = f"hop_{uuid.uuid4().hex[:8]}"
        self._emit(
            kind="hop_start",
            hop_id=hop_id,
            src=src,
            dst=dst,
            label=label,
            engine=engine,
            protocol=protocol,
            payload=trim(payload) if payload is not None else None,
        )
        hop = Hop(self, hop_id, src, dst, engine)
        try:
            yield hop
        except Exception as exc:  # noqa: BLE001 - re-raised immediately; this only closes the visual
            hop.failed(summary=str(exc))
            raise
        finally:
            # A body that returned without calling ok()/blocked()/failed() is
            # a bug in the caller, but leaving the packet in flight would be a
            # worse demo than closing it silently.
            hop._finish("ok")
            if audit:
                last = self._events[-1]
                append_event(
                    correlation_id=self.correlation_id,
                    actor=src,
                    event_type=audit,
                    decision=last.get("status"),
                    outcome=last.get("code") or last.get("summary"),
                    detail={
                        "hop_id": hop_id,
                        "target": dst,
                        "engine": engine,
                        "duration_ms": last.get("duration_ms"),
                        **(last.get("detail") or {}),
                    },
                )
