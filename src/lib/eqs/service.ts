/**
 * Stage 11 — Output.
 *
 * The one entry point application code should use: runs the pipeline, persists the
 * run with its component results, claims, plagiarism findings, and model versions,
 * then flushes the audit trail against the stored run id.
 *
 * Persistence never blocks a score: if the database is unavailable the caller still
 * gets its EQS, with `persistence.persisted === false` so the failure is visible.
 */

import { EQS_FEATURES } from "@/lib/eqs/config";
import { runEqsPipelineDetailed } from "@/lib/eqs/pipeline";
import {
  persistEqsRun,
  recordWriterDnaHistory,
  updateBlogScoreEqsSummary,
} from "@/lib/eqs/persistence";
import type { EqsDnaProfile, EqsPipelineInput, EqsResult } from "@/lib/eqs/types";
import { errorMessage } from "@/lib/eqs/utils";

export interface ScoredExpression {
  result: EqsResult;
  persistence: {
    runId: string | null;
    persisted: boolean;
    blogScoreUpdated: boolean;
    error?: string;
  };
}

/** Turns the 0-1 DNA mix into the 0-100 percentages the DNA tables store. */
function toDnaPercentages(mix: Record<EqsDnaProfile, number>): Record<EqsDnaProfile, number> {
  return {
    analyst: Math.round(mix.analyst * 1000) / 10,
    fan: Math.round(mix.fan * 1000) / 10,
    storyteller: Math.round(mix.storyteller * 1000) / 10,
    debater: Math.round(mix.debater * 1000) / 10,
  };
}

export async function scoreExpression(
  input: EqsPipelineInput & { persist?: boolean },
): Promise<ScoredExpression> {
  const { result, audit } = await runEqsPipelineDetailed(input);

  const shouldPersist = (input.persist ?? true) && EQS_FEATURES.persistence;

  if (!shouldPersist) {
    await audit.flush(null).catch(() => undefined);
    return {
      result,
      persistence: { runId: null, persisted: false, blogScoreUpdated: false },
    };
  }

  try {
    const stored = await persistEqsRun({
      result,
      blogId: input.blogId,
      writerId: input.writerId,
    });

    await audit.flush(stored.persisted ? stored.runId : null).catch(() => undefined);

    let blogScoreUpdated = false;
    if (stored.persisted && input.blogId) {
      blogScoreUpdated = await updateBlogScoreEqsSummary({
        blogId: input.blogId,
        result,
        runId: stored.runId,
      });
    }

    // Record the DNA mix that actually drove the weighting, so a past score stays
    // explainable even after the writer's profile moves on.
    if (stored.persisted && input.writerId) {
      await recordWriterDnaHistory({
        userId: input.writerId,
        dna: toDnaPercentages(result.writerDna.mix),
        source: result.writerDna.source,
        reason: `EQS run scored ${result.eqs} (${result.band})`,
        blogId: input.blogId,
        eqsRunId: stored.runId,
      });
    }

    return {
      result,
      persistence: {
        runId: stored.persisted ? stored.runId : null,
        persisted: stored.persisted,
        blogScoreUpdated,
        error: stored.error,
      },
    };
  } catch (error) {
    const message = errorMessage(error);
    console.error("[eqs] Persistence step failed after a successful score", message);
    await audit.flush(null).catch(() => undefined);

    return {
      result,
      persistence: { runId: null, persisted: false, blogScoreUpdated: false, error: message },
    };
  }
}
