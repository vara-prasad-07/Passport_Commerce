"""
Shared Pydantic models used across the passport, marginmind, and buyer-agent
services. Keeping one typed contract here (instead of each service inventing
its own dict shapes) is what lets the three FastAPI apps talk to each other
like real separate services instead of one monolith pretending to be three.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Buyer intent (LLM-parsed, structured)
# ---------------------------------------------------------------------------


class BuyerIntent(BaseModel):
    # Defaulted rather than required. When the model classifies a message as
    # off-topic it is told to leave the other fields alone, and a required
    # field then makes the provider reject the whole tool call for a missing
    # property — so the one field we can always reconstruct ourselves (the
    # parser backfills it from the input) must not be the one that fails.
    raw_text: str = ""

    # Whether this text is a shopping request at all. The buyer agent refuses
    # to spin up the whole pipeline — passport fetch, policy evaluation, a
    # merchant's decision engine — for "hello" or "what's the weather". The
    # model classifies; deterministic code downstream acts on the boolean.
    is_purchase_request: bool = True
    off_topic_reply: Optional[str] = None

    dietary_include: list[str] = Field(default_factory=list)
    dietary_exclude: list[str] = Field(default_factory=list)
    meal_type: Optional[str] = None
    people_count: int = 1
    budget_max_minor: Optional[int] = None
    currency: str = "INR"
    region: Optional[str] = None
    delivery_window: Optional[str] = None


# ---------------------------------------------------------------------------
# MarginMind basket decisions
# ---------------------------------------------------------------------------


class BasketLineItem(BaseModel):
    sku: str
    name: str
    quantity: int
    unit_price_minor: int
    line_total_minor: int


class BasketOption(BaseModel):
    basket_id: str
    items: list[BasketLineItem]
    subtotal_minor: int
    discount_minor: int
    total_minor: int
    currency: str
    estimated_margin_percent: float
    score: float
    rationale: dict = Field(default_factory=dict)
    explanation: Optional[str] = None  # filled in later by the LLM explainer


class MarginMindDecision(BaseModel):
    status: Literal["accepted", "declined"]
    code: Optional[str] = None
    message: Optional[str] = None
    options: list[BasketOption] = Field(default_factory=list)
    requested_amount_minor: Optional[int] = None
    permitted_amount_minor: Optional[int] = None
    money_action_taken: bool = False
    escalation_required: bool = False
    audit_id: str
    correlation_id: str


class RecommendRequest(BaseModel):
    correlation_id: str
    intent: BuyerIntent
    # The buyer agent's own verified passport snapshot — used by MarginMind
    # only for audit cross-checking, NEVER for enforcement. See
    # marginmind/merchant_store.py for why.
    buyer_passport_snapshot: dict
    # Selects WHICH merchant's trusted config to decide against. It cannot
    # supply that config — see merchant_store for why that distinction is the
    # entire security model of this parameter.
    merchant_id: Optional[str] = None


class ValidateOrderRequest(BaseModel):
    correlation_id: str
    basket: BasketOption
    buyer_passport_snapshot: dict
    merchant_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Orders / payments
# ---------------------------------------------------------------------------


class OrderRecord(BaseModel):
    order_id: str
    correlation_id: str
    basket: BasketOption
    status: Literal["pending", "created", "paid", "failed", "declined"]
    razorpay_order_id: Optional[str] = None
    razorpay_payment_id: Optional[str] = None
    simulated: bool = False
    created_at: str
    updated_at: str


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


class AuditEvent(BaseModel):
    event_id: str
    correlation_id: str
    timestamp: str
    actor: str
    event_type: str
    input_hash: Optional[str] = None
    decision: Optional[str] = None
    outcome: Optional[str] = None
    detail: dict = Field(default_factory=dict)
