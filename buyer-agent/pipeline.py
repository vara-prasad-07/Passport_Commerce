"""
The buyer agent's pipeline, expressed once, as a traced sequence of hops.

Every step below is wrapped in `tracer.hop(...)`, which does three things at
the same moment the step actually runs: pushes an event to whoever is
streaming (the dashboard's orchestration canvas), records the real elapsed
time, and appends an audit row. There is no second, "for the animation"
version of this pipeline — the canvas is a rendering of these calls, and if a
call is removed from here it disappears from the canvas automatically.

Order matters and is not arbitrary:

    1. understand the request, or stop           (a model, classifying + parsing)
    2. verify the merchant's passport            (crypto — before any merchant use)
    3. apply the BUYER's own risk policy         (buyer-side, deterministic)
    4. check the merchant serves the region      (deterministic)
    5. ask MarginMind for a basket               (merchant-side, deterministic)
    6. negotiate on soft preferences if declined (a model, bounded)
    7. neutralise untrusted catalog text         (deterministic)
    8. explain the final decision                (a model, narrating only)
    9. stop and wait for explicit consent

Step 1 is first because reading what the BUYER said involves no merchant trust,
and an off-topic message should cost one hop rather than a passport fetch, a
policy evaluation and a decision engine. Everything that touches the merchant
still happens after verification, which is the property that matters.

Steps 1, 6 and 8 are the only ones that involve a model, and none of them can
change a number — that is the shape the whole project is arguing for, and
putting it in one readable list is half the reason this module exists.
"""

from __future__ import annotations

import os
import sys
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shared.models import BasketOption, BuyerIntent, MarginMindDecision  # noqa: E402

import config  # noqa: E402
import explainer  # noqa: E402
import intent_parser  # noqa: E402
import marginmind_client  # noqa: E402
import negotiator  # noqa: E402
import passport_client  # noqa: E402
import risk_policy  # noqa: E402
import sanitize  # noqa: E402
from trace import (  # noqa: E402
    ENGINE_CODE,
    ENGINE_CRYPTO,
    ENGINE_LLM,
    ENGINE_MONEY,
    ENGINE_POLICY,
    NODE_BUYER,
    NODE_LLM,
    NODE_MARGINMIND,
    NODE_PASSPORT,
    NODE_POLICY,
    NODE_RAZORPAY,
    NODE_REGISTRY,
    Tracer,
)

# basket_id -> {basket, merchant_id}. Populated by a query, consumed by a
# confirm. In-memory on purpose and consistent with the in-memory order store:
# a durable basket cache would imply a database this MVP deliberately does not
# have, and the confirm path re-prices from the trusted catalog anyway, so a
# stale cache entry cannot become a wrong charge.
#
# The merchant id is stored WITH the basket rather than accepted from the
# client at confirm time. With more than one merchant that distinction is
# load-bearing: a caller who could name the merchant could ask for merchant
# A's basket to be repriced against merchant B's catalog. Binding it here
# means the basket carries its own origin and the client cannot restate it.
BASKET_CACHE: dict[str, dict] = {}


def remember_basket(basket: BasketOption, merchant_id: Optional[str] = None) -> None:
    BASKET_CACHE[basket.basket_id] = {"basket": basket, "merchant_id": merchant_id}


def recall_basket(basket_id: str) -> tuple[Optional[BasketOption], Optional[str]]:
    entry = BASKET_CACHE.get(basket_id)
    if entry is None:
        return None, None
    return entry["basket"], entry["merchant_id"]

# Declines a negotiator is allowed to respond to. Both are BUYER-side reasons
# ("nothing fits your budget", "nothing matches your criteria"). Merchant-side
# declines are absent from this set by design — there is nothing to negotiate
# about a margin floor, and letting a model retry against one would be exactly
# the overreach the architecture exists to prevent.
NEGOTIABLE_CODES = {"NO_BASKET_WITHIN_BUYER_BUDGET", "NO_ITEMS_MATCH_CRITERIA"}


