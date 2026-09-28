/**
 * Voice-to-Commentary persistence (spec section 11 "Voice").
 *
 * Stores the transcript, the transformed commentary, and the per-stage latencies so
 * the latency target can be measured over time rather than asserted. Best-effort:
 * a storage failure never fails a commentary submission.
 */

import { prisma } from "@/lib/db";
import { ensureEqsTables } from "@/lib/eqs/db-schema";
import { createShortId, errorMessage, truncate } from "@/lib/eqs/utils";
import { VOICE_FEATURES } from "@/lib/voice/config";
import type { VoiceStageTimings } from "@/lib/voice/pipeline";

export async function persistVoiceJob(input: {
  sessionId?: string | null;
  entryId?: string | null;
  moderatorId?: string | null;
  sttProvider: string;
  sttModel?: string | null;
  transformProvider?: string | null;
  transformModel?: string | null;
  transcriptRaw?: string | null;
  transcriptCleaned?: string | null;
  commentaryText?: string | null;
  status: string;
  errorText?: string | null;
  stages: VoiceStageTimings;
  targetMs: number;
  withinTarget: boolean;
}): Promise<string | null> {
  if (!VOICE_FEATURES.persistence) return null;

  const id = createShortId("v");

  try {
    const ready = await ensureEqsTables();
    if (!ready) return null;

    await prisma.$executeRawUnsafe(
      `INSERT INTO dbo.VoiceCommentaryJob (
         id, sessionId, entryId, moderatorId, sttProvider, sttModel, transformProvider, transformModel,
         transcriptRaw, transcriptCleaned, commentaryText, status, errorText,
         sttMs, cleanupMs, transformMs, totalMs, targetMs, withinTarget
       ) VALUES (
         @P1, @P2, @P3, @P4, @P5, @P6, @P7, @P8,
         @P9, @P10, @P11, @P12, @P13,
         @P14, @P15, @P16, @P17, @P18, @P19
       )`,
      id,
      input.sessionId ?? null,
      input.entryId ?? null,
      input.moderatorId ?? null,
      truncate(input.sttProvider, 40),
      input.sttModel ? truncate(input.sttModel, 80) : null,
      input.transformProvider ? truncate(input.transformProvider, 40) : null,
      input.transformModel ? truncate(input.transformModel, 80) : null,
      input.transcriptRaw ?? null,
      input.transcriptCleaned ?? null,
      input.commentaryText ?? null,
      truncate(input.status, 20),
      input.errorText ? truncate(input.errorText, 1000) : null,
      Math.round(input.stages.sttMs),
      Math.round(input.stages.cleanupMs),
      Math.round(input.stages.transformMs),
      Math.round(input.stages.totalMs),
      Math.round(input.targetMs),
      input.withinTarget ? 1 : 0,
    );

    return id;
  } catch (error) {
    console.error("[voice] Failed to persist voice job", errorMessage(error));
    return null;
  }
}

/** Links a persisted voice job to the commentary entry it produced. */
export async function attachVoiceJobToEntry(jobId: string, entryId: string): Promise<void> {
  if (!VOICE_FEATURES.persistence) return;

  try {
    const ready = await ensureEqsTables();
    if (!ready) return;

    await prisma.$executeRawUnsafe(
      `UPDATE dbo.VoiceCommentaryJob SET entryId = @P1 WHERE id = @P2`,
      entryId,
      jobId,
    );
  } catch (error) {
    console.error("[voice] Failed to attach voice job to entry", errorMessage(error));
  }
}

export interface VoiceLatencyStats {
  samples: number;
  withinTarget: number;
  withinTargetRate: number;
  avgSttMs: number;
  avgCleanupMs: number;
  avgTransformMs: number;
  avgTotalMs: number;
  p95TotalMs: number;
  maxTotalMs: number;
}

type LatencyRow = {
  sttMs: number;
  cleanupMs: number;
  transformMs: number;
  totalMs: number;
  withinTarget: boolean;
};

/** Observed latency against the spec's end-to-end target. */
export async function getVoiceLatencyStats(limit = 200): Promise<VoiceLatencyStats | null> {
  try {
    const ready = await ensureEqsTables();
    if (!ready) return null;

    const capped = Math.max(1, Math.min(limit, 1000));
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT TOP (${capped}) sttMs, cleanupMs, transformMs, totalMs, withinTarget
       FROM dbo.VoiceCommentaryJob
       WHERE status = 'completed'
       ORDER BY createdAt DESC`,
    )) as LatencyRow[];

    if (rows.length === 0) {
      return {
        samples: 0,
        withinTarget: 0,
        withinTargetRate: 0,
        avgSttMs: 0,
        avgCleanupMs: 0,
        avgTransformMs: 0,
        avgTotalMs: 0,
        p95TotalMs: 0,
        maxTotalMs: 0,
      };
    }

    const average = (pick: (row: LatencyRow) => number) =>
      Math.round(rows.reduce((sum, row) => sum + pick(row), 0) / rows.length);

    const totals = rows.map((row) => row.totalMs).sort((left, right) => left - right);
    const p95Index = Math.min(totals.length - 1, Math.floor(totals.length * 0.95));
    const withinTarget = rows.filter((row) => row.withinTarget).length;

    return {
      samples: rows.length,
      withinTarget,
      withinTargetRate: Math.round((withinTarget / rows.length) * 1000) / 1000,
      avgSttMs: average((row) => row.sttMs),
      avgCleanupMs: average((row) => row.cleanupMs),
      avgTransformMs: average((row) => row.transformMs),
      avgTotalMs: average((row) => row.totalMs),
      p95TotalMs: totals[p95Index],
      maxTotalMs: totals[totals.length - 1],
    };
  } catch (error) {
    console.error("[voice] Failed to read voice latency stats", errorMessage(error));
    return null;
  }
}
