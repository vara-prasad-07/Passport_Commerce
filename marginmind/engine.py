"""
MarginMind decision engine — deterministic, code-only. Filters the catalog,
builds candidate baskets, scores them, and enforces the merchant's bounds.

No LLM call happens anywhere in this file, on purpose. If a rule isn't in
the passport's `bounds` / `policies`, this engine will not honor it no
matter what a buyer agent asks for — that split (LLM reasons and talks,
this file enforces and decides) is the whole safety story of the demo.
"""

from __future__ import annotations

import math
import os
import sys
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shared.ids import new_id  # noqa: E402
from shared.models import BasketLineItem, BasketOption, BuyerIntent, MarginMindDecision  # noqa: E402

from marginmind import merchant_store  # noqa: E402
from marginmind.scoring import margin_percent, score_basket  # noqa: E402

MAX_CANDIDATE_HEROES = 5
BUNDLE_DISCOUNT_RATE = 0.05


def _eligible_items(catalog_items: list[dict], intent: BuyerIntent) -> list[dict]:
    excluded = {t.lower() for t in intent.dietary_exclude}
    eligible = []
    for item in catalog_items:
        if item.get("stock") == "out_of_stock":
            continue
        tags = {t.lower() for t in item.get("tags", [])}
        if excluded & tags:
            continue
        eligible.append(item)
    return eligible


def _requested_tags(intent: BuyerIntent) -> set[str]:
    tags = {t.lower() for t in intent.dietary_include}
    if intent.meal_type:
        tags.add(intent.meal_type.lower())
    return tags


def _tag_overlap(item: dict, requested_tags: set[str]) -> int:
    return len(requested_tags & {t.lower() for t in item.get("tags", [])})


def _generate_candidate_baskets(
    eligible_items: list[dict], intent: BuyerIntent
) -> list[list[tuple[dict, int]]]:
    """Two basket shapes per hero candidate: the hero alone (one unit per
    person), and hero + a declared complement split across servings. Simple
    on purpose — this is a catalog of 8 SKUs for a ten-day build, not a
    general-purpose meal-planner."""
    by_sku = {i["sku"]: i for i in eligible_items}
    requested_tags = _requested_tags(intent)
    people = max(intent.people_count, 1)

    heroes = sorted(eligible_items, key=lambda i: _tag_overlap(i, requested_tags), reverse=True)
    heroes = heroes[:MAX_CANDIDATE_HEROES]

    baskets: list[list[tuple[dict, int]]] = []
    for hero in heroes:
        baskets.append([(hero, people)])

        for comp_sku in hero.get("complements", []):
            comp = by_sku.get(comp_sku)
            if comp is None or comp["sku"] == hero["sku"]:
                continue
            hero_qty = max(math.ceil(people / 2), 1)
            comp_qty = max(people - hero_qty, 1)
            baskets.append([(hero, hero_qty), (comp, comp_qty)])
    return baskets


def _build_basket_option(
    lines: list[tuple[dict, int]],
    bounds: dict,
    cost_by_sku: dict[str, int],
    intent: BuyerIntent,
) -> BasketOption:
    currency = lines[0][0]["currency"] if lines else intent.currency

    line_items = [
        BasketLineItem(
            sku=item["sku"],
            name=item["name"],
            quantity=qty,
            unit_price_minor=item["price_minor"],
            line_total_minor=item["price_minor"] * qty,
        )
        for item, qty in lines
    ]
    subtotal_minor = sum(li.line_total_minor for li in line_items)
    # Cost basis comes ONLY from MarginMind's own trusted merchant store —
    # never from the public catalog, which never carries cost_minor at all.
    cost_minor = sum(cost_by_sku.get(item["sku"], item["price_minor"]) * qty for item, qty in lines)

    discount_minor = 0
    if len(line_items) >= 2:
        cheapest_line = min(li.line_total_minor for li in line_items)
        discount_minor = min(
            round(cheapest_line * BUNDLE_DISCOUNT_RATE), bounds["discount_ceiling_minor"]
        )

    total_minor = subtotal_minor - discount_minor

    requested_tags = _requested_tags(intent)
    matched_tags = len(
        requested_tags & {t.lower() for item, _ in lines for t in item.get("tags", [])}
    )

    result = score_basket(
        matched_tags=matched_tags,
        requested_tags=len(requested_tags),
        stock_states=[item["stock"] for item, _ in lines],
        total_minor=total_minor,
        subtotal_minor=subtotal_minor,
        cost_minor=cost_minor,
        discount_minor=discount_minor,
        budget_max_minor=intent.budget_max_minor,
        max_order_value_minor=bounds["max_order_value_minor"],
        min_margin_percent=bounds["min_margin_percent"],
        discount_ceiling_minor=bounds["discount_ceiling_minor"],
    )

    rationale = {
        **result["components"],
        "matched_tags": matched_tags,
        "requested_tags": len(requested_tags),
        "bundle_discount_applied_minor": discount_minor,
    }

    return BasketOption(
        basket_id=new_id("basket"),
        items=line_items,
        subtotal_minor=subtotal_minor,
        discount_minor=discount_minor,
        total_minor=total_minor,
        currency=currency,
        estimated_margin_percent=result["margin_percent"],
        score=result["score"],
        rationale=rationale,
    )


