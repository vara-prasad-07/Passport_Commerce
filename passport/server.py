"""
The merchant's own service: publishes signed passports, and hosts the
merchant control plane that produces them.

  GET   /.well-known/agent-commerce.json          default merchant's passport
  GET   /.well-known/agent-commerce-key.json      its public key
  GET   /m/{id}/.well-known/agent-commerce.json   any registered merchant
  GET   /m/{id}/.well-known/agent-commerce-key.json

  GET   /admin/merchants                          registry listing
  GET   /admin/merchant/{id}                      full internal data (incl. cost)
  PATCH /admin/merchant/{id}                      edit bounds/policies/prices, re-sign
  POST  /admin/merchant/{id}/regenerate           force a re-sign

The TTL is deliberately short (see merchant_data.json) so the freshness
check is easy to demonstrate rather than theoretical. That would otherwise
make a passport that just sits idle for a few minutes start failing every
buyer verification, so this server re-signs it lazily on read whenever the
cached copy has actually expired — the same "regenerate on demand, cache
otherwise" shape called for in the scalability notes, just triggered by a
staleness check instead of a webhook from the merchant's catalog system.

The /admin surface has no authentication. That is a deliberate, bounded
demo decision and not an oversight: the whole point of the control plane is
that a judge can change the merchant's margin floor mid-demo and watch the
passport re-sign, and a login screen would add nothing to the argument. In
anything real this is merchant-authenticated and the buyer agent has no
route to it at all — note that the buyer agent never calls these endpoints;
the dashboard's merchant console talks to this service directly, because
this is the merchant's plane, not the buyer's.

Run:  uvicorn server:app --reload --port 8001
"""

from __future__ import annotations

import base64
import copy
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, HTTPException, Query, Response  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import merchants  # noqa: E402
from generator import build_passport, write_passport  # noqa: E402
from shared.verify import verify_freshness  # noqa: E402

app = FastAPI(title="Merchant Passport Server + Control Plane")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # demo only — restrict in anything real
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def ensure_passports_exist():
    for merchant in merchants.list_merchants():
        path = merchants.passport_path(merchant["merchant_id"])
        if not path.exists():
            write_passport(merchant["merchant_id"])


def _load_fresh_passport(merchant_id: str) -> dict:
    path = merchants.passport_path(merchant_id)
    if not path.exists():
        return write_passport(merchant_id)
    with open(path, "r", encoding="utf-8") as f:
        passport = json.load(f)
    if not verify_freshness(passport).ok:
        return write_passport(merchant_id)
    return passport


# ---------------------------------------------------------------------------
# deliberate corruption, for the Red Team console
# ---------------------------------------------------------------------------

TAMPER_MODES = {
    "payload": "Rewrite a catalog price after signing — the classic price-tampering attack.",
    "bounds": "Raise the declared order cap after signing, to try to buy more authority.",
    "signature": "Replace the signature bytes with a well-formed but wrong signature.",
    "stale": "Backdate the passport so it falls outside its own declared TTL.",
    "strip": "Remove the integrity block entirely and hope nobody checks.",
}


def _tamper(passport: dict, mode: str) -> dict:
    """Serve a genuinely broken passport.

    The corruption is applied here, server-side, so the bad bytes really do
    travel over HTTP and the buyer agent's verification is doing real work.
    Mutating the passport inside the verifier's own process and then
    "detecting" it would be a test of nothing.
    """
    bad = copy.deepcopy(passport)
    if mode == "payload":
        if bad.get("catalog", {}).get("items"):
            bad["catalog"]["items"][0]["price_minor"] = 1
    elif mode == "bounds":
        bad.setdefault("bounds", {})["max_order_value_minor"] = 99_999_900
    elif mode == "signature":
        # A syntactically valid Ed25519 signature of the right length that
        # simply isn't the right one — this exercises the cryptographic check
        # rather than a length/parse guard.
        bad.setdefault("integrity", {})["signature"] = base64.urlsafe_b64encode(b"\x00" * 64).decode("ascii")
    elif mode == "stale":
        old = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
        bad["version"] = old
        bad.setdefault("catalog", {})["updated_at"] = old
    elif mode == "strip":
        bad.pop("integrity", None)
    else:
        raise HTTPException(status_code=400, detail=f"unknown tamper mode: {mode}")
    return bad


def _serve_passport(merchant_id: str, tamper: Optional[str]) -> Response:
    if not merchants.exists(merchant_id):
        raise HTTPException(status_code=404, detail=f"unknown merchant: {merchant_id}")
    passport = _load_fresh_passport(merchant_id)
    if tamper:
        passport = _tamper(passport, tamper)
    return Response(content=json.dumps(passport, indent=2), media_type="application/json")


def _serve_key(merchant_id: str) -> dict:
    if not merchants.exists(merchant_id):
        raise HTTPException(status_code=404, detail=f"unknown merchant: {merchant_id}")
    return {
        "key_id": merchants.key_id(merchant_id),
        "algorithm": "Ed25519",
        "public_key_pem": merchants.load_public_key_pem(merchant_id),
    }


# ---------------------------------------------------------------------------
# well-known endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "passport",
        "default_merchant": merchants.DEFAULT_MERCHANT_ID,
        "merchant_count": len(merchants.list_merchants()),
    }


@app.get("/.well-known/agent-commerce.json")
def get_passport(tamper: Optional[str] = Query(None)):
    return _serve_passport(merchants.DEFAULT_MERCHANT_ID, tamper)


@app.get("/.well-known/agent-commerce-key.json")
def get_public_key():
    return _serve_key(merchants.DEFAULT_MERCHANT_ID)


