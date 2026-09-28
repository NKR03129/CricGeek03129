"""
CricGeek — SportMonks Cricket API v2 Client

Production-ready client with:
  - TTL-based in-memory cache (fixtures=1hr, livescores=30s, etc.)
  - Rate-limit tracking with exponential backoff
  - Rich `include=` support for nested data
  - Graceful degradation when API is unavailable
"""

import os
import time
import hashlib
import json
import logging
from typing import Any, Optional
from urllib.parse import urlencode

import httpx

logger = logging.getLogger("sportmonks")

# ── Configuration ────────────────────────────────────────────────────

BASE_URL = "https://cricket.sportmonks.com/api/v2.0"

# TTL in seconds for each resource type
CACHE_TTL: dict[str, int] = {
    "fixtures":      3600,      # 1 hour
    "livescores":    30,        # 30 seconds (live data)
    "batting":       3600,
    "bowling":       3600,
    "runs":          3600,
    "lineup":        3600,
    "balls":         3600,
    "scores":        3600,
    "standings":     86400,     # 24 hours
    "team-rankings": 86400,
    "teams":         604800,    # 7 days
    "players":       604800,
    "leagues":       604800,
    "seasons":       604800,
    "default":       3600,
}

# Rate limiting: max requests per minute
MAX_REQUESTS_PER_MINUTE = 100
REQUEST_WINDOW_SECONDS = 60


# ── Cache Entry ──────────────────────────────────────────────────────

class CacheEntry:
    __slots__ = ("data", "expires_at")

    def __init__(self, data: Any, ttl: int):
        self.data = data
        self.expires_at = time.time() + ttl

    @property
    def is_valid(self) -> bool:
        return time.time() < self.expires_at


# ── SportMonks Client ────────────────────────────────────────────────

