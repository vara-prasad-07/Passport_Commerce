"""
Deterministic, unit-testable scoring for MarginMind baskets.

Nothing in this file calls an LLM. The score is a pure function of a basket
and the merchant's bounds — same inputs always produce the same output. That
is the entire point: the buyer-facing explanation ("I recommend Basket B
because...") is generated *from* this breakdown, not invented alongside it.

    score = buyer_fit + availability + expected_conversion + basket_value
            + merchant_margin - discount_cost - policy_risk

(weighted; weights below). See test_scoring.py for the guarantees this file
makes: determinism, and correct margin-floor / discount-ceiling flagging.
"""

from __future__ import annotations

from typing import Optional

WEIGHTS = {
    "buyer_fit": 3.0,
    "availability": 1.5,
    "expected_conversion": 1.5,
    "basket_value": 1.0,
    "merchant_margin": 2.0,
    "discount_cost": 1.0,
    "policy_risk": 5.0,
}


def buyer_fit_score(matched_tags: int, requested_tags: int) -> float:
    if requested_tags <= 0:
        return 1.0
    return min(matched_tags / requested_tags, 1.0)


def availability_score(stock_states: list[str]) -> float:
    if any(s == "out_of_stock" for s in stock_states):
        return 0.0
    if any(s == "low_stock" for s in stock_states):
        return 0.5
    return 1.0


def expected_conversion_score(total_minor: int, budget_max_minor: Optional[int]) -> float:
    """How well the basket uses a stated budget without either blowing past
    it or leaving it awkwardly under-used. Neutral (0.75) when no budget was
    stated at all."""
    if not budget_max_minor or budget_max_minor <= 0:
        return 0.75
    if total_minor > budget_max_minor:
        return 0.0
    utilization = total_minor / budget_max_minor
    return max(0.0, 1.0 - abs(0.85 - utilization))


def basket_value_score(total_minor: int, max_order_value_minor: int) -> float:
    if max_order_value_minor <= 0:
        return 0.0
    return min(total_minor / max_order_value_minor, 1.0)


def margin_percent(subtotal_minor: int, cost_minor: int) -> float:
    if subtotal_minor <= 0:
        return 0.0
    return ((subtotal_minor - cost_minor) / subtotal_minor) * 100.0


def discount_cost_score(discount_minor: int, subtotal_minor: int) -> float:
    if subtotal_minor <= 0:
        return 0.0
    return discount_minor / subtotal_minor


def policy_risk_score(
    margin_pct: float,
    min_margin_percent: float,
    discount_minor: int,
    discount_ceiling_minor: int,
) -> float:
    """Non-zero only when a basket sits outside merchant bounds. `engine.py`
    hard-filters these baskets out before they ever reach a buyer, but the
    penalty stays here too so scoring alone never *ranks* an unsafe basket
    highly, even if a caller forgets to filter."""
    risk = 0.0
    if margin_pct < min_margin_percent:
        risk += 1.0
    if discount_minor > discount_ceiling_minor:
        risk += 1.0
    return risk


def score_basket(
    *,
    matched_tags: int,
    requested_tags: int,
    stock_states: list[str],
    total_minor: int,
    subtotal_minor: int,
    cost_minor: int,
    discount_minor: int,
    budget_max_minor: Optional[int],
    max_order_value_minor: int,
    min_margin_percent: float,
    discount_ceiling_minor: int,
) -> dict:
    """Pure function: same inputs -> same output, always. Returns the full
    component breakdown alongside the final weighted score so the
    explanation layer has something real to point at."""
    m_pct = margin_percent(subtotal_minor, cost_minor)
    components = {
        "buyer_fit": buyer_fit_score(matched_tags, requested_tags),
        "availability": availability_score(stock_states),
        "expected_conversion": expected_conversion_score(total_minor, budget_max_minor),
        "basket_value": basket_value_score(total_minor, max_order_value_minor),
        "merchant_margin": m_pct / 100.0,
        "discount_cost": discount_cost_score(discount_minor, subtotal_minor),
        "policy_risk": policy_risk_score(m_pct, min_margin_percent, discount_minor, discount_ceiling_minor),
    }
    score = (
        WEIGHTS["buyer_fit"] * components["buyer_fit"]
        + WEIGHTS["availability"] * components["availability"]
        + WEIGHTS["expected_conversion"] * components["expected_conversion"]
        + WEIGHTS["basket_value"] * components["basket_value"]
        + WEIGHTS["merchant_margin"] * components["merchant_margin"]
        - WEIGHTS["discount_cost"] * components["discount_cost"]
        - WEIGHTS["policy_risk"] * components["policy_risk"]
    )
    return {
        "score": round(score, 4),
        "margin_percent": round(m_pct, 2),
        "components": {k: round(v, 4) for k, v in components.items()},
    }
