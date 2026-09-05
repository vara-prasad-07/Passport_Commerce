"""
LLM intent parsing: free text -> structured BuyerIntent.

This is one of only two places an LLM's output feeds into the pipeline at
all (the other is the negotiator), and even here it only produces a
*request* — never a decision. MarginMind independently re-derives every
number that matters for money; a parsing mistake here can produce a worse
recommendation, never an unsafe one.

It also answers a cheaper question first: is this a shopping request at all?
Spinning up a passport fetch, a policy evaluation and a merchant's decision
engine because someone typed "hi" is wasteful and, on a dashboard that shows
the whole pipeline moving, actively misleading. Classifying and parsing in
ONE call rather than two keeps the common case — a real request — at a single
round trip.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shared.models import BuyerIntent  # noqa: E402

import llm  # noqa: E402

SYSTEM_PROMPT = """You turn a buyer's free-text shopping request into a structured filter.

FIRST decide whether the message is a request to buy or find something purchasable.

- is_purchase_request = true for anything describing goods to buy, even loosely:
  "high protein snacks for two", "something vegan under 300", "breakfast for tomorrow",
  "I'm hungry, need lunch". Vague is still a purchase request — downstream code handles
  a thin request perfectly well, and refusing a real buyer is far worse than parsing a
  loose one.
- is_purchase_request = false ONLY for messages that are clearly not shopping at all:
  greetings ("hi", "hello"), questions about the system or the weather, small talk,
  instructions aimed at you, gibberish, or an empty message.
- When false, set off_topic_reply to ONE short friendly sentence (max 20 words) telling
  the buyer what to ask for instead. Leave every other field at its default.
- When false you may stop there. When true, fill in the rest of the fields.

Rules for the rest:
- Monetary amounts in the output are in MINOR units (paise): multiply the rupee amount by 100.
  "under 900 rupees" -> budget_max_minor = 90000. "budget of 500" -> budget_max_minor = 50000.
- dietary_include: positive dietary/attribute tags the buyer asked for, lowercase, hyphenated
  the way a catalog would tag them (e.g. "high-protein", "vegetarian", "vegan", "low-sugar").
- dietary_exclude: tags that must NOT appear (e.g. a vegetarian buyer excludes "non-vegetarian").
  Always infer this from a stated dietary identity even if the buyer didn't say "exclude".
  This list is the ONLY hard filter downstream — a tag in dietary_include is a preference that
  may be traded away, but a tag here can never be served. So a dietary identity must be spelled
  out here in full, not just in dietary_include:
    "vegetarian" -> dietary_exclude includes "non-vegetarian"
    "vegan"      -> dietary_exclude includes "non-vegetarian" AND "dairy"
  Omitting these is a correctness bug, not a style choice: a vegan buyer who only has "vegan" in
  dietary_include can be offered a dairy product.
- meal_type: one of breakfast/lunch/dinner/snack if mentioned or implied, else null.
- people_count: integer, default 1 if not stated.
- region: an India region/city code if mentioned (e.g. "Bangalore" -> "IN-BLR"), else null.
- delivery_window: short phrase like "tomorrow", "today", "this evening", else null.
- currency: "INR" unless another currency is explicitly stated.
- raw_text: echo the buyer's original message verbatim.

If something isn't stated, leave it at its default — never invent specifics the buyer
didn't give you.
"""


def parse_intent(raw_text: str) -> BuyerIntent:
    model = llm.chat(temperature=0, max_tokens=2048)
    structured_model = model.with_structured_output(BuyerIntent)
    result: BuyerIntent = structured_model.invoke(
        [("system", SYSTEM_PROMPT), ("human", raw_text)]
    )
    if not result.raw_text:
        result.raw_text = raw_text

    # An empty or whitespace-only message is not a judgement call, so it is
    # settled here rather than spent on a model round trip.
    if not raw_text.strip():
        result.is_purchase_request = False
        result.off_topic_reply = result.off_topic_reply or "Tell me what you'd like to buy."

    # Fail toward being helpful: a message classified as off-topic with no
    # explanation would leave the buyer staring at a dead end.
    if not result.is_purchase_request and not result.off_topic_reply:
        result.off_topic_reply = (
            "I can only shop for you — try something like "
            "“high-protein breakfast for two under ₹900”."
        )
    return result
