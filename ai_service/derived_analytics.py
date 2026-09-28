"""
CricGeek — Derived Analytics

Higher-level cricket analytics computed from raw SportMonks data.
These are built internally (not a direct API endpoint) as per the spec:

  A. Head2Head       — Las N meetings between two teams
  B. TeamSeasonStats  — Win rate, avg score, chase success, top performers
  C. RecentForm       — Last 5/10 match results
  D. PlayerTrend      — Player's recent batting/bowling form
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from sportmonks_client import SportMonksClient, get_sportmonks_client
from entity_cache import EntityCache, get_entity_cache

logger = logging.getLogger("derived_analytics")


# ── Data Models ──────────────────────────────────────────────────────

@dataclass
class Head2HeadResult:
    team_a: str
    team_b: str
    total_matches: int
    team_a_wins: int
    team_b_wins: int
    draws: int
    last_n_meetings: list[dict] = field(default_factory=list)
    avg_score_a: float = 0.0
    avg_score_b: float = 0.0


@dataclass
class TeamSeasonStatsResult:
    team_name: str
    season_name: str
    matches_played: int
    wins: int
    losses: int
    draws: int
    win_rate: float
    avg_innings_score: float
    avg_wickets_taken: float
    chase_success_rate: float
    top_batters: list[dict] = field(default_factory=list)
    top_bowlers: list[dict] = field(default_factory=list)


@dataclass
class RecentFormResult:
    team_name: str
    last_n: int
    results: list[str] = field(default_factory=list)  # ["W", "L", "W", "W", "L"]
    wins: int = 0
    losses: int = 0
    draws: int = 0


@dataclass
class PlayerTrendResult:
    player_name: str
    last_n_innings: int
    batting_scores: list[int] = field(default_factory=list)
    avg_recent: float = 0.0
    bowling_wickets: list[int] = field(default_factory=list)
    avg_wickets_recent: float = 0.0


# ── Analytics Engine ─────────────────────────────────────────────────

class DerivedAnalytics:
    def __init__(self):
        self.client: SportMonksClient = get_sportmonks_client()
        self.cache: EntityCache = get_entity_cache()

    def head_to_head(
        self, team_a_name: str, team_b_name: str, last_n: int = 10
    ) -> Optional[Head2HeadResult]:
        """
        Compute H2H record from historical fixtures.
        Built from: Fixtures + Teams + Runs
        """
        team_a = self.cache.resolve_team(team_a_name)
        team_b = self.cache.resolve_team(team_b_name)

        if not team_a or not team_b:
            logger.warning(f"Cannot compute H2H: team resolution failed ({team_a_name}, {team_b_name})")
            return None

        a_id = team_a["id"]
        b_id = team_b["id"]

        fixtures = self.client.get_fixtures(includes=["runs"])
        if not fixtures:
            return None

        # Filter for matches between these two teams
        h2h_fixtures = [
            f for f in fixtures
            if {f.get("localteam_id"), f.get("visitorteam_id")} == {a_id, b_id}
            and f.get("status") == "Finished"
        ]
        h2h_fixtures.sort(key=lambda f: f.get("starting_at", ""), reverse=True)

        if not h2h_fixtures:
            return Head2HeadResult(
                team_a=team_a_name, team_b=team_b_name,
                total_matches=0, team_a_wins=0, team_b_wins=0, draws=0,
            )

        recent = h2h_fixtures[:last_n]
        a_wins = sum(1 for f in recent if f.get("winner_team_id") == a_id)
        b_wins = sum(1 for f in recent if f.get("winner_team_id") == b_id)
        draws = len(recent) - a_wins - b_wins

        # Average scores
        a_scores = []
        b_scores = []
        for f in recent:
            for innings in f.get("runs", []):
                if innings.get("team_id") == a_id:
                    a_scores.append(innings.get("score", 0))
                elif innings.get("team_id") == b_id:
                    b_scores.append(innings.get("score", 0))

        return Head2HeadResult(
            team_a=team_a_name,
            team_b=team_b_name,
            total_matches=len(recent),
            team_a_wins=a_wins,
            team_b_wins=b_wins,
            draws=draws,
            last_n_meetings=[
                {"id": f.get("id"), "winner_id": f.get("winner_team_id"),
                 "date": f.get("starting_at", "")}
                for f in recent
            ],
            avg_score_a=sum(a_scores) / max(len(a_scores), 1),
            avg_score_b=sum(b_scores) / max(len(b_scores), 1),
        )

    def team_season_stats(
        self, team_name: str, season_id: Optional[int] = None
    ) -> Optional[TeamSeasonStatsResult]:
        """
        Compute team season stats.
        Built from: Fixtures + Batting + Bowling + Runs + Standings
        """
        team = self.cache.resolve_team(team_name)
        if not team:
            return None

        team_id = team["id"]

        fixtures = self.client.get_fixtures(
            includes=["runs", "batting", "bowling"],
        )
        if not fixtures:
            return None

        team_fixtures = [
            f for f in fixtures
            if (f.get("localteam_id") == team_id or f.get("visitorteam_id") == team_id)
            and f.get("status") == "Finished"
        ]

        if season_id:
            team_fixtures = [f for f in team_fixtures if f.get("season_id") == season_id]

        if not team_fixtures:
            return None

        wins = sum(1 for f in team_fixtures if f.get("winner_team_id") == team_id)
        losses = sum(
            1 for f in team_fixtures
            if f.get("winner_team_id") and f.get("winner_team_id") != team_id
        )
        draws = len(team_fixtures) - wins - losses

        # Innings scores
        all_scores = []
        chases = {"total": 0, "success": 0}
        for f in team_fixtures:
            for innings in f.get("runs", []):
                if innings.get("team_id") == team_id:
                    score = innings.get("score", 0)
                    if score > 0:
                        all_scores.append(score)
                    # Chase tracking (2nd innings)
                    if innings.get("inning") == 2:
                        chases["total"] += 1
                        if f.get("winner_team_id") == team_id:
                            chases["success"] += 1

        # Top batters/bowlers from batting/bowling data
        batter_runs: dict[str, int] = {}
        bowler_wickets: dict[str, int] = {}
        for f in team_fixtures:
            for bat in f.get("batting", []):
                name = bat.get("batsman", {}).get("fullname", "Unknown")
                batter_runs[name] = batter_runs.get(name, 0) + bat.get("score", 0)
            for bowl in f.get("bowling", []):
                name = bowl.get("bowler", {}).get("fullname", "Unknown")
                bowler_wickets[name] = bowler_wickets.get(name, 0) + bowl.get("wickets", 0)

        top_batters = sorted(batter_runs.items(), key=lambda x: x[1], reverse=True)[:5]
        top_bowlers = sorted(bowler_wickets.items(), key=lambda x: x[1], reverse=True)[:5]

        return TeamSeasonStatsResult(
            team_name=team_name,
            season_name=str(season_id or "all"),
            matches_played=len(team_fixtures),
            wins=wins,
            losses=losses,
            draws=draws,
            win_rate=wins / max(len(team_fixtures), 1) * 100,
            avg_innings_score=sum(all_scores) / max(len(all_scores), 1),
            avg_wickets_taken=0,  # Would need bowling aggregate
            chase_success_rate=(
                chases["success"] / max(chases["total"], 1) * 100
            ),
            top_batters=[{"name": n, "runs": r} for n, r in top_batters],
            top_bowlers=[{"name": n, "wickets": w} for n, w in top_bowlers],
        )

    def recent_form(
        self, team_name: str, last_n: int = 5
    ) -> Optional[RecentFormResult]:
        """
        Get last N match results for a team.
        """
        team = self.cache.resolve_team(team_name)
        if not team:
            return None

        team_id = team["id"]
        fixtures = self.client.get_fixtures()
        if not fixtures:
            return None

        team_fixtures = [
            f for f in fixtures
            if (f.get("localteam_id") == team_id or f.get("visitorteam_id") == team_id)
            and f.get("status") == "Finished"
        ]
        team_fixtures.sort(key=lambda f: f.get("starting_at", ""), reverse=True)
        recent = team_fixtures[:last_n]

        results = []
        for f in recent:
            winner = f.get("winner_team_id")
            if winner == team_id:
                results.append("W")
            elif winner is None:
                results.append("D")
            else:
                results.append("L")

        return RecentFormResult(
            team_name=team_name,
            last_n=last_n,
            results=results,
            wins=results.count("W"),
            losses=results.count("L"),
            draws=results.count("D"),
        )

    def player_trend(
        self, player_name: str, last_n: int = 5
    ) -> Optional[PlayerTrendResult]:
        """
        Get a player's recent batting/bowling form.
        """
        player = self.cache.resolve_player(player_name)
        if not player:
            return None

        player_id = player["id"]
        fixtures = self.client.get_fixtures(includes=["batting", "bowling"])
        if not fixtures:
            return None

        batting_scores = []
        bowling_wickets = []

        # Reverse chronological
        fixtures.sort(key=lambda f: f.get("starting_at", ""), reverse=True)

        for f in fixtures:
            for bat in f.get("batting", []):
                if bat.get("player_id") == player_id and len(batting_scores) < last_n:
                    batting_scores.append(bat.get("score", 0))
            for bowl in f.get("bowling", []):
                if bowl.get("player_id") == player_id and len(bowling_wickets) < last_n:
                    bowling_wickets.append(bowl.get("wickets", 0))

        return PlayerTrendResult(
            player_name=player_name,
            last_n_innings=last_n,
            batting_scores=batting_scores,
            avg_recent=sum(batting_scores) / max(len(batting_scores), 1),
            bowling_wickets=bowling_wickets,
            avg_wickets_recent=sum(bowling_wickets) / max(len(bowling_wickets), 1),
        )
