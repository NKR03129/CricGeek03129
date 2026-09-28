/**
 * Persists an EQS run and everything needed to explain it later (spec section 11).
 *
 * All writes go through raw SQL against the tables in `db-schema.ts`, and every
 * function is best-effort: a persistence failure is logged and surfaced, but never
 * turned into a scoring failure.
 */

import { prisma } from "@/lib/db";
import { EQS_FEATURES } from "@/lib/eqs/config";
import { ensureEqsTables } from "@/lib/eqs/db-schema";
import type { EqsDnaProfile, EqsResult } from "@/lib/eqs/types";
import { createShortId, errorMessage, truncate } from "@/lib/eqs/utils";

function json(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export interface PersistedEqsRunRef {
  runId: string;
  persisted: boolean;
  error?: string;
}

export async function persistEqsRun(input: {
  result: EqsResult;
  blogId?: string | null;
  writerId?: string | null;
}): Promise<PersistedEqsRunRef> {
  const runId = createShortId("r");

  if (!EQS_FEATURES.persistence) {
    return { runId, persisted: false, error: "EQS persistence is disabled by configuration" };
  }

  try {
    const ready = await ensureEqsTables();
    if (!ready) {
      return { runId, persisted: false, error: "EQS tables are unavailable" };
    }

    const result = input.result;

    await prisma.$executeRawUnsafe(
      `INSERT INTO dbo.EqsRun (
         id, blogId, writerId, contentHash, title, wordCount, eqs, baseScore, confidence, band,
         requiresHumanReview, humanReviewReasons, dnaSnapshot, dimensionsJson, flagsJson,
         guardrailsJson, explanationJson, timingsJson, modelVersionsJson, pipelineVersion,
         scoringConfigVersion, status, processingTimeMs
       ) VALUES (
         @P1, @P2, @P3, @P4, @P5, @P6, @P7, @P8, @P9, @P10,
         @P11, @P12, @P13, @P14, @P15,
         @P16, @P17, @P18, @P19, @P20,
         @P21, @P22, @P23
       )`,
      runId,
      input.blogId ?? null,
      input.writerId ?? null,
      result.contentHash,
      null, // title is intentionally not stored here; the Blog row owns it.
      Math.round(
        (result.components.find((component) => component.component === "fast-checks")?.evidence as
          | { wordCount?: number }
          | undefined)?.wordCount ?? 0,
      ),
      result.eqs,
      result.baseScore,
      result.confidence,
      result.band,
      result.requiresHumanReview ? 1 : 0,
      json(result.humanReviewReasons),
      json(result.writerDna),
      json(result.dimensions),
      json(result.flags),
      json(result.guardrails),
      json(result.explanation),
      json(result.timings),
      json(result.modelVersions),
      result.pipelineVersion,
      result.scoringConfigVersion,
      "completed",
      Math.round(result.processingTimeMs),
    );

    for (const component of result.components) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO dbo.EqsComponentResult (
           id, runId, component, score, confidence, status, source, version, durationMs,
           evidenceJson, flagsJson, errorText
         ) VALUES (@P1, @P2, @P3, @P4, @P5, @P6, @P7, @P8, @P9, @P10, @P11, @P12)`,
        createShortId("c"),
        runId,
        component.component,
        component.score,
        component.confidence,
        component.status,
        truncate(component.source, 120),
        truncate(component.version, 160),
        Math.round(component.durationMs),
        json(component.evidence),
        json(component.flags),
        component.error ? truncate(component.error, 1000) : null,
      );
    }

    for (const claim of result.claims) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO dbo.EqsClaim (
           id, runId, claimKey, claimText, claimType, playerName, metric, claimValue, timeframe,
           requiresVerification, status, verificationSource, provider, evidenceJson, verifiedAt
         ) VALUES (@P1, @P2, @P3, @P4, @P5, @P6, @P7, @P8, @P9, @P10, @P11, @P12, @P13, @P14, @P15)`,
        createShortId("k"),
        runId,
        truncate(claim.id, 40),
        truncate(claim.text, 400),
        claim.type,
        claim.player ? truncate(claim.player, 150) : null,
        claim.metric,
        claim.value,
        claim.timeframe ? truncate(claim.timeframe, 120) : null,
        claim.requiresVerification ? 1 : 0,
        claim.status,
        claim.verificationSource,
        claim.provider ? truncate(claim.provider, 80) : null,
        json(claim.evidence),
        claim.verifiedAt ? new Date(claim.verifiedAt) : null,
      );
    }

    await persistPlagiarismRows(runId, result);

    for (const version of result.modelVersions) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO dbo.EqsModelVersion (id, runId, stage, provider, model, promptVersion, latencyMs, status)
         VALUES (@P1, @P2, @P3, @P4, @P5, @P6, @P7, @P8)`,
        createShortId("m"),
        runId,
        truncate(version.stage, 60),
        truncate(version.provider, 60),
        truncate(version.model, 160),
        truncate(version.promptVersion, 60),
        Math.round(version.latencyMs),
        version.status,
      );
    }

    return { runId, persisted: true };
  } catch (error) {
    const message = errorMessage(error);
    console.error("[eqs] Failed to persist EQS run", message);
    return { runId, persisted: false, error: message };
  }
}

async function persistPlagiarismRows(runId: string, result: EqsResult) {
  const internal = result.components.find((component) => component.component === "internal-plagiarism");
  const external = result.components.find((component) => component.component === "external-plagiarism");

  if (internal && internal.status !== "skipped") {
    const evidence = internal.evidence as {
      maxVectorSimilarity?: number;
      vectorFlagged?: boolean;
      exactMatchFlagged?: boolean;
      maxExactOverlapRatio?: number;
      matchedBlogId?: string | null;
      matchedTitle?: string | null;
      matchedPassage?: string | null;
    };

    await prisma.$executeRawUnsafe(
      `INSERT INTO dbo.EqsPlagiarismResult (
         id, runId, kind, flagged, maxSimilarity, matchedPercent, provider,
         matchedBlogId, matchedTitle, matchedExcerpt, evidenceJson
       ) VALUES (@P1, @P2, @P3, @P4, @P5, @P6, @P7, @P8, @P9, @P10, @P11)`,
      createShortId("p"),
      runId,
      "internal",
      evidence.vectorFlagged || evidence.exactMatchFlagged ? 1 : 0,
      evidence.maxVectorSimilarity ?? null,
      typeof evidence.maxExactOverlapRatio === "number" ? evidence.maxExactOverlapRatio * 100 : null,
      internal.source,
      evidence.matchedBlogId ?? null,
      evidence.matchedTitle ? truncate(evidence.matchedTitle, 300) : null,
      evidence.matchedPassage ?? null,
      json(evidence),
    );
  }

  if (external && external.status !== "skipped") {
    const evidence = external.evidence as {
      matchedPercent?: number | null;
      provider?: string | null;
      sources?: Array<{ url: string; title: string | null }>;
    };

    await prisma.$executeRawUnsafe(
      `INSERT INTO dbo.EqsPlagiarismResult (
         id, runId, kind, flagged, maxSimilarity, matchedPercent, provider,
         matchedBlogId, matchedTitle, matchedExcerpt, evidenceJson
       ) VALUES (@P1, @P2, @P3, @P4, @P5, @P6, @P7, @P8, @P9, @P10, @P11)`,
      createShortId("p"),
      runId,
      "external",
      external.flags.some((flag) => flag.code === "EXTERNAL_PLAGIARISM_MATCH") ? 1 : 0,
      null,
      evidence.matchedPercent ?? null,
      evidence.provider ?? external.source,
      null,
      evidence.sources?.[0]?.title ? truncate(evidence.sources[0].title as string, 300) : null,
      evidence.sources?.[0]?.url ?? null,
      json(evidence),
    );
  }
}

/**
 * Mirrors the headline EQS fields onto BlogScore so feed and profile queries do not
 * need to join EqsRun. Written with raw SQL because these columns are added by the
 * EQS bootstrap rather than by `prisma generate`.
 */
export async function updateBlogScoreEqsSummary(input: {
  blogId: string;
  result: EqsResult;
  runId: string;
}): Promise<boolean> {
  if (!EQS_FEATURES.persistence) return false;

  try {
    const ready = await ensureEqsTables();
    if (!ready) return false;

    const affected = await prisma.$executeRawUnsafe(
      `UPDATE dbo.BlogScore
       SET eqs = @P1,
           eqsConfidence = @P2,
           eqsBand = @P3,
           eqsRunId = @P4,
           eqsRequiresReview = @P5,
           eqsVersion = @P6,
           eqsFlagsJson = @P7,
           updatedAt = SYSUTCDATETIME()
       WHERE blogId = @P8`,
      input.result.eqs,
      input.result.confidence,
      input.result.band,
      input.runId,
      input.result.requiresHumanReview ? 1 : 0,
      `${input.result.pipelineVersion}/${input.result.scoringConfigVersion}`,
      json(input.result.flags),
      input.blogId,
    );

    return affected > 0;
  } catch (error) {
    console.error("[eqs] Failed to update BlogScore EQS summary", errorMessage(error));
    return false;
  }
}

/** Appends a Writer DNA classification snapshot for auditability. */
export async function recordWriterDnaHistory(input: {
  userId: string;
  dna: Record<EqsDnaProfile, number>;
  source: string;
  reason?: string | null;
  blogId?: string | null;
  eqsRunId?: string | null;
}): Promise<boolean> {
  if (!EQS_FEATURES.persistence) return false;

  try {
    const ready = await ensureEqsTables();
    if (!ready) return false;

    await prisma.$executeRawUnsafe(
      `INSERT INTO dbo.WriterDNAHistory (id, userId, analyst, fan, storyteller, debater, source, reason, blogId, eqsRunId)
       VALUES (@P1, @P2, @P3, @P4, @P5, @P6, @P7, @P8, @P9, @P10)`,
      createShortId("d"),
      input.userId,
      input.dna.analyst ?? 0,
      input.dna.fan ?? 0,
      input.dna.storyteller ?? 0,
      input.dna.debater ?? 0,
      truncate(input.source, 40),
      input.reason ? truncate(input.reason, 300) : null,
      input.blogId ?? null,
      input.eqsRunId ?? null,
    );

    return true;
  } catch (error) {
    console.error("[eqs] Failed to record Writer DNA history", errorMessage(error));
    return false;
  }
}

// ── Read paths for the API ───────────────────────────────────────────

type EqsRunRow = {
  id: string;
  blogId: string | null;
  writerId: string | null;
  contentHash: string;
  eqs: number;
  baseScore: number;
  confidence: number;
  band: string;
  requiresHumanReview: boolean;
  humanReviewReasons: string | null;
  dnaSnapshot: string | null;
  dimensionsJson: string | null;
  flagsJson: string | null;
  guardrailsJson: string | null;
  explanationJson: string | null;
  timingsJson: string | null;
  modelVersionsJson: string | null;
  pipelineVersion: string;
  scoringConfigVersion: string;
  processingTimeMs: number;
  createdAt: Date;
};

function parseJsonColumn<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Latest stored run for a blog, with its components, claims, and plagiarism rows. */
export async function getLatestEqsRunForBlog(blogId: string) {
  const ready = await ensureEqsTables();
  if (!ready) return null;

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT TOP (1) * FROM dbo.EqsRun WHERE blogId = @P1 ORDER BY createdAt DESC`,
    blogId,
  )) as EqsRunRow[];

  const run = rows[0];
  if (!run) return null;

  const [components, claims, plagiarism, modelVersions] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT component, score, confidence, status, source, version, durationMs, evidenceJson, flagsJson, errorText
       FROM dbo.EqsComponentResult WHERE runId = @P1`,
      run.id,
    ),
    prisma.$queryRawUnsafe(
      `SELECT claimKey, claimText, claimType, playerName, metric, claimValue, timeframe,
              requiresVerification, status, verificationSource, provider, evidenceJson, verifiedAt
       FROM dbo.EqsClaim WHERE runId = @P1`,
      run.id,
    ),
    prisma.$queryRawUnsafe(
      `SELECT kind, flagged, maxSimilarity, matchedPercent, provider, matchedBlogId, matchedTitle, matchedExcerpt
       FROM dbo.EqsPlagiarismResult WHERE runId = @P1`,
      run.id,
    ),
    prisma.$queryRawUnsafe(
      `SELECT stage, provider, model, promptVersion, latencyMs, status
       FROM dbo.EqsModelVersion WHERE runId = @P1`,
      run.id,
    ),
  ]);

  return {
    runId: run.id,
    blogId: run.blogId,
    writerId: run.writerId,
    eqs: run.eqs,
    baseScore: run.baseScore,
    confidence: run.confidence,
    band: run.band,
    requiresHumanReview: Boolean(run.requiresHumanReview),
    humanReviewReasons: parseJsonColumn<string[]>(run.humanReviewReasons, []),
    writerDna: parseJsonColumn<unknown>(run.dnaSnapshot, null),
    dimensions: parseJsonColumn<unknown[]>(run.dimensionsJson, []),
    flags: parseJsonColumn<unknown[]>(run.flagsJson, []),
    guardrails: parseJsonColumn<unknown[]>(run.guardrailsJson, []),
    explanation: parseJsonColumn<unknown>(run.explanationJson, null),
    timings: parseJsonColumn<unknown>(run.timingsJson, {}),
    pipelineVersion: run.pipelineVersion,
    scoringConfigVersion: run.scoringConfigVersion,
    processingTimeMs: run.processingTimeMs,
    createdAt: run.createdAt,
    components,
    claims,
    plagiarism,
    modelVersions: modelVersions ?? parseJsonColumn<unknown[]>(run.modelVersionsJson, []),
  };
}

/** Runs flagged for human review, for an editorial queue. */
export async function listRunsAwaitingReview(limit = 50) {
  const ready = await ensureEqsTables();
  if (!ready) return [];

  const capped = Math.max(1, Math.min(limit, 200));

  return (await prisma.$queryRawUnsafe(
    `SELECT TOP (${capped}) id, blogId, writerId, eqs, confidence, band, humanReviewReasons, flagsJson, createdAt
     FROM dbo.EqsRun
     WHERE requiresHumanReview = 1
     ORDER BY createdAt DESC`,
  )) as unknown[];
}
