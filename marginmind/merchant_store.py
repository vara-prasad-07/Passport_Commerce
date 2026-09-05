"""
MarginMind's OWN trusted source of merchant configuration.

Security note: `bounds`, `policies`, and per-SKU `cost_minor` are read here
directly from the merchant's internal data file — NEVER from a value a
buyer agent sent in over HTTP. A `passport` dict arriving in a
`/marginmind/*` request body is the buyer's own verified snapshot, kept
only for audit cross-checking (see `engine.py`). If MarginMind trusted
caller-supplied bounds instead, any buyer agent could forge a request with
an inflated `max_order_value_minor` and bypass the merchant's order cap
entirely. Enforcement always uses what THIS module loads.

The `merchant_id` parameter threaded through here is subject to the same
rule. It selects WHICH merchant's trusted config to read; it can never
supply the config itself. An unknown id is an error rather than a fallback
to the default merchant — silently deciding one merchant's order against
another's margin floor would be the worst possible failure mode, and a
caller who can pick the id is exactly who would exploit it.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Optional

PASSPORT_DIR = Path(__file__).resolve().parent.parent / "passport"
DEFAULT_MERCHANT_ID = os.getenv("DEFAULT_MERCHANT_ID", "greenbowl")

MERCHANT_DATA_PATH = PASSPORT_DIR / "merchant_data.json"

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


class UnknownMerchant(Exception):
    pass


def data_path(merchant_id: Optional[str] = None) -> Path:
    merchant_id = merchant_id or DEFAULT_MERCHANT_ID
    if not _ID_RE.match(merchant_id):
        raise UnknownMerchant(f"invalid merchant id: {merchant_id!r}")
    if merchant_id == DEFAULT_MERCHANT_ID:
        return MERCHANT_DATA_PATH
    return PASSPORT_DIR / f"merchant_data.{merchant_id}.json"


def load_merchant_config(merchant_id: Optional[str] = None) -> dict:
    """Re-read on every call (the file is a couple KB) so a merchant edit +
    passport regeneration is picked up without restarting this service.

    This is what makes the control plane honest: changing the margin floor in
    the merchant console affects the very next decision, with no cache to
    invalidate and no restart to hide behind.
    """
    path = data_path(merchant_id)
    if not path.exists():
        raise UnknownMerchant(f"no merchant data for {merchant_id!r}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def known_merchants() -> list[str]:
    ids = []
    for path in sorted(PASSPORT_DIR.glob("merchant_data*.json")):
        if path.name == "merchant_data.json":
            ids.append(DEFAULT_MERCHANT_ID)
        else:
            ids.append(path.name[len("merchant_data.") : -len(".json")])
    return ids


def cost_by_sku(merchant_id: Optional[str] = None) -> dict[str, int]:
    config = load_merchant_config(merchant_id)
    return {item["sku"]: item.get("cost_minor", item["price_minor"]) for item in config["catalog"]["items"]}
