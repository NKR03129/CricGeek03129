/**
 * EQS / Voice DDL statements — the single source of truth for the schema.
 *
 * Deliberately dependency-free so `scripts/generate-eqs-migration.mjs` can emit
 * `prisma/eqs_migration.sql` from this exact array. Never hand-edit that .sql file;
 * change these statements and re-run the generator.
 *
 * Every statement is idempotent (`IF OBJECT_ID(...) IS NULL`, `IF COL_LENGTH(...) IS
 * NULL`), so applying it twice is safe.
 */

export const EQS_SCHEMA_VERSION = "eqs-schema-1.0.0";

export const EQS_DDL_STATEMENTS: string[] = [
  // ── EQS run: one row per scoring pass ──────────────────────────────
  `IF OBJECT_ID(N'dbo.EqsRun', N'U') IS NULL
   BEGIN
     CREATE TABLE dbo.EqsRun (
       id                   VARCHAR(30)   NOT NULL CONSTRAINT PK_EqsRun PRIMARY KEY,
       blogId               VARCHAR(30)   NULL,
       writerId             VARCHAR(30)   NULL,
       contentHash          VARCHAR(64)   NOT NULL,
       title                NVARCHAR(300) NULL,
       wordCount            INT           NOT NULL CONSTRAINT DF_EqsRun_wordCount DEFAULT 0,
       eqs                  FLOAT         NOT NULL CONSTRAINT DF_EqsRun_eqs DEFAULT 0,
       baseScore            FLOAT         NOT NULL CONSTRAINT DF_EqsRun_baseScore DEFAULT 0,
       confidence           FLOAT         NOT NULL CONSTRAINT DF_EqsRun_confidence DEFAULT 0,
       band                 VARCHAR(30)   NOT NULL CONSTRAINT DF_EqsRun_band DEFAULT '',
       requiresHumanReview  BIT           NOT NULL CONSTRAINT DF_EqsRun_review DEFAULT 0,
       humanReviewReasons   NVARCHAR(MAX) NULL,
       dnaSnapshot          NVARCHAR(MAX) NULL,
       dimensionsJson       NVARCHAR(MAX) NULL,
       flagsJson            NVARCHAR(MAX) NULL,
       guardrailsJson       NVARCHAR(MAX) NULL,
       explanationJson      NVARCHAR(MAX) NULL,
       timingsJson          NVARCHAR(MAX) NULL,
       modelVersionsJson    NVARCHAR(MAX) NULL,
       pipelineVersion      VARCHAR(60)   NOT NULL CONSTRAINT DF_EqsRun_pipelineVersion DEFAULT '',
       scoringConfigVersion VARCHAR(60)   NOT NULL CONSTRAINT DF_EqsRun_configVersion DEFAULT '',
       status               VARCHAR(20)   NOT NULL CONSTRAINT DF_EqsRun_status DEFAULT 'completed',
       processingTimeMs     INT           NOT NULL CONSTRAINT DF_EqsRun_processingTimeMs DEFAULT 0,
       createdAt            DATETIME2     NOT NULL CONSTRAINT DF_EqsRun_createdAt DEFAULT SYSUTCDATETIME()
     );

     CREATE INDEX IX_EqsRun_blogId_createdAt ON dbo.EqsRun(blogId, createdAt DESC);
     CREATE INDEX IX_EqsRun_writerId_createdAt ON dbo.EqsRun(writerId, createdAt DESC);
     CREATE INDEX IX_EqsRun_contentHash ON dbo.EqsRun(contentHash);
     CREATE INDEX IX_EqsRun_review_createdAt ON dbo.EqsRun(requiresHumanReview, createdAt DESC);
   END`,

  // ── Normalised per-component results (spec section 9) ─────────────
  `IF OBJECT_ID(N'dbo.EqsComponentResult', N'U') IS NULL
   BEGIN
     CREATE TABLE dbo.EqsComponentResult (
       id           VARCHAR(30)    NOT NULL CONSTRAINT PK_EqsComponentResult PRIMARY KEY,
       runId        VARCHAR(30)    NOT NULL,
       component    VARCHAR(40)    NOT NULL,
       score        FLOAT          NULL,
       confidence   FLOAT          NOT NULL CONSTRAINT DF_EqsComponent_confidence DEFAULT 0,
       status       VARCHAR(20)    NOT NULL CONSTRAINT DF_EqsComponent_status DEFAULT 'ok',
       source       VARCHAR(120)   NOT NULL CONSTRAINT DF_EqsComponent_source DEFAULT '',
       version      VARCHAR(160)   NOT NULL CONSTRAINT DF_EqsComponent_version DEFAULT '',
       durationMs   INT            NOT NULL CONSTRAINT DF_EqsComponent_durationMs DEFAULT 0,
       evidenceJson NVARCHAR(MAX)  NULL,
       flagsJson    NVARCHAR(MAX)  NULL,
       errorText    NVARCHAR(1000) NULL,
       createdAt    DATETIME2      NOT NULL CONSTRAINT DF_EqsComponent_createdAt DEFAULT SYSUTCDATETIME(),
       CONSTRAINT FK_EqsComponentResult_run FOREIGN KEY (runId) REFERENCES dbo.EqsRun(id) ON DELETE CASCADE
     );

     CREATE INDEX IX_EqsComponentResult_runId ON dbo.EqsComponentResult(runId);
     CREATE INDEX IX_EqsComponentResult_component_status ON dbo.EqsComponentResult(component, status);
   END`,

  // ── Claim-level verification evidence (spec section 11 "Verification") ──
  `IF OBJECT_ID(N'dbo.EqsClaim', N'U') IS NULL
   BEGIN
     CREATE TABLE dbo.EqsClaim (
       id                  VARCHAR(30)   NOT NULL CONSTRAINT PK_EqsClaim PRIMARY KEY,
       runId               VARCHAR(30)   NOT NULL,
       claimKey            VARCHAR(40)   NOT NULL,
       claimText           NVARCHAR(400) NOT NULL,
       claimType           VARCHAR(30)   NOT NULL CONSTRAINT DF_EqsClaim_type DEFAULT 'general',
       playerName          NVARCHAR(150) NULL,
       metric              VARCHAR(40)   NULL,
       claimValue          FLOAT         NULL,
       timeframe           NVARCHAR(120) NULL,
       requiresVerification BIT          NOT NULL CONSTRAINT DF_EqsClaim_requires DEFAULT 1,
       status              VARCHAR(20)   NOT NULL CONSTRAINT DF_EqsClaim_status DEFAULT 'unverified',
       verificationSource  VARCHAR(60)   NULL,
       provider            VARCHAR(80)   NULL,
       evidenceJson        NVARCHAR(MAX) NULL,
       verifiedAt          DATETIME2     NULL,
       createdAt           DATETIME2     NOT NULL CONSTRAINT DF_EqsClaim_createdAt DEFAULT SYSUTCDATETIME(),
       CONSTRAINT FK_EqsClaim_run FOREIGN KEY (runId) REFERENCES dbo.EqsRun(id) ON DELETE CASCADE
     );

     CREATE INDEX IX_EqsClaim_runId ON dbo.EqsClaim(runId);
     CREATE INDEX IX_EqsClaim_status ON dbo.EqsClaim(status);
     CREATE INDEX IX_EqsClaim_player ON dbo.EqsClaim(playerName);
   END`,

  // ── Internal + external plagiarism results, kept as separate rows ──
  `IF OBJECT_ID(N'dbo.EqsPlagiarismResult', N'U') IS NULL
   BEGIN
     CREATE TABLE dbo.EqsPlagiarismResult (
       id             VARCHAR(30)   NOT NULL CONSTRAINT PK_EqsPlagiarismResult PRIMARY KEY,
       runId          VARCHAR(30)   NOT NULL,
       kind           VARCHAR(20)   NOT NULL,
       flagged        BIT           NOT NULL CONSTRAINT DF_EqsPlag_flagged DEFAULT 0,
       maxSimilarity  FLOAT         NULL,
       matchedPercent FLOAT         NULL,
       provider       VARCHAR(80)   NULL,
       matchedBlogId  VARCHAR(30)   NULL,
       matchedTitle   NVARCHAR(300) NULL,
       matchedExcerpt NVARCHAR(MAX) NULL,
       evidenceJson   NVARCHAR(MAX) NULL,
       createdAt      DATETIME2     NOT NULL CONSTRAINT DF_EqsPlag_createdAt DEFAULT SYSUTCDATETIME(),
       CONSTRAINT FK_EqsPlagiarismResult_run FOREIGN KEY (runId) REFERENCES dbo.EqsRun(id) ON DELETE CASCADE
     );

     CREATE INDEX IX_EqsPlagiarismResult_runId_kind ON dbo.EqsPlagiarismResult(runId, kind);
     CREATE INDEX IX_EqsPlagiarismResult_flagged ON dbo.EqsPlagiarismResult(flagged, createdAt DESC);
   END`,

  // ── Which model/provider/version produced each analysis ────────────
  `IF OBJECT_ID(N'dbo.EqsModelVersion', N'U') IS NULL
   BEGIN
     CREATE TABLE dbo.EqsModelVersion (
       id            VARCHAR(30)  NOT NULL CONSTRAINT PK_EqsModelVersion PRIMARY KEY,
       runId         VARCHAR(30)  NOT NULL,
       stage         VARCHAR(60)  NOT NULL,
       provider      VARCHAR(60)  NOT NULL,
       model         VARCHAR(160) NOT NULL,
       promptVersion VARCHAR(60)  NOT NULL CONSTRAINT DF_EqsModelVersion_prompt DEFAULT '',
       latencyMs     INT          NOT NULL CONSTRAINT DF_EqsModelVersion_latency DEFAULT 0,
       status        VARCHAR(20)  NOT NULL CONSTRAINT DF_EqsModelVersion_status DEFAULT 'ok',
       createdAt     DATETIME2    NOT NULL CONSTRAINT DF_EqsModelVersion_createdAt DEFAULT SYSUTCDATETIME(),
       CONSTRAINT FK_EqsModelVersion_run FOREIGN KEY (runId) REFERENCES dbo.EqsRun(id) ON DELETE CASCADE
     );

     CREATE INDEX IX_EqsModelVersion_runId ON dbo.EqsModelVersion(runId);
     CREATE INDEX IX_EqsModelVersion_provider_model ON dbo.EqsModelVersion(provider, model);
   END`,

  // ── Audit trail: processing events, failures, retries ──────────────
  `IF OBJECT_ID(N'dbo.EqsAuditEvent', N'U') IS NULL
   BEGIN
     CREATE TABLE dbo.EqsAuditEvent (
       id         VARCHAR(30)    NOT NULL CONSTRAINT PK_EqsAuditEvent PRIMARY KEY,
       runId      VARCHAR(30)    NULL,
       blogId     VARCHAR(30)    NULL,
       stage      VARCHAR(60)    NOT NULL,
       eventName  VARCHAR(60)    NOT NULL,
       status     VARCHAR(20)    NOT NULL CONSTRAINT DF_EqsAudit_status DEFAULT 'ok',
       message    NVARCHAR(1000) NULL,
       detailJson NVARCHAR(MAX)  NULL,
       durationMs INT            NULL,
       createdAt  DATETIME2      NOT NULL CONSTRAINT DF_EqsAudit_createdAt DEFAULT SYSUTCDATETIME()
     );

     CREATE INDEX IX_EqsAuditEvent_runId_createdAt ON dbo.EqsAuditEvent(runId, createdAt);
     CREATE INDEX IX_EqsAuditEvent_blogId_createdAt ON dbo.EqsAuditEvent(blogId, createdAt DESC);
     CREATE INDEX IX_EqsAuditEvent_stage_status ON dbo.EqsAuditEvent(stage, status);
   END`,

  // ── Writer DNA classification history / versioning ─────────────────
  `IF OBJECT_ID(N'dbo.WriterDNAHistory', N'U') IS NULL
   BEGIN
     CREATE TABLE dbo.WriterDNAHistory (
       id          VARCHAR(30)   NOT NULL CONSTRAINT PK_WriterDNAHistory PRIMARY KEY,
       userId      VARCHAR(30)   NOT NULL,
       analyst     FLOAT         NOT NULL CONSTRAINT DF_WriterDNAHistory_analyst DEFAULT 0,
       fan         FLOAT         NOT NULL CONSTRAINT DF_WriterDNAHistory_fan DEFAULT 0,
       storyteller FLOAT         NOT NULL CONSTRAINT DF_WriterDNAHistory_storyteller DEFAULT 0,
       debater     FLOAT         NOT NULL CONSTRAINT DF_WriterDNAHistory_debater DEFAULT 0,
       source      VARCHAR(40)   NOT NULL CONSTRAINT DF_WriterDNAHistory_source DEFAULT 'scoring',
       reason      NVARCHAR(300) NULL,
       blogId      VARCHAR(30)   NULL,
       eqsRunId    VARCHAR(30)   NULL,
       createdAt   DATETIME2     NOT NULL CONSTRAINT DF_WriterDNAHistory_createdAt DEFAULT SYSUTCDATETIME()
     );

     CREATE INDEX IX_WriterDNAHistory_userId_createdAt ON dbo.WriterDNAHistory(userId, createdAt DESC);
   END`,

  // ── Voice-to-Commentary jobs (spec sections 10 and 11) ────────────
  `IF OBJECT_ID(N'dbo.VoiceCommentaryJob', N'U') IS NULL
   BEGIN
     CREATE TABLE dbo.VoiceCommentaryJob (
       id                VARCHAR(30)    NOT NULL CONSTRAINT PK_VoiceCommentaryJob PRIMARY KEY,
       sessionId         VARCHAR(30)    NULL,
       entryId           VARCHAR(30)    NULL,
       moderatorId       VARCHAR(30)    NULL,
       sttProvider       VARCHAR(40)    NOT NULL CONSTRAINT DF_VoiceJob_sttProvider DEFAULT 'none',
       sttModel          VARCHAR(80)    NULL,
       transformProvider VARCHAR(40)    NULL,
       transformModel    VARCHAR(80)    NULL,
       transcriptRaw     NVARCHAR(MAX)  NULL,
       transcriptCleaned NVARCHAR(MAX)  NULL,
       commentaryText    NVARCHAR(MAX)  NULL,
       status            VARCHAR(20)    NOT NULL CONSTRAINT DF_VoiceJob_status DEFAULT 'completed',
       errorText         NVARCHAR(1000) NULL,
       sttMs             INT            NOT NULL CONSTRAINT DF_VoiceJob_sttMs DEFAULT 0,
       cleanupMs         INT            NOT NULL CONSTRAINT DF_VoiceJob_cleanupMs DEFAULT 0,
       transformMs       INT            NOT NULL CONSTRAINT DF_VoiceJob_transformMs DEFAULT 0,
       totalMs           INT            NOT NULL CONSTRAINT DF_VoiceJob_totalMs DEFAULT 0,
       targetMs          INT            NOT NULL CONSTRAINT DF_VoiceJob_targetMs DEFAULT 0,
       withinTarget      BIT            NOT NULL CONSTRAINT DF_VoiceJob_withinTarget DEFAULT 1,
       createdAt         DATETIME2      NOT NULL CONSTRAINT DF_VoiceJob_createdAt DEFAULT SYSUTCDATETIME()
     );

     CREATE INDEX IX_VoiceCommentaryJob_sessionId_createdAt ON dbo.VoiceCommentaryJob(sessionId, createdAt DESC);
     CREATE INDEX IX_VoiceCommentaryJob_status_createdAt ON dbo.VoiceCommentaryJob(status, createdAt DESC);
   END`,

  // ── EQS summary columns on BlogScore, so feed queries stay single-table ──
  `IF COL_LENGTH('dbo.BlogScore', 'eqs') IS NULL
     ALTER TABLE dbo.BlogScore ADD eqs FLOAT NOT NULL CONSTRAINT DF_BlogScore_eqs DEFAULT 0`,
  `IF COL_LENGTH('dbo.BlogScore', 'eqsConfidence') IS NULL
     ALTER TABLE dbo.BlogScore ADD eqsConfidence FLOAT NOT NULL CONSTRAINT DF_BlogScore_eqsConfidence DEFAULT 0`,
  `IF COL_LENGTH('dbo.BlogScore', 'eqsBand') IS NULL
     ALTER TABLE dbo.BlogScore ADD eqsBand VARCHAR(30) NULL`,
  `IF COL_LENGTH('dbo.BlogScore', 'eqsRunId') IS NULL
     ALTER TABLE dbo.BlogScore ADD eqsRunId VARCHAR(30) NULL`,
  `IF COL_LENGTH('dbo.BlogScore', 'eqsRequiresReview') IS NULL
     ALTER TABLE dbo.BlogScore ADD eqsRequiresReview BIT NOT NULL CONSTRAINT DF_BlogScore_eqsRequiresReview DEFAULT 0`,
  `IF COL_LENGTH('dbo.BlogScore', 'eqsVersion') IS NULL
     ALTER TABLE dbo.BlogScore ADD eqsVersion VARCHAR(60) NULL`,
  `IF COL_LENGTH('dbo.BlogScore', 'eqsFlagsJson') IS NULL
     ALTER TABLE dbo.BlogScore ADD eqsFlagsJson NVARCHAR(MAX) NULL`,
];
