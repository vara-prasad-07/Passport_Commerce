"""
Buyer-agent service — the API gateway the React dashboard talks to, and the
one place the full pipeline from the pitch actually runs end to end.

The pipeline itself lives in `pipeline.py`, expressed once as a traced
sequence of hops. This module is transport: it exposes that pipeline as a
streaming endpoint (so the dashboard's orchestration canvas can render each
hop the moment it really happens), as a plain JSON endpoint (same code, drained
instead of streamed), and as a set of adversarial runs for the Red Team
console.

    buyer intent
      -> passport integrity + freshness check      (passport_client)
      -> buyer's own risk policy                    (risk_policy)
      -> intent parsing                             (intent_parser, LLM)
      -> catalog filtering + basket ranking          (marginmind, HTTP)
      -> margin + discount checks                    (marginmind, HTTP)
      -> negotiation, if declined for buyer reasons   (negotiator, LLM)
      -> untrusted catalog text neutralised           (sanitize)
      -> buyer explanation                            (explainer, LLM)
      -> consent (explicit frontend confirm click)
      -> order validation (re-checked, fresh)         (marginmind, HTTP)
      -> Razorpay order/payment action                (payments)
      -> webhook reconciliation                       (payments)
      -> audit record                                 (shared.audit)

Run:  uvicorn server:app --reload --port 8003   (from this directory)
Docs: http://localhost:8003/docs
"""

from __future__ import annotations

import json
import math
import os
import queue
import sys
import threading
from typing import Any, Callable, Iterator, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from shared.audit import append_event, read_events  # noqa: E402
from shared.ids import new_correlation_id, new_id  # noqa: E402
from shared.models import BasketLineItem, BasketOption  # noqa: E402

import config  # noqa: E402
import marginmind_client  # noqa: E402
import orders_store  # noqa: E402
import passport_client  # noqa: E402
import pipeline  # noqa: E402
import redteam  # noqa: E402
import risk_policy  # noqa: E402
from payments import razorpay_client, webhook_handler  # noqa: E402
from trace import Tracer  # noqa: E402

app = FastAPI(title="Buyer Agent — Passport Commerce")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # demo only
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# request/response shapes (buyer-agent's own external API, not a shared
# cross-service contract, so these live here rather than in shared/models.py)
# ---------------------------------------------------------------------------


class AgentQueryRequest(BaseModel):
    correlation_id: Optional[str] = None
    message: str
    merchant_id: Optional[str] = None


class AgentCompareRequest(BaseModel):
    correlation_id: Optional[str] = None
    message: str
    merchant_ids: Optional[list[str]] = None


class AgentConfirmRequest(BaseModel):
    correlation_id: str
    basket_id: str
    merchant_id: Optional[str] = None


class PaymentVerifyRequest(BaseModel):
    order_id: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class PaymentSimulateRequest(BaseModel):
    order_id: str


class DemoOverlimitRequest(BaseModel):
    correlation_id: Optional[str] = None


class PolicyPatchRequest(BaseModel):
    patch: dict[str, Any]


class RedTeamRequest(BaseModel):
    attack_id: str
    correlation_id: Optional[str] = None


def _require_llm():
    try:
        config.require_groq_key()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# streaming
# ---------------------------------------------------------------------------


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


