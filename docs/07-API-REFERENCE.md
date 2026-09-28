# 07-API-REFERENCE

## API style

This application uses Next.js route handlers for its backend API surface. Most routes return JSON and often rely on Prisma and auth gating.

## Route group categories

### Authentication routes

- /api/auth/[...nextauth]
- /api/auth/login
- /api/auth/register

Purpose:

- session establishment
- credentials / OAuth login
- account creation and user onboarding

### Blog routes

- GET /api/blogs
- POST /api/blogs
- GET /api/blogs/[slug]
- PATCH /api/blogs/[slug]
- POST /api/blogs/[slug]/comments
- POST /api/blogs/[slug]/save
- POST /api/blogs/[slug]/views
- POST /api/blogs/[slug]/runs
- POST /api/blogs/report

Purpose:

- blog discovery, creation, publication, and moderation
- comment threads, saves, reactions, views, and reporting

### Match routes

- GET /api/matches
- GET /api/matches/[id]
- GET /api/matches/[id]/live
- GET /api/matches/[id]/scorecard
- GET /api/insights/live

Purpose:

- fetch live and historical match data
- return match detail bundles
- provide scorecard and commentary context

### Commentary routes

- GET /api/commentary
- POST /api/commentary
- GET /api/commentary/[sessionId]
- POST /api/commentary/[sessionId]/entries
- POST /api/commentary/transcribe
- POST /api/commentary/stt-token

Purpose:

- commentary session creation and participation
- voice clip to publish-ready commentary, with per-stage latency reported
  (`stages`, `latencyMs`, `targetMs`, `withinTarget`)
- `stt-token` mints a short-lived provider credential so the browser can stream
  microphone audio directly to the speech-to-text provider

See [11-VOICE-TO-COMMENTARY.md](11-VOICE-TO-COMMENTARY.md).

### AI routes

- POST /api/ai/eqs
- POST /api/ai/tags
- POST /api/ai/paraphrase
- POST /api/ai/upload
- POST /api/scoring/analyze
- POST /api/scoring/validate

Purpose:

- analyze and score blog quality
- generate tags and text rewrites
- integrate with local AI or service-based inference

`POST /api/ai/eqs` scores a draft through the EQS pipeline. Its response keeps the
legacy `overallEqs` / `weightedEqs` / `attributes` / `originalityCheck` fields and adds
the full breakdown (`eqs`, `band`, `confidence`, `dimensions`, `components`, `claims`,
`flags`, `guardrails`, `writerDna`, `explanation`, `requiresHumanReview`,
`modelVersions`). Drafts are not persisted unless `persist: true` is passed.

`POST /api/scoring/analyze` runs BQS and then EQS, persisting both. An EQS failure
degrades to BQS-only and is reported in `eqsError`.

### EQS routes

| Route | Method | Access | Purpose |
|---|---|---|---|
| /api/eqs/run | POST | author or admin | Score a saved expression and persist the full audit trail |
| /api/eqs/[blogId] | GET | any (`?audit=1` author/admin) | Stored EQS breakdown with component evidence, claims, and plagiarism findings |
| /api/eqs/review-queue | GET | admin | Runs the pipeline routed to a human reviewer |
| /api/eqs/benchmark | GET | admin (`?coverage=1` open) | Calibration report with false positive/negative metrics |
| /api/eqs/config | GET | admin | Effective provider, model, weights, thresholds, and versions |

See [10-EQS.md](10-EQS.md).

### Admin routes

- GET /api/admin/blogs
- PATCH /api/admin/blogs
- GET /api/admin/contests
- POST /api/admin/contests
- PATCH /api/admin/contests

Purpose:

- moderate blog submissions
- configure contests
- recompute standings
- publish announcements

## Common response patterns

Typical responses are either:

- JSON object with a result payload
- status code 200/201/400/403/500
- error message objects on failure

Example response structure:

```json
{
  "message": "Blog updated",
  "blog": { "id": "..." }
}
```

## Authenticated endpoints

Many admin, blog write, and contest-related APIs require session-bound auth. The app commonly uses auth() to verify role and identity before proceeding.

## Notes on API robustness

The API layer is active but not uniformly fully hardened.

Main concerns:

- validation is inconsistent across routes
- some routes are environment dependent
- some endpoints have fallbacks for demo mode and local testing
- some data fetches assume upstream service health

## Example backend logic

The following route pattern is common:

```ts
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // validate
    // call Prisma or external service
    // return JSON
  } catch (error) {
    console.error("error", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
```

This indicates a straightforward server-route design rather than GraphQL or an explicit REST specification.

## API status

The API surface is substantial and coherent, but it is better understood as a product API with partial service integration than as a fully standardized public API contract.