class PipelineStop(Exception):
    """A step ended the run in a well-defined, expected way (untrusted
    passport, policy refusal, region not served). Carries the full response
    the caller should return. Distinct from an unexpected failure, which
    propagates as itself."""

    def __init__(self, payload: dict):
        super().__init__(payload.get("message", "pipeline stopped"))
        self.payload = payload


# ---------------------------------------------------------------------------
# shared steps
# ---------------------------------------------------------------------------


def verify_passport(tracer: Tracer, *, merchant_id: Optional[str] = None) -> dict:
    """Fetch and verify the merchant passport, tracing it as a real hop."""
    with tracer.hop(
        src=NODE_BUYER,
        dst=NODE_PASSPORT,
        label="verify passport",
        engine=ENGINE_CRYPTO,
        protocol="HTTPS · Ed25519",
        payload={"merchant_id": merchant_id or "greenbowl", "checks": ["signature", "freshness"]},
        audit="passport_verified",
    ) as hop:
        result = passport_client.fetch_and_verify_passport(merchant_id=merchant_id)
        passport = result["passport"]
        integrity = passport.get("integrity", {})

        if not result["trusted"]:
            hop.blocked(
                code="PASSPORT_NOT_TRUSTED",
                summary=result["signature_reason"] if not result["signature_ok"] else result["freshness_reason"],
                reply={
                    "trusted": False,
                    "signature_ok": result["signature_ok"],
                    "freshness_ok": result["freshness_ok"],
                },
            )
            raise PipelineStop(
                {
                    "stage": "passport_rejected",
                    "passport_verification": result,
                    "message": "The merchant's passport failed verification, so no basket was requested.",
                }
            )

        hop.ok(
            summary=f"{passport['merchant']['name']} · {result['freshness_reason']}",
            reply={
                "passport_id": passport.get("passport_id"),
                "version": passport.get("version"),
                "merchant": passport.get("merchant"),
                "bounds": passport.get("bounds"),
                "catalog_items": len(passport.get("catalog", {}).get("items", [])),
                "integrity": {
                    "signature_algorithm": integrity.get("signature_algorithm"),
                    "payload_sha256": integrity.get("payload_sha256"),
                    "signature": integrity.get("signature"),
                },
            },
            detail={"passport_id": passport.get("passport_id"), "version": passport.get("version")},
        )
    return result


def apply_risk_policy(
    tracer: Tracer,
    verification: dict,
    *,
    intended_spend_minor: Optional[int] = None,
    stage_on_fail: str = "policy_refused",
) -> dict:
    """Run the buyer's own risk policy against the verified passport.

    Deliberately a hop to its own node rather than an invisible function call:
    a buyer refusing a cryptographically valid merchant is the single least
    obvious idea in this product, and it needs to be something you can watch
    happen and click on.
    """
    with tracer.hop(
        src=NODE_BUYER,
        dst=NODE_POLICY,
        label="buyer risk policy",
        engine=ENGINE_POLICY,
        protocol="local · deterministic",
        payload={
            "policy": risk_policy.load_policy(),
            "intended_spend_minor": intended_spend_minor,
        },
        audit="buyer_policy_evaluated",
    ) as hop:
        verdict = risk_policy.evaluate(
            verification["passport"], verification, intended_spend_minor=intended_spend_minor
        )
        if not verdict["passed"]:
            hop.blocked(
                code="BUYER_POLICY_REFUSED",
                summary=verdict["summary"],
                reply=verdict,
            )
            raise PipelineStop(
                {
                    "stage": stage_on_fail,
                    "status": "declined",
                    "code": "BUYER_POLICY_REFUSED",
                    "policy": verdict,
                    "money_action_taken": False,
                    "escalation_required": True,
                    "message": (
                        "This merchant's passport is valid and signed, but it does not satisfy "
                        f"the buyer agent's own risk policy — {verdict['summary']}."
                    ),
                }
            )
        hop.ok(summary=verdict["summary"], reply=verdict)
    return verdict


# ---------------------------------------------------------------------------
# query
# ---------------------------------------------------------------------------