def _stream_pipeline(correlation_id: str, work: Callable[[Tracer], dict]) -> Iterator[str]:
    """Run `work` on a worker thread and forward its trace events as SSE.

    A thread rather than an async rewrite: the pipeline is a chain of blocking
    calls (httpx, Groq via LangChain) and making it async would mean rewriting
    three clients to prove a point the user cannot see. What the user CAN see
    is that a hop's start event arrives the instant the call begins — which a
    queue gives us either way, and which is the entire reason for streaming.

    The sentinel `None` is what closes the stream; it is pushed from `finally`
    so a crash inside the pipeline ends the response cleanly instead of
    leaving the browser holding an open connection forever.
    """
    events: "queue.Queue[Optional[dict]]" = queue.Queue()

    def worker() -> None:
        tracer = Tracer(correlation_id, sink=events.put)
        try:
            result = work(tracer)
            events.put({"kind": "final", "correlation_id": correlation_id, "result": result})
        except Exception as exc:  # noqa: BLE001 - the transport boundary; surfaced to the client
            events.put(
                {
                    "kind": "fatal",
                    "correlation_id": correlation_id,
                    "message": str(exc),
                    "error_type": type(exc).__name__,
                }
            )
        finally:
            events.put(None)

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()

    # An opening frame lets the client show the canvas as connected before any
    # real work has produced an event.
    yield _sse({"kind": "open", "correlation_id": correlation_id})
    while True:
        event = events.get()
        if event is None:
            break
        yield _sse(event)


def _stream_response(correlation_id: str, work: Callable[[Tracer], dict]) -> StreamingResponse:
    return StreamingResponse(
        _stream_pipeline(correlation_id, work),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # nginx would otherwise buffer the whole stream
            "Connection": "keep-alive",
        },
    )


# ---------------------------------------------------------------------------
# health / session / passport
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "buyer-agent",
        "razorpay_live": config.RAZORPAY_LIVE,
        "llm_configured": bool(config.GROQ_API_KEY),
        "default_merchant": config.DEFAULT_MERCHANT_ID,
        "streaming": True,
    }


@app.post("/api/session/start")
def start_session():
    correlation_id = new_correlation_id()
    append_event(correlation_id=correlation_id, actor="buyer_agent", event_type="session_started")
    return {"correlation_id": correlation_id}


def _passport_summary_payload(result: dict, correlation_id: str) -> dict:
    passport = result["passport"]
    return {
        "correlation_id": correlation_id,
        "merchant_id": result.get("merchant_id"),
        "passport_url": result.get("passport_url"),
        "key_id": result.get("key_id"),
        "trusted": result["trusted"],
        "signature_ok": result["signature_ok"],
        "signature_reason": result["signature_reason"],
        "freshness_ok": result["freshness_ok"],
        "freshness_reason": result["freshness_reason"],
        "passport_id": passport.get("passport_id"),
        "version": passport.get("version"),
        "merchant": passport.get("merchant"),
        "policies": passport.get("policies"),
        "capabilities": passport.get("capabilities"),
        "bounds": passport.get("bounds"),
        "catalog": passport.get("catalog"),
        "attestations": passport.get("attestations"),
        # The signed integrity block is public by construction — it is what any
        # third party needs to re-verify the passport independently, so the
        # dashboard shows it rather than asking the viewer to trust our word.
        "schema": passport.get("schema"),
        "integrity": passport.get("integrity"),
    }


