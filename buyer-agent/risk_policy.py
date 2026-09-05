"""
The BUYER's own risk policy — the half of the trust story almost nobody builds.

The passport deliberately does not claim "this merchant is trustworthy". It
publishes evidence: who the merchant is, which attestations exist and who
issued them, what the refund window is, which capabilities are granted, and
what the declared bounds are. Somebody still has to decide whether that
evidence is good enough to spend money against, and that decision belongs to
the buyer, not the merchant.

That is this module. It is deterministic, buyer-side, and it runs BEFORE any
basket is requested. A merchant can publish a perfectly valid, perfectly
signed passport and still be refused here because this particular buyer agent
was configured to require a 7-day refund window, or to refuse any merchant
whose passport permits autonomous orders without buyer confirmation.

Three properties matter:

  * It is not an LLM. Every rule is a comparison, so the verdict reproduces
    exactly and a declined merchant can be shown the specific failing clause.
  * It cannot be relaxed by the merchant. The policy is buyer-side state; a
    passport cannot contain a field that turns a rule off.
  * It fails closed. An absent value is a failure, not a pass — a merchant who
    omits a refund policy is exactly the merchant the rule exists for.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

POLICY_PATH = Path(__file__).resolve().parent / "buyer_policy.json"

_lock = threading.Lock()

# Chosen to make the demo interesting rather than permissive: the shipped
# merchant passes every clause, but each threshold is one edit away from
# refusing it, so the page is a live control rather than a decoration.
DEFAULT_POLICY: dict[str, Any] = {
    "name": "Default buyer risk policy",
    "require_valid_signature": True,
    "require_fresh_passport": True,
    "max_passport_age_seconds": 900,
    "required_attestations": ["payment_provider_connected"],
    "min_refund_window_days": 7,
    "require_buyer_confirmation_for_orders": True,
    "required_capabilities": ["create_order", "request_payment"],
    "max_autonomous_spend_minor": 150000,
    "allowed_regions": ["IN-BLR", "IN-DEL", "IN-MUM", "IN-HYD"],
    "blocked_categories": [],
}


def load_policy() -> dict:
    """Re-read on every call so an edit in the dashboard takes effect on the
    very next buyer query without restarting the service — the same reason
    MarginMind re-reads its merchant config."""
    if not POLICY_PATH.exists():
        return dict(DEFAULT_POLICY)
    try:
        with open(POLICY_PATH, "r", encoding="utf-8") as f:
            stored = json.load(f)
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_POLICY)
    # Merge over the defaults so a policy file written by an older build (or
    # hand-edited and missing a key) can never make a rule silently vanish.
    return {**DEFAULT_POLICY, **stored}


def save_policy(patch: dict) -> dict:
    with _lock:
        current = load_policy()
        merged = {**current, **{k: v for k, v in patch.items() if k in DEFAULT_POLICY}}
        with open(POLICY_PATH, "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=2)
    return merged


def reset_policy() -> dict:
    with _lock:
        if POLICY_PATH.exists():
            POLICY_PATH.unlink()
    return dict(DEFAULT_POLICY)


# ---------------------------------------------------------------------------
# evaluation
# ---------------------------------------------------------------------------


def _passport_age_seconds(passport: dict) -> Optional[float]:
    stamp = (passport.get("catalog") or {}).get("updated_at") or passport.get("version")
    if not stamp:
        return None
    try:
        issued = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return None
    if issued.tzinfo is None:
        issued = issued.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - issued).total_seconds()


def _check(rule: str, title: str, passed: bool, detail: str, *, severity: str = "block") -> dict:
    return {
        "rule": rule,
        "title": title,
        "passed": bool(passed),
        "detail": detail,
        # A failing "warn" clause is reported to the buyer but does not stop
        # the run — the distinction keeps the policy usable without forcing
        # every preference to be a veto.
        "severity": severity,
    }


def evaluate(
    passport: dict,
    verification: dict,
    *,
    policy: Optional[dict] = None,
    intended_spend_minor: Optional[int] = None,
) -> dict:
    """Run every clause and return a full verdict.

    Always evaluates ALL rules rather than short-circuiting on the first
    failure: a buyer who is refused deserves the complete list of what would
    have to change, and the dashboard renders the passing clauses too so the
    policy reads as a checklist that ran rather than an opaque yes/no.
    """
    pol = policy or load_policy()
    checks: list[dict] = []

    # --- cryptographic integrity ---
    if pol.get("require_valid_signature", True):
        checks.append(
            _check(
                "require_valid_signature",
                "Passport signature must verify",
                bool(verification.get("signature_ok")),
                verification.get("signature_reason") or "no signature result",
            )
        )

    if pol.get("require_fresh_passport", True):
        checks.append(
            _check(
                "require_fresh_passport",
                "Passport must be within its own declared TTL",
                bool(verification.get("freshness_ok")),
                verification.get("freshness_reason") or "no freshness result",
            )
        )

    # The buyer's own staleness ceiling, independent of whatever TTL the
    # merchant chose for itself. A merchant declaring a 30-day TTL does not
    # get to decide how stale this buyer is willing to be.
    max_age = pol.get("max_passport_age_seconds")
    if max_age:
        age = _passport_age_seconds(passport)
        checks.append(
            _check(
                "max_passport_age_seconds",
                f"Passport signed within the last {int(max_age)}s",
                age is not None and age <= max_age,
                f"signed {age:.0f}s ago" if age is not None else "no readable signing timestamp",
            )
        )

    # --- evidence ---
    present = {a.get("type") for a in passport.get("attestations", []) if isinstance(a, dict)}
    for required in pol.get("required_attestations", []):
        checks.append(
            _check(
                f"attestation:{required}",
                f"Attestation present: {required}",
                required in present,
                f"declared by merchant" if required in present else "not present in the passport",
            )
        )

    # --- commercial policy ---
    policies = passport.get("policies") or {}
    min_refund = pol.get("min_refund_window_days")
    if min_refund:
        actual = policies.get("refund_window_days")
        checks.append(
            _check(
                "min_refund_window_days",
                f"Refund window at least {min_refund} days",
                isinstance(actual, (int, float)) and actual >= min_refund,
                f"merchant declares {actual} days" if actual is not None else "no refund window declared",
            )
        )

    # --- capabilities and consent ---
    capabilities = passport.get("capabilities") or {}
    for cap in pol.get("required_capabilities", []):
        granted = bool((capabilities.get(cap) or {}).get("allowed"))
        checks.append(
            _check(
                f"capability:{cap}",
                f"Capability granted: {cap}",
                granted,
                "granted by the passport" if granted else "not granted",
            )
        )

    if pol.get("require_buyer_confirmation_for_orders", True):
        # Deliberately inverted from how it first reads: this rule REFUSES a
        # merchant that would let an agent create orders with no human in the
        # loop. A merchant being more permissive is a risk to the buyer, not a
        # convenience.
        create = capabilities.get("create_order") or {}
        needs_confirm = bool(create.get("requires_buyer_confirmation"))
        checks.append(
            _check(
                "require_buyer_confirmation_for_orders",
                "Merchant must require explicit buyer confirmation",
                needs_confirm or not create.get("allowed"),
                "passport requires buyer confirmation"
                if needs_confirm
                else "passport would allow orders with no buyer confirmation",
            )
        )

    # --- geography ---
    allowed_regions = pol.get("allowed_regions") or []
    if allowed_regions:
        regions = (passport.get("merchant") or {}).get("service_regions") or []
        overlap = sorted(set(regions) & set(allowed_regions))
        checks.append(
            _check(
                "allowed_regions",
                "Merchant serves a region this buyer will transact in",
                bool(overlap),
                f"overlap: {', '.join(overlap)}" if overlap else f"merchant serves {', '.join(regions) or 'nowhere declared'}",
            )
        )

    blocked = pol.get("blocked_categories") or []
    if blocked:
        category = (passport.get("merchant") or {}).get("category")
        checks.append(
            _check(
                "blocked_categories",
                "Merchant category is not on the buyer's blocklist",
                category not in blocked,
                f"category is {category}",
            )
        )

    # --- the buyer's own spending ceiling ---
    # Note this is checked against the BUYER's limit, and separately from
    # MarginMind's merchant-side cap. Two independent parties each enforce
    # their own ceiling; neither can raise the other's.
    buyer_cap = pol.get("max_autonomous_spend_minor")
    if buyer_cap and intended_spend_minor is not None:
        checks.append(
            _check(
                "max_autonomous_spend_minor",
                f"Order within the buyer's own ₹{buyer_cap / 100:,.0f} autonomous cap",
                intended_spend_minor <= buyer_cap,
                f"₹{intended_spend_minor / 100:,.2f} requested against a ₹{buyer_cap / 100:,.0f} buyer cap",
            )
        )

    failed = [c for c in checks if not c["passed"] and c["severity"] == "block"]
    warned = [c for c in checks if not c["passed"] and c["severity"] == "warn"]

    return {
        "policy_name": pol.get("name", "Buyer risk policy"),
        "passed": not failed,
        "checks": checks,
        "passed_count": sum(1 for c in checks if c["passed"]),
        "total_count": len(checks),
        "failed_rules": [c["rule"] for c in failed],
        "warnings": [c["rule"] for c in warned],
        "summary": (
            f"{sum(1 for c in checks if c['passed'])}/{len(checks)} clauses passed"
            if not failed
            else f"refused by {len(failed)} clause(s): {', '.join(c['rule'] for c in failed)}"
        ),
    }
