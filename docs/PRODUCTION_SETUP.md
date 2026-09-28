# CricGeek Production Setup

## 1. Push the current code

From the project root:

```bash
git add .
git commit -m "Prepare production deployment"
git push origin main
```

## 2. Provision the production database

Use a hosted MySQL database.

Required:
- create a database named `cricgeek` or equivalent
- copy the connection string into `DATABASE_URL`

## 3. Apply the schema before the first deploy

Use one of these:

```bash
npx prisma db push
```

Or apply the SQL in:

[`prisma/create_tables.sql`](/Users/adityauppuluri/cricgeek/prisma/create_tables.sql)

Important:
- the latest schema adds engagement tables and richer `BlogScore` JSON fields
- if you skip this step, likes/saves/follows/BQS explanation storage will fail

## 4. Set production environment variables

Copy values from:

[`/.env.production.example`](/Users/adityauppuluri/cricgeek/.env.production.example)

Minimum required:
- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SPORTMONKS_API_TOKEN`
- `OLLAMA_URL`
- `OLLAMA_BASE_URL` if you run the Python AI service separately
- `OLLAMA_BQS_MODEL`
- `OLLAMA_MATCH_MODEL`

Recommended defaults:
- `ALLOW_MOCK_MATCH_DATA=false`
- `OLLAMA_URL=http://ec2-16-16-184-21.eu-north-1.compute.amazonaws.com:11434`
- `OLLAMA_BASE_URL=http://ec2-16-16-184-21.eu-north-1.compute.amazonaws.com:11434`
- `OLLAMA_MODEL=qwen3.5:latest`
- `OLLAMA_BQS_MODEL=qwen3.5:latest`
- `OLLAMA_MATCH_MODEL=qwen3.5:latest`

## 5. Important Ollama production note

`OLLAMA_URL` cannot be `http://localhost:11434` on Vercel unless Ollama is running in the same environment, which it usually is not.

Use one of these approaches:
- deploy Ollama on a VPS or GPU box and expose it over a private/public HTTPS endpoint
- put the app on infrastructure that can directly reach the Ollama host
- replace Ollama with a separately hosted internal AI scoring service

If `OLLAMA_URL` is not reachable from production:
- BQS analysis will fall back to heuristics
- tag generation may fail or degrade
- match preview/post-match narrative generation will fall back to deterministic summaries

For an EC2-hosted Ollama instance, make sure:
- the EC2 security group allows inbound TCP `11434` from your app host
- Ollama is bound to a non-loopback interface, for example `OLLAMA_HOST=0.0.0.0:11434`
- `curl http://ec2-16-16-184-21.eu-north-1.compute.amazonaws.com:11434/api/tags` works from the app host

## 6. Google Auth setup

In Google Cloud Console:
- create OAuth credentials
- add your production domain callback URL

For NextAuth on Vercel, the callback path is:

`https://your-domain.com/api/auth/callback/google`

## 7. Cricket data setup

Recommended:
- set `SPORTMONKS_API_TOKEN`

Behavior:
- SportMonks drives fixtures, livescores, scorecards, commentary, and squads
- if `SPORTMONKS_API_TOKEN` is missing, the app should avoid mock production data when `ALLOW_MOCK_MATCH_DATA=false`

## 8. Vercel project settings

Recommended:
- Production Branch: `main`
- Node version: default modern Vercel runtime
- add all env vars in Project Settings -> Environment Variables
- redeploy after changing env vars

## 9. Post-deploy checks

After deployment, verify these routes manually:
- `/api/health`
- `/matches`
- `/calendar`
- `/blog`
- `/auth/login`
- `/commentary`

Also test:
- Google sign-in
- becoming a writer
- publishing a blog
- running BQS analysis
- reacting/saving/following
- opening a match preview page
- opening a post-match analysis page

## 10. Run validation on the scoring engine

The sports-domain validation runner is available at:

- `/api/scoring/validate`
- `/api/scoring/validate?limit=20`

This uses the calibration dataset in:

[`src/data/bqs-calibration.json`](/Users/adityauppuluri/cricgeek/src/data/bqs-calibration.json)

## 11. If deployment fails

Check in this order:
- database connectivity
- missing Prisma schema migration
- bad `NEXTAUTH_URL`
- bad Google callback URL
- unreachable `OLLAMA_URL`
- exhausted cricket API quota

## 12. Recommended first production pass

1. Push code
2. Apply Prisma schema to production DB
3. Add all env vars in Vercel
4. Deploy
5. Open `/api/health`
6. Test Google login
7. Create a writer profile
8. Publish one test blog
9. Run `/api/scoring/validate`
