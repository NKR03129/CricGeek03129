"""
CricGeek AI Scoring Microservice (V2)
Models loaded at startup. SportMonks entity cache refreshed on startup.
Includes multi-agent fact-checking + LLM reasoning + web research + rankings.
Now includes Whisper-based speech-to-text for live commentary.
"""

import os
import time
import logging
import tempfile
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import whisper

from models import load_all_models, get_models
from scoring import compute_bqs
from ner import extract_cricket_entities
from fact_checker import check_blog, FactCheckReport
from ranking_service import get_leaderboard, compute_engagement_score
from sportmonks_client import get_sportmonks_client
from entity_cache import get_entity_cache
import ollama_client
from t20_api import router as t20_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

COMMENTARY_INITIAL_PROMPT = (
    "This is live English cricket commentary. Common cricket terms include batter, bowler, "
    "over, innings, yorker, bouncer, good length, slower ball, full toss, leg side, off side, "
    "midwicket, square leg, fine leg, covers, powerplay, strike rate, and economy. "
    "Common team abbreviations include IPL, KKR, SRH, CSK, MI, RCB, DC, PBKS, RR, GT, and LSG."
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load all HuggingFace models, Whisper, and populate entity cache at startup."""
    print("🏏 CricGeek AI Service V2 starting — loading models...")
    load_all_models()
    print("✅ All scoring models loaded.")

    # Load Whisper speech-to-text model
    whisper_model_name = os.getenv("WHISPER_MODEL", "base")
    print(f"🎙️  Loading Whisper '{whisper_model_name}' model...")
    try:
        app.state.whisper_model = whisper.load_model(whisper_model_name)
        print(f"✅ Whisper '{whisper_model_name}' model loaded.")
    except Exception as e:
        print(f"⚠️  Whisper load failed: {e} — transcription will be unavailable")
        app.state.whisper_model = None

    # Populate entity cache from SportMonks if stale
    client = get_sportmonks_client()
    cache = get_entity_cache()
    if client.is_available and cache.is_stale:
        print("📡 Refreshing entity cache from SportMonks...")
        try:
            cache.populate_from_api(client)
            print(f"✅ Entity cache refreshed: {len(cache.players)} players, {len(cache.teams)} teams")
        except Exception as e:
            print(f"⚠️  Entity cache refresh failed: {e}")
    elif not client.is_available:
        print("⚠️  SPORTMONKS_API_TOKEN not set — stat fact-checking in degraded mode")

    # Check LLM availability (Ollama is primary, cloud APIs are fallbacks)
    ollama_health = ollama_client.health_check()
    if ollama_health["status"] == "ok":
        model = ollama_client.OLLAMA_MODEL
        ready = ollama_health["default_model_ready"]
        if ready:
            print(f"✅ Ollama running — model '{model}' ready (primary LLM)")
        else:
            print(f"⚠️  Ollama running but model '{model}' not pulled. Run: ollama pull {model}")
    else:
        print("⚠️  Ollama not running — checking cloud fallbacks...")
        if os.getenv("GEMINI_API_KEY"):
            print("✅ Gemini API key detected — LLM reasoning via cloud")
        elif os.getenv("OPENAI_API_KEY"):
            print("✅ OpenAI API key detected — LLM reasoning via cloud")
        else:
            print("⚠️  No LLM available — reasoning will use heuristic fallback")
            print("     To enable: Install Ollama → ollama serve → ollama pull qwen2.5")

    # Check search backend availability
    if os.getenv("TAVILY_API_KEY"):
        print("✅ Tavily API key detected — web research enabled")
    elif os.getenv("SERPER_API_KEY"):
        print("✅ Serper API key detected — web research enabled")
    else:
        print("⚠️  No search API key set — research agent disabled")

    print("✅ Service ready.")
    yield
    print("🛑 Shutting down AI service.")


app = FastAPI(
    title="CricGeek AI Scoring Service",
    description=(
        "Blog quality scoring (BART-MNLI, RoBERTa, Toxic-BERT, MiniLM), "
        "multi-agent fact-checking (SportMonks + LLM + Web Search), "
        "and global blogger rankings for prize distribution"
    ),
    version="2.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://cricgeek.in"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

app.include_router(t20_router)


# ── Request / Response Models ────────────────────────────────────────

class ScoreRequest(BaseModel):
    text: str
    blog_id: str = ""
    include_fact_check: bool = False
    skip_fact_check: bool = False


class ScoreResponse(BaseModel):
    archetype: str
    archetype_confidence: float
    tone_score: float
    negativity_score: float
    toxicity_score: float
    originality_score: float
    coherence_score: float
    constructiveness: float
    evidence_presence: float
    counter_acknowledge: float
    position_clarity: float
    info_density: float
    repetition_penalty: float
    completeness: float
    argument_logic: float
    stat_accuracy: float
    entities_found: int
    stats_found: int
    stats_verified: float
    word_count: int
    lexical_diversity: float
    sentence_variety: float
    avg_sentence_length: float
    bqs: float
    toxicity_penalty_applied: bool
    toxicity_penalty_override: bool
    writer_dna: Optional[dict] = None
    paragraph_scores: Optional[list[dict]] = None
    explanation: Optional[dict] = None
    score_version: str
    reference_corpus_size: int
    reference_corpus_source: str
    max_reference_similarity: Optional[float] = None
    adjacent_similarity: Optional[float] = None
    processing_time_ms: int
    fact_check: Optional[dict] = None


class FactCheckRequest(BaseModel):
    text: str
    blog_id: str = ""
    archetype: str = "Unknown"


class FactCheckResponse(BaseModel):
    total_claims: int
    verified_count: int
    disputed_count: int
    unverifiable_count: int
    insight_score: float
    archetype_synergy: float
    narrative_quality: float
    editorial_summary: str
    research_supported: int
    research_contradicted: int
    research_inconclusive: int
    fact_check_score: float
    combined_score: float
    verdicts: list[dict]
    research_verdicts: list[dict]
    processing_time_ms: int
    sportmonks_available: bool
    llm_used: str
    search_backend: str
    summary: str


class RankingsRequest(BaseModel):
    bloggers: list[dict]
    top_n: int = 25
    weights: Optional[dict] = None


# ── Endpoints ────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    models = get_models()
    sm_client = get_sportmonks_client()
    sm_health = sm_client.health_check()
    cache = get_entity_cache()
    return {
        "status": "ok",
        "version": "2.2.0",
        "models_loaded": all(v is not None for v in models.values()),
        "model_status": {k: (v is not None) for k, v in models.items()},
        "sportmonks": sm_health,
        "ollama": ollama_client.health_check(),
        "cloud_llm_available": bool(os.getenv("GEMINI_API_KEY") or os.getenv("OPENAI_API_KEY")),
        "search_available": bool(os.getenv("TAVILY_API_KEY") or os.getenv("SERPER_API_KEY")),
        "entity_cache": {
            "players": len(cache.players),
            "teams": len(cache.teams),
            "leagues": len(cache.leagues),
            "is_stale": cache.is_stale,
        },
    }


@app.post("/score", response_model=ScoreResponse)
async def score_blog(req: ScoreRequest):
    if not req.text or len(req.text.strip()) < 50:
        raise HTTPException(status_code=400, detail="Text must be at least 50 characters")

    start = time.time()
    try:
        result = compute_bqs(req.text, include_fact_check_score=not req.skip_fact_check)
        result["processing_time_ms"] = int((time.time() - start) * 1000)

        # Optionally include fact-check results
        fact_check_data = None
        if req.include_fact_check and not req.skip_fact_check:
            report = check_blog(req.text, archetype=result.get("archetype", "Unknown"))
            fact_check_data = report.to_dict()
            # Override stat_accuracy with combined score when agents are active
            if report.total_claims > 0 or report.llm_used != "heuristic_fallback":
                result["stat_accuracy"] = report.combined_score

        result["fact_check"] = fact_check_data
        return ScoreResponse(**result)
    except Exception as e:
        logger.error(f"Scoring failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Scoring failed: {str(e)}")


@app.post("/fact-check", response_model=FactCheckResponse)
async def fact_check_blog(req: FactCheckRequest):
    """
    Dedicated fact-checking endpoint.
    Runs the full 3-layer pipeline: Data Agents + LLM Reasoning + Web Research.
    """
    if not req.text or len(req.text.strip()) < 50:
        raise HTTPException(status_code=400, detail="Text must be at least 50 characters")

    try:
        report = check_blog(req.text, archetype=req.archetype)
        return FactCheckResponse(**report.to_dict())
    except Exception as e:
        logger.error(f"Fact-check failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Fact-check failed: {str(e)}")


@app.post("/rankings")
async def get_blogger_rankings(req: RankingsRequest):
    """
    Compute blogger rankings for prize distribution.

    Expects a list of blogger objects, each with their blog scores.
    Returns a sorted leaderboard with prize tiers.
    """
    try:
        leaderboard = get_leaderboard(
            bloggers=req.bloggers,
            top_n=req.top_n,
            weights=req.weights,
        )
        return leaderboard
    except Exception as e:
        logger.error(f"Rankings failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Rankings failed: {str(e)}")


# ── Speech-to-Text (Whisper) ─────────────────────────────────────────

@app.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    """
    Transcribe an audio file to text using OpenAI Whisper (open-source, local).
    Accepts WebM, WAV, MP3, M4A, OGG, FLAC.
    Returns { "text": "...", "language": "...", "duration_ms": ... }
    """
    model = getattr(app.state, "whisper_model", None)
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="Whisper model not loaded. Check server logs.",
        )

    allowed = {
        "audio/webm", "audio/wav", "audio/wave", "audio/x-wav",
        "audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a",
        "audio/ogg", "audio/flac", "application/octet-stream",
    }
    content_type = (audio.content_type or "application/octet-stream").lower()
    if content_type not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio type: {content_type}. Accepted: webm, wav, mp3, m4a, ogg, flac.",
        )

    # Write upload to a temp file for Whisper processing
    if "webm" in content_type:
        suffix = ".webm"
    elif "mp4" in content_type or "m4a" in content_type:
        suffix = ".m4a"
    elif "mpeg" in content_type or "mp3" in content_type:
        suffix = ".mp3"
    elif "ogg" in content_type:
        suffix = ".ogg"
    elif "flac" in content_type:
        suffix = ".flac"
    else:
        suffix = ".wav"
    start = time.time()
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await audio.read())
            tmp_path = tmp.name

        result = model.transcribe(
            tmp_path,
            fp16=False,
            language="en",
            task="transcribe",
            temperature=0,
            initial_prompt=COMMENTARY_INITIAL_PROMPT,
        )
        duration_ms = int((time.time() - start) * 1000)

        return {
            "text": result["text"].strip(),
            "language": result.get("language", "en"),
            "duration_ms": duration_ms,
        }
    except Exception as e:
        logger.error(f"Transcription failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    finally:
        # Clean up temp file
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