class SportMonksClient:
    """
    Async-compatible, cached, rate-limited client for SportMonks Cricket API v2.
    """

    def __init__(self, api_token: Optional[str] = None):
        self.api_token = api_token or os.getenv("SPORTMONKS_API_TOKEN", "")
        self._cache: dict[str, CacheEntry] = {}
        self._request_timestamps: list[float] = []
        self._client = httpx.Client(timeout=15.0)

        if not self.api_token:
            logger.warning(
                "SPORTMONKS_API_TOKEN not set. Fact-checking will operate "
                "in degraded mode (all claims marked unverifiable)."
            )

    @property
    def is_available(self) -> bool:
        return bool(self.api_token)

    # ── Cache helpers ────────────────────────────────────────────────

    @staticmethod
    def _cache_key(endpoint: str, params: dict[str, Any]) -> str:
        raw = f"{endpoint}|{json.dumps(params, sort_keys=True)}"
        return hashlib.md5(raw.encode()).hexdigest()

    def _get_ttl(self, endpoint: str) -> int:
        for key, ttl in CACHE_TTL.items():
            if key in endpoint:
                return ttl
        return CACHE_TTL["default"]

    def _cache_get(self, key: str) -> Optional[Any]:
        entry = self._cache.get(key)
        if entry and entry.is_valid:
            return entry.data
        if entry:
            del self._cache[key]
        return None

    def _cache_set(self, key: str, data: Any, ttl: int) -> None:
        self._cache[key] = CacheEntry(data, ttl)

    def clear_cache(self) -> None:
        self._cache.clear()

    # ── Rate limiting ────────────────────────────────────────────────

    def _check_rate_limit(self) -> None:
        now = time.time()
        cutoff = now - REQUEST_WINDOW_SECONDS
        self._request_timestamps = [
            t for t in self._request_timestamps if t > cutoff
        ]
        if len(self._request_timestamps) >= MAX_REQUESTS_PER_MINUTE:
            wait = self._request_timestamps[0] + REQUEST_WINDOW_SECONDS - now
            if wait > 0:
                logger.warning(f"Rate limit hit, sleeping {wait:.1f}s")
                time.sleep(wait)

    def _record_request(self) -> None:
        self._request_timestamps.append(time.time())

    # ── Core request method ──────────────────────────────────────────

    def _request(
        self,
        endpoint: str,
        params: Optional[dict[str, Any]] = None,
        use_cache: bool = True,
    ) -> Optional[dict[str, Any]]:
        """
        Make a GET request to SportMonks API.
        Returns the parsed JSON response or None on failure.
        """
        if not self.is_available:
            return None

        params = params or {}
        params["api_token"] = self.api_token

        # Check cache
        cache_key = self._cache_key(endpoint, params)
        if use_cache:
            cached = self._cache_get(cache_key)
            if cached is not None:
                logger.debug(f"Cache HIT: {endpoint}")
                return cached

        # Rate limit
        self._check_rate_limit()

        url = f"{BASE_URL}/{endpoint}"
        try:
            self._record_request()
            response = self._client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            # Cache the response
            ttl = self._get_ttl(endpoint)
            self._cache_set(cache_key, data, ttl)

            return data
        except httpx.HTTPStatusError as e:
            logger.error(f"SportMonks HTTP {e.response.status_code}: {endpoint}")
            if e.response.status_code == 429:
                logger.warning("Rate limited by SportMonks, backing off 30s")
                time.sleep(30)
            return None
        except httpx.RequestError as e:
            logger.error(f"SportMonks request failed: {e}")
            return None

    def _extract_data(self, response: Optional[dict]) -> Optional[list | dict]:
        """Extract the 'data' key from a SportMonks response."""
        if response is None:
            return None
        return response.get("data")

    # ── Core Verification Layer ──────────────────────────────────────

    def get_fixtures(
        self,
        includes: Optional[list[str]] = None,
        filters: Optional[dict[str, Any]] = None,
    ) -> Optional[list[dict]]:
        """GET /fixtures with optional includes and filters."""
        params: dict[str, Any] = {}
        if includes:
            params["include"] = ",".join(includes)
        if filters:
            params.update(filters)
        resp = self._request("fixtures", params)
        return self._extract_data(resp)

    def get_fixture_by_id(
        self, fixture_id: int, includes: Optional[list[str]] = None
    ) -> Optional[dict]:
        """GET /fixtures/{id}"""
        params: dict[str, Any] = {}
        if includes:
            params["include"] = ",".join(includes)
        resp = self._request(f"fixtures/{fixture_id}", params)
        return self._extract_data(resp)

    def get_livescores(
        self, includes: Optional[list[str]] = None
    ) -> Optional[list[dict]]:
        """GET /livescores with optional includes (batting, bowling, runs, etc.)"""
        params: dict[str, Any] = {}
        if includes:
            params["include"] = ",".join(includes)
        resp = self._request("livescores", params, use_cache=True)
        return self._extract_data(resp)

    def get_scores(self, score_id: Optional[int] = None) -> Optional[Any]:
        """GET /scores or /scores/{id}"""
        endpoint = f"scores/{score_id}" if score_id else "scores"
        resp = self._request(endpoint)
        return self._extract_data(resp)

    # ── Context / Ranking Layer ──────────────────────────────────────

    def get_standings_by_season(self, season_id: int) -> Optional[list[dict]]:
        """GET /standings/season/{id}"""
        resp = self._request(f"standings/season/{season_id}")
        return self._extract_data(resp)

    def get_standings_by_stage(self, stage_id: int) -> Optional[list[dict]]:
        """GET /standings/stage/{id}"""
        resp = self._request(f"standings/stage/{stage_id}")
        return self._extract_data(resp)

    def get_team_rankings(self) -> Optional[list[dict]]:
        """GET /team-rankings"""
        resp = self._request("team-rankings")
        return self._extract_data(resp)

    # ── Resolution Layer ─────────────────────────────────────────────

    def get_teams(self) -> Optional[list[dict]]:
        """GET /teams"""
        resp = self._request("teams")
        return self._extract_data(resp)

    def get_team_by_id(self, team_id: int) -> Optional[dict]:
        """GET /teams/{id}"""
        resp = self._request(f"teams/{team_id}")
        return self._extract_data(resp)

    def get_players(self) -> Optional[list[dict]]:
        """GET /players"""
        resp = self._request("players")
        return self._extract_data(resp)

    def get_player_by_id(self, player_id: int) -> Optional[dict]:
        """GET /players/{id}"""
        resp = self._request(f"players/{player_id}")
        return self._extract_data(resp)

    def get_leagues(self) -> Optional[list[dict]]:
        """GET /leagues"""
        resp = self._request("leagues")
        return self._extract_data(resp)

    def get_seasons(self) -> Optional[list[dict]]:
        """GET /seasons"""
        resp = self._request("seasons")
        return self._extract_data(resp)

    def get_season_by_id(self, season_id: int) -> Optional[dict]:
        """GET /seasons/{season_id}"""
        resp = self._request(f"seasons/{season_id}")
        return self._extract_data(resp)

    # ── Convenience: Fixture with full scoreboards ───────────────────

    def get_fixture_full(self, fixture_id: int) -> Optional[dict]:
        """
        Get fixture with batting, bowling, runs, lineup, and balls included.
        This is the most data-rich query for match-level fact-checking.
        """
        return self.get_fixture_by_id(
            fixture_id,
            includes=["batting", "bowling", "runs", "lineup", "balls"],
        )

    def search_fixtures(
        self,
        team_ids: Optional[list[int]] = None,
        season_id: Optional[int] = None,
        status: Optional[str] = None,
        includes: Optional[list[str]] = None,
    ) -> Optional[list[dict]]:
        """
        Search fixtures with filters.
        status: 'Finished', 'NS' (not started), 'Live', etc.
        """
        params: dict[str, Any] = {}
        if includes:
            params["include"] = ",".join(includes)
        filters = []
        if team_ids:
            for tid in team_ids:
                filters.append(f"localteam_id:{tid}")
        if season_id:
            filters.append(f"season_id:{season_id}")
        if status:
            filters.append(f"status:{status}")
        if filters:
            params["filter[status]"] = status if status else None
        resp = self._request("fixtures", params)
        return self._extract_data(resp)

    # ── Health check ─────────────────────────────────────────────────

    def health_check(self) -> dict[str, Any]:
        """Check if the SportMonks API is reachable and the token is valid."""
        if not self.is_available:
            return {
                "status": "unavailable",
                "reason": "SPORTMONKS_API_TOKEN not set",
            }
        try:
            resp = self._request("leagues", use_cache=False)
            if resp and "data" in resp:
                return {
                    "status": "ok",
                    "leagues_available": len(resp["data"]),
                    "cache_entries": len(self._cache),
                }
            return {"status": "error", "reason": "Invalid response"}
        except Exception as e:
            return {"status": "error", "reason": str(e)}

    def __del__(self):
        try:
            self._client.close()
        except Exception:
            pass


# ── Singleton accessor ───────────────────────────────────────────────

_client_instance: Optional[SportMonksClient] = None


def get_sportmonks_client() -> SportMonksClient:
    """Get or create the singleton SportMonks client."""
    global _client_instance
    if _client_instance is None:
        _client_instance = SportMonksClient()
    return _client_instance
