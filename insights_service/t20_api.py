from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

try:
    from insights_service.t20_insights import (
        T20InsightsUnavailable,
        get_evaluation as get_t20_evaluation,
        get_manual_advisor as get_t20_manual_advisor,
        get_metadata as get_t20_metadata,
        get_player_explorer as get_t20_player_explorer,
        search_players as search_t20_players,
    )
except ModuleNotFoundError:
    from t20_insights import (
        T20InsightsUnavailable,
        get_evaluation as get_t20_evaluation,
        get_manual_advisor as get_t20_manual_advisor,
        get_metadata as get_t20_metadata,
        get_player_explorer as get_t20_player_explorer,
        search_players as search_t20_players,
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


router = APIRouter()


@router.get("/t20-insights/meta")
async def get_t20_insights_metadata(
    query: Optional[str] = None,
    team: Optional[str] = None,
    gender: Optional[str] = None,
    limit: int = 50,
):
    try:
        payload = get_t20_metadata()
        payload["playerMatches"] = search_t20_players(
            query=query,
            team=team,
            gender=gender,
            limit=limit,
        )
        return payload
    except T20InsightsUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f"T20 metadata failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"T20 metadata failed: {str(exc)}") from exc


@router.post("/t20-insights/advisor")
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
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f"T20 advisor failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"T20 advisor failed: {str(exc)}") from exc


@router.get("/t20-insights/evaluation")
async def get_t20_insights_evaluation(sample_situations: int = 80):
    bounded_sample_size = max(20, min(sample_situations, 150))

    try:
        return get_t20_evaluation(bounded_sample_size)
    except T20InsightsUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f"T20 evaluation failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"T20 evaluation failed: {str(exc)}") from exc


@router.get("/t20-insights/player")
async def get_t20_insights_player(name: str):
    try:
        return get_t20_player_explorer(name)
    except T20InsightsUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f"T20 player explorer failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"T20 player explorer failed: {str(exc)}") from exc