def _basket_signature(basket: BasketOption) -> tuple:
    return tuple(sorted((li.sku, li.quantity) for li in basket.items))


def _within_merchant_bounds(
    basket: BasketOption, bounds: dict
) -> tuple[bool, Optional[str], Optional[str]]:
    """The single source of truth for "is this basket safe to sell", used
    both when ranking recommendations and as the last gate before payment."""
    if basket.currency not in bounds["allowed_currencies"]:
        return False, "CURRENCY_NOT_ALLOWED", f"{basket.currency} is not an allowed currency for this merchant."
    if basket.total_minor > bounds["max_order_value_minor"]:
        cap = bounds["max_order_value_minor"] / 100
        return (
            False,
            "ORDER_VALUE_EXCEEDS_AGENT_BOUND",
            f"This agent may create autonomous orders only up to ₹{cap:.0f}.",
        )
    if basket.discount_minor > bounds["discount_ceiling_minor"]:
        return False, "DISCOUNT_EXCEEDS_CEILING", "Applied discount exceeds the merchant's discount ceiling."
    if basket.estimated_margin_percent < bounds["min_margin_percent"]:
        return False, "BELOW_MARGIN_FLOOR", "This basket would sell below the merchant's minimum margin floor."
    return True, None, None


def passport_bounds_match(buyer_passport_snapshot: dict, merchant_config: dict) -> bool:
    """Cross-check only — NEVER used for enforcement. If a buyer agent's
    verified passport snapshot disagrees with the merchant's current
    internal config (e.g. it cached an old version, or was tampered with
    upstream of signing), we still enforce off our own config, but we flag
    the mismatch in the audit trail rather than silently ignoring it."""
    try:
        return dict(buyer_passport_snapshot.get("bounds", {})) == dict(merchant_config.get("bounds", {}))
    except (TypeError, AttributeError):
        return False


def recommend(
    *,
    correlation_id: str,
    buyer_passport_snapshot: dict,
    intent: BuyerIntent,
    audit_id: str,
    merchant_id: Optional[str] = None,
) -> MarginMindDecision:
    """Buyer-facing recommendation. Only ever returns baskets that are
    ALREADY safe under the merchant's bounds — MarginMind should never
    recommend something it would reject a moment later at `validate_order`.

    `buyer_passport_snapshot` is the buyer agent's own verified copy of the
    public passport — used only to cross-check for drift and for audit
    logging. Every number used for actual decisioning (bounds, catalog,
    cost) comes from `merchant_store`, MarginMind's own trusted config,
    never from this parameter. A buyer-stated budget is a *soft*
    preference: if nothing merchant-safe fits it, we decline with a reason
    the negotiator can act on (try smaller / substitute), not a hard bound
    violation.
    """
    merchant_config = merchant_store.load_merchant_config(merchant_id)
    bounds = merchant_config["bounds"]
    cost_by_sku = {i["sku"]: i.get("cost_minor", i["price_minor"]) for i in merchant_config["catalog"]["items"]}
    catalog_items = merchant_config["catalog"]["items"]

    eligible = _eligible_items(catalog_items, intent)
    if not eligible:
        return MarginMindDecision(
            status="declined",
            code="NO_ITEMS_MATCH_CRITERIA",
            message="No catalog items satisfy the buyer's dietary constraints right now.",
            audit_id=audit_id,
            correlation_id=correlation_id,
        )

    candidate_lines = _generate_candidate_baskets(eligible, intent)

    built: list[BasketOption] = []
    seen_signatures: set[tuple] = set()
    for lines in candidate_lines:
        option = _build_basket_option(lines, bounds, cost_by_sku, intent)
        sig = _basket_signature(option)
        if sig in seen_signatures:
            continue
        seen_signatures.add(sig)
        built.append(option)

    merchant_safe = [b for b in built if _within_merchant_bounds(b, bounds)[0]]
    if not merchant_safe:
        return MarginMindDecision(
            status="declined",
            code="NO_BASKET_WITHIN_MERCHANT_BOUNDS",
            message="Every combination available right now would breach the merchant's margin, discount, or order-value rules.",
            audit_id=audit_id,
            correlation_id=correlation_id,
        )

    if intent.budget_max_minor:
        within_budget = [b for b in merchant_safe if b.total_minor <= intent.budget_max_minor]
    else:
        within_budget = merchant_safe

    if not within_budget:
        cheapest = min(merchant_safe, key=lambda b: b.total_minor)
        return MarginMindDecision(
            status="declined",
            code="NO_BASKET_WITHIN_BUYER_BUDGET",
            message=(
                f"Cheapest available option is ₹{cheapest.total_minor / 100:.2f}, "
                f"above the buyer's stated budget of ₹{intent.budget_max_minor / 100:.2f}."
            ),
            options=[cheapest],
            audit_id=audit_id,
            correlation_id=correlation_id,
        )

    ranked = sorted(within_budget, key=lambda b: b.score, reverse=True)[:2]
    return MarginMindDecision(
        status="accepted",
        options=ranked,
        audit_id=audit_id,
        correlation_id=correlation_id,
    )


