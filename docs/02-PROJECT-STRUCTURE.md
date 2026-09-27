# 02-PROJECT-STRUCTURE

## Actual repository structure

The workspace contains a monorepo-like combination of a Next.js app, Python AI services, operational docs, scripts, and Prisma definitions.

```text
cricgeek-app/
├── .env, .env.example, .env.production.example
├── .github/
├── .next/
├── ai_service/
├── analysis/
├── capstone cric/
├── cloudflare/
├── data/
├── docs/
├── frontend/
├── insights_service/
├── launchd/
├── ollama-proxy/
├── ops-backups/
├── prisma/
├── public/
├── rag/
├── reports/
├── scripts/
├── src/
├── eslint.config.mjs
├── next-env.d.ts
├── next.config.ts
├── package.json
├── package-lock.json
├── postcss.config.mjs
├── README.md
├── requirements.txt
├── tsconfig.json
├── vercel.json
└── ...
```

## Top-level functional areas

### src/

This is the main application codebase.

Relevant folders:

- src/app — App Router pages, layouts, and route handlers
- src/components — reusable UI components
- src/lib — application logic, API integration, scoring, auth, data access
- src/types — typed cricket data models and interfaces
- src/hooks — client-side hooks (if present)

### prisma/

Contains the Prisma schema and SQL migration scripts.

Notable files:

- prisma/schema.prisma — source of truth for database model types
- prisma/create_tables.sql — SQL creation script
- prisma/comment_threads_migration.sql
- prisma/contest_engine_migration.sql
- prisma/fact_check_search_migration.sql
- prisma/historical_warehouse_migration.sql

### ai_service/

Python services used as the AI backend for analysis, fact checking, and model-backed features. Examples:

- ai_service/claim_extractor.py
- ai_service/fact_checker.py
- ai_service/ollama_client.py
- ai_service/ranking_service.py
- ai_service/research_agent.py
- ai_service/scoring.py
- ai_service/verification_agents.py

### insights_service/

Python service related to match insights and analytics processing. Example files:

- insights_service/main.py
- insights_service/t20_api.py
- insights_service/t20_insights.py
- insights_service/cricket_metrics.py
- insights_service/evaluator.py

### rag/

Contains retrieval-augmented generation support for contextual search.

### scripts/

Operational scripts, import pipelines, and debugging flows.

### docs/

Contains project documentation, deployment guides, and setup notes.

## Source map by responsibility

### Frontend pages

Under src/app:

- landing page: src/app/page.tsx
- blog pages: src/app/blog, src/app/blog/[slug]
- match pages: src/app/matches, src/app/matches/[id]
- commentary pages: src/app/commentary, src/app/commentary/[sessionId]
- writer pages: src/app/writer/[id]
- auth pages: src/app/auth/login, src/app/auth/register
- admin page: src/app/admin/page.tsx
- legal pages and content policy pages

### API layer

Under src/app/api:

- auth routes
- blog routes
- commentary routes
- matches routes
- insights routes
- admin routes
- AI routes for tags, EQS, paraphrase, upload
- scoring validation/analyze routes

### Shared domain logic

Files under src/lib:

- cricket-api.ts — match data provider abstraction
- scoring.ts — overall quality scoring engine
- fact-check.ts — fact checking flow
- historical-warehouse.ts — structured historical data analysis
- deepgram.ts — transcription support
- commentary-polish.ts — commentary text cleanup
- auth.ts — NextAuth config and user orchestration
- contest.ts — contest leaderboard logic

## Relationship between app layers

Application flows usually map like this:

- Page component in src/app
- API route under src/app/api
- Domain helper in src/lib
- Prisma query or persistence operation
- external provider call
- response returned to client

## Important implementation observations

### Layering is coherent but broad

The app uses a single large lib folder rather than strict domain submodules. The following directory patterns exist, but the code is not split into a strict layered architecture with separate controllers and repos.

### AI modules are split across Node and Python

The architecture is hybrid, which means developers must understand both the Node runtime and Python service environment. This is a key operational requirement.

### Some features are still partially demo-driven

The demo-data.ts file and fallback paths in auth and blog flows show a strong local/demo experience, which indicates the app is intentionally resilient during startup or when dependencies are missing.
