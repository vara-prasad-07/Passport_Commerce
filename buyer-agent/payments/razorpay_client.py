"""
Dual-mode Razorpay client.

Real mode (RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET set): calls the actual
Razorpay Orders API — in TEST mode, so Razorpay itself guarantees no real
money moves — and verifies real HMAC-signed callbacks/webhooks.

Simulated mode (no keys configured): fabricates the same response shapes
using the IDENTICAL HMAC-SHA256 signature scheme Razorpay's own SDK uses
(see razorpay.Utility.verify_signature), so the verification code path is
exercised for real either way — only the source of the order/payment
differs. Every simulated object is tagged `"simulated": True` and uses an
`order_SIMULATED*` / `pay_SIMULATED*` id so it can never be confused with
a real Razorpay object in the audit trail or the UI.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import razorpay  # noqa: E402
from razorpay.errors import SignatureVerificationError  # noqa: E402

import config  # noqa: E402

_SIMULATED_SECRET = "simulated-secret-never-used-for-real-money"

_client = (
    razorpay.Client(auth=(config.RAZORPAY_KEY_ID, config.RAZORPAY_KEY_SECRET))
    if config.RAZORPAY_LIVE
    else None
)


def _hmac_hex(message: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


def create_order(*, amount_minor: int, currency: str, receipt: str, notes: dict) -> dict:
    if config.RAZORPAY_LIVE:
        order = _client.order.create(
            {
                "amount": amount_minor,
                "currency": currency,
                "receipt": receipt,
                "notes": notes,
                "payment_capture": 1,
            }
        )
        order["simulated"] = False
        return order

    return {
        "id": f"order_SIMULATED{uuid.uuid4().hex[:14]}",
        "entity": "order",
        "amount": amount_minor,
        "currency": currency,
        "receipt": receipt,
        "status": "created",
        "notes": notes,
        "simulated": True,
    }


def create_simulated_payment(*, razorpay_order_id: str) -> dict:
    """Stands in for what the Razorpay Checkout popup would normally
    return after a buyer pays with a test card. Only used in simulated
    mode — real mode gets this from the browser's Checkout.js callback."""
    payment_id = f"pay_SIMULATED{uuid.uuid4().hex[:14]}"
    signature = _hmac_hex(f"{razorpay_order_id}|{payment_id}", _SIMULATED_SECRET)
    return {
        "razorpay_order_id": razorpay_order_id,
        "razorpay_payment_id": payment_id,
        "razorpay_signature": signature,
    }


def verify_payment_signature(
    *, razorpay_order_id: str, razorpay_payment_id: str, razorpay_signature: str
) -> bool:
    """Server-side only. Never trust a client-side "payment succeeded"
    message on its own — this is what actually confirms it."""
    if config.RAZORPAY_LIVE:
        try:
            _client.utility.verify_payment_signature(
                {
                    "razorpay_order_id": razorpay_order_id,
                    "razorpay_payment_id": razorpay_payment_id,
                    "razorpay_signature": razorpay_signature,
                }
            )
            return True
        except SignatureVerificationError:
            return False

    expected = _hmac_hex(f"{razorpay_order_id}|{razorpay_payment_id}", _SIMULATED_SECRET)
    return hmac.compare_digest(expected, razorpay_signature)


def verify_webhook_signature(*, body: str, signature: str) -> bool:
    if config.RAZORPAY_LIVE:
        try:
            _client.utility.verify_webhook_signature(body, signature, config.RAZORPAY_WEBHOOK_SECRET)
            return True
        except SignatureVerificationError:
            return False
    expected = _hmac_hex(body, _SIMULATED_SECRET)
    return hmac.compare_digest(expected, signature)


def create_simulated_webhook_signature(body: str) -> str:
    """So the demo's simulated flow can also exercise POST /webhooks/razorpay
    for real, instead of only the direct-verify path."""
    return _hmac_hex(body, _SIMULATED_SECRET)
