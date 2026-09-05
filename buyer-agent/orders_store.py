"""
In-memory idempotent order store for the demo (a DB would be overkill for
a ten-day build with one merchant). An `idempotency_key` (hash of
correlation_id + basket_id) is checked BEFORE ever calling Razorpay, so a
retried "confirm" click never creates two orders for the same basket.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shared.ids import hash_payload, new_id  # noqa: E402
from shared.models import BasketOption, OrderRecord  # noqa: E402

_ORDERS: dict[str, OrderRecord] = {}
_IDEMPOTENCY_INDEX: dict[str, str] = {}
_RAZORPAY_ORDER_INDEX: dict[str, str] = {}


def idempotency_key(correlation_id: str, basket_id: str) -> str:
    return hash_payload({"correlation_id": correlation_id, "basket_id": basket_id})


def get_existing(idem_key: str) -> Optional[OrderRecord]:
    order_id = _IDEMPOTENCY_INDEX.get(idem_key)
    return _ORDERS.get(order_id) if order_id else None


def create_pending(*, correlation_id: str, basket: BasketOption, idem_key: str) -> OrderRecord:
    now = datetime.now(timezone.utc).isoformat()
    order = OrderRecord(
        order_id=new_id("order"),
        correlation_id=correlation_id,
        basket=basket,
        status="pending",
        simulated=False,
        created_at=now,
        updated_at=now,
    )
    _ORDERS[order.order_id] = order
    _IDEMPOTENCY_INDEX[idem_key] = order.order_id
    return order


def mark_created(order_id: str, *, razorpay_order_id: str, simulated: bool) -> OrderRecord:
    order = _ORDERS[order_id]
    order.status = "created"
    order.razorpay_order_id = razorpay_order_id
    order.simulated = simulated
    order.updated_at = datetime.now(timezone.utc).isoformat()
    _RAZORPAY_ORDER_INDEX[razorpay_order_id] = order_id
    return order


def mark_paid(order_id: str, *, razorpay_payment_id: str) -> OrderRecord:
    order = _ORDERS[order_id]
    order.status = "paid"
    order.razorpay_payment_id = razorpay_payment_id
    order.updated_at = datetime.now(timezone.utc).isoformat()
    return order


def mark_failed(order_id: str) -> OrderRecord:
    order = _ORDERS[order_id]
    order.status = "failed"
    order.updated_at = datetime.now(timezone.utc).isoformat()
    return order


def get(order_id: str) -> Optional[OrderRecord]:
    return _ORDERS.get(order_id)


def find_by_razorpay_order_id(razorpay_order_id: str) -> Optional[OrderRecord]:
    order_id = _RAZORPAY_ORDER_INDEX.get(razorpay_order_id)
    return _ORDERS.get(order_id) if order_id else None


def all_orders() -> list[OrderRecord]:
    return list(_ORDERS.values())
