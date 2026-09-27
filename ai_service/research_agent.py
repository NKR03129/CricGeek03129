"""
CricGeek — Research Agent (Dynamic Web Search)

Verifies claims that SportMonks cannot cover:
  - Historical anecdotes ("first time since 1983")
  - Atmosphere / context claims ("record crowd at Eden Gardens")
  - Breaking news not yet in structured data
  - Superlative claims ("greatest T20 innings ever")

Search backends: Tavily → Serper → None
LLM synthesis:   Ollama (local) → Gemini → OpenAI → keyword heuristic
"""

import os
import re
import json
import logging
from typing import Any, Optional
from dataclasses import dataclass, field

import ollama_client

logger = logging.getLogger("research_agent")


# ── Result Model ─────────────────────────────────────────────────────

@dataclass
class ResearchVerdict:
    claim: str
    verdict: str          # "supported" | "contradicted" | "inconclusive"
    confidence: float
    evidence: str
    sources: list[str] = field(default_factory=list)


@dataclass
class ResearchReport:
    claims_researched: int
    supported: int
    contradicted: int
    inconclusive: int
    verdicts: list[dict] = field(default_factory=list)
    search_backend: str = "none"

    def to_dict(self) -> dict[str, Any]:
        return {
            "claims_researched": self.claims_researched,
            "supported": self.supported,
            "contradicted": self.contradicted,
            "inconclusive": self.inconclusive,
            "verdicts": self.verdicts,
            "search_backend": self.search_backend,
        }


# ── Search Backends ──────────────────────────────────────────────────

