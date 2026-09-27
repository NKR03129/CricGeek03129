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
