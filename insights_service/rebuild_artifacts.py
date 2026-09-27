"""
Artifact Rebuild script.

After the SportsMonks importer writes new Cricsheet CSVs, this script
re-runs the capstone pipeline (pipeline.py) to regenerate all model
artifacts in-place under capstone cric/outputs/.

While the pipeline is running the FastAPI insights service continues to
serve the *previous* artifacts — there is no downtime because pickle files
are only replaced when the new ones are ready.

Usage:
    python -m insights_service.rebuild_artifacts
    # or via weekly_update.py (preferred)
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

THIS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = THIS_DIR.parent
CAPSTONE_DIR = PROJECT_ROOT / "capstone cric"
PIPELINE_SCRIPT = CAPSTONE_DIR / "pipeline.py"
OUTPUTS_DIR = CAPSTONE_DIR / "outputs"

LOG_DIR = PROJECT_ROOT / "data" / "logs"
LOG_FILE = LOG_DIR / "t20_weekly_update.log"
LOG_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Logging (reuse the shared log file)
# ---------------------------------------------------------------------------

logger = logging.getLogger("rebuild_artifacts")

# ---------------------------------------------------------------------------
# Venv discovery
# ---------------------------------------------------------------------------

def _find_python() -> str:
    """
    Return the Python executable to use for running pipeline.py.

    Preference order:
        1. The same interpreter as the current process (i.e. the venv that is
           already activated when weekly_update.py is run).
        2. capstone cric/.venv/bin/python
        3. capstone cric/../.venv/bin/python  (project-level venv)
        4. sys.executable as fallback
    """
    candidates = [
        sys.executable,
        CAPSTONE_DIR / ".venv" / "bin" / "python",
        PROJECT_ROOT / ".venv" / "bin" / "python",
    ]
    for candidate in candidates:
        path = Path(str(candidate))
        if path.exists():
            return str(path)
    return sys.executable


# ---------------------------------------------------------------------------
# Rebuild
# ---------------------------------------------------------------------------

def run_rebuild(timeout_seconds: int = 900) -> bool:
    """
    Invoke ``python pipeline.py`` inside ``capstone cric/``.

    Returns True on success, False on failure.
    """
    if not PIPELINE_SCRIPT.exists():
        logger.error("pipeline.py not found at %s — skipping rebuild.", PIPELINE_SCRIPT)
        return False

    python_exe = _find_python()
    logger.info("Rebuilding capstone artifacts…")
    logger.info("  python  : %s", python_exe)
    logger.info("  script  : %s", PIPELINE_SCRIPT)
    logger.info("  cwd     : %s", CAPSTONE_DIR)

    start = time.time()
    try:
        result = subprocess.run(
            [python_exe, str(PIPELINE_SCRIPT)],
            cwd=str(CAPSTONE_DIR),
            capture_output=False,     # let stdout/stderr flow to the terminal so logs capture them
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired:
        elapsed = time.time() - start
        logger.error(
            "Pipeline timed out after %.0fs (limit=%ds).",
            elapsed, timeout_seconds,
        )
        return False
    except Exception as exc:
        logger.error("Failed to launch pipeline.py: %s", exc)
        return False

    elapsed = time.time() - start
    if result.returncode == 0:
        logger.info("Pipeline completed successfully in %.0fs.", elapsed)
        _invalidate_artifact_cache()
        return True
    else:
        logger.error(
            "Pipeline exited with code %d after %.0fs.",
            result.returncode, elapsed,
        )
        return False


def _invalidate_artifact_cache() -> None:
    """
    Clear the lru_cache in t20_insights so the FastAPI service picks up the
    newly written pickle files on the next request.

    When the insights service runs in the *same process* we can call
    load_t20_artifacts.cache_clear() directly.  In production the service
    runs separately so the cache will expire naturally on the next request
    (Python lru_cache is per-process).  In that case write a sentinel file
    that the service can watch.
    """
    sentinel = OUTPUTS_DIR / ".artifacts_rebuilt"
    try:
        sentinel.write_text(str(time.time()), encoding="utf-8")
        logger.info("Wrote rebuild sentinel → %s", sentinel)
    except Exception as exc:
        logger.warning("Could not write rebuild sentinel: %s", exc)

    # If we are running inside the same process as the insights service
    # (e.g. during testing), clear the cache immediately.
    try:
        try:
            from insights_service.t20_insights import load_t20_artifacts
        except ImportError:
            from t20_insights import load_t20_artifacts  # type: ignore[no-redef]
        load_t20_artifacts.cache_clear()
        logger.info("lru_cache cleared — next request will load fresh artifacts.")
    except Exception:
        pass  # Running as a standalone script; cache lives in another process


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-8s  %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(LOG_FILE, encoding="utf-8"),
        ],
    )
    success = run_rebuild()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