def _reprice_from_catalog(basket: BasketOption, merchant_config: dict) -> BasketOption:
    """Recompute every money-relevant field from the merchant's own trusted
    catalog and cost data, using only the (sku, quantity) pairs from the
    incoming basket. Whatever a caller claimed for unit_price_minor,
    subtotal_minor, total_minor, or estimated_margin_percent is discarded
    and rebuilt from scratch here — this is what makes it safe to call
    `validate_order` with a basket that arrived over the network. Without
    this, a buyer agent could forge a near-zero price on an expensive SKU
    and have Razorpay charge the forged amount instead of the real one.
    """
    bounds = merchant_config["bounds"]
    catalog_by_sku = {i["sku"]: i for i in merchant_config["catalog"]["items"]}
    cost_by_sku = {i["sku"]: i.get("cost_minor", i["price_minor"]) for i in merchant_config["catalog"]["items"]}

    line_items = []
    for line in basket.items:
        catalog_item = catalog_by_sku.get(line.sku)
        if catalog_item is None:
            raise ValueError(f"unknown SKU: {line.sku}")
        unit_price = catalog_item["price_minor"]
        line_items.append(
            BasketLineItem(
                sku=line.sku,
                name=catalog_item["name"],
                quantity=line.quantity,
                unit_price_minor=unit_price,
                line_total_minor=unit_price * line.quantity,
            )
        )

    subtotal_minor = sum(li.line_total_minor for li in line_items)
    cost_minor = sum(cost_by_sku.get(li.sku, li.unit_price_minor) * li.quantity for li in line_items)

    discount_minor = 0
    if len(line_items) >= 2:
        cheapest_line = min(li.line_total_minor for li in line_items)
        discount_minor = min(round(cheapest_line * BUNDLE_DISCOUNT_RATE), bounds["discount_ceiling_minor"])

    total_minor = subtotal_minor - discount_minor
    currency = catalog_by_sku[line_items[0].sku]["currency"] if line_items else basket.currency

    return basket.model_copy(
        update={
            "items": line_items,
            "subtotal_minor": subtotal_minor,
            "discount_minor": discount_minor,
            "total_minor": total_minor,
            "currency": currency,
            "estimated_margin_percent": round(margin_percent(subtotal_minor, cost_minor), 2),
        }
    )


def validate_order(
    *,
    correlation_id: str,
    buyer_passport_snapshot: dict,
    basket: BasketOption,
    audit_id: str,
    merchant_id: Optional[str] = None,
) -> MarginMindDecision:
    """The last-line-of-defense gate, re-run right before any money action,
    using bounds AND prices freshly loaded from `merchant_store` — never
    from `basket` or `buyer_passport_snapshot`, both of which a caller
    fully controls. This is also the endpoint the "over-limit buyer agent"
    demo calls directly with a deliberately oversized basket — it is not a
    separate fake code path, it is the real gate.
    """
    merchant_config = merchant_store.load_merchant_config(merchant_id)
    bounds = merchant_config["bounds"]

    try:
        trusted_basket = _reprice_from_catalog(basket, merchant_config)
    except ValueError as exc:
        return MarginMindDecision(
            status="declined",
            code="UNKNOWN_SKU",
            message=str(exc),
            money_action_taken=False,
            escalation_required=True,
            audit_id=audit_id,
            correlation_id=correlation_id,
        )

    ok, code, message = _within_merchant_bounds(trusted_basket, bounds)
    if not ok:
        return MarginMindDecision(
            status="declined",
            code=code,
            message=message,
            requested_amount_minor=trusted_basket.total_minor,
            permitted_amount_minor=bounds["max_order_value_minor"],
            money_action_taken=False,
            escalation_required=True,
            audit_id=audit_id,
            correlation_id=correlation_id,
        )
    return MarginMindDecision(
        status="accepted",
        options=[trusted_basket],
        requested_amount_minor=trusted_basket.total_minor,
        permitted_amount_minor=bounds["max_order_value_minor"],
        money_action_taken=False,
        escalation_required=False,
        audit_id=audit_id,
        correlation_id=correlation_id,
    )
