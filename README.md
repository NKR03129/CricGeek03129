## CricGeek

Cricket platform with:
- live scores and calendar
- commentary
- blog/community system
- writer roles, saves, follows, and cricket-ball reactions
- Qwen/Ollama-powered BQS scoring
- match preview and post-match analysis pages

## Local Development

Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy on Vercel

Production setup steps are documented here:

- [`docs/PRODUCTION_SETUP.md`](/Users/adityauppuluri/cricgeek/docs/PRODUCTION_SETUP.md)

Important:
- apply Prisma schema changes before deploy
- `OLLAMA_URL` must be reachable from production
- if you run the Python AI service too, set `OLLAMA_BASE_URL` to the same remote host
- use `/api/health` after deploy to verify the environment

Health endpoint:

- `/api/health`
