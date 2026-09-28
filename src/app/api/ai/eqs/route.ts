/**
 * POST /api/ai/eqs — score a draft with the EQS pipeline.
 *
 * This is the in-editor / publish-flow endpoint. The response keeps the legacy
 * `overallEqs` / `weightedEqs` / `attributes` / `originalityCheck` shape that the
 * publish UI reads, and adds the full EQS breakdown alongside it.
 *
 * By default the run is not persisted: drafts are scored repeatedly while writing,
 * and only `/api/eqs/run` (called against a saved blog) is worth an audit row.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { EQS_PIPELINE_VERSION, EQS_SCORING_CONFIG_VERSION } from "@/lib/eqs/config";
import { scoreExpression } from "@/lib/eqs/service";
import type { EqsResult } from "@/lib/eqs/types";
import { errorMessage, isAbortError } from "@/lib/eqs/utils";

export const runtime = "nodejs";
export const maxDuration = 120;

const REQUEST_TIMEOUT_MS = 110_000;
const MIN_CONTENT_CHARS = 20;
const MAX_CONTENT_CHARS = 60_000;

function logStage(requestId: string, stage: string, details?: Record<string, unknown>) {
  const payload = details ? ` ${JSON.stringify(details)}` : "";
  console.log(`[eqs:${requestId}] ${stage}${payload}`);
}

/**
 * Projects the internal plagiarism component back onto the legacy
 * `originalityCheck` field that the publish flow already understands.
 */
function buildLegacyOriginalityCheck(result: EqsResult) {
  const internal = result.components.find((component) => component.component === "internal-plagiarism");
  if (!internal || internal.status === "skipped") return null;

  const evidence = internal.evidence as {
    maxVectorSimilarity?: number;
    vectorThreshold?: number;
    vectorFlagged?: boolean;
    exactMatchFlagged?: boolean;
    maxExactOverlapRatio?: number;
    matchedBlogId?: string | null;
    matchedTitle?: string | null;
  };

  return {
    source: "internal-expression-corpus",
    threshold: evidence.vectorThreshold ?? null,
    maxSimilarity: evidence.maxVectorSimilarity ?? 0,
    matchedExpressionId: evidence.matchedBlogId ?? null,
    matchedExpressionTitle: evidence.matchedTitle ?? null,
    flagged: Boolean(evidence.vectorFlagged || evidence.exactMatchFlagged),
    exactOverlapRatio: evidence.maxExactOverlapRatio ?? 0,
  };
}

export async function POST(req: NextRequest) {
  const requestId = Math.random().toString(36).slice(2, 10);
  const requestStart = Date.now();
  const controller = new AbortController();
  const requestTimeout = setTimeout(() => controller.abort("EQS_ROUTE_TIMEOUT"), REQUEST_TIMEOUT_MS);

  try {
    const body = (await req.json()) as {
      title?: unknown;
      content?: unknown;
      matchId?: unknown;
      blogId?: unknown;
      fastMode?: unknown;
      persist?: unknown;
    };

    if (typeof body.content !== "string" || body.content.trim().length < MIN_CONTENT_CHARS) {
      return NextResponse.json(
        { error: `Content is required and must be at least ${MIN_CONTENT_CHARS} characters` },
        { status: 400 },
      );
    }

    if (body.content.length > MAX_CONTENT_CHARS) {
      return NextResponse.json(
        { error: `Content exceeds the ${MAX_CONTENT_CHARS}-character scoring limit` },
        { status: 413 },
      );
    }

    // The signed-in writer's DNA drives the weighting, so an anonymous request
    // falls back to inferring the profile from the article itself.
    const session = await auth().catch(() => null);
    const writerId = (session?.user as { id?: string } | undefined)?.id ?? null;

    logStage(requestId, "pipeline_start", {
      hasWriter: Boolean(writerId),
      contentChars: body.content.length,
      fastMode: body.fastMode === true,
    });

    const { result, persistence } = await scoreExpression({
      title: typeof body.title === "string" ? body.title : undefined,
      content: body.content,
      matchId: typeof body.matchId === "string" && body.matchId.trim() ? body.matchId.trim() : null,
      blogId: typeof body.blogId === "string" && body.blogId.trim() ? body.blogId.trim() : null,
      writerId,
      fastMode: body.fastMode === true,
      // Drafts are re-scored constantly; only persist when explicitly asked.
      persist: body.persist === true,
      signal: controller.signal,
    });

    const totalMs = Date.now() - requestStart;
    logStage(requestId, "pipeline_end", {
      eqs: result.eqs,
      confidence: result.confidence,
      durationMs: totalMs,
      guardrails: result.guardrails.map((entry) => entry.code),
    });

    const payload = {
      // ── Legacy contract, unchanged ──
      overallEqs: result.overallEqs,
      weightedEqs: result.weightedEqs,
      attributes: result.attributes,
      originalityCheck: buildLegacyOriginalityCheck(result),

      // ── Full EQS breakdown ──
      eqs: result.eqs,
      band: result.band,
      confidence: result.confidence,
      baseScore: result.baseScore,
      dimensions: result.dimensions,
      components: result.components.map((component) => ({
        component: component.component,
        score: component.score,
        confidence: component.confidence,
        status: component.status,
        source: component.source,
        version: component.version,
        durationMs: component.durationMs,
        flags: component.flags,
      })),
      claims: result.claims,
      flags: result.flags,
      guardrails: result.guardrails,
      writerDna: result.writerDna,
      explanation: result.explanation,
      requiresHumanReview: result.requiresHumanReview,
      humanReviewReasons: result.humanReviewReasons,
      pipelineVersion: result.pipelineVersion,
      scoringConfigVersion: result.scoringConfigVersion,
      modelVersions: result.modelVersions,
      persistence,
    };

    return NextResponse.json(
      process.env.NODE_ENV === "production"
        ? payload
        : { ...payload, _timings: { ...result.timings, totalMs } },
    );
  } catch (error) {
    const totalMs = Date.now() - requestStart;

    if (controller.signal.aborted || isAbortError(error)) {
      logStage(requestId, "request_timeout", { durationMs: totalMs });
      return NextResponse.json(
        { error: "Scoring is taking unusually long. Please try again in a moment." },
        { status: 504 },
      );
    }

    console.error(`[eqs:${requestId}] route failed`, error);
    return NextResponse.json(
      {
        error: "Failed to score content",
        detail: process.env.NODE_ENV === "production" ? undefined : errorMessage(error),
        pipelineVersion: EQS_PIPELINE_VERSION,
        scoringConfigVersion: EQS_SCORING_CONFIG_VERSION,
      },
      { status: 500 },
    );
  } finally {
    clearTimeout(requestTimeout);
  }
}
