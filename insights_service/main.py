from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
import logging

THIS_DIR = Path(__file__).resolve().parent


def _resolve_root_dir() -> Path:
    candidates = (THIS_DIR.parent, THIS_DIR)
    for candidate in candidates:
        if (candidate / "capstone cric").exists():
            return candidate
    return THIS_DIR.parent


ROOT_DIR = _resolve_root_dir()
try:
    from insights_service.t20_insights import (
        CAPSTONE_OUTPUTS_DIR,
        T20InsightsUnavailable,
        get_evaluation as get_t20_evaluation,
        get_manual_advisor as get_t20_manual_advisor,
        get_metadata,
        get_player_explorer as get_t20_player_explorer,
        search_players as search_t20_players,
    )
except ModuleNotFoundError:
    from t20_insights import (
        CAPSTONE_OUTPUTS_DIR,
        T20InsightsUnavailable,
        get_evaluation as get_t20_evaluation,
        get_manual_advisor as get_t20_manual_advisor,
        get_metadata,
        get_player_explorer as get_t20_player_explorer,
        search_players as search_t20_players,
    )

REQUIRED_ARTIFACTS = (
    "aggregated_df.pkl",
    "bowling_over_df.pkl",
    "entries_with_perf.pkl",
    "eval_results.pkl",
    "filtered_df.pkl",
    "player_gender_map.pkl",
    "player_image_urls.json",
    "player_team_map.json",
    "team_players_map.json",
    "teams_list.pkl",
)

app = FastAPI(
    title="CricGeek T20 Insights Service",
    description="Lightweight deployed service for capstone T20 advisor, evaluation, and player explorer routes.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://cricgeek.vercel.app",
        "https://cricgeek.in",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

logger = logging.getLogger("t20_api")


class T20AdvisorRequest(BaseModel):
    runs: int = Field(ge=0, le=300)
    wickets: int = Field(ge=0, le=10)
    overs: float = Field(ge=0, le=20)
    innings: int = Field(ge=1, le=2)
    target: Optional[int] = Field(default=None, ge=1, le=400)
    batting_team: Optional[str] = None
    bowling_team: Optional[str] = None
    match_gender: str = "male"
    strategy: str = "balanced"
    top_n: int = Field(default=5, ge=3, le=10)


def _artifact_health() -> tuple[bool, dict[str, object]]:
    outputs_dir = CAPSTONE_OUTPUTS_DIR
    files: dict[str, object] = {}
    missing: list[str] = []

    for filename in REQUIRED_ARTIFACTS:
        path = outputs_dir / filename
        exists = path.exists()
        if not exists:
            missing.append(filename)
            files[filename] = {"exists": False}
            continue

        files[filename] = {
            "exists": True,
            "sizeBytes": path.stat().st_size,
        }

    return len(missing) == 0, {
        "directory": str(outputs_dir),
        "missing": missing,
        "files": files,
    }


@app.get("/health")
async def health() -> dict[str, object]:
    artifacts_ok, artifact_report = _artifact_health()

    return {
        "status": "ok" if artifacts_ok else "degraded",
        "service": "t20-insights",
        "artifacts": artifact_report,
    }


@app.get("/health/deep")
async def health_deep() -> dict[str, object]:
    try:
        metadata = get_metadata()
        return {
            "status": "ok",
            "service": "t20-insights",
            "players": metadata.get("playerCount", 0),
            "teams": metadata.get("teamCount", 0),
            "artifacts": metadata.get("artifactStatus", {}),
        }
    except T20InsightsUnavailable as exc:
        return {
            "status": "degraded",
            "service": "t20-insights",
            "error": str(exc),
        }
    except Exception as exc:
        return {
            "status": "degraded",
            "service": "t20-insights",
            "error": f"Unexpected insights health error: {exc}",
        }


@app.get("/t20-insights/meta")
async def get_t20_insights_metadata(
    query: Optional[str] = None,
    team: Optional[str] = None,
    gender: Optional[str] = None,
    limit: int = 50,
):
    try:
        payload = get_metadata()
        payload["playerMatches"] = search_t20_players(
            query=query,
            team=team,
            gender=gender,
            limit=limit,
        )
        return payload
    except T20InsightsUnavailable as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        from fastapi import HTTPException

        logger.error(f"T20 metadata failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"T20 metadata failed: {str(exc)}") from exc


@app.post("/t20-insights/advisor")
async def get_t20_insights_advisor(req: T20AdvisorRequest):
    try:
        return get_t20_manual_advisor(
            runs=req.runs,
            wickets=req.wickets,
            overs=req.overs,
            innings=req.innings,
            target=req.target,
            batting_team=req.batting_team,
            bowling_team=req.bowling_team,
            match_gender=req.match_gender,
            strategy=req.strategy,
            top_n=req.top_n,
        )
    except T20InsightsUnavailable as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        from fastapi import HTTPException

        logger.error(f"T20 advisor failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"T20 advisor failed: {str(exc)}") from exc


@app.get("/t20-insights/evaluation")
async def get_t20_insights_evaluation(sample_situations: int = 80):
    bounded_sample_size = max(20, min(sample_situations, 150))

    try:
        return get_t20_evaluation(bounded_sample_size)
    except T20InsightsUnavailable as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        from fastapi import HTTPException

        logger.error(f"T20 evaluation failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"T20 evaluation failed: {str(exc)}") from exc


@app.get("/t20-insights/player")
async def get_t20_insights_player(name: str):
    try:
        return get_t20_player_explorer(name)
    except T20InsightsUnavailable as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        from fastapi import HTTPException

        logger.error(f"T20 player explorer failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"T20 player explorer failed: {str(exc)}") from exc
