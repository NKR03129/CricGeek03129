# CricGeek EDA System Setup

This document describes the production EDA stack that now powers CricGeek's match intelligence layer.

## What is wired in

- Pre-match EDA:
  - page: `/matches/[id]/preview`
  - API: `GET /api/eda/pre-match?matchId=...`
- Live EDA:
  - in-page panel on the main match centre live tab
  - API: `GET /api/eda/live?matchId=...`
- Post-match EDA:
  - page: `/matches/[id]/analysis`
  - API: `GET /api/eda/post-match?matchId=...`
- Hybrid ask flow:
  - in-page "Ask CricGeek" panels on preview and analysis pages
  - API: `POST /api/eda/ask`

## Data and model sources

- SportMonks:
  - live fixture shell
  - score state
  - squads
  - scorecards
- Historical warehouse:
  - team form
  - head-to-head
  - venue benchmarks
  - player trend snapshots
- Online news:
  - GNews or TheNewsAPI
  - optional mock mode for development
- LLM:
  - Ollama for compact JSON narratives and hybrid answer synthesis
- Optional retrieval:
  - `RAG_SERVICE_URL` for internal long-form context retrieval
- Optional specialist live advisor:
  - `INSIGHTS_URL` or `T20_INSIGHTS_URL`

## Required environment variables

- Core match data:
  - `SPORTMONKS_API_TOKEN`
- Database:
  - `DATABASE_URL`
- Auth:
  - `AUTH_SECRET`
  - `AUTH_URL` in production if host inference is not used

## Recommended environment variables

- Ollama:
  - `OLLAMA_URL`
  - `OLLAMA_MATCH_MODEL`
  - `OLLAMA_SHARED_SECRET`
- News:
  - `GNEWS_API_KEY`
  - `THENEWSAPI_API_KEY`
  - `CRICKET_NEWS_ENABLE_MOCK=true` for local fallback only
- Retrieval:
  - `RAG_SERVICE_URL`
- Live insights:
  - `INSIGHTS_URL` or `T20_INSIGHTS_URL`

## Warehouse requirements

The EDA layer is strongest when the historical warehouse has been seeded.

- Import historical SportMonks data:
  - `npx tsx scripts/import-sportmonks-history.ts`
- Or use the protected admin seeder route:
  - `POST /api/admin/seed-historical-warehouse`

## Health checks

`GET /api/health` now reports:

- `historicalWarehouseAvailable`
- `cricketNewsConfigured`
- `ragConfigured`
- `edaStructuredReady`
- `edaLiveReady`
- `edaAskReady`

## Production notes

- Pre-match and post-match pages render server-side from shared EDA builders.
- Live EDA is client-refreshed from the match centre as live match data updates.
- The ask flow is structured-first:
  - match builders first
  - linked CricGeek content next
  - online news next
  - optional RAG last
- Live projections are format-aware:
  - fixed-over projection for T10, T20, and ODI
  - conservative score-state reads for non-fixed-over formats
- All user-facing EDA surfaces expose freshness and confidence so users can judge data quality quickly.
