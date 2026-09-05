"""
Buyer-side passport client: fetch, verify signature, verify freshness.

This is the ONLY place the buyer agent obtains merchant trust data — never
a local file, never something the merchant pushed proactively. Everything
downstream (MarginMind calls, explanations, the dashboard) works off the
dict this returns, tagged with whether it actually passed both checks.

The public key is re-fetched alongside the passport on every call rather than
cached. That is slower than it needs to be and deliberately so: caching a key
is a real optimisation with a real invalidation story (rotation, revocation),
and faking it here would make the demo quietly wrong about the one thing it
is trying to demonstrate.
"""

from __future__ import annotations

import os
import sys
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402

from shared.verify import load_public_key_from_pem, verify_passport  # noqa: E402

import config  # noqa: E402


class PassportFetchError(Exception):
    """Infrastructure failure (unreachable service, malformed response) —
    distinct from a failed trust check, which is an expected outcome."""


def passport_urls(merchant_id: Optional[str] = None) -> tuple[str, str]:
    """(passport_url, public_key_url) for a merchant.

    A named merchant is namespaced by id, matching how a real registry would
    address many merchants behind one origin. The unnamespaced path stays as
    the default merchant's canonical well-known URL, because that is the
    shape a merchant actually publishes on their own domain.
    """
    base = config.PASSPORT_BASE_URL.rstrip("/")
    if merchant_id and merchant_id != config.DEFAULT_MERCHANT_ID:
        prefix = f"{base}/m/{merchant_id}"
    else:
        prefix = base
    return (
        f"{prefix}/.well-known/agent-commerce.json",
        f"{prefix}/.well-known/agent-commerce-key.json",
    )


def fetch_and_verify_passport(
    merchant_id: Optional[str] = None, *, tamper: Optional[str] = None
) -> dict:
    """Never raises on a failed verification — rejecting an untrustworthy
    passport is a normal, expected result the caller must act on. Raises
    PassportFetchError only when the passport service itself is unreachable
    or returns something unparseable.

    `tamper` asks the passport service to serve a deliberately corrupted copy,
    used by the Red Team console. It is a request parameter rather than
    client-side mutation on purpose: the bytes really do arrive over the wire
    already broken, so the verification below is doing genuine work rather
    than checking a value this function just edited.
    """
    passport_url, key_url = passport_urls(merchant_id)
    params = {"tamper": tamper} if tamper else None

    try:
        with httpx.Client(timeout=10.0) as client:
            passport_resp = client.get(passport_url, params=params)
            passport_resp.raise_for_status()
            passport = passport_resp.json()

            key_resp = client.get(key_url)
            key_resp.raise_for_status()
            key_payload = key_resp.json()
    except httpx.HTTPError as exc:
        raise PassportFetchError(
            f"could not reach passport service at {passport_url}: {exc}"
        ) from exc

    try:
        public_key = load_public_key_from_pem(key_payload["public_key_pem"])
    except (KeyError, ValueError) as exc:
        raise PassportFetchError(f"malformed public key response: {exc}") from exc

    sig_result, fresh_result = verify_passport(passport, public_key)

    return {
        "passport": passport,
        "merchant_id": merchant_id or config.DEFAULT_MERCHANT_ID,
        "passport_url": passport_url,
        "key_id": key_payload.get("key_id"),
        "signature_ok": sig_result.ok,
        "signature_reason": sig_result.reason,
        "freshness_ok": fresh_result.ok,
        "freshness_reason": fresh_result.reason,
        "trusted": sig_result.ok and fresh_result.ok,
        "tampered": bool(tamper),
    }
