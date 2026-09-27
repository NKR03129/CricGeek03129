"""
CricGeek — Verification Agents

Five specialized agents that verify specific claim types against SportMonks data:

  1. LiveClaimAgent       — live/in-progress match claims
  2. HistoricalMatchAgent — past match results, chase totals, lineups
  3. PlayerStatAgent      — player statistics (averages, strike rates, wickets)
  4. RankingAgent         — ICC rankings and table positions
  5. TeamTrendAgent       — form, win streaks, season averages
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from sportmonks_client import SportMonksClient, get_sportmonks_client
from entity_cache import EntityCache, get_entity_cache

logger = logging.getLogger("verification_agents")


# ── Claim Verdict ────────────────────────────────────────────────────

@dataclass
class ClaimVerdict:
    claim_text: str
    claim_type: str
    verdict: str        # "verified" | "disputed" | "unverifiable"
    confidence: float   # 0.0 – 1.0
    evidence: str       # Human-readable explanation
    source_data: dict = field(default_factory=dict)


def _unverifiable(claim_text: str, claim_type: str, reason: str) -> ClaimVerdict:
    return ClaimVerdict(
        claim_text=claim_text,
        claim_type=claim_type,
        verdict="unverifiable",
        confidence=0.0,
        evidence=reason,
    )


# ── Base Agent ───────────────────────────────────────────────────────

class BaseAgent:
    def __init__(self):
        self.client: SportMonksClient = get_sportmonks_client()
        self.cache: EntityCache = get_entity_cache()

    def verify(self, claim_text: str, claim_type: str,
               entities: list[str], numbers: list[str],
               context: str = "") -> ClaimVerdict:
        raise NotImplementedError


# ── 1. Live Claim Agent ──────────────────────────────────────────────

class LiveClaimAgent(BaseAgent):
    """
    Verifies claims about in-progress matches.
    Uses: Livescores + Runs + Bowling + Batting
    """

    def verify(self, claim_text: str, claim_type: str,
               entities: list[str], numbers: list[str],
               context: str = "") -> ClaimVerdict:

        if not self.client.is_available:
            return _unverifiable(claim_text, claim_type, "SportMonks API not configured")

        livescores = self.client.get_livescores(
            includes=["batting", "bowling", "runs"]
        )

        if not livescores:
            return _unverifiable(claim_text, claim_type, "No live matches found or API unavailable")

        # Try to match the claim to a live match
        for match in livescores:
            local_team = match.get("localteam", {}).get("name", "").lower()
            visitor_team = match.get("visitorteam", {}).get("name", "").lower()

            # Check if any of the claim entities match the teams
            team_match = any(
                e.lower() in local_team or e.lower() in visitor_team
                or local_team in e.lower() or visitor_team in e.lower()
                for e in entities
            )
            if not team_match and entities:
                continue

            # Score verification
            runs_data = match.get("runs", [])
            bowling_data = match.get("bowling", [])
            batting_data = match.get("batting", [])

            # Try to verify score claims
            if numbers and len(numbers) >= 2:
                claimed_score = numbers[0]
                claimed_wickets = numbers[1]

                for innings in runs_data:
                    actual_score = str(innings.get("score", ""))
                    actual_wickets = str(innings.get("wickets", ""))
                    actual_overs = str(innings.get("overs", ""))

                    if actual_score == claimed_score and actual_wickets == claimed_wickets:
                        return ClaimVerdict(
                            claim_text=claim_text,
                            claim_type=claim_type,
                            verdict="verified",
                            confidence=0.95,
                            evidence=f"Live score confirmed: {actual_score}/{actual_wickets} in {actual_overs} overs",
                            source_data={"match": match.get("id"), "innings": innings},
                        )

                # If we found the match but score doesn't match
                if runs_data:
                    latest = runs_data[-1] if runs_data else {}
                    return ClaimVerdict(
                        claim_text=claim_text,
                        claim_type=claim_type,
                        verdict="disputed",
                        confidence=0.8,
                        evidence=f"Score mismatch. Actual: {latest.get('score','?')}/{latest.get('wickets','?')}",
                        source_data={"match": match.get("id"), "actual_runs": runs_data},
                    )

            # Wicket claims for bowlers
            for bowler in bowling_data:
                bowler_name = bowler.get("bowler", {}).get("fullname", "").lower()
                if any(e.lower() in bowler_name or bowler_name in e.lower() for e in entities):
                    actual_wickets = str(bowler.get("wickets", 0))
                    if numbers and actual_wickets == numbers[0]:
                        return ClaimVerdict(
                            claim_text=claim_text,
                            claim_type=claim_type,
                            verdict="verified",
                            confidence=0.95,
                            evidence=f"Bowler stat confirmed: {bowler.get('bowler', {}).get('fullname', '')} has {actual_wickets} wickets",
                            source_data={"bowler": bowler},
                        )

        return _unverifiable(claim_text, claim_type, "Could not match claim to any live match")


# ── 2. Historical Match Agent ────────────────────────────────────────

class HistoricalMatchAgent(BaseAgent):
    """
    Verifies claims about past matches.
    Uses: Fixtures + Batting + Bowling + Runs + Lineup
    """

    def verify(self, claim_text: str, claim_type: str,
               entities: list[str], numbers: list[str],
               context: str = "") -> ClaimVerdict:

        if not self.client.is_available:
            return _unverifiable(claim_text, claim_type, "SportMonks API not configured")

        # Resolve team IDs from entities
        team_ids = []
        team_names = []
        for entity in entities:
            resolved = self.cache.resolve_team(entity)
            if resolved:
                team_ids.append(resolved["id"])
                team_names.append(resolved.get("name", entity))

        if not team_ids:
            return _unverifiable(claim_text, claim_type,
                                 f"Could not resolve teams: {entities}")

        # Get recent fixtures for these teams
        fixtures = self.client.get_fixtures(
            includes=["runs", "batting", "bowling", "lineup"],
        )

        if not fixtures:
            return _unverifiable(claim_text, claim_type, "No fixtures data available")

        # Filter fixtures involving our teams
        relevant = []
        for fix in fixtures:
            lt_id = fix.get("localteam_id")
            vt_id = fix.get("visitorteam_id")
            if any(tid in [lt_id, vt_id] for tid in team_ids):
                relevant.append(fix)

        if not relevant:
            return _unverifiable(claim_text, claim_type,
                                 f"No fixtures found for teams: {team_names}")

        # Sort by date descending
        relevant.sort(key=lambda f: f.get("starting_at", ""), reverse=True)

        # Match result verification
        claim_lower = claim_text.lower()
        if any(w in claim_lower for w in ["won", "beat", "defeated", "lost"]):
            for fix in relevant[:10]:  # check last 10 matches
                winner_id = fix.get("winner_team_id")
                if winner_id and winner_id in team_ids:
                    winner_team = self.cache.get_team_by_id(winner_id)
                    winner_name = winner_team.get("name", "Unknown") if winner_team else "Unknown"

                    if "won" in claim_lower or "beat" in claim_lower:
                        return ClaimVerdict(
                            claim_text=claim_text,
                            claim_type=claim_type,
                            verdict="verified",
                            confidence=0.85,
                            evidence=f"Match result confirmed: {winner_name} won fixture ID {fix.get('id')}",
                            source_data={"fixture": fix.get("id"), "winner": winner_name},
                        )

        # Innings total / chase verification
        if numbers:
            target_score = numbers[0]
            for fix in relevant[:10]:
                runs_data = fix.get("runs", [])
                for innings in runs_data:
                    actual_score = str(innings.get("score", ""))
                    if actual_score == target_score:
                        return ClaimVerdict(
                            claim_text=claim_text,
                            claim_type=claim_type,
                            verdict="verified",
                            confidence=0.85,
                            evidence=f"Innings total {target_score} confirmed in fixture {fix.get('id')}",
                            source_data={"fixture": fix.get("id"), "innings": innings},
                        )

        # Lineup / captain claims
        if claim_type == "lineup_claim":
            for fix in relevant[:5]:
                lineup_data = fix.get("lineup", [])
                for player in lineup_data:
                    player_name = player.get("fullname", "").lower()
                    if any(e.lower() in player_name for e in entities):
                        is_captain = player.get("captain", False)
                        if "captain" in claim_lower and is_captain:
                            return ClaimVerdict(
                                claim_text=claim_text,
                                claim_type=claim_type,
                                verdict="verified",
                                confidence=0.9,
                                evidence=f"Captain confirmed: {player.get('fullname')} in fixture {fix.get('id')}",
                                source_data={"fixture": fix.get("id"), "player": player},
                            )
                        elif "xi" in claim_lower or "eleven" in claim_lower or "played" in claim_lower:
                            return ClaimVerdict(
                                claim_text=claim_text,
                                claim_type=claim_type,
                                verdict="verified",
                                confidence=0.9,
                                evidence=f"Player in XI confirmed: {player.get('fullname')}",
                                source_data={"fixture": fix.get("id"), "player": player},
                            )

        return _unverifiable(claim_text, claim_type,
                             "Could not verify historical match claim against available data")


# ── 3. Player Stat Agent ─────────────────────────────────────────────

class PlayerStatAgent(BaseAgent):
    """
    Verifies player statistics claims.
    Uses: Batting + Bowling scoreboards aggregated across fixtures
    """

    def verify(self, claim_text: str, claim_type: str,
               entities: list[str], numbers: list[str],
               context: str = "") -> ClaimVerdict:

        if not self.client.is_available:
            return _unverifiable(claim_text, claim_type, "SportMonks API not configured")

        if not numbers:
            return _unverifiable(claim_text, claim_type, "No numerical values found in claim")

        # Try to resolve the player
        player_info = None
        player_name_used = ""
        for entity in entities:
            resolved = self.cache.resolve_player(entity)
            if resolved:
                player_info = resolved
                player_name_used = entity
                break

        if not player_info:
            return _unverifiable(claim_text, claim_type,
                                 f"Could not resolve player from entities: {entities}")

        player_id = player_info["id"]

        # Get the player's detail from API
        player_detail = self.client.get_player_by_id(player_id)
        if not player_detail:
            return _unverifiable(claim_text, claim_type,
                                 f"Could not fetch player data for ID {player_id}")

        # Check career stats if available in the response
        career = player_detail.get("career", [])
        claim_lower = claim_text.lower()
        claimed_value = float(numbers[0])

        # Determine what stat type is being claimed
        stat_type = ""
        if any(w in claim_lower for w in ["average", "avg"]):
            stat_type = "batting_average"
        elif any(w in claim_lower for w in ["strike rate", "sr"]):
            stat_type = "strike_rate"
        elif any(w in claim_lower for w in ["economy", "econ"]):
            stat_type = "economy_rate"
        elif any(w in claim_lower for w in ["centuries", "hundreds", "100s"]):
            stat_type = "centuries"
        elif any(w in claim_lower for w in ["wickets"]):
            stat_type = "wickets"
        elif any(w in claim_lower for w in ["runs", "scored"]):
            stat_type = "runs"

        # Try to match against career data
        for entry in career:
            season_type = entry.get("type", "").lower()

            # Map stat type to career data field
            field_map = {
                "batting_average": "batting_average",
                "strike_rate": "batting_strike_rate",
                "economy_rate": "bowling_economy_rate",
                "centuries": "centuries",
                "wickets": "wickets",
                "runs": "runs_scored",
            }

            field_name = field_map.get(stat_type, "")
            if field_name and field_name in entry:
                actual_value = float(entry.get(field_name, 0))
                if actual_value == 0:
                    continue

                # 5% tolerance
                tolerance = actual_value * 0.05
                if abs(claimed_value - actual_value) <= tolerance:
                    return ClaimVerdict(
                        claim_text=claim_text,
                        claim_type=claim_type,
                        verdict="verified",
                        confidence=0.9,
                        evidence=(
                            f"Stat verified: {player_name_used} {stat_type} = "
                            f"{actual_value} (claimed {claimed_value}, "
                            f"within 5% tolerance, format: {season_type})"
                        ),
                        source_data={"player_id": player_id, "career_entry": entry},
                    )
                else:
                    return ClaimVerdict(
                        claim_text=claim_text,
                        claim_type=claim_type,
                        verdict="disputed",
                        confidence=0.85,
                        evidence=(
                            f"Stat mismatch: {player_name_used} {stat_type} = "
                            f"{actual_value} (claimed {claimed_value}, "
                            f"format: {season_type})"
                        ),
                        source_data={"player_id": player_id, "career_entry": entry},
                    )

        # If we have the player but no matching career stat, try recent fixtures
        fixtures = self.client.get_fixtures(includes=["batting", "bowling"])
        if fixtures:
            for fix in fixtures[:20]:
                for batting in fix.get("batting", []):
                    if batting.get("player_id") == player_id:
                        actual_runs = batting.get("score", 0)
                        if stat_type == "runs" and abs(claimed_value - actual_runs) < 1:
                            return ClaimVerdict(
                                claim_text=claim_text,
                                claim_type=claim_type,
                                verdict="verified",
                                confidence=0.85,
                                evidence=f"Runs verified in fixture {fix.get('id')}: {actual_runs}",
                                source_data={"fixture": fix.get("id")},
                            )

                for bowling in fix.get("bowling", []):
                    if bowling.get("player_id") == player_id:
                        actual_wickets = bowling.get("wickets", 0)
                        if stat_type == "wickets" and abs(claimed_value - actual_wickets) < 1:
                            return ClaimVerdict(
                                claim_text=claim_text,
                                claim_type=claim_type,
                                verdict="verified",
                                confidence=0.85,
                                evidence=f"Wickets verified in fixture {fix.get('id')}: {actual_wickets}",
                                source_data={"fixture": fix.get("id")},
                            )

        return _unverifiable(claim_text, claim_type,
                             f"Could not verify {stat_type} for {player_name_used}")


# ── 4. Ranking Agent ─────────────────────────────────────────────────

class RankingAgent(BaseAgent):
    """
    Verifies ICC ranking and table position claims.
    Uses: Standings + Team Rankings
    """

    def verify(self, claim_text: str, claim_type: str,
               entities: list[str], numbers: list[str],
               context: str = "") -> ClaimVerdict:

        if not self.client.is_available:
            return _unverifiable(claim_text, claim_type, "SportMonks API not configured")

        claim_lower = claim_text.lower()

        # ICC Team Rankings
        if any(w in claim_lower for w in ["ranking", "ranked", "no.", "number", "#",
                                           "top", "first", "lead"]):
            rankings = self.client.get_team_rankings()
            if not rankings:
                return _unverifiable(claim_text, claim_type, "Could not fetch team rankings")

            # Determine format (Test/ODI/T20I)
            target_format = ""
            if "test" in claim_lower:
                target_format = "TEST"
            elif "odi" in claim_lower or "one day" in claim_lower:
                target_format = "ODI"
            elif "t20" in claim_lower or "twenty20" in claim_lower:
                target_format = "T20I"

            for ranking_group in rankings:
                group_type = ranking_group.get("type", "").upper()
                if target_format and target_format not in group_type:
                    continue

                team_rankings = ranking_group.get("team", [])
                for rank_entry in team_rankings:
                    team_name = rank_entry.get("name", "").lower()
                    rank_position = rank_entry.get("position", 0)

                    # Check if this team matches our entities
                    if any(e.lower() in team_name or team_name in e.lower()
                           for e in entities):
                        # Check if claimed rank matches
                        if numbers:
                            claimed_rank = int(float(numbers[0]))
                            if claimed_rank == rank_position:
                                return ClaimVerdict(
                                    claim_text=claim_text,
                                    claim_type=claim_type,
                                    verdict="verified",
                                    confidence=0.95,
                                    evidence=f"Ranking confirmed: {rank_entry.get('name', '')} is #{rank_position} in {group_type}",
                                    source_data={"ranking": rank_entry, "format": group_type},
                                )
                            else:
                                return ClaimVerdict(
                                    claim_text=claim_text,
                                    claim_type=claim_type,
                                    verdict="disputed",
                                    confidence=0.9,
                                    evidence=f"Ranking mismatch: {rank_entry.get('name', '')} is actually #{rank_position} in {group_type} (claimed #{claimed_rank})",
                                    source_data={"ranking": rank_entry, "format": group_type},
                                )

                        # "Top" / "No. 1" claims
                        if any(w in claim_lower for w in ["top", "first", "no. 1",
                                                           "number one", "1st", "lead"]):
                            if rank_position == 1:
                                return ClaimVerdict(
                                    claim_text=claim_text,
                                    claim_type=claim_type,
                                    verdict="verified",
                                    confidence=0.95,
                                    evidence=f"Confirmed: {rank_entry.get('name', '')} is #1 in {group_type}",
                                    source_data={"ranking": rank_entry},
                                )
                            else:
                                return ClaimVerdict(
                                    claim_text=claim_text,
                                    claim_type=claim_type,
                                    verdict="disputed",
                                    confidence=0.9,
                                    evidence=f"Disputed: {rank_entry.get('name', '')} is actually #{rank_position} in {group_type}",
                                    source_data={"ranking": rank_entry},
                                )

        return _unverifiable(claim_text, claim_type, "Could not verify ranking claim")


# ── 5. Team Trend Agent ──────────────────────────────────────────────

class TeamTrendAgent(BaseAgent):
    """
    Verifies team trend and form claims.
    Uses: Fixtures + Runs + derived computations
    """

    def verify(self, claim_text: str, claim_type: str,
               entities: list[str], numbers: list[str],
               context: str = "") -> ClaimVerdict:

        if not self.client.is_available:
            return _unverifiable(claim_text, claim_type, "SportMonks API not configured")

        # Resolve team
        team_info = None
        team_name_used = ""
        for entity in entities:
            resolved = self.cache.resolve_team(entity)
            if resolved:
                team_info = resolved
                team_name_used = entity
                break

        if not team_info:
            return _unverifiable(claim_text, claim_type,
                                 f"Could not resolve team from entities: {entities}")

        team_id = team_info["id"]
        claim_lower = claim_text.lower()

        # Get recent fixtures for this team
        fixtures = self.client.get_fixtures(includes=["runs"])
        if not fixtures:
            return _unverifiable(claim_text, claim_type, "No fixtures data available")

        # Filter for this team, finished matches
        team_fixtures = [
            f for f in fixtures
            if (f.get("localteam_id") == team_id or f.get("visitorteam_id") == team_id)
            and f.get("status") == "Finished"
        ]
        team_fixtures.sort(key=lambda f: f.get("starting_at", ""), reverse=True)

        if not team_fixtures:
            return _unverifiable(claim_text, claim_type,
                                 f"No finished fixtures found for {team_name_used}")

        # "Won X of last Y" claims
        if "won" in claim_lower and "last" in claim_lower and len(numbers) >= 2:
            claimed_wins = int(float(numbers[0]))
            last_n = int(float(numbers[1]))
            recent = team_fixtures[:last_n]

            actual_wins = sum(
                1 for f in recent if f.get("winner_team_id") == team_id
            )

            if actual_wins == claimed_wins:
                return ClaimVerdict(
                    claim_text=claim_text,
                    claim_type=claim_type,
                    verdict="verified",
                    confidence=0.9,
                    evidence=f"Form confirmed: {team_name_used} won {actual_wins} of last {last_n}",
                    source_data={"wins": actual_wins, "total": last_n},
                )
            else:
                return ClaimVerdict(
                    claim_text=claim_text,
                    claim_type=claim_type,
                    verdict="disputed",
                    confidence=0.85,
                    evidence=f"Form mismatch: {team_name_used} actually won {actual_wins} of last {last_n} (claimed {claimed_wins})",
                    source_data={"wins": actual_wins, "total": last_n},
                )

        # "Unbeaten streak" claims
        if "unbeaten" in claim_lower or "winning streak" in claim_lower:
            if numbers:
                claimed_streak = int(float(numbers[0]))
                actual_streak = 0
                for f in team_fixtures:
                    winner = f.get("winner_team_id")
                    if winner == team_id or winner is None:  # win or draw
                        actual_streak += 1
                    else:
                        break

                if actual_streak >= claimed_streak:
                    return ClaimVerdict(
                        claim_text=claim_text,
                        claim_type=claim_type,
                        verdict="verified",
                        confidence=0.85,
                        evidence=f"Unbeaten streak confirmed: {actual_streak} matches",
                        source_data={"streak": actual_streak},
                    )
                else:
                    return ClaimVerdict(
                        claim_text=claim_text,
                        claim_type=claim_type,
                        verdict="disputed",
                        confidence=0.8,
                        evidence=f"Streak mismatch: actual unbeaten run is {actual_streak} (claimed {claimed_streak})",
                        source_data={"streak": actual_streak},
                    )

        # "Average X batting first/second" claims
        if "average" in claim_lower and numbers:
            claimed_avg = float(numbers[0])
            batting_first = "batting first" in claim_lower or "first innings" in claim_lower

            scores = []
            for f in team_fixtures[:20]:
                runs_data = f.get("runs", [])
                for innings in runs_data:
                    innings_team_id = innings.get("team_id")
                    innings_number = innings.get("inning", 1)

                    if innings_team_id == team_id:
                        if (batting_first and innings_number == 1) or \
                           (not batting_first and innings_number == 2):
                            score = innings.get("score", 0)
                            if score > 0:
                                scores.append(score)

            if scores:
                actual_avg = sum(scores) / len(scores)
                tolerance = actual_avg * 0.10  # 10% tolerance for averages

                if abs(claimed_avg - actual_avg) <= tolerance:
                    return ClaimVerdict(
                        claim_text=claim_text,
                        claim_type=claim_type,
                        verdict="verified",
                        confidence=0.8,
                        evidence=f"Average confirmed: ~{actual_avg:.1f} across {len(scores)} innings (claimed {claimed_avg})",
                        source_data={"avg": actual_avg, "innings_count": len(scores)},
                    )
                else:
                    return ClaimVerdict(
                        claim_text=claim_text,
                        claim_type=claim_type,
                        verdict="disputed",
                        confidence=0.75,
                        evidence=f"Average mismatch: actual ~{actual_avg:.1f} (claimed {claimed_avg})",
                        source_data={"avg": actual_avg, "innings_count": len(scores)},
                    )

        return _unverifiable(claim_text, claim_type,
                             f"Could not verify team trend claim for {team_name_used}")


# ── Agent Registry ───────────────────────────────────────────────────

AGENT_REGISTRY: dict[str, type[BaseAgent]] = {
    "live_score":    LiveClaimAgent,
    "match_result":  HistoricalMatchAgent,
    "innings_total": HistoricalMatchAgent,
    "lineup_claim":  HistoricalMatchAgent,
    "player_stat":   PlayerStatAgent,
    "bowling_figure": PlayerStatAgent,
    "ranking_claim": RankingAgent,
    "table_position": RankingAgent,
    "team_trend":    TeamTrendAgent,
}


def get_agent_for_claim(claim_type: str) -> BaseAgent:
    """Get the appropriate verification agent for a claim type."""
    agent_class = AGENT_REGISTRY.get(claim_type, PlayerStatAgent)
    return agent_class()