def run_query(tracer: Tracer, message: str, *, merchant_id: Optional[str] = None) -> dict:
    """The full buyer query, from free text to a basket awaiting consent."""
    tracer.run_start(label="Buyer query", detail={"message": message})

    try:
        # --- understand the request (a model, producing a request) ---
        #
        # Deliberately BEFORE the merchant is contacted. Reading what the buyer
        # said involves no merchant trust, and putting it first means an
        # off-topic message costs one hop instead of fetching a passport,
        # running a policy and waking a decision engine for nothing. Merchant
        # verification still happens before any merchant interaction, which is
        # the property that actually matters.
        intent = _understand(tracer, message)

        passport_result = verify_passport(tracer, merchant_id=merchant_id)
        passport = passport_result["passport"]

        policy_verdict = apply_risk_policy(tracer, passport_result)

        # --- region check (deterministic, buyer-agent local) ---
        service_regions = passport.get("merchant", {}).get("service_regions", [])
        if intent.region and service_regions and intent.region not in service_regions:
            with tracer.hop(
                src=NODE_BUYER,
                dst=NODE_BUYER,
                label="region check",
                engine=ENGINE_CODE,
                protocol="local · deterministic",
                payload={"requested_region": intent.region, "service_regions": service_regions},
                audit="region_not_served",
            ) as hop:
                hop.blocked(
                    code="REGION_NOT_SERVED",
                    summary=f"merchant serves {', '.join(service_regions)}, not {intent.region}",
                )
            raise PipelineStop(
                {
                    "stage": "region_not_served",
                    "passport_verification": _verification_summary(passport_result),
                    "policy": policy_verdict,
                    "intent": intent.model_dump(),
                    "message": (
                        f"{passport['merchant']['name']} serves {', '.join(service_regions)}, "
                        f"not {intent.region} — no basket was requested."
                    ),
                }
            )

        # --- MarginMind (merchant-side, deterministic, over a real HTTP hop) ---
        with tracer.hop(
            src=NODE_BUYER,
            dst=NODE_MARGINMIND,
            label="ask MarginMind",
            engine=ENGINE_CODE,
            protocol="POST :8002/marginmind/recommend",
            payload={"intent": intent.model_dump()},
        ) as hop:
            decision = marginmind_client.recommend(
                correlation_id=tracer.correlation_id,
                intent=intent,
                buyer_passport_snapshot=passport,
                merchant_id=merchant_id,
            )
            if decision.status == "accepted":
                hop.ok(
                    summary=f"{len(decision.options)} basket(s) ranked, all within the merchant's own bounds",
                    reply=decision.model_dump(),
                )
            else:
                hop.blocked(
                    code=decision.code or "DECLINED",
                    summary=decision.message or "declined",
                    reply=decision.model_dump(),
                )

        # --- negotiation (a model, bounded, buyer-side preferences only) ---
        negotiation_outcome = None
        if decision.status == "declined" and decision.code in NEGOTIABLE_CODES:
            decision, negotiation_outcome = _negotiate(
                tracer, intent, passport, decision, merchant_id=merchant_id
            )

        for basket in decision.options:
            remember_basket(basket, merchant_id)

        # --- neutralise untrusted catalog text before it reaches a model ---
        decision_payload = decision.model_dump()
        safe_payload, injection_findings = sanitize.clean_basket_payload(decision_payload)
        if injection_findings:
            with tracer.hop(
                src=NODE_BUYER,
                dst=NODE_BUYER,
                label="sanitise catalog text",
                engine=ENGINE_CODE,
                protocol="local · deterministic",
                payload={"findings": injection_findings},
                audit="prompt_injection_neutralised",
            ) as hop:
                kinds = sorted({k for f in injection_findings for k in f["kinds"]})
                hop.blocked(
                    code="PROMPT_INJECTION_NEUTRALISED",
                    summary=(
                        f"{len(injection_findings)} instruction-shaped string(s) in the merchant's "
                        f"catalog were defanged before any model saw them ({', '.join(kinds)})"
                    ),
                    reply={"findings": injection_findings},
                )

        # --- explanation (a model, narrating numbers that already exist) ---
        explanation = _explain(tracer, decision, safe_payload, intent)

        stage = "declined" if decision.status == "declined" else "ready_for_consent"
        result = {
            "stage": stage,
            "passport_verification": _verification_summary(passport_result),
            "policy": policy_verdict,
            "intent": intent.model_dump(),
            "decision": decision_payload,
            "negotiation": negotiation_outcome,
            "explanation": explanation,
            "injection_findings": injection_findings,
        }
        tracer.run_end(stage=stage, result=result)
        return {"correlation_id": tracer.correlation_id, **result}

    except PipelineStop as stop:
        tracer.run_end(stage=stop.payload.get("stage", "stopped"), result=stop.payload)
        return {"correlation_id": tracer.correlation_id, **stop.payload}


