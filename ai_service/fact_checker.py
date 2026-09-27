"""
CricGeek — Fact-Checker Orchestrator (V2 — Hybrid LLM-Stat)

Full multi-agent pipeline:
  1. Extract claims from blog text (regex)
  2. Route stat claims to specialized Data Agents (SportMonks)
  3. Pass blog to Reasoning Agent (LLM) for insight/synergy evaluation
  4. Send nuance claims to Research Agent (web search + LLM synthesis)
  5. Aggregate all results into a comprehensive FactCheckReport
  6. Compute final fact_check_score (0–100)
"""

import time
import logging
from dataclasses import dataclass, field
from typing import Any

from claim_extractor import extract_claims, Claim
from verification_agents import (
    ClaimVerdict,
    get_agent_for_claim,
)
from reasoning_agent import evaluate_blog, ReasoningResult
from research_agent import research_claims, ResearchReport
from sportmonks_client import get_sportmonks_client
from entity_cache import get_entity_cache

logger = logging.getLogger("fact_checker")


# ── Report Model ─────────────────────────────────────────────────────

@dataclass
class FactCheckReport:
    """Complete fact-check report for a blog post (V2)."""
    # Data Agent results
    total_claims: int
    verified_count: int
    disputed_count: int
    unverifiable_count: int

    # LLM Reasoning results
    insight_score: float            # 0–100
    archetype_synergy: float        # 0–100
    narrative_quality: float        # 0–100
    editorial_summary: str

    # Research Agent results
    research_supported: int
    research_contradicted: int
    research_inconclusive: int

    # Final scores
    fact_check_score: float         # 0–100 (data agents)
    combined_score: float           # 0–100 (weighted blend of all agents)

    # Metadata
    verdicts: list[dict] = field(default_factory=list)
    research_verdicts: list[dict] = field(default_factory=list)
    processing_time_ms: int = 0
    sportmonks_available: bool = False
    llm_used: str = "none"
    search_backend: str = "none"
    summary: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_claims": self.total_claims,
            "verified_count": self.verified_count,
            "disputed_count": self.disputed_count,
            "unverifiable_count": self.unverifiable_count,
            "insight_score": self.insight_score,
            "archetype_synergy": self.archetype_synergy,
            "narrative_quality": self.narrative_quality,
            "editorial_summary": self.editorial_summary,
            "research_supported": self.research_supported,
            "research_contradicted": self.research_contradicted,
            "research_inconclusive": self.research_inconclusive,
            "fact_check_score": self.fact_check_score,
            "combined_score": self.combined_score,
            "verdicts": self.verdicts,
            "research_verdicts": self.research_verdicts,
            "processing_time_ms": self.processing_time_ms,
            "sportmonks_available": self.sportmonks_available,
            "llm_used": self.llm_used,
            "search_backend": self.search_backend,
            "summary": self.summary,
        }


# ── Score Computation ────────────────────────────────────────────────

def _compute_data_score(
    verified: int, disputed: int, unverifiable: int
) -> float:
    """
    Compute fact-check score from data agents (0–100).
    Verified → positive, Disputed → penalty, Unverifiable → neutral.
    """
    total = verified + disputed + unverifiable
    if total == 0:
        return 75.0

    checkable = verified + disputed
    if checkable == 0:
        return 75.0

    accuracy = verified / checkable
    base_score = accuracy * 100
    dispute_penalty = (disputed / total) * 30
    effort_bonus = (checkable / total) * 10

    score = base_score - dispute_penalty + effort_bonus
    return round(max(0.0, min(100.0, score)), 2)


def _compute_combined_score(
    data_score: float,
    insight_score: float,
    narrative_quality: float,
    research_supported: int,
    research_contradicted: int,
    research_total: int,
) -> float:
    """
    Compute combined score blending all agent outputs.

    Weights:
      - Data Agent (stat verification): 40%
      - Insight Score (LLM reasoning):  30%
      - Narrative Quality:              20%
      - Research Agent:                 10%
    """
    # Research score (0–100)
    if research_total > 0:
        research_score = (research_supported / research_total) * 100
        if research_contradicted > 0:
            research_score -= (research_contradicted / research_total) * 50
        research_score = max(0, min(100, research_score))
    else:
        research_score = 75.0  # Neutral if no research conducted

    combined = (
        data_score * 0.40 +
        insight_score * 0.30 +
        narrative_quality * 0.20 +
        research_score * 0.10
    )
    return round(max(0.0, min(100.0, combined)), 2)


def _generate_summary(
    verified: int, disputed: int, unverifiable: int,
    data_score: float, combined_score: float,
    editorial: str, llm_used: str,
) -> str:
    """Generate a human-readable summary."""
    total = verified + disputed + unverifiable
    parts = []

    if total == 0:
        parts.append("No verifiable factual claims found.")
    else:
        claim_parts = []
        if verified > 0:
            claim_parts.append(f"{verified} verified ✅")
        if disputed > 0:
            claim_parts.append(f"{disputed} disputed ❌")
        if unverifiable > 0:
            claim_parts.append(f"{unverifiable} unchecked")
        parts.append(f"{total} claims found: {', '.join(claim_parts)}.")

    if editorial:
        parts.append(editorial)

    if combined_score >= 80:
        parts.append("Overall: Strong, well-researched blog.")
    elif combined_score >= 60:
        parts.append("Overall: Decent with room for improvement.")
    elif combined_score >= 40:
        parts.append("Overall: Multiple issues detected.")
    else:
        parts.append("Overall: Significant concerns.")

    if llm_used != "heuristic_fallback" and llm_used != "none":
        parts.append(f"(Evaluated by {llm_used})")

    return " ".join(parts)


