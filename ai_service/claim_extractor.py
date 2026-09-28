"""
CricGeek — Claim Extractor

Parses blog text into structured, typed claims that can be routed
to specialized verification agents.

Claim Types:
  - live_score       "RCB are 82/3 after 11 overs"
  - match_result     "India won the previous ODI"
  - player_stat      "Kohli averages 58 in ODIs"
  - bowling_figure   "Bumrah took 3/23"
  - ranking_claim    "India are No. 1 in T20Is"
  - table_position   "They are top of the table"
  - team_trend       "Won 4 of last 5"
  - lineup_claim     "KL Rahul captained the side"
  - innings_total    "Australia chased 280"
"""

import re
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("claim_extractor")


@dataclass
class Claim:
    """A single factual claim extracted from blog text."""
    text: str                          # The raw sentence / phrase
    claim_type: str                    # One of the claim types above
    entities: list[str] = field(default_factory=list)  # Players/teams mentioned
    numbers: list[str] = field(default_factory=list)   # Numbers found in the claim
    context: str = ""                  # Surrounding context for disambiguation
    sentence_index: int = 0           # Position in the blog


# ── Claim Patterns ───────────────────────────────────────────────────
# Each pattern is (regex, claim_type). Patterns are tested against
# individual sentences from the blog.

_SEP = r"(?:\s+(?:of|is|at|around|only|approx\.?|roughly|currently|his|her|its))*\s*[:\-]?\s*"

CLAIM_PATTERNS: list[tuple[str, str]] = [
    # Live score claims
    (r"(?:are|is|at|on|sitting)\s+(\d+)[/-](\d+)\s+(?:after|in|at)\s+(\d+(?:\.\d+)?)\s+overs?", "live_score"),
    (r"(?:currently|live|right now).*?(\d+)[/-](\d+)", "live_score"),
    (r"already\s+(?:has|have|taken|scored)\s+(\d+)\s+(?:wickets?|runs?)", "live_score"),

    # Match result claims
    (r"(?:won|lost|beat|defeated|drew)\s+(?:the|their|a)?\s*(?:previous|last|recent|first|second)?\s*(?:match|game|odi|test|t20i?|series|final)", "match_result"),
    (r"(?:won|beat|defeated)\s+(?:by|against)\s+(\d+)\s*(?:runs?|wickets?)", "match_result"),
    (r"(?:won|lost)\s+(?:the|a)\s+(?:match|game|series|final|semi-?final)", "match_result"),

    # Innings total / chase claims
    (r"(?:scored|posted|set|chased|chasing)\s+(\d{2,3})[/-]?(\d+)?\s*(?:in|from|after)?\s*(\d+(?:\.\d+)?)?\s*(?:overs?)?", "innings_total"),
    (r"(?:target|chase|defend|defending)\s+(?:of\s+)?(\d{2,3})", "innings_total"),

    # Player stat claims
    (r"(?:average|avg)" + _SEP + r"(\d+(?:\.\d+)?)", "player_stat"),
    (r"(?:strike\s+rate|sr)" + _SEP + r"(\d+(?:\.\d+)?)", "player_stat"),
    (r"(?:economy|econ)" + _SEP + r"(\d+(?:\.\d+)?)", "player_stat"),
    (r"(\d+)\s+(?:centuries|hundreds|100s)", "player_stat"),
    (r"(\d+)\s+(?:fifties|half-centuries|50s)", "player_stat"),
    (r"(\d+)\s+(?:wickets?)\s+(?:in|across|over|this|last)", "player_stat"),
    (r"scored\s+(\d{3,5})\s+(?:runs?|total)", "player_stat"),

    # Bowling figure claims
    (r"(?:took|claimed|grabbed|picked|bowling figures of)\s+(\d)[/-](\d+)", "bowling_figure"),
    (r"(\d)[/-](\d+)\s+(?:in|from)\s+(\d+(?:\.\d+)?)\s*overs?", "bowling_figure"),

    # Ranking claims
    (r"(?:no\.?\s*|number\s*|#\s*)(\d+)\s+(?:in|ranked|ranking)", "ranking_claim"),
    (r"(?:top|number one|first|1st)\s+(?:in|of)\s+(?:the)?\s*(?:icc|world)?\s*(?:test|odi|t20i?|ranking)", "ranking_claim"),
    (r"(?:lead|leads|leading)\s+(?:the)?\s*(?:icc|world)?\s*(?:test|odi|t20i?)\s*(?:ranking|table|chart)", "ranking_claim"),

    # Table position claims
    (r"(?:top|bottom|first|last|second|third|\d+(?:st|nd|rd|th))\s+(?:of|in|on|place|position)\s+(?:the)?\s*(?:table|standings|group|points)", "table_position"),
    (r"(?:qualified|qualifying|eliminated|out)\s+(?:for|from|of)\s+(?:the)?\s*(?:playoffs?|final|semi|knockouts?)", "table_position"),

    # Team trend claims
    (r"(?:won|lost)\s+(\d+)\s+(?:of|out of|from)\s+(?:their)?\s*(?:last|previous|past)\s+(\d+)", "team_trend"),
    (r"(?:unbeaten|winning)\s+(?:streak|run|form)\s+(?:of\s+)?(\d+)", "team_trend"),
    (r"(?:average|averaging)\s+(\d+(?:\.\d+)?)\s+(?:batting|bowling|scoring|chasing|defending)\s+(?:first|second)?", "team_trend"),

    # Lineup / captain claims
    (r"(?:captain(?:ed|s)?|led|skipper(?:ed)?)\s+(?:the)?\s*(?:side|team|squad|xi)", "lineup_claim"),
    (r"(?:played|was|were|included|dropped|left out)\s+(?:in|from)\s+(?:the)?\s*(?:playing)?\s*(?:xi|eleven|squad|team)", "lineup_claim"),
    (r"(?:wicket-?keeper|keeper|wk)\s+(?:was|is|for)", "lineup_claim"),
]


