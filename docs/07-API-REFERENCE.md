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

Purpose:

- commentary session creation and participation
- transcription and polish flows

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
