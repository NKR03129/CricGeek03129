# 10-EQS

## Overview

EQS refers to the app's quality-scoring framework for blog content. It is one of the most central features in the platform and drives writer performance, trust signals, and reward logic.

This scoring system lives mainly in:

- src/lib/scoring.ts
- src/lib/local-ai.ts
- src/lib/internal-originality.ts
- src/app/api/ai/eqs/route.ts
- src/app/api/scoring/analyze/route.ts

## What EQS evaluates

The scoring model evaluates content against a broad set of dimensions:

- toneScore
- negativityScore
- toxicityScore
- originalityScore
- coherenceScore
- constructiveness
- evidencePresence
- positionClarity
- infoDensity
- argumentLogic
- statsFound
- statsVerified
- statAccuracy
- BQS

The app then maps these into a final score and often a writer archetype.

## Deterministic and AI-backed scoring

The scoring pipeline is hybrid:

- heuristic analysis of structure, tone, negativity, and evidence density
- AI model-based analysis via Ollama or AI service
- originality check using internal duplicate detection
- fact-check scoring to penalize unsupported claims

This hybrid pattern is essential because a single model is not the only determinant of quality.

## Internal originality module

The internal originality checker uses a token/embedding-like process to detect repeated content patterns inside the app. It is designed to prevent low-originality writing from being rewarded.

Core logic lives in src/lib/internal-originality.ts and includes:

- tokenization
- shingling or hash-like embedding generation
- cosine similarity comparisons
- originality scoring output

This supports the system's anti-duplicate and anti-rehash quality controls.

## Local AI model integration

The local AI layer in src/lib/local-ai.ts performs a model-backed scoring pass with Ollama. This is the main path for tool-assisted overall quality evaluation.

Notable characteristics:

- JSON output parsing from model responses
- heuristic fallback when model output is parseable but invalid or unavailable
- multiple checks before returning a score

## Route-level implementation

The app exposes a dedicated endpoint:

- src/app/api/ai/eqs/route.ts

This route explicitly declares Node runtime:

```ts
export const runtime = "nodejs";
```

This confirms the main EQS route is not configured as an Edge runtime endpoint.

## Writer impact

Once a blog is scored, the system updates:

- blogScore records
- writerProfile metrics
- achievements / badge triggers
- total votes, views, and engagement metrics

This creates a strong loop where publishing quality directly affects writer status.

## EQS maturity

The EQS system is one of the most developed parts of the codebase and is more than a basic heuristic engine. It clearly intends to be a central editorial quality arbitration tool.

However, to be fully reliable in production it still depends on:

- model availability
- consistent data quality
- robust fallback behavior
- external fact-check service health

## EQS status

IMPLEMENTED and central to the platform, but operationally dependent on configured AI and external verification services.
