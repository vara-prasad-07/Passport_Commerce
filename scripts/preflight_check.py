"""
Pre-flight check — run this right before a demo or judging session to
confirm all three backend services are up, correctly wired, and (if
GROQ_API_KEY is configured) that the full LLM-driven happy path
actually works end to end against the REAL running services.

Usage (from the repo root, with all three services already running via
run_services.ps1/.sh):

    .venv\\Scripts\\python scripts\\preflight_check.py

Exits non-zero if anything fails.
"""

from __future__ import annotations

import sys

sys.stdout.reconfigure(encoding="utf-8")

import httpx  # noqa: E402

PASSPORT = "http://localhost:8001"
MARGINMIND = "http://localhost:8002"
BUYER_AGENT = "http://localhost:8003"

_results: list[tuple[str, bool, str]] = []


def check(name, fn):
    try:
        detail = fn() or ""
        _results.append((name, True, detail))
        print(f"[PASS] {name}" + (f" — {detail}" if detail else ""))
    except Exception as exc:  # noqa: BLE001 - this script's whole job is to catch and report failures
        _results.append((name, False, str(exc)))
        print(f"[FAIL] {name}: {exc}")


def passport_is_up():
    r = httpx.get(f"{PASSPORT}/.well-known/agent-commerce.json", timeout=5)
    r.raise_for_status()
    assert "integrity" in r.json(), "response missing integrity block"


def marginmind_is_up():
    r = httpx.get(f"{MARGINMIND}/health", timeout=5)
    r.raise_for_status()


def buyer_agent_is_up():
    r = httpx.get(f"{BUYER_AGENT}/health", timeout=5)
    r.raise_for_status()
    data = r.json()
    return f"llm_configured={data['llm_configured']} razorpay_live={data['razorpay_live']}"


def passport_verifies_trusted():
    r = httpx.get(f"{BUYER_AGENT}/api/passport/summary", timeout=10)
    r.raise_for_status()
    data = r.json()
    assert data["trusted"], f"sig={data['signature_reason']} fresh={data['freshness_reason']}"


def overlimit_guard_blocks_the_order():
    r = httpx.post(f"{BUYER_AGENT}/api/demo/overlimit", json={}, timeout=15)
    r.raise_for_status()
    gw = r.json()["gateway_response"]
    assert gw["status"] == "declined", f"expected declined, got {gw['status']}"
    assert gw["code"] == "ORDER_VALUE_EXCEEDS_AGENT_BOUND", f"unexpected code {gw['code']}"
    assert gw["money_action_taken"] is False, "money_action_taken should be False"
    return gw["code"]


def full_happy_path_via_llm():
    health = httpx.get(f"{BUYER_AGENT}/health", timeout=5).json()
    if not health["llm_configured"]:
        return "skipped — GROQ_API_KEY not configured (only this check needs it)"

    session = httpx.post(f"{BUYER_AGENT}/api/session/start", timeout=10).json()
    correlation_id = session["correlation_id"]

    r = httpx.post(
        f"{BUYER_AGENT}/api/agent/query",
        json={
            "correlation_id": correlation_id,
            "message": "Vegetarian, high-protein breakfast for two under 900 rupees, delivered tomorrow.",
        },
        timeout=60,
    )
    r.raise_for_status()
    data = r.json()
    assert data["stage"] == "ready_for_consent", f"stage={data.get('stage')} decision={data.get('decision')}"
    basket = data["decision"]["options"][0]

    r2 = httpx.post(
        f"{BUYER_AGENT}/api/agent/confirm",
        json={"correlation_id": correlation_id, "basket_id": basket["basket_id"]},
        timeout=30,
    )
    r2.raise_for_status()
    order = r2.json()
    assert order["status"] == "created", f"confirm returned status={order['status']}"

    if not order["simulated"]:
        return (
            f"order {order['order_id']} created for real via Razorpay "
            f"({order['razorpay_order_id']}) — finish payment manually in the dashboard, "
            f"real Checkout can't be driven headlessly from this script"
        )

    r3 = httpx.post(f"{BUYER_AGENT}/api/payments/simulate", json={"order_id": order["order_id"]}, timeout=15)
    r3.raise_for_status()
    pay = r3.json()
    assert pay["status"] == "paid", f"simulated payment did not settle: {pay}"
    return f"simulated order {order['order_id']} paid ({pay['order']['razorpay_payment_id']})"


def main():
    print("=== Passport Commerce pre-flight check ===\n")
    check("passport service reachable (8001)", passport_is_up)
    check("marginmind service reachable (8002)", marginmind_is_up)
    check("buyer-agent service reachable (8003)", buyer_agent_is_up)
    check("passport verifies as trusted (signature + freshness)", passport_verifies_trusted)
    check("guarded failure: over-limit order is declined pre-payment", overlimit_guard_blocks_the_order)
    check("full happy path (intent -> recommend -> confirm -> pay)", full_happy_path_via_llm)

    print("\n=== Summary ===")
    failures = [r for r in _results if not r[1]]
    for name, ok, detail in _results:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    if failures:
        print(f"\n{len(failures)} check(s) failed — fix these before demoing.")
        sys.exit(1)
    print("\nAll checks passed. You're ready to demo.")


if __name__ == "__main__":
    main()
