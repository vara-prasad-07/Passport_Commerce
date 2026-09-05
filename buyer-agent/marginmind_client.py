"""httpx client for MarginMind's endpoints — agent-to-agent over a real
HTTP hop, not a function call, so the "these are separate services" story
in the architecture is actually true at runtime, not just on paper."""

from __future__ import annotations

import os
import sys
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402

from shared.models import BasketOption, BuyerIntent, MarginMindDecision  # noqa: E402

import config  # noqa: E402


def recommend(
    *,
    correlation_id: str,
    intent: BuyerIntent,
    buyer_passport_snapshot: dict,
    merchant_id: Optional[str] = None,
) -> MarginMindDecision:
    payload = {
        "correlation_id": correlation_id,
        "intent": intent.model_dump(),
        "buyer_passport_snapshot": buyer_passport_snapshot,
        "merchant_id": merchant_id,
    }
    with httpx.Client(timeout=15.0) as client:
        resp = client.post(f"{config.MARGINMIND_BASE_URL}/marginmind/recommend", json=payload)
        resp.raise_for_status()
        return MarginMindDecision.model_validate(resp.json())


def validate_order(
    *,
    correlation_id: str,
    basket: BasketOption,
    buyer_passport_snapshot: dict,
    merchant_id: Optional[str] = None,
) -> MarginMindDecision:
    payload = {
        "correlation_id": correlation_id,
        "basket": basket.model_dump(),
        "buyer_passport_snapshot": buyer_passport_snapshot,
        "merchant_id": merchant_id,
    }
    with httpx.Client(timeout=15.0) as client:
        resp = client.post(f"{config.MARGINMIND_BASE_URL}/marginmind/validate_order", json=payload)
        resp.raise_for_status()
        return MarginMindDecision.model_validate(resp.json())


def bounds(*, merchant_id: Optional[str] = None) -> dict:
    params = {"merchant_id": merchant_id} if merchant_id else None
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(f"{config.MARGINMIND_BASE_URL}/marginmind/bounds", params=params)
        resp.raise_for_status()
        return resp.json()
