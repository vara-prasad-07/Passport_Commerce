"""
Standalone passport verifier (merchant-side self-test).

The actual verification logic lives in `shared/verify.py` so the buyer agent
and this self-test apply byte-for-byte identical rules. This module just adds
`shared/` to the path and re-exports the two checks for convenience, plus a
CLI self-test using the locally generated files.

Run:  python verify.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shared.verify import (  # noqa: E402
    VerificationResult,
    canonical_bytes,
    verify_freshness,
    verify_passport,
    verify_signature,
)

__all__ = [
    "VerificationResult",
    "canonical_bytes",
    "verify_signature",
    "verify_freshness",
    "verify_passport",
]


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252; we print em dashes/₹

    # Quick self-test using the local generated files.
    from keys import load_public_key

    with open("passport.json") as f:
        passport = json.load(f)

    pub = load_public_key()
    sig_result, fresh_result = verify_passport(passport, pub)
    print(f"Signature check: {'PASS' if sig_result.ok else 'FAIL'} — {sig_result.reason}")
    print(f"Freshness check: {'PASS' if fresh_result.ok else 'FAIL'} — {fresh_result.reason}")

    # Tamper test — flip one character in the catalog and confirm it's caught.
    tampered = json.loads(json.dumps(passport))
    tampered["catalog"]["items"][0]["price_minor"] = 1
    sig_result_tampered, _ = verify_passport(tampered, pub)
    print(f"\nTamper test: {'CORRECTLY REJECTED' if not sig_result_tampered.ok else 'FAILED TO DETECT TAMPERING'}")
    print(f"  reason: {sig_result_tampered.reason}")
