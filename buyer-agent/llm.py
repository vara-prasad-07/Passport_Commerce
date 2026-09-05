"""
The one place a Groq chat model gets constructed.

Every LLM step in this service (intent parsing, negotiation, explanation)
builds its model here rather than calling ChatGroq directly, so provider
concerns live in exactly one file: the API key check, the reasoning-effort
setting, and the token budget policy below. Swapping provider later is a
change to this module, not a change to three call sites.
"""

from __future__ import annotations

from langchain_groq import ChatGroq

import config


def chat(*, model: str | None = None, temperature: float = 0.0, max_tokens: int = 2048) -> ChatGroq:
    """Build a configured chat model, failing fast if no API key is set.

    `max_tokens` deliberately defaults high. On reasoning models such as
    `openai/gpt-oss-20b` the reasoning trace is billed against the same
    completion budget as the visible answer, so a budget tight enough to fit
    only the answer can be consumed entirely by reasoning — the request then
    succeeds with empty content rather than failing loudly. Headroom here is
    what keeps that from silently producing a blank explanation.
    """
    config.require_groq_key()

    kwargs = {
        "model": model or config.GROQ_MODEL,
        "api_key": config.GROQ_API_KEY,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    # Only forward reasoning_effort when it's configured: it is accepted by
    # reasoning models (gpt-oss, qwen3) and rejected by others, so leaving it
    # blank in .env is the escape hatch after switching to a non-reasoning model.
    if config.GROQ_REASONING_EFFORT:
        kwargs["reasoning_effort"] = config.GROQ_REASONING_EFFORT

    return ChatGroq(**kwargs)
