import { NextRequest, NextResponse } from "next/server";
import { evaluateEqsWithLocalModel } from "@/lib/local-ai";
import { assessInternalOriginality } from "@/lib/internal-originality";

export const runtime = "nodejs";
export const maxDuration = 60;
const ORIGINALITY_CHECK_TIMEOUT_MS = 2500;
const EQS_REQUEST_TIMEOUT_MS = 90_000;
const EQS_MODEL_TIMEOUT_MS = 75_000;

type EqsTimings = {
  totalMs?: number;
  modelMs?: number;
  originalityMs?: number;
  originalityTimedOut?: boolean;
};

function now() {
  return Date.now();
}

function logStage(requestId: string, stage: string, details?: Record<string, unknown>) {
  const payload = details ? ` ${JSON.stringify(details)}` : "";
  console.log(`[eqs:${requestId}] ${stage}${payload}`);
}

function createLinkedController(parent?: AbortSignal) {
  const controller = new AbortController();

  if (parent) {
    if (parent.aborted) {
      controller.abort(parent.reason);
    } else {
      parent.addEventListener(
        "abort",
        () => {
          if (!controller.signal.aborted) {
            controller.abort(parent.reason);
          }
        },
        { once: true },
      );
    }
  }

  return controller;
}

function recalculateOverall(attributes: Array<{ score: number; weight?: number }>) {
  const totalWeight = attributes.reduce((sum, item) => sum + (item.weight || 0), 0) || 1;
  const weighted = attributes.reduce((sum, item) => sum + item.score * (item.weight || 0), 0);
  return Math.round(weighted / totalWeight);
}

export async function POST(req: NextRequest) {
  const requestId = Math.random().toString(36).slice(2, 10);
  const requestStart = now();
  const timings: EqsTimings = {};
  const requestController = createLinkedController();
  const requestTimeout = setTimeout(() => requestController.abort("EQS_ROUTE_TIMEOUT"), EQS_REQUEST_TIMEOUT_MS);

  try {
    logStage(requestId, "request_start", { at: new Date(requestStart).toISOString() });
    const { title, content } = await req.json();

    if (!content || typeof content !== "string") {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const modelStart = now();
    logStage(requestId, "model_start", { modelTimeoutMs: EQS_MODEL_TIMEOUT_MS });
    const result = await evaluateEqsWithLocalModel(
      { title, content },
      { signal: requestController.signal, timeoutMs: EQS_MODEL_TIMEOUT_MS },
    );
    timings.modelMs = now() - modelStart;
    logStage(requestId, "model_end", { durationMs: timings.modelMs });

    try {
      const originalityStart = now();
      logStage(requestId, "originality_start", { timeoutMs: ORIGINALITY_CHECK_TIMEOUT_MS });

      const originalityController = createLinkedController(requestController.signal);
      const originalityTimeout = setTimeout(() => originalityController.abort("ORIGINALITY_TIMEOUT"), ORIGINALITY_CHECK_TIMEOUT_MS);

      let match: Awaited<ReturnType<typeof assessInternalOriginality>> | null = null;
      try {
        match = await assessInternalOriginality({ content, signal: originalityController.signal });
      } catch (originalityError) {
        if (originalityController.signal.aborted || (originalityError instanceof DOMException && originalityError.name === "AbortError")) {
          match = null;
        } else {
          throw originalityError;
        }
      } finally {
        clearTimeout(originalityTimeout);
      }

      timings.originalityMs = now() - originalityStart;

      if (!match) {
        timings.originalityTimedOut = true;
        logStage(requestId, "originality_timeout", { durationMs: timings.originalityMs });
        timings.totalMs = now() - requestStart;
        logStage(requestId, "request_end", { durationMs: timings.totalMs, status: 200, partial: true });
        return NextResponse.json(result);
      }

      logStage(requestId, "originality_end", { durationMs: timings.originalityMs });

      const originality = result.attributes.find((attribute) => attribute.name === "Originality");
      if (originality) {
        const similarityPercent = Math.round(match.maxSimilarity * 100);

        if (match.flagged) {
          originality.score = Math.max(4, Math.min(originality.score, 110 - similarityPercent));
          originality.explanation = `Very close to an existing expression (${similarityPercent}% match). Add fresh language and new angles.`;
        } else if (match.maxSimilarity >= 0.72) {
          originality.score = Math.max(30, Math.min(originality.score, 95 - Math.round((match.maxSimilarity - 0.72) * 100)));
          originality.explanation = `Some overlap with existing expressions (${similarityPercent}% match), but still has distinct sections.`;
        }
      }

      result.overallEqs = recalculateOverall(result.attributes);
      result.weightedEqs = result.overallEqs;

      Object.assign(result, {
        originalityCheck: {
          source: "internal-expression-corpus",
          threshold: match.threshold,
          maxSimilarity: match.maxSimilarity,
          matchedExpressionId: match.matchedBlogId,
          matchedExpressionTitle: match.matchedTitle,
          flagged: match.flagged,
        },
      });
    } catch (originalityError) {
      console.error("Internal originality check failed", originalityError);
    }

    timings.totalMs = now() - requestStart;
    logStage(requestId, "request_end", { durationMs: timings.totalMs, status: 200 });
    const responsePayload = process.env.NODE_ENV === "production" ? result : { ...result, _timings: timings };
    return NextResponse.json(responsePayload);
  } catch (error) {
    const totalMs = now() - requestStart;
    if (requestController.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      logStage(requestId, "request_timeout", { durationMs: totalMs, reason: String(requestController.signal.reason || "ABORT") });
      return NextResponse.json(
        { error: "Scoring is taking unusually long. Please try again in a moment." },
        { status: 504 },
      );
    }

    console.error("EQS route failed", error);
    logStage(requestId, "request_error", { durationMs: totalMs });
    return NextResponse.json({ error: "Failed to score content" }, { status: 500 });
  } finally {
    clearTimeout(requestTimeout);
  }
}
