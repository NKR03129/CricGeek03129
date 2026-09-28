# 09-FEATURES

## Product feature map

The app combines sports content, social writing, community gamification, and AI analysis. The main product domains are:

- live cricket match information
- blog publishing and community scoring
- writer progression and leaderboard systems
- commentary and transcription flows
- contests and moderation
- fact-checking and historical analysis

## 1. Match intelligence

CricGeek includes live data and match-specific UIs for:

- list of live matches
- scorecards
- commentary logs
- squad information
- match-specific analysis pages

This is driven primarily through SportMonks integration with fallback logic in src/lib/cricket-api.ts and src/lib/sportmonks.ts.

## 2. Writing and publishing

The blog and writing workflow is one of the app's core product features. Users can:

- draft content
- generate tags and AI polishing
- evaluate with EQS
- publish to community feed
- receive scoring and profile impact

Implementation core:

- src/app/blog/write/page.tsx
- src/lib/scoring.ts
- src/lib/local-ai.ts
- src/app/api/blogs/route.ts

## 3. EQS and quality scoring

The app has a significant scoring engine called the EQS or evidence-quality style pipeline. It computes:

- BQS (Blog Quality Score)
- tone and negativity metrics
- toxicity and originality evaluation
- evidence presence and argument logic
- archetype classification
- writer performance impact

This is implemented in src/lib/scoring.ts and route handlers under src/app/api/ai and src/app/api/scoring.

## 4. Writer identity and community

The app includes a rich writer community layer:

- profile pages
- badges and achievements
- follow/follower relationships
- writer DNA visualization
- statistics and trend metrics

Core files:

- src/app/writer/[id]/page.tsx
- src/components/writer/WriterProfileCard.tsx
- src/lib/scoring.ts

## 5. Contest engine

A contest module exists for challenge-based writing competition.

Features include:

- contest creation by admins
- submission scoring
- leaderboard recomputation
- override scores
- announcement publishing

Core files:

- src/lib/contest.ts
- src/app/api/admin/contests/route.ts
- src/components/admin dashboard code in src/app/admin/page.tsx

## 6. Fact checking and claim validation

The app supports claim extraction and fact validation with routing between:

- historical structured lookup
- web search
- unsupported claim handling

Core files:

- src/lib/fact-check.ts
- ai_service/fact_checker.py
- ai_service/claim_extractor.py

## 7. Voice to commentary

The app includes a voice and transcription workflow for commentary generation or processing.

Feature focus:

- audio submission
- speech-to-text conversion
- commentary polishing and cleaning
- session storage for live commentary

Core files:

- src/app/api/commentary/transcribe/route.ts
- src/lib/deepgram.ts
- src/app/commentary pages and components

## 8. Historical and analytics layers

Historical warehouse models and analysis services appear to support:

- claim recall against historical match data
- structured fact validation
- deeper match analysis and replay-like evaluation

This is visible through Prisma models and scripts under historical warehouse logic.

## 9. Operational/admin tooling

The app also includes a moderation and admin layer with:

- blog status updates
- contest management
- featured content review
- scoring pipeline visibility

## Product maturity assessment

The app is not a narrow single-feature prototype. It is a multi-feature sports-content platform with a layered and fairly rich domain model.

However, its feature set assumes a combination of:

- configured database
- configured auth
- AI model availability
- cricket data provider access
- operational service hosting

Without those, the app falls back to demo patterns or partial functionality.
