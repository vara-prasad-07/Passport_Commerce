"""
MarginMind as its own service — agent-to-agent over HTTP, not a function
call inside the buyer agent's process. This is deliberate: it is the
merchant's decision engine, and in a real deployment it would run on the
merchant's own infrastructure, separate from whoever operates the buyer
agent.

Run:  uvicorn server:app --reload --port 8002   (from this directory)
Docs: http://localhost:8002/docs
"""

from __future__ import annotations

import os
import sys
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from marginmind import engine, merchant_store  # noqa: E402
from shared.audit import append_event  # noqa: E402
from shared.ids import hash_payload, new_id  # noqa: E402
from shared.models import MarginMindDecision, RecommendRequest, ValidateOrderRequest  # noqa: E402

app = FastAPI(title="MarginMind — Merchant Decision Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # demo only
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "marginmind",
        "merchants": merchant_store.known_merchants(),
    }


def _resolve(merchant_id: Optional[str]) -> dict:
    try:
        return merchant_store.load_merchant_config(merchant_id)
    except merchant_store.UnknownMerchant as exc:
        # Fail rather than silently falling back to the default merchant:
        # deciding one merchant's order against another's margin floor would
        # be far worse than an error, and the caller picks this id.
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/marginmind/recommend", response_model=MarginMindDecision)
def recommend(req: RecommendRequest):
    merchant_config = _resolve(req.merchant_id)
    audit_id = new_id("audit")
    decision = engine.recommend(
        correlation_id=req.correlation_id,
        buyer_passport_snapshot=req.buyer_passport_snapshot,
        intent=req.intent,
        audit_id=audit_id,
        merchant_id=req.merchant_id,
    )
    bounds_match = engine.passport_bounds_match(req.buyer_passport_snapshot, merchant_config)
    append_event(
        correlation_id=req.correlation_id,
        actor="marginmind",
        event_type="recommend",
        decision=decision.status,
        outcome=decision.code or "ranked_options",
        input_hash=hash_payload(req.intent.model_dump()),
        detail={
            "audit_id": audit_id,
            "merchant_id": req.merchant_id or merchant_store.DEFAULT_MERCHANT_ID,
            "intent": req.intent.model_dump(),
            "option_count": len(decision.options),
            "message": decision.message,
            "buyer_passport_bounds_match": bounds_match,
        },
    )
    return decision


@app.post("/marginmind/validate_order", response_model=MarginMindDecision)
def validate_order(req: ValidateOrderRequest):
    merchant_config = _resolve(req.merchant_id)
    audit_id = new_id("audit")
    decision = engine.validate_order(
        correlation_id=req.correlation_id,
        buyer_passport_snapshot=req.buyer_passport_snapshot,
        basket=req.basket,
        audit_id=audit_id,
        merchant_id=req.merchant_id,
    )
    bounds_match = engine.passport_bounds_match(req.buyer_passport_snapshot, merchant_config)
    append_event(
        correlation_id=req.correlation_id,
        actor="marginmind",
        event_type="validate_order",
        decision=decision.status,
        outcome=decision.code or "within_bounds",
        input_hash=hash_payload(req.basket.model_dump()),
        detail={
            "audit_id": audit_id,
            "merchant_id": req.merchant_id or merchant_store.DEFAULT_MERCHANT_ID,
            "basket_id": req.basket.basket_id,
            "requested_amount_minor": decision.requested_amount_minor,
            "permitted_amount_minor": decision.permitted_amount_minor,
            "money_action_taken": decision.money_action_taken,
            "escalation_required": decision.escalation_required,
            "message": decision.message,
            "buyer_passport_bounds_match": bounds_match,
        },
    )
    return decision


@app.get("/marginmind/bounds")
def bounds(merchant_id: Optional[str] = None):
    """The bounds MarginMind will actually enforce, read from its own config.

    Exposed so the dashboard can show the enforced numbers side by side with
    the ones the passport declares. When a judge edits a bound in the merchant
    console, both move together — and if they ever didn't, this endpoint is
    how you would catch it.
    """
    config = _resolve(merchant_id)
    return {
        "merchant_id": merchant_id or merchant_store.DEFAULT_MERCHANT_ID,
        "bounds": config["bounds"],
        "source": "marginmind's own trusted merchant config, not the caller's passport snapshot",
    }
