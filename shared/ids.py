"""ID generation and content hashing shared across services."""

from __future__ import annotations

import hashlib
import json
import uuid


def new_correlation_id() -> str:
    """One per buyer session/request — threads through every log line and
    API response so a full transaction can be traced end to end."""
    return f"req_{uuid.uuid4().hex[:12]}"


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def hash_payload(obj) -> str:
    """Deterministic short hash of any JSON-able object, used as the
    idempotency key basis and for audit `input_hash` fields."""
    canonical = json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