# ── Main Orchestrator ────────────────────────────────────────────────

def check_blog(text: str, archetype: str = "Unknown") -> FactCheckReport:
    """
    Run the full multi-agent fact-checking + evaluation pipeline.

    Pipeline:
    1. Extract typed claims → Data Agents (SportMonks)
    2. Blog text + verdicts → Reasoning Agent (LLM)
    3. Nuance claims → Research Agent (Web Search)
    4. Aggregate all results
    """
    start_time = time.time()

    client = get_sportmonks_client()
    cache = get_entity_cache()

    # Populate entity cache if stale
    if cache.is_stale and client.is_available:
        try:
            cache.populate_from_api(client)
        except Exception as e:
            logger.warning(f"Entity cache refresh failed: {e}")

    # ── Step 1: Data Agent Layer ─────────────────────────────────────

    claims = extract_claims(text)
    data_verdicts: list[ClaimVerdict] = []

    for claim in claims:
        try:
            agent = get_agent_for_claim(claim.claim_type)
            verdict = agent.verify(
                claim_text=claim.text,
                claim_type=claim.claim_type,
                entities=claim.entities,
                numbers=claim.numbers,
                context=claim.context,
            )
            data_verdicts.append(verdict)
        except Exception as e:
            logger.error(f"Data agent error: {e}")
            data_verdicts.append(ClaimVerdict(
                claim_text=claim.text,
                claim_type=claim.claim_type,
                verdict="unverifiable",
                confidence=0.0,
                evidence=f"Agent error: {str(e)}",
            ))

    verified = sum(1 for v in data_verdicts if v.verdict == "verified")
    disputed = sum(1 for v in data_verdicts if v.verdict == "disputed")
    unverifiable = sum(1 for v in data_verdicts if v.verdict == "unverifiable")
    data_score = _compute_data_score(verified, disputed, unverifiable)

    verdicts_for_llm = [
        {
            "claim": v.claim_text,
            "type": v.claim_type,
            "verdict": v.verdict,
            "confidence": v.confidence,
            "evidence": v.evidence,
        }
        for v in data_verdicts
    ]

    # ── Step 2: Reasoning Agent Layer (LLM) ──────────────────────────

    try:
        reasoning: ReasoningResult = evaluate_blog(
            text=text,
            archetype=archetype,
            verdicts=verdicts_for_llm,
        )
    except Exception as e:
        logger.error(f"Reasoning agent error: {e}")
        reasoning = ReasoningResult(
            insight_score=50.0,
            archetype_synergy=50.0,
            narrative_quality=50.0,
            nuance_claims=[],
            editorial_summary="Evaluation unavailable.",
            llm_used="error",
        )

    # ── Step 3: Research Agent Layer (Web Search) ────────────────────

    try:
        research: ResearchReport = research_claims(reasoning.nuance_claims)
    except Exception as e:
        logger.error(f"Research agent error: {e}")
        research = ResearchReport(
            claims_researched=0,
            supported=0,
            contradicted=0,
            inconclusive=0,
            search_backend="error",
        )

    # ── Step 4: Aggregate ────────────────────────────────────────────

    combined = _compute_combined_score(
        data_score=data_score,
        insight_score=reasoning.insight_score,
        narrative_quality=reasoning.narrative_quality,
        research_supported=research.supported,
        research_contradicted=research.contradicted,
        research_total=research.claims_researched,
    )

    summary = _generate_summary(
        verified, disputed, unverifiable,
        data_score, combined,
        reasoning.editorial_summary,
        reasoning.llm_used,
    )

    elapsed = int((time.time() - start_time) * 1000)

    report = FactCheckReport(
        total_claims=len(claims),
        verified_count=verified,
        disputed_count=disputed,
        unverifiable_count=unverifiable,
        insight_score=reasoning.insight_score,
        archetype_synergy=reasoning.archetype_synergy,
        narrative_quality=reasoning.narrative_quality,
        editorial_summary=reasoning.editorial_summary,
        research_supported=research.supported,
        research_contradicted=research.contradicted,
        research_inconclusive=research.inconclusive,
        fact_check_score=data_score,
        combined_score=combined,
        verdicts=verdicts_for_llm,
        research_verdicts=research.verdicts,
        processing_time_ms=elapsed,
        sportmonks_available=client.is_available,
        llm_used=reasoning.llm_used,
        search_backend=research.search_backend,
        summary=summary,
    )

    logger.info(
        f"Fact-check V2 complete: {len(claims)} claims, "
        f"data={data_score}, insight={reasoning.insight_score}, "
        f"combined={combined}, llm={reasoning.llm_used}, "
        f"research={research.search_backend}, time={elapsed}ms"
    )

    return report


# ── Quick helper for BQS integration ────────────────────────────────

def get_fact_check_score(text: str, archetype: str = "Unknown") -> float:
    """
    Returns the combined score (0–100) for use in the BQS pipeline.
    This now includes LLM reasoning and web research when available.
    """
    try:
        report = check_blog(text, archetype)
        return report.combined_score
    except Exception as e:
        logger.error(f"Fact-check score failed: {e}")
        return 75.0  # Neutral fallback
