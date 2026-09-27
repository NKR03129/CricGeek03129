# 17-DEVELOPER-HANDOVER

## Handover summary

This project is a Next.js-based cricket platform with a large social/editorial layer, AI scoring, contest logic, and match intelligence features. It is not a limited demo; it is a serious, multi-domain application.

## First steps for a new developer

1. Confirm the environment variables from the env examples
2. Validate the Prisma connection string and DB provider
3. Start required external services, especially Ollama and any Python AI service
4. Check SportMonks credentials for live match data
5. Run the app locally with the normal Next.js dev command

## Recommended local startup command

Use the root package script:

```bash
npm run dev
```

This is the standard local Next.js development command based on the package manifest in the project root.

## Critical runtime fact

The project is not implemented as Edge runtime for the main EQS route. The route explicitly declares Node.js runtime:

```ts
export const runtime = "nodejs";
```

This should be treated as the authoritative runtime behavior for that route and should not be assumed to be Edge unless a specific route or deployment config changes it.

## Most important folders

- src/app — pages and route handlers
- src/lib — shared logic and integrations
- src/components — UI building blocks
- prisma/schema.prisma — schema of record
- ai_service — Python AI backend
- insights_service — Python insights service
- docs — deployment and architecture notes

## High-priority validation checklist

- DB connectivity
- auth provider setup
- admin role and login flow
- Ollama model reachability
- SportMonks API access
- Deepgram/voice path if relevant
- fact-check provider access

## One caution

The app has many features, but many of them are intentionally service-dependent. Development success depends on a fully configured environment, not just on the frontend code.

## Final recommendation

Treat the codebase as a production-oriented platform requiring both application and infrastructure configuration. Start by validating the environment before debugging deeper business logic.
