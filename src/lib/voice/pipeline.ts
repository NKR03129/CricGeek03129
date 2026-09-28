/**
 * Voice-to-Commentary pipeline (spec section 10).
 *
 *   1. Microphone                -> browser (client-side capture)
 *   2. Streaming STT             -> Deepgram, or the legacy Whisper service
 *   3. Cleanup                   -> roster-driven player-name correction
 *   4. Commentary transformation -> low-latency model polish
 *   5. Output                    -> returned to the caller for the commentary API
 *   6. Target                    -> ~15-30s end to end, measured per stage
 *
 * Each stage is timed separately so a latency regression can be attributed to a
 * stage rather than guessed at, and every run is persisted with those timings.
 */

import "server-only";

import { correctPlayerNamesInCommentary } from "@/lib/commentary-player-correction";
import { polishCommentaryForSubmission } from "@/lib/commentary-polish";
import { getCommentarySessionMatchContext } from "@/lib/commentary-match-context";
import { hasDeepgramConfigured, transcribeWithDeepgram } from "@/lib/deepgram";
import { errorMessage } from "@/lib/eqs/utils";
import { VOICE_LATENCY, VOICE_PIPELINE_VERSION } from "@/lib/voice/config";
import { persistVoiceJob } from "@/lib/voice/persistence";

export type VoiceSttProvider = "deepgram" | "legacy" | "none";

export interface VoiceStageTimings {
  sttMs: number;
  cleanupMs: number;
  transformMs: number;
  totalMs: number;
}

export interface VoiceCommentaryResult {
  /** Final, publish-ready commentary line. */
  text: string;
  /** Transcript after name correction but before model polish. */
  rawText: string;
  /** Untouched provider transcript. */
  transcript: string;
  provider: VoiceSttProvider;
  sttModel: string | null;
  confidence: number | null;
  requestId: string | null;
  stages: VoiceStageTimings;
  targetMs: number;
  withinTarget: boolean;
  /** True when the run crossed the warn budget but stayed inside the target. */
  latencyWarning: boolean;
  pipelineVersion: string;
  /** Raw provider payload fields, preserved for callers that already used them. */
  providerPayload: Record<string, unknown>;
  jobId: string | null;
}

export interface LegacyTranscriber {
  (audio: File): Promise<Record<string, unknown>>;
}

/**
 * Runs stages 2-5 for a single audio clip.
 *
 * `transcribeWithLegacyService` is injected so the route keeps ownership of how it
 * reaches the Python service, and this module stays testable without a network.
 */
export async function runVoiceToCommentary(input: {
  audio: File;
  sessionId?: string | null;
  moderatorId?: string | null;
  transcribeWithLegacyService?: LegacyTranscriber | null;
  /** Prefer the legacy service even when Deepgram is configured. */
  preferLegacy?: boolean;
}): Promise<VoiceCommentaryResult> {
  const startedAt = Date.now();
  const deepgramReady = hasDeepgramConfigured();
  const legacyReady = Boolean(input.transcribeWithLegacyService);

  if (!deepgramReady && !legacyReady) {
    throw Object.assign(new Error("No transcription provider is configured"), {
      code: "TRANSCRIPTION_SERVICE_UNAVAILABLE",
    });
  }

  // The roster lookup runs before the clock-sensitive stages so its cost is not
  // charged to STT, and because both cleanup and transformation need it.
  const matchContext = await getCommentarySessionMatchContext(input.sessionId ?? null);

  // ── Stage 2: speech to text ───────────────────────────────────────
  const sttStart = Date.now();
  let providerPayload: Record<string, unknown> = {};
  let provider: VoiceSttProvider = "none";
  let sttModel: string | null = null;
  let confidence: number | null = null;
  let requestId: string | null = null;
  let sttError: string | null = null;

  const useDeepgramFirst = deepgramReady && !input.preferLegacy;

  if (useDeepgramFirst) {
    try {
      const result = await transcribeWithDeepgram(input.audio, { keyterms: matchContext.keyterms });
      providerPayload = result as unknown as Record<string, unknown>;
      provider = "deepgram";
      sttModel = process.env.DEEPGRAM_MODEL || "nova-3";
      confidence = result.confidence;
      requestId = result.requestId;
    } catch (error) {
      sttError = errorMessage(error);
      if (!legacyReady) throw error;
      console.error("[voice] Deepgram failed, falling back to the legacy service:", sttError);
    }
  }

  if (provider === "none") {
    if (!input.transcribeWithLegacyService) {
      throw Object.assign(new Error(sttError || "No transcription provider is available"), {
        code: "TRANSCRIPTION_SERVICE_UNAVAILABLE",
      });
    }

    providerPayload = await input.transcribeWithLegacyService(input.audio);
    provider = "legacy";
    sttModel = typeof providerPayload.model === "string" ? providerPayload.model : "whisper";
    confidence = typeof providerPayload.confidence === "number" ? providerPayload.confidence : null;
  }

  const sttMs = Date.now() - sttStart;
  const transcript = typeof providerPayload.text === "string" ? providerPayload.text : "";

  // ── Stage 3: cleanup ──────────────────────────────────────────────
  // Fixes obvious ASR damage (player names) without changing intended meaning.
  const cleanupStart = Date.now();
  const cleanedText = correctPlayerNamesInCommentary(transcript, matchContext.playerNames);
  const cleanupMs = Date.now() - cleanupStart;

  // ── Stage 4: commentary transformation ────────────────────────────
  const transformStart = Date.now();
  const polished = await polishCommentaryForSubmission(transcript, {
    playerNames: matchContext.playerNames,
    players: matchContext.players,
    keyterms: matchContext.keyterms,
    preNormalizedText: cleanedText,
  });
  // Re-run the deterministic correction: the model is the last thing to touch the
  // text, so a name it reintroduced incorrectly would otherwise ship.
  const finalText = correctPlayerNamesInCommentary(polished, matchContext.playerNames);
  const transformMs = Date.now() - transformStart;

  const totalMs = Date.now() - startedAt;
  const stages: VoiceStageTimings = { sttMs, cleanupMs, transformMs, totalMs };
  const withinTarget = totalMs <= VOICE_LATENCY.targetMs;

  if (!withinTarget) {
    console.warn(
      `[voice] End-to-end latency ${totalMs}ms exceeded the ${VOICE_LATENCY.targetMs}ms target (stt ${sttMs}ms, transform ${transformMs}ms).`,
    );
  }

  const jobId = await persistVoiceJob({
    sessionId: input.sessionId ?? null,
    moderatorId: input.moderatorId ?? null,
    sttProvider: provider,
    sttModel,
    transformProvider: process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL ? "ollama" : "deterministic",
    transformModel: process.env.OLLAMA_MODEL || null,
    transcriptRaw: transcript,
    transcriptCleaned: cleanedText,
    commentaryText: finalText,
    status: finalText ? "completed" : "empty",
    errorText: sttError,
    stages,
    targetMs: VOICE_LATENCY.targetMs,
    withinTarget,
  });

  return {
    text: finalText,
    rawText: cleanedText,
    transcript,
    provider,
    sttModel,
    confidence,
    requestId,
    stages,
    targetMs: VOICE_LATENCY.targetMs,
    withinTarget,
    latencyWarning: totalMs > VOICE_LATENCY.warnMs && withinTarget,
    pipelineVersion: VOICE_PIPELINE_VERSION,
    providerPayload,
    jobId,
  };
}