# ── Entity / Number extractors ───────────────────────────────────────

# Known team keywords for quick detection
_TEAM_KEYWORDS = {
    "india", "australia", "england", "pakistan", "new zealand", "south africa",
    "west indies", "sri lanka", "bangladesh", "afghanistan", "zimbabwe", "ireland",
    "mumbai indians", "mi", "chennai super kings", "csk", "royal challengers",
    "rcb", "kolkata knight riders", "kkr", "delhi capitals", "dc",
    "sunrisers hyderabad", "srh", "punjab kings", "pbks", "rajasthan royals", "rr",
    "gujarat titans", "gt", "lucknow super giants", "lsg",
}

# Known player names for quick detection
_PLAYER_KEYWORDS = {
    "kohli", "virat", "rohit", "bumrah", "dhoni", "sachin", "tendulkar",
    "pandya", "pant", "rahul", "gill", "suryakumar", "sky",
    "jadeja", "ashwin", "chahal", "shami", "siraj", "kuldeep",
    "smith", "warner", "cummins", "starc", "lyon", "hazlewood", "maxwell",
    "head", "labuschagne", "green", "stoinis",
    "root", "stokes", "anderson", "broad", "buttler", "bairstow", "brook",
    "babar", "shaheen", "rizwan", "naseem",
    "williamson", "boult", "southee", "conway",
    "rabada", "de kock", "markram", "bavuma",
    "gayle", "russell", "pooran",
    "rashid khan", "hasaranga", "shakib",
}

_NUMBER_RE = re.compile(r"\b(\d+(?:\.\d+)?)\b")


def _extract_entities(sentence: str) -> list[str]:
    """Extract player and team names from a sentence."""
    lower = sentence.lower()
    entities = []
    for kw in _TEAM_KEYWORDS:
        if kw in lower:
            entities.append(kw)
    for kw in _PLAYER_KEYWORDS:
        if kw in lower:
            entities.append(kw)
    return entities


def _extract_numbers(sentence: str) -> list[str]:
    return _NUMBER_RE.findall(sentence)


# ── Main extraction function ─────────────────────────────────────────

def extract_claims(text: str) -> list[Claim]:
    """
    Extract all verifiable claims from a blog text.

    Steps:
    1. Split text into sentences
    2. For each sentence, test against all claim patterns
    3. Extract entities and numbers for context
    4. De-duplicate overlapping claims
    """
    # Split into sentences
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    claims: list[Claim] = []
    seen_texts: set[str] = set()

    for idx, sentence in enumerate(sentences):
        sentence = sentence.strip()
        if len(sentence) < 10:
            continue

        sentence_lower = sentence.lower()

        for pattern, claim_type in CLAIM_PATTERNS:
            if re.search(pattern, sentence_lower, re.IGNORECASE):
                # De-duplicate: don't add the same sentence twice for the same type
                dedup_key = f"{claim_type}:{sentence[:50]}"
                if dedup_key in seen_texts:
                    continue
                seen_texts.add(dedup_key)

                entities = _extract_entities(sentence)
                numbers = _extract_numbers(sentence)

                # Context: grab adjacent sentences
                context_parts = []
                if idx > 0:
                    context_parts.append(sentences[idx - 1].strip())
                context_parts.append(sentence)
                if idx < len(sentences) - 1:
                    context_parts.append(sentences[idx + 1].strip())
                context = " ".join(context_parts)

                claims.append(Claim(
                    text=sentence,
                    claim_type=claim_type,
                    entities=entities,
                    numbers=numbers,
                    context=context,
                    sentence_index=idx,
                ))
                break  # One claim type per sentence (first match wins)

    logger.info(f"Extracted {len(claims)} claims from blog text ({len(sentences)} sentences)")
    return claims
