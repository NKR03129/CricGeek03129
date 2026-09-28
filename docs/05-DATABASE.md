# 05-DATABASE

## Database layer

The data layer is driven by Prisma and defined in prisma/schema.prisma.

The schema contains a SQL Server datasource, which is the actual configured provider for the project.

```prisma
datasource db {
  provider = "sqlserver"
  url      = env("DATABASE_URL")
}
```

This means the main app is not currently configured as SQLite-based. Some helper docs or examples may mention other databases, but the schema is the authoritative source.

## Core entities

### User

Represents a platform user, account identity, and writer profile.

Primary fields likely include:

- id
- name
- email
- passwordHash
- image
- role
- createdAt
- updatedAt

Related models:

- WriterProfile
- Blog
- CommentThread
- Comment
- ContestSubmission
- Follow
- Save

### Blog

A single cricket expression/article.

Important fields include:

- id
- title
- slug
- content
- excerpt
- status
- authorId
- createdAt
- updatedAt

Relationships:

- author -> User
- score -> BlogScore
- comments -> comments and threads
- reports -> report records
- saves
- reactions
- contest submissions

### BlogScore

Stores the computed evaluation and score snapshot for a blog.

This is a critical model for the EQS pipeline and includes fields like:

- bqs
- toneScore
- negativityScore
- toxicityScore
- originalityScore
- coherenceScore
- constructiveness
- evidencePresence
- infoDensity
- argumentLogic
- factCheckOverallScore
- processingStatus
- scoreVersion

It is the canonical place where article quality metrics are persisted.

### WriterProfile

Stores aggregated writer leaderboards and reputation metrics.

Important fields include:

- averageBQS
- totalBlogs
- totalViews
- totalRuns
- archetype
- writerTitle
- level
- xp
- bestBQS
- featuredCount
- streak
- bcs
- statAccuracy

This model supports leaderboard and achievement systems.

### WriterDNA

Tracks a writer's stylistic profile or archetype composition.

Likely used to compute how a writer tends to write:

- analyst
- storyteller
- fan
- debater

### HistoricalMatch and other analytics models

The schema includes models for historical cricket data and warehouse analysis.

These likely support:

- historical fact-checking
- match analysis
- statistical normalization
- replay-style or post-match review flows

### Contest and contest submissions

Contest features are represented by models like:

- Contest
- ContestSubmission

These track:

- contest title and dates
- rules, prize, deadlines
- submission blog relationships
- ranking, scores, final score, overrides
- announcements and status

### Commentary and sessions

The app includes a commentary domain important for live match discussion and voice commentary. Models such as:

- LiveCommentarySession
- CommentaryEntry

are present in the schema and support session-based live commentary streams.

## Relationship patterns

The schema is designed around a social publishing model:

- user -> blogs
- user -> writerProfile
- blog -> blogScore
- blog -> comments / reactions / saves / reports
- user -> follows
- contest -> submissions

This gives the platform both product interaction and gamification features in one database.

## EQS, audit, and voice tables

These cover the spec's database-design workstream. They are declared in
`prisma/schema.prisma`, their DDL lives in `src/lib/eqs/db-ddl.ts`, and
`prisma/eqs_migration.sql` is generated from that DDL by
`node scripts/generate-eqs-migration.mjs`.

| Area | Table | Holds |
|---|---|---|
| EQS | `EqsRun` | Final score, base score, confidence, band, flags, guardrails, explanation, DNA snapshot, timings, pipeline + config version |
| EQS | `EqsComponentResult` | Per-module score, confidence, evidence, flags, source, version, latency |
| Verification | `EqsClaim` | Claim text and type, player, metric, value, status, verification source, provider, evidence, timestamp |
| Plagiarism | `EqsPlagiarismResult` | Internal and external findings as separate rows: similarity, matched percent, matched post, matched passage, provider evidence |
| Models | `EqsModelVersion` | Provider, model, prompt version, latency, and status per analysis stage |
| Audit | `EqsAuditEvent` | Processing events, failures, timeouts, and retries, with stage and duration |
| Writer DNA | `WriterDNAHistory` | DNA classification snapshots, so a past score stays explainable after the live profile moves on |
| Voice | `VoiceCommentaryJob` | Transcript, cleaned transcript, commentary, both providers/models, status, per-stage latency, target compliance |
| Plagiarism | `ExpressionEmbedding` | Vector index of published expressions, used for internal duplicate detection |

`BlogScore` also carries a denormalised EQS summary (`eqs`, `eqsConfidence`, `eqsBand`,
`eqsRunId`, `eqsRequiresReview`, `eqsVersion`, `eqsFlagsJson`) so feed and profile
queries do not need to join `EqsRun`.

### Applying them

The tables are created automatically on first use by `ensureEqsTables()`, which runs
idempotent DDL once per process. That means a freshly cloned checkout starts scoring
without a separate migration step.

To manage the schema yourself instead, apply `prisma/eqs_migration.sql` (or run
`npm run db:push`) and set `EQS_AUTO_MIGRATE=false` to skip the runtime check.

### Indexes

Chosen around the actual query patterns: latest run per post
(`blogId, createdAt DESC`), per writer (`writerId, createdAt DESC`), cache lookups by
`contentHash`, the human-review queue (`requiresHumanReview, createdAt DESC`), component
health (`component, status`), claim triage (`status`, `playerName`), and voice latency
reporting (`status, createdAt DESC`).

### Retention

`EqsRun` children cascade on delete, so removing a run removes its component results,
claims, plagiarism rows, and model versions. `EqsAuditEvent` deliberately has **no**
foreign key to `EqsRun` — an event must be recordable even when the run row was never
written, which is precisely the case you need the audit trail for. Audit events and
voice jobs are therefore not cascaded and need their own retention policy if volume
becomes a concern.

## Database risks and inconsistency

There are several important configuration concerns:

- schema uses SQL Server, but README and environment examples may refer to SQLite-like or generic local setups
- some SQL migration files may show older or alternative schema assumptions
- production readiness depends on migration synchronization between schema.prisma and actual deployed DB

## Operational guidance

For a new developer, the primary DB tasks are:

1. Ensure DATABASE_URL is correctly set for the selected environment
2. Run Prisma migration or schema sync against the target database
3. Validate the generated Prisma client after schema changes
4. Check connection string compatibility with SQL Server requirements

## Database status

The database layer is real and structurally rich. It is one of the core strengths of the application, although operational drift between docs and actual provider config should be treated as a deployment risk.
