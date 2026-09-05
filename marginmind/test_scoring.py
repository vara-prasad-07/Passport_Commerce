"""
Unit tests proving the claims the pitch makes about MarginMind:

1. Scoring is a pure, deterministic function (same inputs -> same output).
2. Merchant bounds (order cap, margin floor, discount ceiling) are actually
   enforced in code, not just described in a JSON file.
3. Enforcement uses MarginMind's OWN trusted merchant config, never a value
   supplied by the caller — a forged `buyer_passport_snapshot` must not be
   able to raise the effective order cap.

Run:  pytest  (from this directory, or the repo root)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from marginmind import engine, merchant_store, scoring  # noqa: E402
from marginmind.engine import _within_merchant_bounds  # noqa: E402
from shared.models import BasketLineItem, BasketOption, BuyerIntent  # noqa: E402

FAKE_BOUNDS = {
    "max_order_value_minor": 100000,
    "allowed_currencies": ["INR"],
    "discount_ceiling_minor": 10000,
    "min_margin_percent": 30,
    "rate_limit_per_agent_per_hour": 20,
}

FAKE_MERCHANT_CONFIG = {
    "catalog": {
        "items": [
            {
                "sku": "OATS-500",
                "name": "High Protein Oats",
                "price_minor": 24900,
                "cost_minor": 14900,
                "currency": "INR",
                "stock": "in_stock",
                "tags": ["vegetarian", "high-protein", "breakfast"],
                "complements": ["YOG-200"],
            },
            {
                "sku": "YOG-200",
                "name": "Greek Yogurt Cup",
                "price_minor": 12000,
                "cost_minor": 7500,
                "currency": "INR",
                "stock": "in_stock",
                "tags": ["vegetarian", "high-protein", "breakfast", "dairy"],
                "complements": ["OATS-500"],
            },
        ]
    },
    "bounds": FAKE_BOUNDS,
}


@pytest.fixture(autouse=True)
def fake_merchant_store(monkeypatch):
    """Every test runs against a small, known catalog — never the real
    merchant_data.json — so these tests don't silently break if the demo
    fixture data changes."""
    monkeypatch.setattr(merchant_store, "load_merchant_config", lambda: FAKE_MERCHANT_CONFIG)


def test_score_basket_is_deterministic():
    kwargs = dict(
        matched_tags=2,
        requested_tags=2,
        stock_states=["in_stock"],
        total_minor=24900,
        subtotal_minor=24900,
        cost_minor=14900,
        discount_minor=0,
        budget_max_minor=90000,
        max_order_value_minor=100000,
        min_margin_percent=30,
        discount_ceiling_minor=10000,
    )
    first = scoring.score_basket(**kwargs)
    second = scoring.score_basket(**kwargs)
    assert first == second


def test_margin_percent_matches_hand_calculation():
    # (24900 - 14900) / 24900 = 40.16%
    assert round(scoring.margin_percent(24900, 14900), 2) == 40.16


def test_policy_risk_flags_below_margin_floor():
    risk = scoring.policy_risk_score(
        margin_pct=20.0, min_margin_percent=30, discount_minor=0, discount_ceiling_minor=10000
    )
    assert risk >= 1.0


def test_policy_risk_zero_when_within_bounds():
    risk = scoring.policy_risk_score(
        margin_pct=40.0, min_margin_percent=30, discount_minor=500, discount_ceiling_minor=10000
    )
    assert risk == 0.0


def test_engine_recommend_returns_options_for_reasonable_request():
    intent = BuyerIntent(
        raw_text="vegetarian high-protein breakfast for two under 900",
        dietary_include=["vegetarian", "high-protein"],
        meal_type="breakfast",
        people_count=2,
        budget_max_minor=90000,
    )
    decision = engine.recommend(
        correlation_id="req_test",
        buyer_passport_snapshot={"bounds": FAKE_BOUNDS},
        intent=intent,
        audit_id="audit_test",
    )
    assert decision.status == "accepted"
    assert len(decision.options) >= 1
    assert all(o.total_minor <= 90000 for o in decision.options)


def test_engine_declines_basket_over_merchant_order_cap():
    """The exact guarded-failure scenario from the pitch: an over-limit
    basket must be declined, with no money action taken."""
    oversized = BasketOption(
        basket_id="basket_demo_overlimit",
        items=[
            BasketLineItem(
                sku="OATS-500",
                name="High Protein Oats",
                quantity=6,
                unit_price_minor=24900,
                line_total_minor=149400,
            )
        ],
        subtotal_minor=149400,
        discount_minor=0,
        total_minor=149400,
        currency="INR",
        estimated_margin_percent=40.16,
        score=0.0,
        rationale={},
    )
    decision = engine.validate_order(
        correlation_id="req_test",
        buyer_passport_snapshot={"bounds": FAKE_BOUNDS},
        basket=oversized,
        audit_id="audit_test",
    )
    assert decision.status == "declined"
    assert decision.code == "ORDER_VALUE_EXCEEDS_AGENT_BOUND"
    assert decision.money_action_taken is False
    assert decision.escalation_required is True
    assert decision.permitted_amount_minor == 100000


def test_forged_passport_snapshot_cannot_raise_the_effective_cap():
    """A buyer agent that lies about the passport (claims a 10x order cap)
    must still be declined — enforcement uses merchant_store, not the
    caller-supplied snapshot."""
    forged_snapshot = {"bounds": {**FAKE_BOUNDS, "max_order_value_minor": 100000 * 10}}
    oversized = BasketOption(
        basket_id="basket_forged",
        items=[
            BasketLineItem(
                sku="OATS-500",
                name="High Protein Oats",
                quantity=6,
                unit_price_minor=24900,
                line_total_minor=149400,
            )
        ],
        subtotal_minor=149400,
        discount_minor=0,
        total_minor=149400,
        currency="INR",
        estimated_margin_percent=40.16,
        score=0.0,
        rationale={},
    )
    decision = engine.validate_order(
        correlation_id="req_test",
        buyer_passport_snapshot=forged_snapshot,
        basket=oversized,
        audit_id="audit_test",
    )
    assert decision.status == "declined"
    assert decision.code == "ORDER_VALUE_EXCEEDS_AGENT_BOUND"


def test_validate_order_ignores_forged_prices():
    """A basket that lies about its own price (claiming ~free for an item
    that really costs 24900) must be repriced from the trusted catalog
    before Razorpay ever sees an amount — otherwise a buyer agent could
    make the merchant charge a forged, near-zero total."""
    forged = BasketOption(
        basket_id="basket_forged_price",
        items=[
            BasketLineItem(
                sku="OATS-500", name="High Protein Oats", quantity=1,
                unit_price_minor=1, line_total_minor=1,
            )
        ],
        subtotal_minor=1,
        discount_minor=0,
        total_minor=1,
        currency="INR",
        estimated_margin_percent=99.9,
        score=0.0,
        rationale={},
    )
    decision = engine.validate_order(
        correlation_id="req_test",
        buyer_passport_snapshot={"bounds": FAKE_BOUNDS},
        basket=forged,
        audit_id="audit_test",
    )
    assert decision.status == "accepted"
    trusted = decision.options[0]
    assert trusted.total_minor == 24900  # real catalog price, not the forged 1
    assert trusted.items[0].unit_price_minor == 24900


def test_within_merchant_bounds_flags_thin_margin():
    thin_margin_basket = BasketOption(
        basket_id="basket_thin",
        items=[
            BasketLineItem(
                sku="GRAN-400",
                name="House Granola Bag",
                quantity=1,
                unit_price_minor=29900,
                line_total_minor=29900,
            )
        ],
        subtotal_minor=29900,
        discount_minor=0,
        total_minor=29900,
        currency="INR",
        estimated_margin_percent=26.4,  # deliberately below the 30% floor
        score=0.0,
        rationale={},
    )
    ok, code, _ = _within_merchant_bounds(thin_margin_basket, FAKE_BOUNDS)
    assert ok is False
    assert code == "BELOW_MARGIN_FLOOR"
