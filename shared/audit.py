"""
Append-only audit log shared by marginmind, buyer-agent, and payments.

Every pipeline stage — passport fetch, verification, basket ranking, margin
check, consent, order creation, payment verification, decline — appends one
JSON line here. Nothing is ever rewritten or deleted: the dashboard's audit
view and the "prove no money action happened" story both depend on this file
being append-only. A per-process lock is enough here since the demo runs a
handful of local services, not a distributed fleet.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from shared.ids import new_id

AUDIT_DIR = Path(__file__).resolve().parent.parent / "audit"
AUDIT_LOG_PATH = AUDIT_DIR / "audit.log"

_lock = threading.Lock()


def append_event(
    *,
    correlation_id: str,
    actor: str,
    event_type: str,
    decision: Optional[str] = None,
    outcome: Optional[str] = None,
    input_hash: Optional[str] = None,
    detail: Optional[dict[str, Any]] = None,
) -> dict:
    """Append one immutable audit record and return it (already-serializable dict)."""
    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    event = {
        "event_id": new_id("evt"),
        "correlation_id": correlation_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "actor": actor,
        "event_type": event_type,
        "decision": decision,
        "outcome": outcome,
        "input_hash": input_hash,
        "detail": detail or {},
    }
    line = json.dumps(event, separators=(",", ":"), default=str)
    with _lock:
        with open(AUDIT_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    return event


def read_events(limit: int = 200, correlation_id: Optional[str] = None) -> list[dict]:
    """Newest-first. Tolerates a missing file (nothing logged yet)."""
    if not AUDIT_LOG_PATH.exists():
        return []
    events: list[dict] = []
    with open(AUDIT_LOG_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if correlation_id and event.get("correlation_id") != correlation_id:
                continue
            events.append(event)
    return events[-limit:][::-1]
