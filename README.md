## CricGeek

Cricket platform with:
- live scores and calendar
- voice-driven live commentary
- blog/community system
- writer roles, saves, follows, and cricket-ball reactions
- **EQS (Expression Quality Score)** — DNA-aware content-quality scoring
- match preview and post-match analysis pages

## Quick start

**New here? Follow [`SETUP.md`](SETUP.md)** — it is a copy-paste cheat sheet that assumes
no prior knowledge of this codebase.

The short version:

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# Mac / Linux
bash scripts/setup.sh

npm run dev
```

Open <http://localhost:3000>, then <http://localhost:3000/api/health> to see which
features are configured.

## Configuration

Every setting is documented in [`.env.example`](.env.example). Copy it to `.env` and fill
in `DATABASE_URL` — that is the only strictly required value. Everything else enables a
feature; when it is missing that feature degrades gracefully and `/api/health` reports it.

## Commands

```bash
npm run dev            # development server
npm run build          # production build (also typechecks)
npm run typecheck      # types only
npm run lint           # code style
npm run db:push        # create/update database tables
npm run db:studio      # visual database browser
npm run eqs:selftest   # offline check of the scoring engine (no keys, no database)
npm run eqs:migration  # regenerate prisma/eqs_migration.sql
```

## EQS

EQS evaluates quality, credibility, expression, reasoning, originality, and suitability
of cricket content. It is not an AI detector, a sentiment score, or a grammar checker.

An 11-stage pipeline combines deterministic fast checks, structured language analysis,
cricket-stat verification against trusted data, internal and external plagiarism
detection, and Writer DNA context — then applies DNA-aware weighting, a bounded model
interpretation, and deterministic guardrails.

- How it works: [`docs/10-EQS.md`](docs/10-EQS.md)
- Code: [`src/lib/eqs/`](src/lib/eqs/)
- Weights and thresholds: [`src/data/eqs-scoring-config.json`](src/data/eqs-scoring-config.json)
- Benchmark set: [`src/data/eqs-benchmark.json`](src/data/eqs-benchmark.json)

Endpoints: `/api/ai/eqs`, `/api/eqs/run`, `/api/eqs/[blogId]`, `/api/eqs/review-queue`,
`/api/eqs/benchmark`, `/api/eqs/config`.

## Voice-to-Commentary

Microphone → streaming STT → cleanup → commentary transformation → commentary API, with
per-stage latency measured against a ~15–30s end-to-end target.

See [`docs/11-VOICE-TO-COMMENTARY.md`](docs/11-VOICE-TO-COMMENTARY.md).

## Documentation

[`docs/`](docs/) covers architecture, frontend, backend, database, auth, API reference,
pages, features, EQS, voice, external services, configuration, dependencies, and known
issues.

## Deploy on Vercel

See [`docs/PRODUCTION_SETUP.md`](docs/PRODUCTION_SETUP.md).

Important:
- apply Prisma schema changes before deploy (`npx prisma db push`)
- set `AUTH_URL` to your real domain and `ALLOW_MOCK_MATCH_DATA=false`
- `OLLAMA_URL` must be reachable from production if you use the self-hosted model path
- use `/api/health` after deploy to verify the environment
