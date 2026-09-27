# 13-CONFIGURATION

## Environment configuration overview

The project depends on environment variables for database access, auth, external APIs, and AI service connectivity.

The codebase includes files such as:

- .env.example
- .env.production.example
- README.md
- docs/ setup guides

## Core env variables

The app expects values such as:

- DATABASE_URL
- NEXTAUTH_SECRET
- NEXTAUTH_URL
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- SPORTMONKS_API_TOKEN
- OLLAMA_URL
- AI_SERVICE_URL
- INSIGHTS_URL or T20_INSIGHTS_URL
- DEEPGRAM_API_KEY
- GNEWS_API_KEY
- TAVILY_API_KEY / SERPER_API_KEY if used

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
