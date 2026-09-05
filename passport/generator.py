"""
Builds the signed Merchant Passport from a merchant's source data.

The signature covers the CANONICAL JSON of everything except the
`integrity` block itself (you can't sign a signature). Canonical means:
sorted keys, no extra whitespace — so the buyer agent can reproduce the
exact same bytes and verify the signature matches.

Run:  python generator.py [merchant_id]
Produces: passport.json  (this is what server.py serves at the well-known URL)
"""

from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime, timezone
from typing import Optional

import merchants

SCHEMA_VERSION = "agent-commerce/passport/v1"

# Kept as module constants because the rest of the codebase (and the docs)
# refer to them; they resolve to the default merchant's files.
MERCHANT_DATA_PATH = str(merchants.data_path(merchants.DEFAULT_MERCHANT_ID))
OUTPUT_PATH = str(merchants.passport_path(merchants.DEFAULT_MERCHANT_ID))

# Allowlist, not a blocklist: only these catalog fields ever leave the
# merchant's internal store. `cost_minor` (and anything added later) stays
# server-side — MarginMind reads it directly from the merchant data file
# (see marginmind/merchant_store.py). A buyer agent must never be able to
# reverse-engineer merchant margins from a public, signed document.
#
# An allowlist is the load-bearing choice here. With a blocklist, every new
# internal field a merchant adds is public by default and leaks until someone
# notices; with this, a new field is private until someone deliberately
# publishes it.
PUBLIC_CATALOG_FIELDS = ("sku", "name", "price_minor", "currency", "stock", "tags", "complements")


def _public_catalog_items(items: list[dict]) -> list[dict]:
    return [{k: item[k] for k in PUBLIC_CATALOG_FIELDS if k in item} for item in items]


def canonical_bytes(obj: dict) -> bytes:
    """Deterministic JSON encoding so signer and verifier hash identical bytes."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode("utf-8")


def build_passport(merchant_id: Optional[str] = None) -> dict:
    merchant_id = merchant_id or merchants.DEFAULT_MERCHANT_ID
    data = merchants.load_data(merchant_id)

    now = datetime.now(timezone.utc).isoformat()

    # Everything the buyer agent needs, EXCEPT the integrity block.
    unsigned = {
        "schema": SCHEMA_VERSION,
        "passport_id": f"mp_{merchant_id}",
        "merchant_id": merchant_id,
        "version": now,
        "merchant": data["merchant"],
        "catalog": {
            "source": "merchant_system",
            "updated_at": now,
            "ttl_seconds": data["ttl_seconds"],
            "items": _public_catalog_items(data["catalog"]["items"]),
        },
        "policies": data["policies"],
        "capabilities": data["capabilities"],
        "bounds": data["bounds"],
        "attestations": [{**a, "issued_at": now} for a in data["attestations"]],
    }

    # Hash + sign the canonical bytes of everything above.
    payload_bytes = canonical_bytes(unsigned)
    payload_hash = hashlib.sha256(payload_bytes).hexdigest()

    private_key = merchants.load_private_key(merchant_id)
    signature = private_key.sign(payload_bytes)
    signature_b64 = base64.urlsafe_b64encode(signature).decode("ascii")

    domain = data["merchant"].get("domain", "merchant.example")
    return {
        **unsigned,
        "integrity": {
            "signature_algorithm": "Ed25519",
            "key_id": merchants.key_id(merchant_id),
            "public_key_url": f"https://{domain}/.well-known/agent-commerce-key.json",
            "payload_sha256": payload_hash,
            "signature": signature_b64,
        },
    }


def write_passport(merchant_id: Optional[str] = None) -> dict:
    merchant_id = merchant_id or merchants.DEFAULT_MERCHANT_ID
    passport = build_passport(merchant_id)
    with open(merchants.passport_path(merchant_id), "w", encoding="utf-8") as f:
        json.dump(passport, f, indent=2)
    return passport


if __name__ == "__main__":
    import sys

    target = sys.argv[1] if len(sys.argv) > 1 else merchants.DEFAULT_MERCHANT_ID
    result = write_passport(target)
    print(f"Signed passport written to {merchants.passport_path(target)}")
    print(f"  merchant: {target}")
    print(f"  version: {result['version']}")
    print(f"  payload_sha256: {result['integrity']['payload_sha256']}")