@app.get("/api/passport/summary")
def passport_summary(merchant_id: Optional[str] = None):
    correlation_id = new_correlation_id()
    try:
        result = passport_client.fetch_and_verify_passport(merchant_id)
    except passport_client.PassportFetchError as exc:
        append_event(
            correlation_id=correlation_id,
            actor="buyer_agent",
            event_type="passport_fetch_failed",
            outcome="unreachable",
            detail={"error": str(exc)},
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    append_event(
        correlation_id=correlation_id,
        actor="buyer_agent",
        event_type="passport_verified",
        decision="trusted" if result["trusted"] else "rejected",
        outcome=f"signature={result['signature_ok']} freshness={result['freshness_ok']}",
        detail={
            "merchant_id": result.get("merchant_id"),
            "signature_reason": result["signature_reason"],
            "freshness_reason": result["freshness_reason"],
        },
    )
    return _passport_summary_payload(result, correlation_id)


@app.get("/api/registry")
def registry():
    """Every merchant the buyer agent can reach, each independently verified.

    This is the buyer's view of a passport registry: the trust decision is
    made per merchant, against that merchant's own key, and a merchant failing
    verification is listed as failing rather than hidden — a registry that
    quietly drops merchants it can't verify is a registry you cannot audit.
    """
    import httpx

    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(f"{config.PASSPORT_BASE_URL}/admin/merchants")
            resp.raise_for_status()
            listing = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"passport service unreachable: {exc}") from exc

    merchants = []
    for entry in listing.get("merchants", []):
        merchant_id = entry["merchant_id"]
        try:
            verified = passport_client.fetch_and_verify_passport(merchant_id)
            merchants.append(
                {
                    **entry,
                    "trusted": verified["trusted"],
                    "signature_ok": verified["signature_ok"],
                    "signature_reason": verified["signature_reason"],
                    "freshness_ok": verified["freshness_ok"],
                    "freshness_reason": verified["freshness_reason"],
                    "key_id": verified.get("key_id"),
                    "passport_url": verified.get("passport_url"),
                    "bounds": verified["passport"].get("bounds"),
                    "policies": verified["passport"].get("policies"),
                    "version": verified["passport"].get("version"),
                    "catalog": verified["passport"].get("catalog"),
                }
            )
        except passport_client.PassportFetchError as exc:
            merchants.append({**entry, "trusted": False, "signature_reason": str(exc), "unreachable": True})

    return {"merchants": merchants, "default": listing.get("default")}


# ---------------------------------------------------------------------------
# the pipeline, streamed and unstreamed
# ---------------------------------------------------------------------------


@app.post("/api/agent/stream")
def agent_stream(req: AgentQueryRequest):
    """The buyer query as a live event stream.

    This is what the orchestration canvas consumes. Every packet it animates
    is one of these events, and every duration it reports was measured here.
    """
    _require_llm()
    correlation_id = req.correlation_id or new_correlation_id()
    return _stream_response(
        correlation_id,
        lambda tracer: pipeline.run_query(tracer, req.message, merchant_id=req.merchant_id),
    )


@app.post("/api/agent/query")
def agent_query(req: AgentQueryRequest):
    """The same pipeline, drained rather than streamed.

    Kept because a JSON endpoint is what you hand someone with curl, and
    because it proves the streaming version isn't a different code path
    wearing the same name.
    """
    _require_llm()
    correlation_id = req.correlation_id or new_correlation_id()
    tracer = Tracer(correlation_id)
    result = pipeline.run_query(tracer, req.message, merchant_id=req.merchant_id)
    return {**result, "trace": tracer.events}


def _all_merchant_ids() -> list[str]:
    import httpx

    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(f"{config.PASSPORT_BASE_URL}/admin/merchants")
            resp.raise_for_status()
            return [m["merchant_id"] for m in resp.json().get("merchants", [])]
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"passport service unreachable: {exc}") from exc


@app.post("/api/agent/compare/stream")
def agent_compare_stream(req: AgentCompareRequest):
    """One request, every merchant in the registry, each verified separately.

    This is the passport idea doing what a passport is for: a buyer agent that
    has never met either merchant can establish who they are, judge them
    against its own policy, take the same request to both, and choose — with
    the choice itself made in deterministic code, because which merchant gets
    the money is a decision.
    """
    _require_llm()
    correlation_id = req.correlation_id or new_correlation_id()
    merchant_ids = req.merchant_ids or _all_merchant_ids()
    return _stream_response(
        correlation_id,
        lambda tracer: pipeline.run_compare(tracer, req.message, merchant_ids),
    )


