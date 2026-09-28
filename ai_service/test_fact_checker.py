"""
CricGeek — V2 Fact-Checker Test Suite

Tests the full hybrid multi-agent pipeline:
  1. Claim extraction from blog text
  2. Score computation logic
  3. Degraded mode (no API keys)
  4. Agent routing
  5. Entity cache
  6. LLM Reasoning Agent (heuristic fallback)
  7. Ranking Service + Prize distribution
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from claim_extractor import extract_claims
from fact_checker import check_blog, _compute_data_score


def divider(title: str) -> None:
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


# ── Test 1: Claim Extraction ────────────────────────────────────────

def test_claim_extraction():
    divider("TEST 1: Claim Extraction")

    blog_text = """
    India won the previous ODI against Australia by 6 wickets at Wankhede.
    Virat Kohli averaged 58.7 in ODIs last year, while his strike rate was 93.5.
    Bumrah took 3/23 in the powerplay, rattling the top order.
    RCB are 82/3 after 11 overs in the ongoing IPL match.
    India are No. 1 in T20Is according to the latest ICC rankings.
    They have won 4 of their last 5 T20I matches this year.
    KL Rahul captained the side in the absence of Rohit Sharma.
    Australia chased 280 at the MCG in their previous encounter.
    """

    claims = extract_claims(blog_text)
    print(f"  Total claims extracted: {len(claims)}")

    for claim in claims:
        print(f"  ✅ [{claim.claim_type:15s}] {claim.text[:70]}...")
        print(f"     Entities: {claim.entities[:3]}, Numbers: {claim.numbers[:3]}")

    assert len(claims) >= 5, f"Expected at least 5 claims, got {len(claims)}"
    print("  ✅ PASSED")


# ── Test 2: Score Computation ────────────────────────────────────────

def test_score_computation():
    divider("TEST 2: Data Score Computation")

    test_cases = [
        {"v": 5, "d": 0, "u": 0, "expected_min": 90, "label": "All verified"},
        {"v": 0, "d": 5, "u": 0, "expected_max": 30, "label": "All disputed"},
        {"v": 0, "d": 0, "u": 5, "expected_range": (70, 80), "label": "All unverifiable"},
        {"v": 3, "d": 1, "u": 1, "expected_min": 50, "label": "Mixed 3v/1d/1u"},
        {"v": 0, "d": 0, "u": 0, "expected_range": (70, 80), "label": "No claims"},
    ]

    all_passed = True
    for tc in test_cases:
        score = _compute_data_score(tc["v"], tc["d"], tc["u"])
        passed = True
        if "expected_min" in tc:
            passed = score >= tc["expected_min"]
        elif "expected_max" in tc:
            passed = score <= tc["expected_max"]
        elif "expected_range" in tc:
            lo, hi = tc["expected_range"]
            passed = lo <= score <= hi
        status = "✅" if passed else "❌"
        print(f"  {status} {tc['label']}: score={score:.1f}")
        if not passed:
            all_passed = False

    assert all_passed, "Some score computation tests failed"
    print("  ✅ ALL PASSED")


# ── Test 3: Full Pipeline (Degraded Mode) ───────────────────────────

def test_full_pipeline_degraded():
    divider("TEST 3: Full Pipeline (Degraded Mode)")

    # Remove all API keys
    saved = {}
    for key in ["SPORTMONKS_API_TOKEN", "GEMINI_API_KEY", "OPENAI_API_KEY",
                 "TAVILY_API_KEY", "SERPER_API_KEY"]:
        saved[key] = os.environ.pop(key, None)

    blog_text = """
    Virat Kohli averages 58.7 in ODIs, making him one of the greatest batsmen
    of all time. India won the World Cup in 2011 under MS Dhoni's captaincy.
    Jasprit Bumrah took 3/23 in the powerplay, dismantling the top order.
    India are currently ranked No. 1 in T20Is.
    """

    report = check_blog(blog_text, archetype="Analyst")

    print(f"  Total claims: {report.total_claims}")
    print(f"  Verified:     {report.verified_count}")
    print(f"  Disputed:     {report.disputed_count}")
    print(f"  Unverifiable: {report.unverifiable_count}")
    print(f"  Data Score:   {report.fact_check_score}")
    print(f"  Insight:      {report.insight_score}")
    print(f"  Synergy:      {report.archetype_synergy}")
    print(f"  Narrative:    {report.narrative_quality}")
    print(f"  Combined:     {report.combined_score}")
    print(f"  LLM Used:     {report.llm_used}")
    print(f"  Search:       {report.search_backend}")
    print(f"  Time:         {report.processing_time_ms}ms")
    print(f"  Summary:      {report.summary[:100]}...")

    # Restore keys
    for key, val in saved.items():
        if val:
            os.environ[key] = val

    assert report.llm_used == "heuristic_fallback", f"Expected heuristic_fallback, got {report.llm_used}"
    assert report.combined_score > 0, "Combined score should be positive"
    print("  ✅ PASSED: Degraded mode with heuristic reasoning works")


# ── Test 4: Claim Type → Agent Routing ───────────────────────────────

def test_claim_routing():
    divider("TEST 4: Claim Type → Agent Routing")
    from verification_agents import AGENT_REGISTRY

    expected = {
        "live_score": "LiveClaimAgent",
        "match_result": "HistoricalMatchAgent",
        "innings_total": "HistoricalMatchAgent",
        "lineup_claim": "HistoricalMatchAgent",
        "player_stat": "PlayerStatAgent",
        "bowling_figure": "PlayerStatAgent",
        "ranking_claim": "RankingAgent",
        "table_position": "RankingAgent",
        "team_trend": "TeamTrendAgent",
    }

    all_ok = True
    for ct, expected_agent in expected.items():
        actual = AGENT_REGISTRY.get(ct)
        if actual and actual.__name__ == expected_agent:
            print(f"  ✅ {ct:15s} → {expected_agent}")
        else:
            print(f"  ❌ {ct:15s} → expected {expected_agent}")
            all_ok = False

    assert all_ok
    print("  ✅ ALL PASSED")


# ── Test 5: Entity Cache ────────────────────────────────────────────

def test_entity_cache():
    divider("TEST 5: Entity Cache")
    from entity_cache import EntityCache

    cache = EntityCache()
    cache.add_player("Virat Kohli", 123, {"country_id": 1})
    cache.add_team("India", 45, {"code": "IND", "aliases": ["IND", "Team India"]})
    cache.add_league("Indian Premier League", 1, {"code": "IPL"})

    assert cache.resolve_player("virat kohli")["id"] == 123
    print("  ✅ Player: exact match")
    assert cache.resolve_player("kohli")["id"] == 123
    print("  ✅ Player: partial (last name)")
    assert cache.resolve_team("india")["id"] == 45
    print("  ✅ Team: exact match")
    assert cache.resolve_team("IND")["id"] == 45
    print("  ✅ Team: alias match")
    assert cache.resolve_league("indian premier league")["id"] == 1
    print("  ✅ League: exact match")
    print("  ✅ ALL PASSED")


# ── Test 6: LLM Reasoning Agent (Heuristic Fallback) ────────────────

def test_reasoning_heuristic():
    divider("TEST 6: Reasoning Agent (Heuristic Fallback)")
    from reasoning_agent import _heuristic_evaluation

    blog = """
    Virat Kohli's average of 58.7 in ODIs is a testament to his technical mastery.
    The data suggests a clear correlation between his batting stance adjustments
    and the subsequent improvement in his strike rate against pace bowling.
    His trend over the last 10 innings shows a remarkable consistency with an
    average of 64.3, well above his career baseline.
    """

    result = _heuristic_evaluation(blog, "Analyst", [])

    print(f"  Insight Score:       {result.insight_score}")
    print(f"  Archetype Synergy:   {result.archetype_synergy}")
    print(f"  Narrative Quality:   {result.narrative_quality}")
    print(f"  Nuance Claims:       {len(result.nuance_claims)}")
    print(f"  LLM Used:            {result.llm_used}")
    print(f"  Summary:             {result.editorial_summary[:100]}...")

    assert result.insight_score > 0
    assert result.archetype_synergy >= 50  # Analyst keywords present
    assert result.llm_used == "heuristic_fallback"
    print("  ✅ PASSED")


# ── Test 7: Ranking Service ──────────────────────────────────────────

def test_ranking_service():
    divider("TEST 7: Ranking Service & Prize Distribution")
    from ranking_service import (
        compute_rankings,
        compute_engagement_score,
        get_leaderboard,
    )

    # Test engagement score
    eng = compute_engagement_score(runs=200, views=1000, shares=30, comments=15)
    print(f"  Engagement score (200 runs, 1K views): {eng}")
    assert 20 <= eng <= 60

    # Mock bloggers
    mock_bloggers = [
        {
            "writer_id": "w1",
            "writer_name": "Top Writer",
            "blogs": [
                {"blog_id": "b1", "bqs": 85, "fact_check_score": 90, "insight_score": 80,
                 "runs": 300, "views": 2000, "shares": 50, "comments": 20, "created_at": "2026-03-01"},
                {"blog_id": "b2", "bqs": 88, "fact_check_score": 85, "insight_score": 82,
                 "runs": 250, "views": 1800, "shares": 40, "comments": 18, "created_at": "2026-03-05"},
                {"blog_id": "b3", "bqs": 92, "fact_check_score": 95, "insight_score": 90,
                 "runs": 400, "views": 3000, "shares": 60, "comments": 25, "created_at": "2026-03-10"},
            ],
        },
        {
            "writer_id": "w2",
            "writer_name": "Average Writer",
            "blogs": [
                {"blog_id": "b4", "bqs": 55, "fact_check_score": 60, "insight_score": 45,
                 "runs": 50, "views": 500, "shares": 5, "comments": 3, "created_at": "2026-03-02"},
                {"blog_id": "b5", "bqs": 60, "fact_check_score": 65, "insight_score": 50,
                 "runs": 70, "views": 600, "shares": 8, "comments": 5, "created_at": "2026-03-08"},
                {"blog_id": "b6", "bqs": 58, "fact_check_score": 70, "insight_score": 48,
                 "runs": 60, "views": 550, "shares": 6, "comments": 4, "created_at": "2026-03-12"},
            ],
        },
        {
            "writer_id": "w3",
            "writer_name": "New Writer",
            "blogs": [
                {"blog_id": "b7", "bqs": 40, "fact_check_score": 50, "insight_score": 35,
                 "runs": 10, "views": 100, "shares": 1, "comments": 1, "created_at": "2026-03-15"},
            ],
        },
    ]

    rankings = compute_rankings(mock_bloggers)

    print(f"\n  Leaderboard ({len(rankings)} bloggers):")
    for r in rankings:
        print(f"  #{r.rank} {r.tier} {r.writer_name:16s} "
              f"Score={r.final_rank_score:6.2f} "
              f"Avg={r.avg_total_score:5.2f} "
              f"Best={r.best_score:5.2f} "
              f"Runs={r.total_runs:4d} "
              f"Bonus={r.consistency_bonus:5.2f} "
              f"Prize={r.prize_multiplier}x")

    # Verify ordering
    assert rankings[0].writer_name == "Top Writer", f"Expected Top Writer at #1, got {rankings[0].writer_name}"
    assert rankings[0].rank == 1
    assert rankings[0].tier == "🏆 Gold"
    assert rankings[0].prize_multiplier == 3.0
    assert rankings[1].rank == 2
    assert rankings[2].rank == 3

    # Verify consistency bonus
    assert rankings[0].consistency_bonus > 0, "Top Writer should have consistency bonus (3+ blogs, high avg)"
    assert rankings[2].consistency_bonus == 0, "New Writer should have no consistency bonus (only 1 blog)"

    # Test full leaderboard output
    leaderboard = get_leaderboard(mock_bloggers, top_n=5)
    assert leaderboard["total_bloggers"] == 3
    assert len(leaderboard["leaderboard"]) == 3
    assert "prize_tiers" in leaderboard
    assert "weights_used" in leaderboard

    print("\n  ✅ ALL PASSED: Rankings, prize tiers, consistency bonuses verified")


# ── Run All ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n🏏 CricGeek V2 Multi-Agent Test Suite\n")

    test_claim_extraction()
    test_score_computation()
    test_full_pipeline_degraded()
    test_claim_routing()
    test_entity_cache()
    test_reasoning_heuristic()
    test_ranking_service()

    divider("ALL TESTS COMPLETE")
    print("  🎉 V2 Hybrid Agentic System is fully operational!")
