"""
Weekly update orchestrator.

Chains:
    1. sportmonks_importer.run_import()  — fetch new Cricsheet CSVs
    2. rebuild_artifacts.run_rebuild()   — re-run pipeline.py, hot-swap artifacts

Usage:
    python -m insights_service.weekly_update [--since YYYY-MM-DD] [--dry-run] [--import-only]

Designed to be run from launchd (com.cricgeek.t20-weekly-update.plist)
every Sunday at 03:00.
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, date
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Logging (both modules share this configuration)
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = PROJECT_ROOT / "data" / "logs"
LOG_FILE = LOG_DIR / "t20_weekly_update.log"
LOG_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
logger = logging.getLogger("weekly_update")


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def run(
    since: Optional[date] = None,
    dry_run: bool = False,
    import_only: bool = False,
) -> bool:
    """
    Run the weekly update pipeline.

    Args:
        since:       Override the cursor date for the importer.
        dry_run:     Fetch data but do not write files or rebuild artifacts.
        import_only: Run only the importer step, skip the rebuild.

    Returns True if all requested steps succeeded.
    """
    logger.info("=" * 60)
    logger.info("CricGeek T20 Weekly Update — START")
    logger.info("  since       : %s", since or "cursor")
    logger.info("  dry_run     : %s", dry_run)
    logger.info("  import_only : %s", import_only)
    logger.info("=" * 60)

    # ── Step 1: Import new fixtures ──────────────────────────────────────────
    try:
        try:
            from insights_service.sportmonks_importer import run_import
        except ImportError:
            from sportmonks_importer import run_import  # type: ignore[no-redef]

        new_fixtures = run_import(since=since, dry_run=dry_run)
        logger.info("Import step complete — %d new fixtures.", new_fixtures)
    except Exception as exc:
        logger.error("Import step FAILED: %s", exc, exc_info=True)
        return False

    if import_only:
        logger.info("--import-only flag set — skipping rebuild.")
        return True

    if dry_run:
        logger.info("--dry-run flag set — skipping artifact rebuild.")
        return True

    if new_fixtures == 0:
        logger.info("No new fixtures — artifact rebuild not required.")
        return True

    # ── Step 2: Rebuild artifacts ────────────────────────────────────────────
    try:
        try:
            from insights_service.rebuild_artifacts import run_rebuild
        except ImportError:
            from rebuild_artifacts import run_rebuild  # type: ignore[no-redef]

        success = run_rebuild()
        if success:
            logger.info("Rebuild step complete.")
        else:
            logger.error("Rebuild step FAILED.")
        return success
    except Exception as exc:
        logger.error("Rebuild step FAILED with exception: %s", exc, exc_info=True)
        return False


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="CricGeek T20 weekly update: import new fixtures then rebuild artifacts."
    )
    parser.add_argument(
        "--since",
        metavar="YYYY-MM-DD",
        help="Override the import cursor; fetch fixtures after this date.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and parse data but do not write CSVs or rebuild artifacts.",
    )
    parser.add_argument(
        "--import-only",
        action="store_true",
        help="Only run the import step; skip rebuilding artifacts.",
    )
    args = parser.parse_args()

    since: Optional[date] = None
    if args.since:
        try:
            since = datetime.strptime(args.since, "%Y-%m-%d").date()
        except ValueError:
            print(f"Invalid --since date: {args.since!r}", file=sys.stderr)
            sys.exit(1)

    ok = run(
        since=since,
        dry_run=args.dry_run,
        import_only=args.import_only,
    )
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
