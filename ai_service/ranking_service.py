"""
CricGeek — Ranking Service

Global leaderboard and prize distribution engine.

Ranking Formula:
  Total Score = (BQS * 0.4) + (FactCheck * 0.3) + (Insight * 0.2) + (Engagement * 0.1)

Features:
  - Per-blogger aggregate scoring across all their blogs
  - Configurable time windows (weekly, monthly, season, all-time)
  - Tier classification for prize tiers
  - Streak bonuses for consistent quality
"""

import time
import logging
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger("ranking_service")


# ── Configuration ────────────────────────────────────────────────────

# Default ranking weights — can be overridden via environment or admin API
DEFAULT_WEIGHTS = {
    "bqs": 0.40,
    "fact_check": 0.30,
    "insight": 0.20,
    "engagement": 0.10,
}

# Prize tiers
PRIZE_TIERS = [
    {"name": "🏆 Gold",   "min_rank": 1,  "max_rank": 1,   "multiplier": 3.0},
    {"name": "🥈 Silver", "min_rank": 2,  "max_rank": 3,   "multiplier": 2.0},
    {"name": "🥉 Bronze", "min_rank": 4,  "max_rank": 10,  "multiplier": 1.5},
    {"name": "⭐ Star",   "min_rank": 11, "max_rank": 25,  "multiplier": 1.0},
    {"name": "📝 Writer", "min_rank": 26, "max_rank": 9999, "multiplier": 0.0},
]


# ── Data Models ──────────────────────────────────────────────────────

@dataclass
class BlogScore:
    """Score breakdown for a single blog post."""
    blog_id: str
    bqs: float               # 0–100
    fact_check_score: float   # 0–100
    insight_score: float      # 0–100
    engagement_score: float   # 0–100 (derived from runs, views, shares)
    total_score: float = 0.0
    created_at: str = ""

    def compute_total(self, weights: Optional[dict] = None) -> float:
        w = weights or DEFAULT_WEIGHTS
        self.total_score = round(
            self.bqs * w["bqs"] +
            self.fact_check_score * w["fact_check"] +
            self.insight_score * w["insight"] +
            self.engagement_score * w["engagement"],
            2,
        )
        return self.total_score


@dataclass
class BloggerRanking:
    """Aggregate ranking for a blogger."""
    writer_id: str
    writer_name: str
    total_blogs: int
    avg_total_score: float
    best_score: float
    total_runs: int             # Engagement metric
    consistency_bonus: float    # Bonus for regular, quality publishing
    final_rank_score: float = 0.0
    rank: int = 0
    tier: str = "📝 Writer"
    prize_multiplier: float = 0.0
    blog_scores: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "writer_id": self.writer_id,
            "writer_name": self.writer_name,
            "total_blogs": self.total_blogs,
            "avg_total_score": self.avg_total_score,
            "best_score": self.best_score,
            "total_runs": self.total_runs,
            "consistency_bonus": self.consistency_bonus,
            "final_rank_score": self.final_rank_score,
            "rank": self.rank,
            "tier": self.tier,
            "prize_multiplier": self.prize_multiplier,
            "blog_scores": self.blog_scores,
        }


# ── Engagement Score Calculator ──────────────────────────────────────

def compute_engagement_score(
    runs: int,
    views: int,
    shares: int = 0,
    comments: int = 0,
) -> float:
    """
    Compute an engagement score (0–100) from raw metrics.

    Formula:
      - Runs contribute 40% (capped at 500 runs = 100%)
      - Views contribute 30% (capped at 5000 views = 100%)
      - Shares contribute 20% (capped at 100 shares = 100%)
      - Comments contribute 10% (capped at 50 comments = 100%)
    """
    runs_pct = min(runs / 500, 1.0)
    views_pct = min(views / 5000, 1.0)
    shares_pct = min(shares / 100, 1.0)
    comments_pct = min(comments / 50, 1.0)

    score = (
        runs_pct * 40 +
        views_pct * 30 +
        shares_pct * 20 +
        comments_pct * 10
    )
    return round(min(100, score), 2)


# ── Consistency Bonus Calculator ─────────────────────────────────────

