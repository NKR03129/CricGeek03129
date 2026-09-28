"""
SportsMonks Incremental Fixture Importer for the T20 Capstone Pipeline.

Usage:
    python -m insights_service.sportmonks_importer [--since YYYY-MM-DD] [--dry-run]

What it does:
    1. Reads SPORTMONKS_API_TOKEN from .env or the environment.
    2. Fetches completed T20 / T20I fixtures from SportsMonks that are newer
       than the cursor date stored in capstone cric/t20s_csv/.import_cursor.
    3. For each fixture, downloads ball-by-ball data (the "balls" include) and
       writes a Cricsheet v1.6-style CSV to capstone cric/t20s_csv/<fixture_id>.csv.
    4. Updates the cursor to the latest fixture date so the next run is incremental.

The output CSVs match the schema that t20_prep.py already knows how to parse:
    info,key,value   — match-level metadata
    ball,innings,over.ball,batting_team,striker,non_striker,bowler,
         runs_off_bat,extras,wides,noballs,byes,legbyes,penalty,
         wicket_fell,dismissal_kind,dismissed_player
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Generator, Optional

# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------

THIS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = THIS_DIR.parent

# The t20s_csv folder used by the capstone pipeline
T20S_CSV_DIR = PROJECT_ROOT / "capstone cric" / "t20s_csv"
CURSOR_FILE = T20S_CSV_DIR / ".import_cursor"
LOG_DIR = PROJECT_ROOT / "data" / "logs"
LOG_FILE = LOG_DIR / "t20_weekly_update.log"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

LOG_DIR.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
logger = logging.getLogger("sportmonks_importer")

# ---------------------------------------------------------------------------
# Environment / config
# ---------------------------------------------------------------------------

def _load_env() -> None:
    """Best-effort load of the project .env file so we pick up API keys."""
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return
    with env_path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("\"'")
            os.environ.setdefault(key, value)


_load_env()

SPORTMONKS_TOKEN = os.environ.get("SPORTMONKS_API_TOKEN", "")
SPORTMONKS_BASE = os.environ.get(
    "SPORTMONKS_BASE_URL", "https://cricket.sportmonks.com/api/v2.0"
).rstrip("/")

# Match types whose data we want to import
T20_TYPES = {"T20", "T20I"}
# SportsMonks status strings for completed matches
FINISHED_STATUSES = {"Finished", "Completed", "completed", "finished"}

# Rate-limit politeness: seconds to wait between paginated requests
PAGE_SLEEP_SECONDS = 0.4
# Max fixtures per API request
PAGE_SIZE = 50


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------

def _get(path: str, params: Optional[dict[str, Any]] = None, retries: int = 3) -> Any:
    """GET a SportsMonks endpoint and return parsed JSON data field."""
    import urllib.request
    import urllib.parse
    import urllib.error

    if not SPORTMONKS_TOKEN:
        raise RuntimeError(
            "SPORTMONKS_API_TOKEN is not set. "
            "Add it to your .env file or the environment."
        )

    base_params: dict[str, Any] = {"api_token": SPORTMONKS_TOKEN}
    if params:
        base_params.update(params)

    query_string = urllib.parse.urlencode(base_params, doseq=True)
    url = f"{SPORTMONKS_BASE}/{path.lstrip('/')}?{query_string}"

    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                raw = response.read().decode("utf-8")
                payload = json.loads(raw)
                return payload.get("data", payload)
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < retries:
                wait = 10 * attempt
                logger.warning("Rate limited — waiting %ds (attempt %d/%d)", wait, attempt, retries)
                time.sleep(wait)
                continue
            raise
        except Exception as exc:
            if attempt < retries:
                time.sleep(2 * attempt)
                continue
            raise

    return []  # unreachable but appeases type checkers


# ---------------------------------------------------------------------------
# Cursor helpers
# ---------------------------------------------------------------------------

def _read_cursor() -> date:
    """Return the last-processed fixture date, defaulting to 2024-01-01."""
    if CURSOR_FILE.exists():
        try:
            text = CURSOR_FILE.read_text(encoding="utf-8").strip()
            return datetime.strptime(text, "%Y-%m-%d").date()
        except Exception:
            pass
    return date(2024, 1, 1)


def _write_cursor(new_date: date) -> None:
    CURSOR_FILE.write_text(new_date.strftime("%Y-%m-%d"), encoding="utf-8")


# ---------------------------------------------------------------------------
# Fixture discovery
# ---------------------------------------------------------------------------

def _paginate_fixtures(since: date) -> Generator[dict[str, Any], None, None]:
    """
    Yield SportsMonks fixture dicts for completed T20/T20I matches after `since`.

    SportsMonks v2 /fixtures endpoint docs:
        GET /fixtures?filter[sport_id]=<>
    We use the more reliable /fixtures/between/<start>/<end> route and page through.
    """
    end_date = date.today() - timedelta(days=1)  # yesterday = safely finalized
    start_str = since.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")

    current_page = 1
    while True:
        try:
            payload = _get(
                f"fixtures/between/{start_str}/{end_str}",
                params={
                    "page": current_page,
                    "per_page": PAGE_SIZE,
                    "include": "localteam,visitorteam,mancofthematch,manofthematch",
                },
            )
        except Exception as exc:
            logger.error("Failed to fetch fixtures page %d: %s", current_page, exc)
            break

        # SportsMonks wraps paginated results differently from direct data
        if isinstance(payload, dict):
            items = payload.get("data", [])
            meta = payload.get("meta", {})
        elif isinstance(payload, list):
            items = payload
            meta = {}
        else:
            break

        for fixture in items:
            yield fixture

        # Check if there are more pages
        pagination = meta.get("pagination", {})
        total_pages = pagination.get("total_pages", 1)
        if current_page >= total_pages or not items:
            break

        current_page += 1
        time.sleep(PAGE_SLEEP_SECONDS)


def _is_target_fixture(fixture: dict[str, Any]) -> bool:
    """Return True if this fixture is a completed T20/T20I match."""
    match_type = fixture.get("type", "") or ""
    status = fixture.get("status", "") or ""

    # Check type
    if not any(t.lower() in match_type.lower() for t in ("t20", "t20i", "Twenty20")):
        return False

    # Check status
    if status not in FINISHED_STATUSES and "inning" not in status.lower():
        # Some SportsMonks fixtures have status like "1st Innings" while live —
        # we only want finished ones.
        if status not in FINISHED_STATUSES:
            return False

    return True


# ---------------------------------------------------------------------------
# Ball extraction
# ---------------------------------------------------------------------------

def _fetch_balls(fixture_id: int | str) -> list[dict[str, Any]]:
    """Fetch ball-by-ball data for a fixture from SportsMonks."""
    try:
        data = _get(
            f"fixtures/{fixture_id}",
            params={"include": "balls,localteam,visitorteam,tosswinner"},
        )
        if isinstance(data, dict):
            return data.get("balls", {}).get("data", []) if isinstance(data.get("balls"), dict) else data.get("balls", [])
        return []
    except Exception as exc:
        logger.warning("Could not fetch balls for fixture %s: %s", fixture_id, exc)
        return []


def _ball_to_row(ball: dict[str, Any], innings: int) -> dict[str, Any]:
    """
    Normalize a SportsMonks ball object into the columns expected by t20_prep.py.

    SportsMonks ball fields (v2):
        id, ball, score, batter_id, bowler_id, non_striker_id, catch_stump_id,
        batter_name, bowler_name, non_striker_name, run_out_type,
        wicket_type, dismissal_kind, score (struct: runs, extras, is_wicket, ...),
        team_id (batting team), is_wicket, is_four, is_six
    """
    # Resolve score sub-object
    score_obj = ball.get("score") or {}
    if not isinstance(score_obj, dict):
        score_obj = {}

    runs_off_bat = int(score_obj.get("runs", 0) or 0)
    extras_total = int(score_obj.get("extras", 0) or 0)
    is_wide = int(score_obj.get("wide", 0) or 0)
    is_noball = int(score_obj.get("noball", 0) or 0)
    is_bye = int(score_obj.get("bye", 0) or 0)
    is_legbye = int(score_obj.get("legbye", 0) or 0)
    is_penalty = int(score_obj.get("penalty", 0) or 0)

    is_wicket = bool(ball.get("is_wicket") or score_obj.get("is_wicket"))
    dismissal_kind = ball.get("dismissal_kind") or ball.get("wicket_type") or ""
    dismissed_player = ball.get("batter_name") if is_wicket else ""

    over_float = float(ball.get("ball", 0) or 0)

    return {
        "innings": innings,
        "over_ball": f"{over_float:.1f}",
        "batting_team": ball.get("team_name") or ball.get("batting_team") or "",
        "striker": ball.get("batter_name") or "",
        "non_striker": ball.get("non_striker_name") or "",
        "bowler": ball.get("bowler_name") or "",
        "runs_off_bat": runs_off_bat,
        "extras": extras_total,
        "wides": is_wide,
        "noballs": is_noball,
        "byes": is_bye,
        "legbyes": is_legbye,
        "penalty": is_penalty,
        "wicket_fell": 1 if is_wicket else "",
        "dismissal_kind": dismissal_kind,
        "dismissed_player": dismissed_player,
    }


# ---------------------------------------------------------------------------
# CSV writer
# ---------------------------------------------------------------------------

def _write_cricsheet_csv(
    fixture: dict[str, Any],
    balls: list[dict[str, Any]],
    output_path: Path,
) -> None:
    """Write a Cricsheet v1.6-style CSV for a single fixture."""
    local_team = (fixture.get("localteam") or {}).get("name", "")
    visitor_team = (fixture.get("visitorteam") or {}).get("name", "")
    toss_winner_id = fixture.get("toss_winner_id")
    toss_won_by = local_team if str(fixture.get("localteam_id", "")) == str(toss_winner_id) else visitor_team
    toss_decision = fixture.get("elected") or ""

    winning_team = ""
    winner_id = fixture.get("winner_team_id")
    if winner_id:
        if str(fixture.get("localteam_id", "")) == str(winner_id):
            winning_team = local_team
        else:
            winning_team = visitor_team

    match_date = fixture.get("starting_at") or fixture.get("date") or ""
    if match_date and "T" in match_date:
        match_date = match_date.split("T")[0]
    match_date = match_date.replace("-", "/")

    venue_name = fixture.get("venue", {}).get("name", "") if isinstance(fixture.get("venue"), dict) else ""
    gender = "male"  # SportsMonks doesn't reliably expose gender; derive from league if needed

    with output_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh, quoting=csv.QUOTE_MINIMAL)

        # Header rows
        writer.writerow(["version", "1.6.0"])
        writer.writerow(["info", "balls_per_over", "6"])
        if local_team:
            writer.writerow(["info", "team", local_team])
        if visitor_team:
            writer.writerow(["info", "team", visitor_team])
        writer.writerow(["info", "gender", gender])
        writer.writerow(["info", "date", match_date])
        writer.writerow(["info", "venue", venue_name])
        if toss_won_by:
            writer.writerow(["info", "toss_winner", toss_won_by])
        if toss_decision:
            writer.writerow(["info", "toss_decision", toss_decision])
        if winning_team:
            writer.writerow(["info", "winner", winning_team])
        writer.writerow(["info", "source", "sportmonks_import"])

        # Group balls by innings
        innings_grouped: dict[int, list[dict[str, Any]]] = {}
        for ball in balls:
            inn = int(ball.get("innings_id") or ball.get("innings") or 1)
            innings_grouped.setdefault(inn, []).append(ball)

        for innings_idx, (innings_id, innings_balls) in enumerate(
            sorted(innings_grouped.items()), start=1
        ):
            for ball in innings_balls:
                row_data = _ball_to_row(ball, innings_idx)
                writer.writerow([
                    "ball",
                    row_data["innings"],
                    row_data["over_ball"],
                    row_data["batting_team"],
                    row_data["striker"],
                    row_data["non_striker"],
                    row_data["bowler"],
                    row_data["runs_off_bat"],
                    row_data["extras"],
                    row_data["wides"],
                    row_data["noballs"],
                    row_data["byes"],
                    row_data["legbyes"],
                    row_data["penalty"],
                    row_data["wicket_fell"],
                    row_data["dismissal_kind"],
                    row_data["dismissed_player"],
                ])


# ---------------------------------------------------------------------------
# Main import function
# ---------------------------------------------------------------------------

def run_import(since: Optional[date] = None, dry_run: bool = False) -> int:
    """
    Fetch and persist new completed T20 fixtures from SportsMonks.

    Returns the number of new CSV files written.
    """
    T20S_CSV_DIR.mkdir(parents=True, exist_ok=True)

    cursor = since or _read_cursor()
    logger.info("Starting import — since %s (dry_run=%s)", cursor, dry_run)

    if not SPORTMONKS_TOKEN:
        logger.error(
            "SPORTMONKS_API_TOKEN is missing. "
            "Set it in your .env file and re-run."
        )
        return 0

    written = 0
    latest_date = cursor
    skipped_existing = 0

    for fixture in _paginate_fixtures(cursor):
        fixture_id = fixture.get("id")
        if not fixture_id:
            continue

        if not _is_target_fixture(fixture):
            continue

        output_path = T20S_CSV_DIR / f"{fixture_id}.csv"
        if output_path.exists():
            skipped_existing += 1
            continue

        # Track the latest fixture date we see
        fix_date_str = fixture.get("starting_at") or fixture.get("date") or ""
        if fix_date_str:
            try:
                fix_date = datetime.fromisoformat(fix_date_str.replace("Z", "+00:00")).date()
                if fix_date > latest_date:
                    latest_date = fix_date
            except Exception:
                pass

        logger.info("Fetching balls for fixture %s (%s vs %s)…",
                    fixture_id,
                    (fixture.get("localteam") or {}).get("name", "?"),
                    (fixture.get("visitorteam") or {}).get("name", "?"))

        balls = _fetch_balls(fixture_id)
        if not balls:
            logger.warning("  No ball data returned — skipping fixture %s", fixture_id)
            continue

        logger.info("  %d balls fetched.", len(balls))

        if dry_run:
            logger.info("  [dry-run] Would have written %s", output_path.name)
        else:
            _write_cricsheet_csv(fixture, balls, output_path)
            logger.info("  Written → %s", output_path.name)

        written += 1
        time.sleep(PAGE_SLEEP_SECONDS)

    if not dry_run and latest_date > cursor:
        _write_cursor(latest_date)
        logger.info("Cursor advanced to %s", latest_date)

    logger.info(
        "Import complete: %d new CSVs written, %d already existed.",
        written, skipped_existing,
    )
    return written


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch completed T20 fixtures from SportsMonks and write Cricsheet CSVs."
    )
    parser.add_argument(
        "--since",
        metavar="YYYY-MM-DD",
        help="Override the cursor; fetch fixtures after this date.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and parse data but do not write any files.",
    )
    args = parser.parse_args()

    since: Optional[date] = None
    if args.since:
        try:
            since = datetime.strptime(args.since, "%Y-%m-%d").date()
        except ValueError:
            print(f"Invalid --since date: {args.since!r} (expected YYYY-MM-DD)", file=sys.stderr)
            sys.exit(1)

    count = run_import(since=since, dry_run=args.dry_run)
    sys.exit(0 if count >= 0 else 1)


if __name__ == "__main__":
    main()
