"""
CricGeek — Reasoning Agent (Chief Editor)

An LLM-powered agent that provides deep evaluation of blog content:
  1. Synthesizes verdicts from the Data Agents into a human-readable narrative
  2. Evaluates "Insight Score" — does the writer go beyond rehashing stats?
  3. Evaluates "Archetype Synergy" — does the content match the detected style?
  4. Identifies "Nuance Claims" that need web research

LLM Priority Chain:
  1. Ollama (local — Qwen 2.5 by default)
  2. Gemini (cloud fallback)
  3. OpenAI (cloud fallback)
  4. Heuristic (no LLM)
"""

import os
import re
import logging
from typing import Any, Optional
from dataclasses import dataclass, field

import ollama_client

logger = logging.getLogger("reasoning_agent")


# ── Result Models ────────────────────────────────────────────────────

@dataclass
class ReasoningResult:
    """Output from the LLM Reasoning Agent."""
    insight_score: float           # 0–100: Does the blog offer original analysis?
    archetype_synergy: float       # 0–100: Does the content match its detected style?
    narrative_quality: float       # 0–100: Quality of storytelling / argumentation
    nuance_claims: list[str]       # Claims that need web research
    editorial_summary: str         # LLM-generated "Chief Editor" review
    llm_used: str                  # Which backend was used
    raw_response: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "insight_score": self.insight_score,
            "archetype_synergy": self.archetype_synergy,
            "narrative_quality": self.narrative_quality,
            "nuance_claims": self.nuance_claims,
            "editorial_summary": self.editorial_summary,
            "llm_used": self.llm_used,
        }


# ── System Prompt ────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are the "Chief Editor" of CricGeek, a cricket blogging platform.
Your job is to evaluate cricket blog posts with the eye of a seasoned sports editor.

You will receive:
1. The blog text
2. The detected archetype (Analyst / Fan / Storyteller / Debater)
3. A list of fact-check verdicts from our data agents

You must return a JSON object with exactly these keys:
{
  "insight_score": <0-100 integer>,
  "archetype_synergy": <0-100 integer>,
  "narrative_quality": <0-100 integer>,
  "nuance_claims": [<list of sentences that make historical/anecdotal claims needing web verification>],
  "editorial_summary": "<2-3 sentence editorial review of the blog>"
}

Scoring guidelines:
- **insight_score**: 80+ = original analysis with unique angles; 50-79 = solid but conventional; <50 = rehashed stats or copy-paste commentary
- **archetype_synergy**: How well does the content match the detected archetype? A "Storyteller" should have vivid narrative, an "Analyst" should have data-driven depth, a "Fan" should have passion and emotion, a "Debater" should have structured arguments
- **narrative_quality**: Writing quality, structure, flow, engagement factor
- **nuance_claims**: Look for historical comparisons ("best since 1983"), superlatives ("greatest ever"), atmosphere claims ("record crowd"), or any factual claim that cannot be verified from match scorecards alone

Return ONLY valid JSON, no markdown fences, no extra text."""


# ── Build prompt from inputs ────────────────────────────────────────

def _build_prompt(text: str, archetype: str, verdicts: list[dict]) -> str:
    verdicts_summary = "\n".join([
        f"  - [{v.get('verdict', '?')}] {v.get('claim', '')[:80]}..."
        for v in verdicts[:10]
    ]) or "  No factual claims were identified."

    return f"""Blog Text:
{text[:3000]}

Detected Archetype: {archetype}

Fact-Check Verdicts:
{verdicts_summary}