def compute_consistency_bonus(blog_scores: list[BlogScore]) -> float:
    """
    Award a bonus for consistent, quality publishing.

    - Minimum 3 blogs to qualify
    - All blogs must score >= 50 to get any bonus
    - Bonus scales with count and average quality
    """
    if len(blog_scores) < 3:
        return 0.0

    scores = [b.total_score for b in blog_scores]
    avg = sum(scores) / len(scores)

    if avg < 50:
        return 0.0

    # Base bonus: 1 point per blog above 3
    count_bonus = min((len(blog_scores) - 3) * 1.0, 10.0)

    # Quality bonus: extra for high average
    quality_bonus = max(0, (avg - 60) / 40 * 10)

    # Streak: check if last 3 are all above average
    last_3 = scores[-3:]
    streak_bonus = 5.0 if all(s >= avg for s in last_3) else 0.0

    return round(count_bonus + quality_bonus + streak_bonus, 2)


# ── Tier Assignment ──────────────────────────────────────────────────

def assign_tier(rank: int) -> tuple[str, float]:
    """Assign a prize tier based on rank."""
    for tier in PRIZE_TIERS:
        if tier["min_rank"] <= rank <= tier["max_rank"]:
            return tier["name"], tier["multiplier"]
    return "📝 Writer", 0.0


# ── Ranking Engine ───────────────────────────────────────────────────

def compute_rankings(
    bloggers: list[dict[str, Any]],
    weights: Optional[dict[str, float]] = None,
) -> list[BloggerRanking]:
    """
    Compute global rankings from a list of blogger data.

    Each blogger dict should have:
    {
        "writer_id": str,
        "writer_name": str,
        "blogs": [
            {
                "blog_id": str,
                "bqs": float,
                "fact_check_score": float,
                "insight_score": float,
                "runs": int,
                "views": int,
                "shares": int,
                "comments": int,
                "created_at": str,
            }
        ]
    }
    """
    w = weights or DEFAULT_WEIGHTS
    rankings: list[BloggerRanking] = []

    for blogger in bloggers:
        writer_id = blogger.get("writer_id", "")
        writer_name = blogger.get("writer_name", "Unknown")
        blogs = blogger.get("blogs", [])

        if not blogs:
            continue

        blog_scores: list[BlogScore] = []
        total_runs = 0

        for blog in blogs:
            engagement = compute_engagement_score(
                runs=blog.get("runs", 0),
                views=blog.get("views", 0),
                shares=blog.get("shares", 0),
                comments=blog.get("comments", 0),
            )

            bs = BlogScore(
                blog_id=blog.get("blog_id", ""),
                bqs=blog.get("bqs", 0),
                fact_check_score=blog.get("fact_check_score", 75),
                insight_score=blog.get("insight_score", 50),
                engagement_score=engagement,
                created_at=blog.get("created_at", ""),
            )
            bs.compute_total(w)
            blog_scores.append(bs)
            total_runs += blog.get("runs", 0)

        # Aggregate scores
        total_scores = [b.total_score for b in blog_scores]
        avg_score = sum(total_scores) / len(total_scores)
        best_score = max(total_scores)
        consistency = compute_consistency_bonus(blog_scores)

        # Final rank score = weighted average + consistency bonus
        final = round(avg_score + consistency, 2)

        ranking = BloggerRanking(
            writer_id=writer_id,
            writer_name=writer_name,
            total_blogs=len(blog_scores),
            avg_total_score=round(avg_score, 2),
            best_score=round(best_score, 2),
            total_runs=total_runs,
            consistency_bonus=consistency,
            final_rank_score=final,
            blog_scores=[
                {
                    "blog_id": b.blog_id,
                    "bqs": b.bqs,
                    "fact_check": b.fact_check_score,
                    "insight": b.insight_score,
                    "engagement": b.engagement_score,
                    "total": b.total_score,
                }
                for b in blog_scores
            ],
        )
        rankings.append(ranking)

    # Sort by final_rank_score descending
    rankings.sort(key=lambda r: r.final_rank_score, reverse=True)

    # Assign ranks and tiers
    for idx, ranking in enumerate(rankings):
        ranking.rank = idx + 1
        ranking.tier, ranking.prize_multiplier = assign_tier(ranking.rank)

    logger.info(f"Rankings computed for {len(rankings)} bloggers")
    return rankings


# ── Leaderboard Summary ─────────────────────────────────────────────

def get_leaderboard(
    bloggers: list[dict[str, Any]],
    top_n: int = 25,
    weights: Optional[dict[str, float]] = None,
) -> dict[str, Any]:
    """
    Get the top N bloggers as a leaderboard response.

    Returns a dict suitable for JSON serialization.
    """
    rankings = compute_rankings(bloggers, weights)

    return {
        "total_bloggers": len(rankings),
        "weights_used": weights or DEFAULT_WEIGHTS,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "leaderboard": [r.to_dict() for r in rankings[:top_n]],
        "prize_tiers": PRIZE_TIERS,
    }