def _understand(tracer: Tracer, message: str) -> BuyerIntent:
    """Classify and parse in one call, and stop the run if this isn't shopping.

    The classification is the model's, but the decision to stop is a plain
    boolean check in this function — the same division as everywhere else in
    the pipeline. A model saying "not a purchase request" is a suggestion; the
    `if` below is what actually halts anything.
    """
    with tracer.hop(
        src=NODE_BUYER,
        dst=NODE_LLM,
        label="understand request",
        engine=ENGINE_LLM,
        protocol=f"Groq · {config.GROQ_MODEL}",
        payload={"raw_text": message},
        audit="intent_parsed",
    ) as hop:
        try:
            intent = intent_parser.parse_intent(message)
        except Exception as exc:  # noqa: BLE001 - adapter boundary for any Groq/LangChain failure
            hop.failed(summary=f"Groq call failed: {exc}", code="LLM_CALL_FAILED")
            raise

        if not intent.is_purchase_request:
            hop.blocked(
                code="NOT_A_PURCHASE_REQUEST",
                summary="not a shopping request — no merchant was contacted",
                reply={"off_topic_reply": intent.off_topic_reply, "raw_text": intent.raw_text},
            )
            raise PipelineStop(
                {
                    "stage": "not_a_purchase_request",
                    "status": "declined",
                    "code": "NOT_A_PURCHASE_REQUEST",
                    "message": intent.off_topic_reply,
                    "money_action_taken": False,
                }
            )

        hop.ok(
            summary="free text became typed constraints — a request, never a decision",
            reply=intent.model_dump(),
        )
    return intent


def _verification_summary(passport_result: dict) -> dict:
    return {
        "trusted": passport_result["trusted"],
        "signature_ok": passport_result["signature_ok"],
        "signature_reason": passport_result["signature_reason"],
        "freshness_ok": passport_result["freshness_ok"],
        "freshness_reason": passport_result["freshness_reason"],
    }


def _negotiate(
    tracer: Tracer,
    intent: BuyerIntent,
    passport: dict,
    first_decision: MarginMindDecision,
    *,
    merchant_id: Optional[str] = None,
) -> tuple[MarginMindDecision, Optional[dict]]:
    """Run the bounded negotiator, tracing each retry it makes as its own hop.

    Tracing the individual retries rather than the negotiation as a whole is
    the point: watching the agent bounce off MarginMind two or three times and
    then stop is a far better argument than a single box saying "negotiated",
    because the thing worth seeing is that it never gets through by trying
    harder.
    """

    def on_attempt(attempt: int, adjusted: BuyerIntent, decision: MarginMindDecision) -> None:
        with tracer.hop(
            src=NODE_LLM,
            dst=NODE_MARGINMIND,
            label=f"retry #{attempt} with relaxed preferences",
            engine=ENGINE_CODE,
            protocol="POST :8002/marginmind/recommend",
            payload={"intent": adjusted.model_dump()},
        ) as hop:
            if decision.status == "accepted":
                hop.ok(summary=f"accepted — {len(decision.options)} option(s)", reply=decision.model_dump())
            else:
                hop.blocked(
                    code=decision.code or "DECLINED",
                    summary=decision.message or "declined again",
                    reply=decision.model_dump(),
                )

    with tracer.hop(
        src=NODE_BUYER,
        dst=NODE_LLM,
        label="negotiate",
        engine=ENGINE_LLM,
        protocol=f"Groq · tool-calling agent · max {config.NEGOTIATION_MAX_ATTEMPTS} attempts",
        payload={
            "declined_code": first_decision.code,
            "declined_message": first_decision.message,
            "may_relax": ["dietary_include (non-identity tags)", "meal_type"],
            "may_never_relax": ["budget_max_minor", "people_count", "dietary_exclude", "any merchant bound"],
        },
        audit="negotiation_run",
    ) as hop:
        try:
            outcome, negotiated = negotiator.negotiate(
                correlation_id=tracer.correlation_id,
                intent=intent,
                buyer_passport_snapshot=passport,
                first_decision=first_decision,
                on_attempt=on_attempt,
                merchant_id=merchant_id,
            )
        except Exception as exc:  # noqa: BLE001 - negotiation is a best-effort layer over an already-valid decline
            hop.failed(summary=f"negotiation failed: {exc}")
            return first_decision, None

        won = outcome.final_status == "accepted" and negotiated is not None and negotiated.status == "accepted"
        if won:
            hop.ok(
                summary=f"{outcome.attempts_made} attempt(s) — relaxed {', '.join(outcome.relaxed_constraints) or 'nothing'}",
                reply=outcome.model_dump(),
            )
            return negotiated, outcome.model_dump()

        hop.blocked(
            code="NEGOTIATION_GAVE_UP",
            summary=(
                f"{outcome.attempts_made} attempt(s), then gave up cleanly — it may relax a soft "
                "preference, never a merchant bound"
            ),
            reply=outcome.model_dump(),
        )
        return first_decision, outcome.model_dump()


