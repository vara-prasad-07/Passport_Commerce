"""
Canonical passport verification logic — the ONE place that decides whether a
signed Merchant Passport is authentic and fresh.

This lives in `shared/` (not duplicated per-service) because both the
merchant's own self-test (`passport/verify.py`) and the buyer agent
(`buyer-agent/passport_client.py`) must apply byte-for-byte identical rules.
A buyer agent only ever has the PEM text fetched over HTTP from
`/.well-known/agent-commerce-key.json` — never a local key file — so
`load_public_key_from_pem` is the entry point real callers use.
"""

from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


@dataclass
class VerificationResult:
    ok: bool
    reason: str


def canonical_bytes(obj: dict) -> bytes:
    """Deterministic JSON encoding so signer and verifier hash identical bytes."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode("utf-8")


def load_public_key_from_pem(pem_text: str) -> Ed25519PublicKey:
    """Parse a PEM string fetched over HTTP into a usable public key object.

    This is the only way a buyer agent should ever obtain the merchant's
    public key — never from a local file, since the buyer is a different
    party than the merchant.
    """
    return serialization.load_pem_public_key(pem_text.encode("utf-8"))


def verify_signature(passport: dict, public_key: Ed25519PublicKey) -> VerificationResult:
    """Check A: has the passport been tampered with since it was signed?"""
    passport_copy = dict(passport)
    integrity = passport_copy.pop("integrity", None)
    if not integrity:
        return VerificationResult(ok=False, reason="passport has no integrity block")

    payload_bytes = canonical_bytes(passport_copy)

    declared_hash = integrity.get("payload_sha256")
    actual_hash = hashlib.sha256(payload_bytes).hexdigest()
    if declared_hash != actual_hash:
        return VerificationResult(
            ok=False,
            reason=f"payload hash mismatch: declared={declared_hash} actual={actual_hash}",
        )

    try:
        signature = base64.urlsafe_b64decode(integrity["signature"])
        public_key.verify(signature, payload_bytes)
    except (InvalidSignature, KeyError, ValueError):
        return VerificationResult(ok=False, reason="signature invalid — passport may be tampered")

    return VerificationResult(ok=True, reason="signature valid")


def verify_freshness(passport: dict) -> VerificationResult:
    """Check B: is this passport too old to trust?"""
    version_str = passport.get("version")
    ttl_seconds = passport.get("catalog", {}).get("ttl_seconds")

    if version_str is None or ttl_seconds is None:
        return VerificationResult(ok=False, reason="missing version or ttl_seconds field")

    try:
        issued_at = datetime.fromisoformat(version_str)
    except ValueError:
        return VerificationResult(ok=False, reason=f"unparseable version timestamp: {version_str}")

    if issued_at.tzinfo is None:
        issued_at = issued_at.replace(tzinfo=timezone.utc)

    age_seconds = (datetime.now(timezone.utc) - issued_at).total_seconds()

    if age_seconds > ttl_seconds:
        return VerificationResult(
            ok=False,
            reason=f"passport stale: age={int(age_seconds)}s exceeds ttl={ttl_seconds}s",
        )

    return VerificationResult(ok=True, reason=f"fresh: age={int(age_seconds)}s within ttl={ttl_seconds}s")


def verify_passport(
    passport: dict, public_key: Ed25519PublicKey
) -> tuple[VerificationResult, VerificationResult]:
    """Runs both checks. Caller decides whether both must pass (they should)."""
    return verify_signature(passport, public_key), verify_freshness(passport)