Please evaluate this blog and return your JSON assessment."""


# ── 1. Ollama Backend (LOCAL — Primary) ──────────────────────────────

def _call_ollama(prompt: str) -> Optional[str]:
    """Call local Ollama model (Qwen 2.5 by default)."""
    if not ollama_client.is_ollama_available():
        return None

    return ollama_client.chat(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
        max_tokens=1024,
        json_mode=True,
    )


# ── 2. Gemini Backend (Cloud Fallback) ───────────────────────────────

def _call_gemini(prompt: str) -> Optional[str]:
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        return None
    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
        response = model.generate_content(
            [SYSTEM_PROMPT, prompt],
            generation_config={
                "temperature": 0.3,
                "max_output_tokens": 1024,
                "response_mime_type": "application/json",
            },
        )
        return response.text
    except ImportError:
        logger.warning("google-generativeai not installed")
        return None
    except Exception as e:
        logger.error(f"Gemini API error: {e}")
        return None


# ── 3. OpenAI Backend (Cloud Fallback) ───────────────────────────────

def _call_openai(prompt: str) -> Optional[str]:
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return None
    try:
        import openai
        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=1024,
            response_format={"type": "json_object"},
        )
        return response.choices[0].message.content
    except ImportError:
        logger.warning("openai not installed")
        return None
    except Exception as e:
        logger.error(f"OpenAI API error: {e}")
        return None


# ── 4. Heuristic Fallback ───────────────────────────────────────────

def _heuristic_evaluation(
    text: str, archetype: str, verdicts: list[dict]
) -> ReasoningResult:
    """Fallback evaluation when no LLM is available."""
    words = text.split()
    word_count = len(words)
    sentences = re.split(r"[.!?]+", text)
    sentence_count = len([s for s in sentences if len(s.strip()) > 10])

    # Insight score
    unique_words = len(set(w.lower() for w in words))
    lexical_diversity = unique_words / max(word_count, 1)
    stat_keywords = sum(1 for w in words if w.lower() in {
        "average", "strike", "rate", "economy", "wickets", "centuries",
        "data", "trend", "pattern", "analysis", "metric", "correlation",
    })
    stat_density = stat_keywords / max(word_count, 1) * 100
    insight = min(100, int(
        (lexical_diversity * 120) + (stat_density * 5) +
        (min(word_count, 1500) / 1500 * 30)
    ))

    # Archetype synergy
    text_lower = text.lower()
    synergy = 50
    archetype_markers = {
        "Analyst": ["data", "statistics", "average", "trend", "pattern", "metric", "correlation", "regression"],
        "Fan": ["love", "passion", "heart", "support", "amazing", "incredible", "goat"],
        "Storyteller": ["moment", "silence", "crowd", "atmosphere", "narrative", "journey", "chapter", "saga"],
        "Debater": ["however", "although", "argue", "counter", "perspective", "contrary", "evidence", "therefore"],
    }
    for marker in archetype_markers.get(archetype, []):
        if marker in text_lower:
            synergy += 5
    synergy = min(100, synergy)

    # Narrative quality
    avg_sentence_len = word_count / max(sentence_count, 1)
    has_good_length = 12 <= avg_sentence_len <= 25
    paragraphs = text.count("\n\n") + 1
    narrative = min(100, int(
        50 + (20 if has_good_length else 0) +
        (15 if paragraphs >= 3 else 0) + (lexical_diversity * 30)
    ))

    # Nuance claims
    nuance_patterns = [
        r"(?:first|best|worst|greatest|most)\s+(?:since|in|ever|of all time)",
        r"(?:record|historic|unprecedented|never before)",
        r"(?:biggest|largest|smallest|highest|lowest)\s+(?:crowd|attendance|score|chase)",
        r"\b(?:19|20)\d{2}\b.*(?:since|last time|reminiscent)",
    ]
    nuance_claims = []
    for sent in sentences:
        sent = sent.strip()
        if len(sent) < 10:
            continue
        for pattern in nuance_patterns:
            if re.search(pattern, sent, re.IGNORECASE):
                nuance_claims.append(sent)
                break

    verified = sum(1 for v in verdicts if v.get("verdict") == "verified")
    disputed = sum(1 for v in verdicts if v.get("verdict") == "disputed")
    total = len(verdicts)

    parts = []
    if total > 0:
        parts.append(f"Found {total} factual claims ({verified} verified, {disputed} disputed).")
    if insight >= 70:
        parts.append("The blog demonstrates strong original analysis.")
    elif insight >= 40:
        parts.append("The blog has decent content but could offer more unique insights.")
    else:
        parts.append("The blog lacks depth and original perspective.")
    parts.append(f"Writing quality is {'strong' if narrative >= 70 else 'average' if narrative >= 40 else 'below expectations'}.")

    return ReasoningResult(
        insight_score=insight,
        archetype_synergy=synergy,
        narrative_quality=narrative,
        nuance_claims=nuance_claims,
        editorial_summary=" ".join(parts),
        llm_used="heuristic_fallback",
    )


# ── Parse LLM Response ──────────────────────────────────────────────

def _parse_llm_response(raw: str, llm_name: str) -> Optional[ReasoningResult]:
    """Parse the JSON response from any LLM backend."""
    data = ollama_client.parse_json_response(raw)
    if not data:
        return None

    try:
        return ReasoningResult(
            insight_score=max(0, min(100, float(data.get("insight_score", 50)))),
            archetype_synergy=max(0, min(100, float(data.get("archetype_synergy", 50)))),
            narrative_quality=max(0, min(100, float(data.get("narrative_quality", 50)))),
            nuance_claims=data.get("nuance_claims", []),
            editorial_summary=data.get("editorial_summary", ""),
            llm_used=llm_name,
            raw_response=raw,
        )
    except (ValueError, KeyError) as e:
        logger.error(f"Failed to build result from {llm_name}: {e}")
        return None


# ── Main Entry Point ─────────────────────────────────────────────────

def evaluate_blog(
    text: str,
    archetype: str,
    verdicts: list[dict],
) -> ReasoningResult:
    """
    Evaluate a blog post using the best available LLM backend.

    Priority: Ollama (local) → Gemini → OpenAI → Heuristic Fallback
    """
    prompt = _build_prompt(text, archetype, verdicts)

    # 1. Try Ollama (local — no API key, no cost)
    raw = _call_ollama(prompt)
    if raw:
        result = _parse_llm_response(raw, f"ollama/{ollama_client.OLLAMA_MODEL}")
        if result:
            logger.info(f"Reasoning via Ollama ({ollama_client.OLLAMA_MODEL}): insight={result.insight_score}")
            return result

    # 2. Try Gemini (cloud fallback)
    raw = _call_gemini(prompt)
    if raw:
        result = _parse_llm_response(raw, "gemini-2.0-flash")
        if result:
            logger.info(f"Reasoning via Gemini: insight={result.insight_score}")
            return result

    # 3. Try OpenAI (cloud fallback)
    raw = _call_openai(prompt)
    if raw:
        result = _parse_llm_response(raw, "gpt-4o-mini")
        if result:
            logger.info(f"Reasoning via OpenAI: insight={result.insight_score}")
            return result

    # 4. Heuristic fallback
    logger.info("No LLM available, using heuristic evaluation")
    return _heuristic_evaluation(text, archetype, verdicts)