def _explain(tracer: Tracer, decision: MarginMindDecision, safe_payload: dict, intent: BuyerIntent) -> str:
    with tracer.hop(
        src=NODE_BUYER,
        dst=NODE_LLM,
        label="explain result",
        engine=ENGINE_LLM,
        protocol=f"Groq · {config.GROQ_EXPLAIN_MODEL}",
        payload={"decision": safe_payload, "intent": intent.model_dump()},
        audit="decision_explained",
    ) as hop:
        try:
            explanation = explainer.explain_decision(decision, intent)
            hop.ok(summary="narrates numbers that already exist — it cannot change one", reply={"text": explanation})
            return explanation
        except Exception as exc:  # noqa: BLE001 - explanation is UX-only, never block the pipeline on it
            fallback = decision.message or "Here are the results of your request."
            hop.failed(summary=f"explainer unavailable ({exc}) — falling back to the decision's own message")
            return fallback


# ---------------------------------------------------------------------------
# cross-merchant sourcing
# ---------------------------------------------------------------------------


def run_compare(tracer: Tracer, message: str, merchant_ids: list[str]) -> dict:
    """Take one buyer request to several merchants and let them quote.

    This is the passport idea doing the thing a passport is FOR. Each merchant
    is verified against its own key, judged against the buyer's own policy,
    and asked for a basket by its own MarginMind — and a merchant that fails
    verification or policy is reported as failing rather than quietly dropped,
    because a registry you cannot audit is not worth having.

    The intent is parsed once and carried to every merchant unchanged, so the
    comparison is between merchants rather than between paraphrases of the
    request.
    """
    tracer.run_start(label="Cross-merchant sourcing", detail={"message": message, "merchants": merchant_ids})

    with tracer.hop(
        src=NODE_BUYER,
        dst=NODE_REGISTRY,
        label=f"resolve {len(merchant_ids)} merchants",
        engine=ENGINE_CODE,
        protocol="registry lookup",
        payload={"merchant_ids": merchant_ids},
        audit="registry_resolved",
    ) as hop:
        hop.ok(summary=f"{len(merchant_ids)} merchant passports to verify, each against its own key")

    # --- verify every merchant, independently ---
    verified: dict[str, dict] = {}
    rejected: list[dict] = []
    for merchant_id in merchant_ids:
        try:
            result = passport_client.fetch_and_verify_passport(merchant_id)
        except passport_client.PassportFetchError as exc:
            rejected.append({"merchant_id": merchant_id, "reason": str(exc), "stage": "unreachable"})
            continue

        passport = result["passport"]
        name = passport.get("merchant", {}).get("name", merchant_id)

        with tracer.hop(
            src=NODE_BUYER,
            dst=NODE_PASSPORT,
            label=f"verify {name}",
            engine=ENGINE_CRYPTO,
            protocol=f"HTTPS · Ed25519 · key {result.get('key_id')}",
            payload={"merchant_id": merchant_id, "passport_url": result.get("passport_url")},
            audit="passport_verified",
        ) as hop:
            if not result["trusted"]:
                hop.blocked(
                    code="PASSPORT_NOT_TRUSTED",
                    summary=result["signature_reason"] if not result["signature_ok"] else result["freshness_reason"],
                )
                rejected.append(
                    {"merchant_id": merchant_id, "name": name, "reason": result["signature_reason"], "stage": "signature"}
                )
                continue
            hop.ok(summary=f"{name} · {result['freshness_reason']}", reply={"bounds": passport.get("bounds")})

        # Each merchant faces the same buyer policy. One passing tells you
        # nothing about another — that independence is the point.
        verdict = risk_policy.evaluate(passport, result)
        with tracer.hop(
            src=NODE_BUYER,
            dst=NODE_POLICY,
            label=f"policy check · {name}",
            engine=ENGINE_POLICY,
            protocol="local · deterministic",
            payload={"merchant_id": merchant_id},
            audit="buyer_policy_evaluated",
        ) as hop:
            if not verdict["passed"]:
                hop.blocked(code="BUYER_POLICY_REFUSED", summary=f"{name}: {verdict['summary']}", reply=verdict)
                rejected.append({"merchant_id": merchant_id, "name": name, "reason": verdict["summary"], "stage": "policy"})
                continue
            hop.ok(summary=f"{name}: {verdict['summary']}", reply=verdict)

        verified[merchant_id] = {"result": result, "name": name, "policy": verdict}

    if not verified:
        payload = {
            "stage": "no_trusted_merchant",
            "rejected": rejected,
            "message": "No merchant in the registry passed both verification and the buyer's own policy.",
        }
        tracer.run_end(stage="no_trusted_merchant", result=payload)
        return {"correlation_id": tracer.correlation_id, **payload}

    # --- parse the request once ---
    with tracer.hop(
        src=NODE_BUYER,
        dst=NODE_LLM,
        label="parse intent → typed filter",
        engine=ENGINE_LLM,
        protocol=f"Groq · {config.GROQ_MODEL}",
        payload={"raw_text": message},
        audit="intent_parsed",
    ) as hop:
        intent = intent_parser.parse_intent(message)
        # Same gate as the single-merchant path. Sourcing an off-topic message
        # across a registry would waste every merchant's decision engine, and
        # the whole point of the gate is that it runs before that happens.
        if not intent.is_purchase_request:
            hop.blocked(
                code="NOT_A_PURCHASE_REQUEST",
                summary="not a shopping request — no merchant was quoted",
                reply={"off_topic_reply": intent.off_topic_reply},
            )
            payload = {
                "stage": "not_a_purchase_request",
                "status": "declined",
                "code": "NOT_A_PURCHASE_REQUEST",
                "message": intent.off_topic_reply,
                "rejected": rejected,
            }
            tracer.run_end(stage="not_a_purchase_request", result=payload)
            return {"correlation_id": tracer.correlation_id, **payload}
        hop.ok(summary="parsed once, carried to every merchant unchanged", reply=intent.model_dump())

    # --- collect quotes ---
    quotes: list[dict] = []
    for merchant_id, entry in verified.items():
        passport = entry["result"]["passport"]
        name = entry["name"]
        regions = passport.get("merchant", {}).get("service_regions", [])
        if intent.region and regions and intent.region not in regions:
            rejected.append(
                {
                    "merchant_id": merchant_id,
                    "name": name,
                    "reason": f"serves {', '.join(regions)}, not {intent.region}",
                    "stage": "region",
                }
            )
            continue

        with tracer.hop(
            src=NODE_BUYER,
            dst=NODE_MARGINMIND,
            label=f"quote from {name}",
            engine=ENGINE_CODE,
            protocol="POST :8002/marginmind/recommend",
            payload={"merchant_id": merchant_id, "intent": intent.model_dump()},
        ) as hop:
            decision = marginmind_client.recommend(
                correlation_id=tracer.correlation_id,
                intent=intent,
                buyer_passport_snapshot=passport,
                merchant_id=merchant_id,
            )
            if decision.status == "accepted" and decision.options:
                best = min(decision.options, key=lambda b: b.total_minor)
                hop.ok(
                    summary=f"{name} quotes ₹{best.total_minor / 100:,.2f} ({len(decision.options)} option(s))",
                    reply=decision.model_dump(),
                )
                for basket in decision.options:
                    remember_basket(basket, merchant_id)
                quotes.append(
                    {
                        "merchant_id": merchant_id,
                        "name": name,
                        "domain": passport.get("merchant", {}).get("domain"),
                        "decision": decision.model_dump(),
                        "best": best.model_dump(),
                        "total_minor": best.total_minor,
                        "policies": passport.get("policies"),
                        "bounds": passport.get("bounds"),
                        "attestations": passport.get("attestations"),
                    }
                )
            else:
                hop.blocked(
                    code=decision.code or "DECLINED",
                    summary=f"{name}: {decision.message or 'declined'}",
                    reply=decision.model_dump(),
                )
                rejected.append(
                    {"merchant_id": merchant_id, "name": name, "reason": decision.message, "stage": "no_basket"}
                )

    if not quotes:
        payload = {
            "stage": "no_quotes",
            "intent": intent.model_dump(),
            "rejected": rejected,
            "message": "Every verified merchant declined this request.",
        }
        tracer.run_end(stage="no_quotes", result=payload)
        return {"correlation_id": tracer.correlation_id, **payload}

    # --- pick, deterministically ---
    with tracer.hop(
        src=NODE_BUYER,
        dst=NODE_BUYER,
        label="rank quotes",
        engine=ENGINE_CODE,
        protocol="local · deterministic",
        payload={"quotes": [{"name": q["name"], "total_minor": q["total_minor"]} for q in quotes]},
        audit="cross_merchant_ranked",
    ) as hop:
        # Cheapest wins, ties broken by the longer refund window. A model
        # ranks nothing here: which merchant gets the buyer's money is a
        # decision, and decisions are code in this system.
        ordered = sorted(
            quotes,
            key=lambda q: (q["total_minor"], -(q["policies"] or {}).get("refund_window_days", 0)),
        )
        winner = ordered[0]
        for rank, quote in enumerate(ordered):
            quote["rank"] = rank
        margin = ordered[1]["total_minor"] - winner["total_minor"] if len(ordered) > 1 else 0
        hop.ok(
            summary=(
                f"{winner['name']} wins at ₹{winner['total_minor'] / 100:,.2f}"
                + (f", ₹{margin / 100:,.2f} cheaper than the next" if margin else "")
            ),
            reply={"ranking": [{"name": q["name"], "total_minor": q["total_minor"], "rank": q["rank"]} for q in ordered]},
        )

    winning_decision = MarginMindDecision.model_validate(winner["decision"])
    safe_payload, injection_findings = sanitize.clean_basket_payload(winner["decision"])
    explanation = _explain(tracer, winning_decision, safe_payload, intent)

    result = {
        "stage": "ready_for_consent",
        "mode": "compare",
        "intent": intent.model_dump(),
        "quotes": ordered,
        "winner": winner,
        "rejected": rejected,
        "decision": winner["decision"],
        "explanation": explanation,
        "injection_findings": injection_findings,
    }
    tracer.run_end(stage="ready_for_consent", result=result)
    return {"correlation_id": tracer.correlation_id, **result}