def _make_order_creator(correlation_id: str, idem_key: str):
    """Build the callback `pipeline.run_confirm` uses for the money action.

    Injected rather than imported so the Red Team console can run the exact
    same confirm path with a payment client that raises if it is ever reached
    — turning "no money action was taken" from an assertion into something the
    run itself would fail to produce if it were false.
    """

    def create_order(trusted_basket: BasketOption) -> dict:
        order = orders_store.create_pending(
            correlation_id=correlation_id, basket=trusted_basket, idem_key=idem_key
        )
        razorpay_order = razorpay_client.create_order(
            amount_minor=trusted_basket.total_minor,
            currency=trusted_basket.currency,
            receipt=order.order_id,
            notes={"correlation_id": correlation_id, "basket_id": trusted_basket.basket_id},
        )
        orders_store.mark_created(
            order.order_id,
            razorpay_order_id=razorpay_order["id"],
            simulated=razorpay_order.get("simulated", False),
        )
        return _order_response(orders_store.get(order.order_id))

    return create_order


def _confirm(tracer: Tracer, req: AgentConfirmRequest) -> dict:
    idem_key = orders_store.idempotency_key(req.correlation_id, req.basket_id)
    existing = orders_store.get_existing(idem_key)
    if existing is not None:
        # A repeated confirm replays the same order instead of creating a
        # second one. Traced as a real step because "clicking twice does not
        # charge twice" is a claim worth being able to watch.
        tracer.run_start(label="Buyer consent (replay)", detail={"basket_id": req.basket_id})
        with tracer.hop(
            src="buyer_agent",
            dst="buyer_agent",
            label="idempotency key already seen",
            engine="code",
            protocol="local · deterministic",
            payload={"idempotency_key": idem_key},
            audit="confirm_idempotent_replay",
        ) as hop:
            hop.ok(summary=f"replaying existing order {existing.order_id} — no second order created")
        response = _order_response(existing)
        tracer.run_end(stage="idempotent_replay", result=response)
        return response

    result, _ = pipeline.run_confirm(
        tracer,
        req.basket_id,
        create_order=_make_order_creator(req.correlation_id, idem_key),
        merchant_id=req.merchant_id,
    )
    return result


@app.post("/api/agent/confirm")
def agent_confirm(req: AgentConfirmRequest):
    tracer = Tracer(req.correlation_id)
    result = _confirm(tracer, req)
    return {**result, "trace": tracer.events}


@app.post("/api/agent/confirm/stream")
def agent_confirm_stream(req: AgentConfirmRequest):
    return _stream_response(req.correlation_id, lambda tracer: _confirm(tracer, req))


def _order_response(order) -> dict:
    return {
        "status": order.status,
        "order_id": order.order_id,
        "razorpay_order_id": order.razorpay_order_id,
        "razorpay_payment_id": order.razorpay_payment_id,
        "amount_minor": order.basket.total_minor,
        "currency": order.basket.currency,
        "simulated": order.simulated,
        "razorpay_key_id": config.RAZORPAY_KEY_ID if (config.RAZORPAY_LIVE and not order.simulated) else None,
        "basket": order.basket.model_dump(),
    }


# ---------------------------------------------------------------------------
# payments
# ---------------------------------------------------------------------------


