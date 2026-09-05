"""
Bounded negotiation loop: when MarginMind declines a request for a
BUYER-side reason (nothing fits their stated budget, or nothing matches
their stated criteria), a LangChain tool-calling agent gets a small,
capped number of attempts to relax ONE non-essential preference at a time
and retry — instead of the buyer agent simply reporting failure.

This never touches merchant bounds. The agent's only tool calls back into
the exact same `MarginMind.recommend()` gate a direct request would use,
so whatever it comes back with is exactly as safe as the happy path —
negotiation happens entirely on the buyer-fit axis, never on money rules.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Callable, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from langchain.agents import create_agent  # noqa: E402
from langchain.agents.structured_output import ToolStrategy  # noqa: E402
from langchain_core.tools import tool  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from shared.models import BuyerIntent, MarginMindDecision  # noqa: E402

import config  # noqa: E402
import llm  # noqa: E402
import marginmind_client  # noqa: E402

SYSTEM_PROMPT = """A merchant's pricing engine (MarginMind) just declined a buyer's request.
You may retry by adjusting the buyer's SOFT preferences only, using the `retry_recommendation` tool:

 - You may drop ONE tag from dietary_include per attempt if it is not the buyer's primary
   identity constraint (e.g. drop "high-protein" but never drop "vegetarian" or "vegan" —
   those are hard identity constraints and must never be relaxed).
 - You may drop meal_type if nothing else works.
 - You must NEVER change budget_max_minor, people_count, or dietary_exclude — those are not
   yours to negotiate, and the tool does not accept them.

Stop as soon as a call returns status "accepted". You have a limited number of attempts —
stop and give up cleanly once you've used them or run out of reasonable relaxations. Always
finish with a structured result naming exactly which constraints (if any) you relaxed, and a
one-sentence buyer-facing summary of what happened.
"""


class NegotiationOutcome(BaseModel):
    final_status: str = Field(description='Either "accepted" or "gave_up".')
    relaxed_constraints: list[str] = Field(default_factory=list)
    attempts_made: int
    summary: str = Field(description="One sentence, plain language, addressed to the buyer.")


def negotiate(
    *,
    correlation_id: str,
    intent: BuyerIntent,
    buyer_passport_snapshot: dict,
    first_decision: MarginMindDecision,
    on_attempt: Optional[Callable[[int, BuyerIntent, MarginMindDecision], None]] = None,
    merchant_id: Optional[str] = None,
) -> tuple[NegotiationOutcome, Optional[MarginMindDecision]]:
    """Returns (outcome, last MarginMind decision seen — accepted or None).

    `on_attempt(attempt_number, adjusted_intent, decision)` is called after
    each retry so a caller can trace the individual round trips. Watching the
    agent bounce off MarginMind and stop is the actual argument here — a
    single "negotiated" summary hides the part worth seeing, which is that
    trying harder never gets it through.
    """
    state = {"attempts": 0, "last_decision": None}

    @tool
    def retry_recommendation(dietary_include: list[str], meal_type: str = "") -> str:
        """Retry MarginMind's recommendation with a relaxed dietary_include list
        and/or meal_type. people_count, budget_max_minor, dietary_exclude, region,
        and delivery_window are carried over unchanged from the original request."""
        state["attempts"] += 1
        adjusted = intent.model_copy(
            update={"dietary_include": dietary_include, "meal_type": meal_type or None}
        )
        decision = marginmind_client.recommend(
            correlation_id=correlation_id,
            intent=adjusted,
            buyer_passport_snapshot=buyer_passport_snapshot,
            merchant_id=merchant_id,
        )
        state["last_decision"] = decision
        if on_attempt is not None:
            # Never let a tracing callback break a negotiation that otherwise
            # worked — this is observability, not part of the decision.
            try:
                on_attempt(state["attempts"], adjusted, decision)
            except Exception:  # noqa: BLE001
                pass
        return json.dumps(
            {
                "status": decision.status,
                "code": decision.code,
                "message": decision.message,
                "option_count": len(decision.options),
                "cheapest_total_minor": decision.options[0].total_minor if decision.options else None,
            }
        )

    model = llm.chat(temperature=0, max_tokens=2048)
    agent = create_agent(
        model=model,
        tools=[retry_recommendation],
        system_prompt=SYSTEM_PROMPT,
        # ToolStrategy, not a bare schema: passing the model class directly lets
        # LangChain pick the provider's native structured-output mode, and Groq
        # rejects JSON mode combined with tool calling ("json mode cannot be
        # combined with tool/function calling", HTTP 400). Returning the schema
        # through a tool call instead is compatible with the retry tool above.
        response_format=ToolStrategy(NegotiationOutcome),
    )

    briefing = (
        f"Original request: {intent.model_dump()}\n"
        f"MarginMind declined with code={first_decision.code!r}, message={first_decision.message!r}.\n"
        f"You have at most {config.NEGOTIATION_MAX_ATTEMPTS} attempts via retry_recommendation."
    )
    result = agent.invoke(
        {"messages": [{"role": "user", "content": briefing}]},
        config={"recursion_limit": config.NEGOTIATION_MAX_ATTEMPTS * 2 + 6},
    )
    outcome: NegotiationOutcome = result["structured_response"]
    return outcome, state["last_decision"]