# ---------------------------------------------------------------------------
# confirm
# ---------------------------------------------------------------------------


def run_confirm(
    tracer: Tracer,
    basket_id: str,
    *,
    create_order,
    merchant_id: Optional[str] = None,
):
    """Consent → re-verify → re-price → bounds gate → money.

    `create_order` is injected rather than imported so the Red Team console can
    run this identical path with a payment client that would fail loudly if it
    were ever reached — proving a blocked attempt never got here, instead of
    asserting it.

    `merchant_id` is ignored when the cached basket already knows which
    merchant it came from — see `remember_basket`. A caller does not get to
    decide whose catalog its basket is repriced against.

    Returns (result_dict, trusted_basket_or_None).
    """
    tracer.run_start(label="Buyer consent", detail={"basket_id": basket_id})

    basket, origin_merchant_id = recall_basket(basket_id)
    merchant_id = origin_merchant_id if basket is not None else merchant_id
    if basket is None:
        payload = {
            "status": "declined",
            "code": "UNKNOWN_BASKET",
            "message": "Unknown basket_id — request a recommendation first.",
            "money_action_taken": False,
        }
        tracer.run_end(stage="declined", result=payload)
        return payload, None

    try:
        passport_result = verify_passport(tracer, merchant_id=merchant_id)
        passport = passport_result["passport"]

        # The buyer's own spend ceiling, re-checked now that a real amount exists.
        apply_risk_policy(
            tracer,
            passport_result,
            intended_spend_minor=basket.total_minor,
            stage_on_fail="policy_refused_at_confirm",
        )

        # --- capability gate ---
        capabilities = passport.get("capabilities", {})
        with tracer.hop(
            src=NODE_BUYER,
            dst=NODE_BUYER,
            label="capability check",
            engine=ENGINE_CODE,
            protocol="local · deterministic",
            payload={"required": ["create_order", "request_payment"], "granted": capabilities},
            audit="capability_checked",
        ) as hop:
            missing = [
                cap for cap in ("create_order", "request_payment")
                if not capabilities.get(cap, {}).get("allowed", False)
            ]
            if missing:
                hop.blocked(code="CAPABILITY_NOT_GRANTED", summary=f"not granted: {', '.join(missing)}")
                raise PipelineStop(
                    {
                        "status": "declined",
                        "code": "CAPABILITY_NOT_GRANTED",
                        "message": f"The merchant's passport does not grant this agent the '{missing[0]}' capability.",
                        "money_action_taken": False,
                        "escalation_required": True,
                    }
                )
            hop.ok(summary="create_order and request_payment are both granted")

        # --- the last gate before money ---
        with tracer.hop(
            src=NODE_BUYER,
            dst=NODE_MARGINMIND,
            label="reprice & check bounds",
            engine=ENGINE_CODE,
            protocol="POST :8002/marginmind/validate_order",
            payload={"basket": basket.model_dump()},
        ) as hop:
            validation = marginmind_client.validate_order(
                correlation_id=tracer.correlation_id,
                basket=basket,
                buyer_passport_snapshot=passport,
                merchant_id=merchant_id,
            )
            if validation.status == "declined":
                hop.blocked(
                    code=validation.code or "DECLINED",
                    summary=validation.message or "declined at the bounds gate",
                    reply=validation.model_dump(),
                    detail={"money_action_taken": False},
                )
                raise PipelineStop(validation.model_dump())

            trusted = validation.options[0]
            repriced = trusted.total_minor != basket.total_minor
            hop.ok(
                summary=(
                    f"repriced from the merchant's own catalog to ₹{trusted.total_minor / 100:,.2f}"
                    if repriced
                    else f"within every bound at ₹{trusted.total_minor / 100:,.2f}"
                ),
                reply=validation.model_dump(),
            )

        # --- money, and only now ---
        with tracer.hop(
            src=NODE_BUYER,
            dst=NODE_RAZORPAY,
            label="create order",
            engine=ENGINE_MONEY,
            protocol="Razorpay Orders API (test mode)",
            payload={
                "amount_minor": trusted.total_minor,
                "currency": trusted.currency,
                "basket_id": trusted.basket_id,
            },
            audit="order_created",
        ) as hop:
            order_result = create_order(trusted)
            hop.ok(
                summary=f"₹{trusted.total_minor / 100:,.2f} order created after explicit consent",
                reply=order_result,
            )

        tracer.run_end(stage="order_created", result=order_result)
        return order_result, trusted

    except PipelineStop as stop:
        tracer.run_end(stage="declined", result=stop.payload)
        return stop.payload, None
