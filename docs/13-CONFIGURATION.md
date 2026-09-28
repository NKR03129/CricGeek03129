# 13-CONFIGURATION

## Environment configuration overview

The project depends on environment variables for database access, auth, external APIs, and AI service connectivity.

**[`.env.example`](../.env.example) is the authoritative, fully commented list.** Copy it
to `.env` and work through it; it is grouped by what each block switches on, and it marks
which variables are actually required.

Related reading:

- [`SETUP.md`](../SETUP.md) — copy-paste setup for a new developer
- [`PRODUCTION_SETUP.md`](PRODUCTION_SETUP.md) — deployment
- [`10-EQS.md`](10-EQS.md) — what each EQS variable changes

## Required

Only these three are needed to boot:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQL Server connection string |
| `AUTH_SECRET` | Session signing secret |
| `AUTH_URL` | Base URL of the app (`AUTH_TRUST_HOST=true` covers local dev) |

`NEXTAUTH_SECRET` / `NEXTAUTH_URL` are accepted as legacy aliases.

## Feature groups

Everything below is optional. When a group is unset, that feature degrades gracefully
and `/api/health` reports which one is off.

| Group | Key variables | Off means |
|---|---|---|
| EQS language model | `EQS_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_EQS_MODEL` | EQS falls back to the self-hosted model, then to deterministic heuristics, with reduced confidence |
| EQS self-hosted model | `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_BQS_MODEL` | BQS, tag generation, and commentary polish degrade to deterministic output |
| EQS external plagiarism | `EXTERNAL_PLAGIARISM_API_URL`, `EXTERNAL_PLAGIARISM_API_KEY` | Stage 8 reports `unavailable`; the pipeline continues |
| EQS internal plagiarism | `INTERNAL_DUPLICATE_THRESHOLD`, `INTERNAL_ORIGINALITY_CANDIDATES` | Uses defaults (0.85 / 120) |
| EQS stage toggles | `EQS_*_ENABLED`, `EQS_RUN_ON_ANALYZE`, `EQS_AUTO_MIGRATE` | All default on |
| EQS timeouts / limits | `EQS_*_TIMEOUT_MS`, `EQS_MAX_MODEL_ADJUSTMENT`, `EQS_CACHE_*` | Sensible defaults |
| Cricket data | `SPORTMONKS_API_TOKEN`, `ALLOW_MOCK_MATCH_DATA` | No real fixtures; EQS cannot verify claims against a scorecard |
| Fact-check search | `TAVILY_API_KEY` or `SERPER_API_KEY` | Claims the scorecard cannot answer stay unverified |
| Voice-to-Commentary | `DEEPGRAM_API_KEY`, `VOICE_LATENCY_TARGET_MS`, `VOICE_STREAMING_ENABLED` | Voice-to-text returns 503 |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Credentials sign-in only |
| Cricket news | `GNEWS_API_KEY`, `THENEWSAPI_API_KEY`, `CRICKET_NEWS_ENABLE_MOCK` | Placeholder headlines |
| Python services | `AI_SERVICE_URL`, `INSIGHTS_URL`, `RAG_SERVICE_URL` | Advanced insights pages unavailable |

## Scoring configuration is not environment configuration

EQS weights, thresholds, guardrail caps, and score bands live in
[`src/data/eqs-scoring-config.json`](../src/data/eqs-scoring-config.json), **not** in
environment variables. That file is versioned (`configVersion`) and every stored run
records which version produced it, so a past score stays explainable.

Change those numbers only after a benchmark comparison — see
[10-EQS.md](10-EQS.md#changing-production-behaviour).

## Runtime configuration notes

### Database

The main schema is for SQL Server, so the database config should be aligned with the current deployed DB.

### Auth

Auth settings are required for both local dev and production. If they are absent, sign-in and admin flows will fail or degrade.

### AI and facts

AI scoring and fact-check flows are often gated by service health and env values. Without a working model or service backend, those features either fall back to heuristics or become unavailable.

## Local development considerations

The repo supports local dev but expects environment files and possibly background services such as:

- Ollama
- Python AI service
- database instance
- match API connectivity

## Deployment configuration notes

The repo includes deployment-related docs and config such as:

- vercel.json
- cloudflare/
- launchd/
- docs for tunnel and production setup

This signals that operations and deployment setup are treated as first-class concerns for the project.

## Configuration risk

The main config issue is not a single missing variable—it is the broad dependency chain across database, auth, AI, and external provider configuration. This makes startup and deployment sensitive to environment correctness.
