# 12-EXTERNAL-SERVICES

## External service inventory

The app is explicitly dependent on several external providers and runtime services.

### Cricket data provider

- SportMonks
- Used through src/lib/cricket-api.ts and src/lib/sportmonks.ts
- Provides live fixtures, scorecards, and match metadata

### Model inference provider

- Ollama
- Used for local AI scoring and text analysis paths
- Qwen-based scoring is referenced in docs and code comments

### Speech transcription

- Deepgram
- Used for audio-to-text commentary transcription
- Configured via src/lib/deepgram.ts

### Search and fact checking

- Tavily
- Serper
- optional GNews or news search integration
- Used in src/lib/fact-check.ts for claims and verdict synthesis

### Python services

- ai_service
- insights_service
- local FastAPI or Python services are expected to respond at configured service URLs

### Optional cloud or deployment integrations

- Cloudflare, Vercel, and tunnel configuration docs exist
- This indicates production deployment and reverse-proxy concerns are part of the platform's broader ops picture

## Service configuration pattern

The app typically expects environment-based configuration like:

- DATABASE_URL
- SPORTMONKS_API_TOKEN
- OLLAMA_URL
- AI_SERVICE_URL
- INSIGHTS_URL / T20_INSIGHTS_URL
- DEEPGRAM_API_KEY
- GNEWS_API_KEY
- NEXTAUTH_SECRET

This means production readiness is strongly coupled to external service health and env correctness.

## Operational risk

Service outages or misconfiguration do not just affect one feature—they can degrade the app's core user experience because many flows are built around remote providers.

## Service status

The external integration layer is an important part of the system. It is functional in a configured environment, but it is not self-contained and requires infrastructure planning before deployment.
