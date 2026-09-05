"""
Razorpay webhook handling: verify the signature over the RAW request body,
dedupe by event id, and update the internal order record. Never trust an
LLM statement or a client-side "payment succeeded" message — only a
verified webhook or a verified Checkout callback signature ever marks an
order paid.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from shared.audit import append_event  # noqa: E402

import orders_store  # noqa: E402
from payments import razorpay_client  # noqa: E402

_SEEN_EVENT_IDS: set[str] = set()


class WebhookError(Exception):
    pass


def handle_webhook(*, raw_body: bytes, signature: str) -> dict:
    body_str = raw_body.decode("utf-8")
    if not razorpay_client.verify_webhook_signature(body=body_str, signature=signature):
        raise WebhookError("invalid webhook signature")

    payload = json.loads(body_str)
    event_id = payload.get("id") or payload.get("event_id") or f"unkeyed_{hash(body_str)}"

    if event_id in _SEEN_EVENT_IDS:
        return {"status": "duplicate_ignored", "event_id": event_id}
    _SEEN_EVENT_IDS.add(event_id)

    event_type = payload.get("event", "unknown")
    payment_entity = payload.get("payload", {}).get("payment", {}).get("entity", {})
    razorpay_order_id = payment_entity.get("order_id")
    razorpay_payment_id = payment_entity.get("id")

    order = orders_store.find_by_razorpay_order_id(razorpay_order_id) if razorpay_order_id else None
    if order and event_type == "payment.captured" and order.status != "paid":
        orders_store.mark_paid(order.order_id, razorpay_payment_id=razorpay_payment_id)

    append_event(
        correlation_id=order.correlation_id if order else "unknown",
        actor="razorpay_webhook",
        event_type="webhook_received",
        decision=event_type,
        outcome="processed" if order else "no_matching_order",
        detail={
            "event_id": event_id,
            "razorpay_order_id": razorpay_order_id,
            "razorpay_payment_id": razorpay_payment_id,
        },
    )
    return {"status": "processed", "event_id": event_id, "event_type": event_type}
