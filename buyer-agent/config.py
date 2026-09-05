"""
Environment configuration for the buyer-agent service. Loads `.env` from the
repo root (never committed — see .gitignore) via python-dotenv, then falls
back to whatever is already in the process environment.

RAZORPAY_LIVE is the one flag the rest of the codebase branches on: real
Razorpay Orders/Checkout/webhook verification when both key vars are set,
a clearly-labeled simulated flow otherwise. Same code path either way —
only this module's booleans change.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
GROQ_EXPLAIN_MODEL = os.getenv("GROQ_EXPLAIN_MODEL", GROQ_MODEL)

# Only meaningful on reasoning models (gpt-oss, qwen3), which is what the
# default above is. "low" roughly halves latency on the short, tightly-scoped
# prompts this service sends. Set it to empty in .env when pointing GROQ_MODEL
# at a non-reasoning model, which will reject the parameter.
GROQ_REASONING_EFFORT = os.getenv("GROQ_REASONING_EFFORT", "low").strip()

# 127.0.0.1, not "localhost", and this matters more than it looks.
#
# On Windows "localhost" resolves to ::1 first. Uvicorn bound to IPv4 does not
# answer there, so every single inter-service call paid a ~2.1s connection
# timeout before falling back to IPv4 — measured, not guessed: 2095ms via
# localhost versus 0.9ms via 127.0.0.1. That was four of the six seconds in a
# demo run, spent entirely on a name lookup, and it made the deterministic
# services look slower than the LLM calls.
PASSPORT_BASE_URL = os.getenv("PASSPORT_BASE_URL", "http://127.0.0.1:8001")
MARGINMIND_BASE_URL = os.getenv("MARGINMIND_BASE_URL", "http://127.0.0.1:8002")

# Every passport and every MarginMind decision is namespaced by merchant, so
# a second merchant is a data change rather than a code change. This id names
# the one whose passport is served at the unnamespaced well-known URL — the
# shape a merchant publishes on their own domain.
DEFAULT_MERCHANT_ID = os.getenv("DEFAULT_MERCHANT_ID", "greenbowl")

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
RAZORPAY_LIVE = bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)

NEGOTIATION_MAX_ATTEMPTS = int(os.getenv("NEGOTIATION_MAX_ATTEMPTS", "3"))


def require_groq_key() -> None:
    if not GROQ_API_KEY:
        raise RuntimeError(
            "GROQ_API_KEY is not set. Add it to a .env file at the repo root "
            "(copy .env.example) or export it in your shell before starting buyer-agent."
        )
