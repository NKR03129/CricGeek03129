# 04-BACKEND

## Backend runtime

The primary backend is the Next.js App Router runtime in src/app/api and the server-side modules in src/lib.

The app also includes Python services under ai_service and insights_service.

## Framework and server stack

- Next.js 16 App Router
- React 19
- Prisma ORM
- NextAuth
- optional Python microservices for AI and insights

## Request lifecycle

Typical request lifecycle for a route:

1. Browser requests a page or API route
2. Route handler in src/app/api executes
3. Route uses auth() or session checks when needed
4. Route reads/writes Prisma models
5. Route calls helper logic in src/lib or third-party APIs
6. JSON or redirect response is returned to the client

## Main backend responsibilities

### Authentication and identity

- src/lib/auth.ts
- src/app/api/auth/login/route.ts
- src/app/api/auth/register/route.ts
- src/app/api/auth/[...nextauth]/route.ts

This provides:

- credentials auth with bcrypt
- optional Google auth provider
- demo fallback via src/lib/demo-data.ts
- role-aware session data

### Blogs and content lifecycle

- src/app/api/blogs/route.ts
- src/app/api/blogs/[slug]/route.ts
- src/app/api/blogs/[slug]/comments/route.ts
- src/app/api/blogs/[slug]/comments/route.ts
- src/app/api/blogs/[slug]/save/route.ts
- src/app/api/blogs/[slug]/runs/route.ts
- src/app/api/blogs/[slug]/views/route.ts
- src/app/api/blogs/report/route.ts

This covers:

- blog creation and listing
- comment handling
- view tracking
- reactions and saves
- report submission

### Match and cricket data

- src/app/api/matches/route.ts
- src/app/api/matches/[id]/live/route.ts
- src/app/api/livescores/route.ts
- src/app/api/insights/live/route.ts
- src/lib/cricket-api.ts
- src/lib/sportmonks.ts

This layer normalizes match data from SportMonks or fallback sources and feeds UI pages.

### Commentary

- src/app/api/commentary/route.ts
- src/app/api/commentary/[sessionId]/route.ts
- src/app/api/commentary/[sessionId]/entries/route.ts
- src/app/api/commentary/[sessionId]/stream/route.ts
- src/app/api/commentary/transcribe/route.ts

This covers:

- session creation and lifecycle
- live entries
- audio transcription via Deepgram or AI service
- cleanup and formatting of commentary text

### AI and scoring

- src/app/api/scoring/analyze/route.ts
- src/app/api/scoring/validate/route.ts
- src/app/api/ai/eqs/route.ts
- src/app/api/ai/tags/route.ts
- src/app/api/ai/paraphrase/route.ts
- src/app/api/ai/upload/route.ts
- src/lib/scoring.ts
- src/lib/local-ai.ts
- src/lib/fact-check.ts
- src/lib/internal-originality.ts

These routes produce and update the quality score pipeline and EQS outputs.

### Admin and moderation

- src/app/api/admin/blogs/route.ts
- src/app/api/admin/contests/route.ts
- src/app/api/admin/seed-historical-warehouse/route.ts

These routes support moderation and contest administration.

## Service layer design

The backend is not separated into strict controllers/repositories; rather, logic is concentrated into route files and lib modules.

This means the code base depends on domain helper functions for:

- auth
- scoring
- fact checking
- data provider access
- historical warehouse operations
- commentary transformation

## Error handling patterns

Common patterns seen across the backend:

- parse/validate request body and return 400 on bad input
- auth checks return 401 or 403
- DB or API failure uses 500 and logs errors
- service failure may degrade to demo fallback data or mocked values

## External backend dependencies

The app expects external services for many capabilities:

- SportMonks API for cricket data
- Ollama for LLM-based model analysis
- Deepgram for STT
- GNews / TheNewsAPI for news-related features
- Tavily or Serper for fact checking
- Python AI service host for legacy features
- RAG service for retrieval features

## Backend status notes

The backend is functionally rich and has a coherent general design, but the system is not fully self-contained. Several critical flows require configured external infrastructure to work beyond demo or fallback behavior.

## Notable backend concerns

- environment config is essential for production operation
- hybrid Node/Python runtime introduces operational complexity
- some fallback logic reads as progressive enhancement rather than production-safe failover
- DB mismatch between SQL Server schema and MySQL examples indicates ongoing configuration drift