def _search_tavily(query: str) -> Optional[dict]:
    api_key = os.getenv("TAVILY_API_KEY", "")
    if not api_key:
        return None
    try:
        import httpx
        response = httpx.post(
            "https://api.tavily.com/search",
            json={
                "api_key": api_key,
                "query": f"cricket {query}",
                "search_depth": "basic",
                "max_results": 5,
                "include_answer": True,
                "include_raw_content": False,
            },
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        logger.error(f"Tavily search failed: {e}")
        return None


def _search_serper(query: str) -> Optional[dict]:
    api_key = os.getenv("SERPER_API_KEY", "")
    if not api_key:
        return None
    try:
        import httpx
        response = httpx.post(
            "https://google.serper.dev/search",
            json={"q": f"cricket {query}", "num": 5},
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        logger.error(f"Serper search failed: {e}")
        return None


# ── LLM Verdict Synthesis ────────────────────────────────────────────

SYNTHESIS_PROMPT = """Given this cricket-related claim and the search results below,
determine whether the evidence SUPPORTS, CONTRADICTS, or is INCONCLUSIVE about the claim.

CLAIM: "{claim}"

SEARCH RESULTS:
{search_text}

Return ONLY a JSON object:
{{"verdict": "supported" | "contradicted" | "inconclusive", "confidence": 0.0-1.0, "evidence": "one-sentence key finding"}}"""


def _synthesize_verdict_with_llm(claim: str, search_text: str) -> Optional[dict]:
    """Use the best available LLM to synthesize a verdict from search results."""
    prompt = SYNTHESIS_PROMPT.format(claim=claim, search_text=search_text[:2000])

    # 1. Try Ollama (local)
    if ollama_client.is_ollama_available():
        raw = ollama_client.generate(
            prompt=prompt,
            temperature=0.1,
            max_tokens=256,
            json_mode=True,
        )
        if raw:
            data = ollama_client.parse_json_response(raw)
            if data:
                return data

    # 2. Try Gemini
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    if gemini_key:
        try:
            import google.generativeai as genai
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel("gemini-2.0-flash")
            response = model.generate_content(
                prompt,
                generation_config={
                    "temperature": 0.1,
                    "max_output_tokens": 256,
                    "response_mime_type": "application/json",
                },
            )
            data = ollama_client.parse_json_response(response.text)
            if data:
                return data
        except Exception as e:
            logger.error(f"Gemini synthesis failed: {e}")

    # 3. Try OpenAI
    openai_key = os.getenv("OPENAI_API_KEY", "")
    if openai_key:
        try:
            import openai
            client = openai.OpenAI(api_key=openai_key)
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=256,
                response_format={"type": "json_object"},
            )
            raw = response.choices[0].message.content or ""
            data = ollama_client.parse_json_response(raw)
            if data:
                return data
        except Exception as e:
            logger.error(f"OpenAI synthesis failed: {e}")

    return None


# ── Research a Single Claim ──────────────────────────────────────────

def _research_claim(claim: str) -> ResearchVerdict:
    """Research a single claim using web search + LLM synthesis."""

    search_data = _search_tavily(claim)
    backend = "tavily"

    if not search_data:
        search_data = _search_serper(claim)
        backend = "serper"

    if not search_data:
        return ResearchVerdict(
            claim=claim,
            verdict="inconclusive",
            confidence=0.0,
            evidence="No search backend available",
        )

    # Extract snippets
    sources: list[str] = []
    snippets: list[str] = []

    if backend == "tavily":
        answer = search_data.get("answer", "")
        if answer:
            snippets.append(f"Direct answer: {answer}")
        for result in search_data.get("results", []):
            snippets.append(result.get("content", "")[:200])
            url = result.get("url", "")
            if url:
                sources.append(url)
    elif backend == "serper":
        answer_box = search_data.get("answerBox", {})
        if answer_box:
            snippets.append(answer_box.get("snippet", "") or answer_box.get("answer", ""))
        for result in search_data.get("organic", [])[:5]:
            snippets.append(result.get("snippet", ""))
            url = result.get("link", "")
            if url:
                sources.append(url)

    search_text = "\n".join(snippets)

    if not search_text.strip():
        return ResearchVerdict(
            claim=claim,
            verdict="inconclusive",
            confidence=0.2,
            evidence="Search returned no relevant results",
            sources=sources,
        )

    # LLM synthesis
    llm_verdict = _synthesize_verdict_with_llm(claim, search_text)

    if llm_verdict:
        return ResearchVerdict(
            claim=claim,
            verdict=llm_verdict.get("verdict", "inconclusive"),
            confidence=float(llm_verdict.get("confidence", 0.5)),
            evidence=llm_verdict.get("evidence", "LLM synthesis"),
            sources=sources[:3],
        )

    # Keyword heuristic fallback
    claim_lower = claim.lower()
    search_lower = search_text.lower()
    claim_words = set(re.findall(r"\b\w{4,}\b", claim_lower))
    overlap = sum(1 for w in claim_words if w in search_lower)
    overlap_ratio = overlap / max(len(claim_words), 1)

    if overlap_ratio > 0.6:
        return ResearchVerdict(
            claim=claim, verdict="supported", confidence=0.6,
            evidence=f"Search results contain {overlap}/{len(claim_words)} key terms",
            sources=sources[:3],
        )
    elif overlap_ratio > 0.3:
        return ResearchVerdict(
            claim=claim, verdict="inconclusive", confidence=0.4,
            evidence="Partial keyword overlap in search results",
            sources=sources[:3],
        )
    else:
        return ResearchVerdict(
            claim=claim, verdict="inconclusive", confidence=0.3,
            evidence="Low relevance in search results",
            sources=sources[:3],
        )


# ── Main Entry Point ─────────────────────────────────────────────────

def research_claims(claims: list[str]) -> ResearchReport:
    """Research a list of nuance claims via web search + LLM."""
    if not claims:
        return ResearchReport(
            claims_researched=0, supported=0,
            contradicted=0, inconclusive=0, search_backend="none",
        )

    backend = "none"
    if os.getenv("TAVILY_API_KEY"):
        backend = "tavily"
    elif os.getenv("SERPER_API_KEY"):
        backend = "serper"

    verdicts: list[ResearchVerdict] = []
    for claim in claims[:10]:
        verdict = _research_claim(claim)
        verdicts.append(verdict)

    supported = sum(1 for v in verdicts if v.verdict == "supported")
    contradicted = sum(1 for v in verdicts if v.verdict == "contradicted")
    inconclusive = sum(1 for v in verdicts if v.verdict == "inconclusive")

    report = ResearchReport(
        claims_researched=len(verdicts),
        supported=supported,
        contradicted=contradicted,
        inconclusive=inconclusive,
        verdicts=[
            {
                "claim": v.claim, "verdict": v.verdict,
                "confidence": v.confidence, "evidence": v.evidence,
                "sources": v.sources,
            }
            for v in verdicts
        ],
        search_backend=backend,
    )

    logger.info(
        f"Research complete: {len(verdicts)} claims — "
        f"{supported} supported, {contradicted} contradicted, "
        f"{inconclusive} inconclusive (backend: {backend})"
    )
    return report
