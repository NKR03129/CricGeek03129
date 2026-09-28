"""
CricGeek — Entity Resolution Cache

Maps player names, team names, league names to SportMonks IDs for fast lookup.
Uses a persistent JSON file with configurable staleness threshold.
"""

import json
import os
import time
import logging
from typing import Optional, Any

logger = logging.getLogger("entity_cache")

CACHE_FILE = os.path.join(os.path.dirname(__file__), "entity_cache.json")
STALE_THRESHOLD_SECONDS = 7 * 24 * 3600  # 7 days


class EntityCache:
    """
    Bidirectional entity resolution cache.

    Stores:
        players:  { "virat kohli": { "id": 123, "full_name": "Virat Kohli", ... } }
        teams:    { "india": { "id": 45, "name": "India", "code": "IND", ... } }
        leagues:  { "ipl": { "id": 1, "name": "Indian Premier League", ... } }
        seasons:  { "ipl_2024": { "id": 999, ... } }

    Also stores reverse maps:
        player_ids:  { 123: "virat kohli" }
        team_ids:    { 45: "india" }
    """

    def __init__(self):
        self.players: dict[str, dict[str, Any]] = {}
        self.teams: dict[str, dict[str, Any]] = {}
        self.leagues: dict[str, dict[str, Any]] = {}
        self.seasons: dict[str, dict[str, Any]] = {}
        self.player_ids: dict[int, str] = {}
        self.team_ids: dict[int, str] = {}
        self.last_refreshed: float = 0
        self._load()

    # ── Persistence ──────────────────────────────────────────────────

    def _load(self) -> None:
        if os.path.exists(CACHE_FILE):
            try:
                with open(CACHE_FILE, "r") as f:
                    data = json.load(f)
                self.players = data.get("players", {})
                self.teams = data.get("teams", {})
                self.leagues = data.get("leagues", {})
                self.seasons = data.get("seasons", {})
                self.player_ids = {int(k): v for k, v in data.get("player_ids", {}).items()}
                self.team_ids = {int(k): v for k, v in data.get("team_ids", {}).items()}
                self.last_refreshed = data.get("last_refreshed", 0)
                logger.info(
                    f"Entity cache loaded: {len(self.players)} players, "
                    f"{len(self.teams)} teams, {len(self.leagues)} leagues"
                )
            except (json.JSONDecodeError, KeyError) as e:
                logger.warning(f"Failed to load entity cache: {e}")

    def save(self) -> None:
        data = {
            "players": self.players,
            "teams": self.teams,
            "leagues": self.leagues,
            "seasons": self.seasons,
            "player_ids": {str(k): v for k, v in self.player_ids.items()},
            "team_ids": {str(k): v for k, v in self.team_ids.items()},
            "last_refreshed": self.last_refreshed,
        }
        try:
            with open(CACHE_FILE, "w") as f:
                json.dump(data, f, indent=2)
            logger.debug("Entity cache saved.")
        except IOError as e:
            logger.error(f"Failed to save entity cache: {e}")

    @property
    def is_stale(self) -> bool:
        return (time.time() - self.last_refreshed) > STALE_THRESHOLD_SECONDS

    # ── Player Resolution ────────────────────────────────────────────

    def resolve_player(self, name: str) -> Optional[dict[str, Any]]:
        """Resolve a player name to cached SportMonks data."""
        key = name.lower().strip()
        if key in self.players:
            return self.players[key]

        # Fuzzy: check if the name is a substring of any cached key
        for cached_key, data in self.players.items():
            if key in cached_key or cached_key in key:
                return data

        # Try matching on last name only
        parts = key.split()
        if len(parts) > 1:
            last_name = parts[-1]
            for cached_key, data in self.players.items():
                if last_name in cached_key.split():
                    return data

        return None

    def add_player(self, name: str, player_id: int, extra: Optional[dict] = None) -> None:
        key = name.lower().strip()
        entry = {"id": player_id, "full_name": name, **(extra or {})}
        self.players[key] = entry
        self.player_ids[player_id] = key

    def get_player_by_id(self, player_id: int) -> Optional[dict[str, Any]]:
        key = self.player_ids.get(player_id)
        if key:
            return self.players.get(key)
        return None

    # ── Team Resolution ──────────────────────────────────────────────

    def resolve_team(self, name: str) -> Optional[dict[str, Any]]:
        """Resolve a team name (or alias) to cached SportMonks data."""
        key = name.lower().strip()
        if key in self.teams:
            return self.teams[key]

        # Check aliases
        for cached_key, data in self.teams.items():
            aliases = data.get("aliases", [])
            if key in [a.lower() for a in aliases]:
                return data
            if key in cached_key or cached_key in key:
                return data

        return None

    def add_team(self, name: str, team_id: int, extra: Optional[dict] = None) -> None:
        key = name.lower().strip()
        entry = {"id": team_id, "name": name, **(extra or {})}
        self.teams[key] = entry
        self.team_ids[team_id] = key

    def get_team_by_id(self, team_id: int) -> Optional[dict[str, Any]]:
        key = self.team_ids.get(team_id)
        if key:
            return self.teams.get(key)
        return None

    # ── League / Season Resolution ───────────────────────────────────

    def resolve_league(self, name: str) -> Optional[dict[str, Any]]:
        key = name.lower().strip()
        if key in self.leagues:
            return self.leagues[key]
        for cached_key, data in self.leagues.items():
            if key in cached_key or cached_key in key:
                return data
        return None

    def add_league(self, name: str, league_id: int, extra: Optional[dict] = None) -> None:
        key = name.lower().strip()
        self.leagues[key] = {"id": league_id, "name": name, **(extra or {})}

    def add_season(self, key: str, season_id: int, extra: Optional[dict] = None) -> None:
        self.seasons[key.lower().strip()] = {"id": season_id, **(extra or {})}

    # ── Bulk populate from SportMonks API ────────────────────────────

    def populate_from_api(self, client: Any) -> None:
        """
        Refresh the cache from the SportMonks API.
        Call this on startup if the cache is stale.
        """
        logger.info("Populating entity cache from SportMonks API...")

        # Teams
        teams_data = client.get_teams()
        if teams_data:
            for team in teams_data:
                tid = team.get("id")
                name = team.get("name", "")
                code = team.get("code", "")
                if tid and name:
                    self.add_team(name, tid, {
                        "code": code,
                        "image_path": team.get("image_path", ""),
                        "aliases": [code] if code else [],
                    })
            logger.info(f"  Cached {len(teams_data)} teams")

        # Players (paginated — just get first page for now)
        players_data = client.get_players()
        if players_data:
            for player in players_data:
                pid = player.get("id")
                full_name = player.get("fullname", "")
                if pid and full_name:
                    self.add_player(full_name, pid, {
                        "country_id": player.get("country_id"),
                        "position": player.get("position", {}).get("name", ""),
                        "image_path": player.get("image_path", ""),
                    })
            logger.info(f"  Cached {len(players_data)} players")

        # Leagues
        leagues_data = client.get_leagues()
        if leagues_data:
            for league in leagues_data:
                lid = league.get("id")
                name = league.get("name", "")
                if lid and name:
                    self.add_league(name, lid, {
                        "code": league.get("code", ""),
                        "type": league.get("type", ""),
                    })
            logger.info(f"  Cached {len(leagues_data)} leagues")

        # Seasons
        seasons_data = client.get_seasons()
        if seasons_data:
            for season in seasons_data:
                sid = season.get("id")
                name = season.get("name", "")
                league_id = season.get("league_id")
                if sid and name:
                    key = f"{name}_{league_id}" if league_id else name
                    self.add_season(key, sid, {
                        "name": name,
                        "league_id": league_id,
                    })
            logger.info(f"  Cached {len(seasons_data)} seasons")

        self.last_refreshed = time.time()
        self.save()
        logger.info("Entity cache population complete.")


# ── Singleton ────────────────────────────────────────────────────────

_cache_instance: Optional[EntityCache] = None


def get_entity_cache() -> EntityCache:
    global _cache_instance
    if _cache_instance is None:
        _cache_instance = EntityCache()
    return _cache_instance