def _verify_and_finalize_payment(
    *, order_id: str, razorpay_order_id: str, razorpay_payment_id: str, razorpay_signature: str
) -> dict:
    order = orders_store.get(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Unknown order_id")

    ok = razorpay_client.verify_payment_signature(
        razorpay_order_id=razorpay_order_id,
        razorpay_payment_id=razorpay_payment_id,
        razorpay_signature=razorpay_signature,
    )
    append_event(
        correlation_id=order.correlation_id,
        actor="buyer_agent",
        event_type="payment_signature_verified",
        decision="paid" if ok else "failed",
        outcome=razorpay_payment_id,
        detail={"order_id": order_id, "razorpay_order_id": razorpay_order_id},
    )

    if not ok:
        orders_store.mark_failed(order_id)
        return {"status": "failed", "reason": "signature_verification_failed", "order": _order_response(order)}

    orders_store.mark_paid(order_id, razorpay_payment_id=razorpay_payment_id)
    return {"status": "paid", "order": _order_response(orders_store.get(order_id))}


@app.post("/api/payments/verify")
def payments_verify(req: PaymentVerifyRequest):
    return _verify_and_finalize_payment(
        order_id=req.order_id,
        razorpay_order_id=req.razorpay_order_id,
        razorpay_payment_id=req.razorpay_payment_id,
        razorpay_signature=req.razorpay_signature,
    )


@app.post("/api/payments/simulate")
def payments_simulate(req: PaymentSimulateRequest):
    """Dev-only convenience: stands in for the Razorpay Checkout popup when
    no real keys are configured. Produces the same shape of callback data a
    real Checkout success would, signed with the same HMAC scheme, then
    runs it through the exact same verification path as a real payment."""
    if config.RAZORPAY_LIVE:
        raise HTTPException(status_code=400, detail="Real Razorpay keys are configured — use the real Checkout flow.")
    order = orders_store.get(req.order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Unknown order_id")

    fake_callback = razorpay_client.create_simulated_payment(razorpay_order_id=order.razorpay_order_id)
    return _verify_and_finalize_payment(
        order_id=req.order_id,
        razorpay_order_id=fake_callback["razorpay_order_id"],
        razorpay_payment_id=fake_callback["razorpay_payment_id"],
        razorpay_signature=fake_callback["razorpay_signature"],
    )


@app.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request):
    raw_body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    try:
        return webhook_handler.handle_webhook(raw_body=raw_body, signature=signature)
    except webhook_handler.WebhookError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# buyer risk policy
# ---------------------------------------------------------------------------


@app.get("/api/policy")
def get_policy():
    return {"policy": risk_policy.load_policy(), "defaults": risk_policy.DEFAULT_POLICY}


@app.put("/api/policy")
def put_policy(req: PolicyPatchRequest):
    updated = risk_policy.save_policy(req.patch)
    append_event(
        correlation_id=new_correlation_id(),
        actor="buyer_agent",
        event_type="buyer_policy_updated",
        outcome=", ".join(sorted(req.patch.keys())),
        detail={"patch": req.patch},
    )
    return {"policy": updated}


@app.post("/api/policy/reset")
def reset_policy():
    return {"policy": risk_policy.reset_policy()}


@app.get("/api/policy/evaluate")
def evaluate_policy(merchant_id: Optional[str] = None):
    """Run the current policy against a merchant without starting a purchase.
    Lets the console show the verdict live as thresholds are dragged."""
    try:
        result = passport_client.fetch_and_verify_passport(merchant_id)
    except passport_client.PassportFetchError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return risk_policy.evaluate(result["passport"], result)


# ---------------------------------------------------------------------------
# red team
# ---------------------------------------------------------------------------


@app.get("/api/redteam/attacks")
def redteam_attacks():
    return {"attacks": redteam.ATTACK_CATALOG}


@app.post("/api/redteam/run")
def redteam_run(req: RedTeamRequest):
    attack = redteam.get_attack(req.attack_id)
    if attack is None:
        raise HTTPException(status_code=404, detail=f"unknown attack: {req.attack_id}")
    correlation_id = req.correlation_id or new_correlation_id()
    tracer = Tracer(correlation_id)
    return redteam.run_attack(req.attack_id, tracer)


@app.post("/api/redteam/stream")
def redteam_stream(req: RedTeamRequest):
    """Run an attack as a live stream so the canvas animates the block."""
    if redteam.get_attack(req.attack_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown attack: {req.attack_id}")
    correlation_id = req.correlation_id or new_correlation_id()
    return _stream_response(correlation_id, lambda tracer: redteam.run_attack(req.attack_id, tracer))


# ---------------------------------------------------------------------------
# legacy guarded-failure demo (superseded by the Red Team console, kept
# because START.md and the curl instructions reference it)
# ---------------------------------------------------------------------------


@app.post("/api/demo/overlimit")
def demo_overlimit(req: DemoOverlimitRequest):
    """Deterministic guarded-failure demo: deliberately request a basket
    priced well above the merchant's autonomous order cap, and prove the
    gateway declines it — with no Razorpay order or internal order record
    ever created — exactly the scenario from the pitch."""
    correlation_id = req.correlation_id or new_correlation_id()
    try:
        passport_result = passport_client.fetch_and_verify_passport()
    except passport_client.PassportFetchError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    passport = passport_result["passport"]

    items = passport["catalog"]["items"]
    if not items:
        raise HTTPException(status_code=500, detail="Merchant catalog is empty")
    item = items[0]
    cap_minor = passport["bounds"]["max_order_value_minor"]
    qty = max(math.ceil((cap_minor * 1.5) / item["price_minor"]), 2)

    oversized_basket = BasketOption(
        basket_id=new_id("basket_demo_overlimit"),
        items=[
            BasketLineItem(
                sku=item["sku"],
                name=item["name"],
                quantity=qty,
                unit_price_minor=item["price_minor"],
                line_total_minor=item["price_minor"] * qty,
            )
        ],
        subtotal_minor=item["price_minor"] * qty,
        discount_minor=0,
        total_minor=item["price_minor"] * qty,
        currency=item["currency"],
        estimated_margin_percent=0.0,
        score=0.0,
        rationale={"demo": "deliberately oversized to exercise the ORDER_VALUE_EXCEEDS_AGENT_BOUND gate"},
    )

    validation = marginmind_client.validate_order(
        correlation_id=correlation_id,
        basket=oversized_basket,
        buyer_passport_snapshot=passport,
    )

    orders_before = len(orders_store.all_orders())
    append_event(
        correlation_id=correlation_id,
        actor="buyer_agent",
        event_type="demo_overlimit_attempt",
        decision=validation.status,
        outcome=validation.code,
        detail={
            "attempted_basket": oversized_basket.model_dump(),
            "orders_in_store": orders_before,
            "money_action_taken": validation.money_action_taken,
        },
    )

    return {
        "correlation_id": correlation_id,
        "attempted_basket": oversized_basket.model_dump(),
        "gateway_response": validation.model_dump(),
        "orders_created_by_this_call": 0,
    }


# ---------------------------------------------------------------------------
# audit
# ---------------------------------------------------------------------------


@app.get("/api/audit")
def get_audit(correlation_id: Optional[str] = None, limit: int = 200):
    return {"events": read_events(limit=limit, correlation_id=correlation_id)}


@app.get("/api/audit/correlations")
def audit_correlations(limit: int = 40):
    """Distinct runs, newest first — the index the replay view is built on.

    Replay matters more than it looks: being able to re-play any past run
    through the same canvas, from the log alone, is what makes the audit trail
    a claim you can check rather than a file you are asked to believe in.
    """
    events = read_events(limit=4000)
    seen: dict[str, dict] = {}
    for event in events:  # newest-first
        cid = event.get("correlation_id")
        if not cid:
            continue
        entry = seen.setdefault(
            cid,
            {
                "correlation_id": cid,
                "started_at": event.get("timestamp"),
                "ended_at": event.get("timestamp"),
                "event_count": 0,
                "actors": set(),
                "blocked": False,
                "paid": False,
                "label": None,
            },
        )
        entry["event_count"] += 1
        entry["actors"].add(event.get("actor"))
        entry["started_at"] = event.get("timestamp")  # keeps moving earlier
        if event.get("decision") in ("blocked", "declined") or (event.get("outcome") or "").isupper():
            entry["blocked"] = True
        if event.get("event_type") == "payment_signature_verified" and event.get("decision") == "paid":
            entry["paid"] = True
        if event.get("event_type") == "intent_parsed":
            entry["label"] = (event.get("detail") or {}).get("raw_text")

    out = []
    for entry in list(seen.values())[:limit]:
        entry["actors"] = sorted(a for a in entry["actors"] if a)
        out.append(entry)
    return {"runs": out}
