"""
Turns an already-final MarginMind decision into a buyer-facing natural
language explanation. This file NEVER changes what was decided — it only
narrates numbers that already exist in the decision JSON, and is
explicitly instructed not to invent ones it doesn't have. If this call
fails or is skipped, the raw decision is still fully usable; the
explanation is a UX layer, not a dependency of the money path.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shared.models import BuyerIntent, MarginMindDecision  # noqa: E402

import config  # noqa: E402
import llm  # noqa: E402

SYSTEM_PROMPT = """You are the voice of a shopping assistant. You are given a JSON decision
already made by a deterministic merchant pricing engine (MarginMind) and the buyer's
original request. Write a short (2-4 sentence), warm, concrete explanation for the buyer.

Hard rules:
- Use ONLY numbers and facts present in the JSON. Never invent a price, margin, or SKU.
- Rupee amounts in the JSON are in minor units (paise) - divide by 100 and format as ₹X (e.g. ₹849).
- If status is "accepted", explain why the top option was chosen, referencing at least one
  concrete rationale field (e.g. margin, budget fit, bundle discount) and mention the
  delivery/region constraint if present in the buyer's request.
- If status is "declined", clearly state why in plain language and what the buyer could do
  next (raise budget, relax a preference) - do not apologize excessively, be direct and useful.
- Never mention internal field names verbatim (say "profit margin" not "estimated_margin_percent").
"""


def explain_decision(decision: MarginMindDecision, intent: BuyerIntent) -> str:
    model = llm.chat(model=config.GROQ_EXPLAIN_MODEL, temperature=0.3, max_tokens=1024)
    payload = {"buyer_request": intent.model_dump(), "decision": decision.model_dump()}
    response = model.invoke(
        [("system", SYSTEM_PROMPT), ("human", json.dumps(payload, indent=2))]
    )

    content = response.content
    # Reasoning models can return their whole completion as reasoning and leave
    # `content` empty. That is not an exception, so nothing upstream would catch
    # it — the buyer would just see a blank explanation. Treat it as a failure
    # and let the caller fall back to the decision's own message.
    text = (content if isinstance(content, str) else "").strip()
    if not text:
        raise RuntimeError(
            "Explainer returned no visible content — the model spent its entire "
            "token budget on reasoning. Raise max_tokens or lower GROQ_REASONING_EFFORT."
        )
    return text