@app.get("/m/{merchant_id}/.well-known/agent-commerce.json")
def get_passport_for(merchant_id: str, tamper: Optional[str] = Query(None)):
    return _serve_passport(merchant_id, tamper)


@app.get("/m/{merchant_id}/.well-known/agent-commerce-key.json")
def get_public_key_for(merchant_id: str):
    return _serve_key(merchant_id)


# ---------------------------------------------------------------------------
# merchant control plane
# ---------------------------------------------------------------------------


class MerchantPatch(BaseModel):
    """A partial edit to a merchant's own configuration.

    Only these four blocks are editable. The catalog is patched by SKU rather
    than replaced wholesale so a mistyped field can't silently delete a
    merchant's inventory, and `cost_minor` is editable here — this is the
    merchant's own plane, and it is the one place that number is allowed to
    exist outside MarginMind.
    """

    bounds: Optional[dict[str, Any]] = None
    policies: Optional[dict[str, Any]] = None
    capabilities: Optional[dict[str, Any]] = None
    ttl_seconds: Optional[int] = None
    # sku -> {price_minor?, cost_minor?, stock?, name?, tags?}
    catalog_patch: Optional[dict[str, dict[str, Any]]] = None


def _passport_summary(passport: dict) -> dict:
    integrity = passport.get("integrity", {})
    return {
        "merchant_id": passport.get("merchant_id"),
        "passport_id": passport.get("passport_id"),
        "version": passport.get("version"),
        "ttl_seconds": passport.get("catalog", {}).get("ttl_seconds"),
        "payload_sha256": integrity.get("payload_sha256"),
        "signature": integrity.get("signature"),
        "key_id": integrity.get("key_id"),
        "bounds": passport.get("bounds"),
        "catalog_size": len(passport.get("catalog", {}).get("items", [])),
    }


@app.get("/admin/merchants")
def admin_list_merchants():
    return {"merchants": merchants.list_merchants(), "default": merchants.DEFAULT_MERCHANT_ID}


@app.get("/admin/merchant/{merchant_id}")
def admin_get_merchant(merchant_id: str):
    try:
        data = merchants.load_data(merchant_id)
    except merchants.UnknownMerchant as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "merchant_id": merchant_id,
        "data": data,
        "passport": _passport_summary(_load_fresh_passport(merchant_id)),
        "tamper_modes": TAMPER_MODES,
    }


@app.patch("/admin/merchant/{merchant_id}")
def admin_patch_merchant(merchant_id: str, patch: MerchantPatch):
    """Edit the merchant's own configuration and immediately re-sign.

    This is the moment the whole control plane exists for: a bound changes,
    a NEW passport is signed with a new version and a genuinely different
    signature, and the very next buyer query is decided against the new
    numbers — by MarginMind, which re-reads this same file. Nothing is
    cached anywhere that could let the old rules survive the edit.
    """
    try:
        data = merchants.load_data(merchant_id)
    except merchants.UnknownMerchant as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    before = _passport_summary(_load_fresh_passport(merchant_id))
    changed: list[str] = []

    for block in ("bounds", "policies", "capabilities"):
        incoming = getattr(patch, block)
        if incoming:
            for key, value in incoming.items():
                if data.get(block, {}).get(key) != value:
                    changed.append(f"{block}.{key}")
            data.setdefault(block, {}).update(incoming)

    if patch.ttl_seconds is not None and patch.ttl_seconds != data.get("ttl_seconds"):
        if not 10 <= patch.ttl_seconds <= 86_400:
            raise HTTPException(status_code=400, detail="ttl_seconds must be between 10 and 86400")
        data["ttl_seconds"] = patch.ttl_seconds
        changed.append("ttl_seconds")

    if patch.catalog_patch:
        by_sku = {item["sku"]: item for item in data["catalog"]["items"]}
        for sku, fields in patch.catalog_patch.items():
            item = by_sku.get(sku)
            if item is None:
                raise HTTPException(status_code=404, detail=f"unknown SKU: {sku}")
            for key, value in fields.items():
                if key not in ("price_minor", "cost_minor", "stock", "name", "tags", "complements"):
                    raise HTTPException(status_code=400, detail=f"field not editable: {key}")
                if item.get(key) != value:
                    changed.append(f"catalog.{sku}.{key}")
                item[key] = value

    merchants.save_data(merchant_id, data)
    passport = write_passport(merchant_id)
    after = _passport_summary(passport)

    return {
        "merchant_id": merchant_id,
        "changed": changed,
        "before": before,
        "after": after,
        # Proof the document really is different, not just re-served: these
        # two hashes are what the buyer agent's signature check runs against.
        "signature_changed": before["signature"] != after["signature"],
        "data": data,
    }


@app.post("/admin/merchant/{merchant_id}/regenerate")
def admin_regenerate(merchant_id: str):
    if not merchants.exists(merchant_id):
        raise HTTPException(status_code=404, detail=f"unknown merchant: {merchant_id}")
    return {"status": "regenerated", "passport": _passport_summary(write_passport(merchant_id))}


@app.post("/admin/regenerate")
def admin_regenerate_default():
    """Kept for the original single-merchant call site."""
    return {"status": "regenerated", "passport": _passport_summary(write_passport(merchants.DEFAULT_MERCHANT_ID))}


@app.get("/admin/preview/{merchant_id}")
def admin_preview(merchant_id: str):
    """What the passport WOULD look like if signed right now, without writing
    it. Lets the console show the merchant exactly which fields become public
    — and, more usefully, that `cost_minor` is not among them."""
    if not merchants.exists(merchant_id):
        raise HTTPException(status_code=404, detail=f"unknown merchant: {merchant_id}")
    return build_passport(merchant_id)
