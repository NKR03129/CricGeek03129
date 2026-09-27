# 16-KNOWN-ISSUES

## Confirmed issues and operational risks

### 1. Runtime confusion: Edge vs Node

The app does not implement an Edge runtime at the EQS route level. The route uses:

```ts
export const runtime = "nodejs";
```

This means the system is built around the standard Node.js server runtime, not Edge runtime, unless a route or deployment specifically overrides it elsewhere.

### 2. Environment-sensitive startup

Many features need configured external services. Without these, the app may degrade to demo or fallback behavior.

### 3. Database provider consistency

The actual Prisma datasource is SQL Server, while some docs and example config files may imply a different setup. This is a known configuration mismatch risk.

### 4. Hybrid Node/Python operational complexity

The app depends on both Next.js and Python service components. Operational work must cover both, or key flows will fail.

### 5. AI quality dependency

The EQS and validation flows use model-based scoring, but they are not standalone if Ollama or the AI service is missing.

### 6. Fact-check service dependency

Web and historical fact-check routes are only as good as the available providers and their API credentials.

### 7. Demo/fallback patterns are project-level behavior

Some modules intentionally degrade to demo values or fallback logic; this is useful for local development, but it can mask missing production configuration.

## Suggested mitigation

- confirm runtime expectations in deployment config
- validate env files against actual code requirements
- ensure database schema matches target DB provider
- verify model and AI service health before relying on scoring features
- treat local/demo fallback logic as development resilience, not a production guarantee

## Status

The application is feature-rich and actively implemented, but it should be treated as a service-dependent sports platform rather than a simple static app.
