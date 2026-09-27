# CricGeek Technical Documentation

This documentation package describes the CricGeek codebase as it exists in this repository at the time of review. It intentionally documents only what is supported by the code and highlights where the implementation is partial, planned, or unused.

## Documentation set

- [01-ARCHITECTURE.md](01-ARCHITECTURE.md) — Architecture overview and system diagrams
- [02-PROJECT-STRUCTURE.md](02-PROJECT-STRUCTURE.md) — Real directory and module map
- [03-FRONTEND.md](03-FRONTEND.md) — Frontend framework, pages, components, UI flows
- [04-BACKEND.md](04-BACKEND.md) — Next.js app router backend and server-side services
- [05-DATABASE.md](05-DATABASE.md) — Prisma schema and database architecture
- [06-AUTHENTICATION-SECURITY.md](06-AUTHENTICATION-SECURITY.md) — Auth, roles, security posture, env controls
- [07-API-REFERENCE.md](07-API-REFERENCE.md) — Route-by-route API documentation
- [08-PAGES.md](08-PAGES.md) — Page-by-page feature inventory
- [09-FEATURES.md](09-FEATURES.md) — Major features and business logic
- [10-EQS.md](10-EQS.md) — EQS technical implementation and status
- [11-VOICE-TO-COMMENTARY.md](11-VOICE-TO-COMMENTARY.md) — Voice commentary system status and implementation
- [12-EXTERNAL-SERVICES.md](12-EXTERNAL-SERVICES.md) — External APIs and provider usage
- [13-CONFIGURATION.md](13-CONFIGURATION.md) — Environment variables and operational configuration
- [14-DEPENDENCIES.md](14-DEPENDENCIES.md) — Runtime, dev, and AI dependencies
- [15-IMPLEMENTATION-STATUS.md](15-IMPLEMENTATION-STATUS.md) — Feature matrix and implementation status
- [16-KNOWN-ISSUES.md](16-KNOWN-ISSUES.md) — Confirmed issues and risks
- [17-DEVELOPER-HANDOVER.md](17-DEVELOPER-HANDOVER.md) — Handover guidance for a new developer

## Executive summary

CricGeek is a Next.js application focused on cricket content, live match intelligence, writer/community features, AI-assisted scoring, and commentary workflows. The frontend is implemented primarily in the App Router under src/app, with reusable UI in src/components. Server logic and route handlers live in the same app folder as route modules and shared service code in src/lib.

The system depends on:

- Next.js 16 + React 19 for the frontend and App Router API layer
- Prisma ORM with SQL Server datasource in schema.prisma
- SQLite-style local dev examples and MySQL-like examples in environment files, which indicates configuration drift
- Ollama for local model inference with Qwen defaults
- SportMonks for live cricket data
- optional Deepgram and external search providers for transcription and fact checking
- Python AI services under ai_service and insights_service for additional analysis and scoring features

## Important status notice

This repository contains a large amount of functionality, but several features are assembled as partial or environment-dependent services. Some features are clearly implemented, some are behind environment variables, and some are intentionally staged as demo-mode or planned extension work.

The docs below distinguish between:

- IMPLEMENTED: directly supported by repository code
- PARTIALLY IMPLEMENTED: code exists but is incomplete or relies on external services or demo fallbacks
- PLANNED / NOT IMPLEMENTED: referenced in architecture or docs, but no supporting code path was found
- IMPLEMENTED BUT CURRENTLY UNUSED: present in code but not actively wired into the main path

## Core product areas

- Live match and calendar information
- Writer community with blog publishing and social interactions
- EQS-style writing analysis and scoring
- Commentary publishing and transcription workflows
- Contest and leaderboard mechanics
- Historical match analysis / EDA-related features
- AI-assisted fact checking and originality checks

## Primary runtime entry points

- Next.js app: package.json and src/app
- Prisma schema: prisma/schema.prisma
- Python AI services: ai_service and insights_service
- Supporting scripts: scripts and docs

## Reading order for a new engineer

1. Architecture overview
2. Route and data flow
3. Database model
4. Auth + security
5. API layer
6. Feature logic and EQS
7. Known issues and environment gaps

## Scope boundaries

This package does not modify application code or infrastructure. It reflects the repository as-is and documents known risks and gaps, especially where the environment or external services are required for full runtime behavior.
