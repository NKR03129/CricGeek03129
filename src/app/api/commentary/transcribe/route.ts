/**
 * POST /api/commentary/transcribe — voice clip to publish-ready commentary.
 *
 * Thin adapter over `runVoiceToCommentary`, which owns stages 2-5 of the
 * Voice-to-Commentary spec. The response keeps the `text` / `rawText` / `provider`
 * fields existing callers read, and adds per-stage latencies so the ~15-30s
 * end-to-end target can be measured rather than assumed.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canCreateCommentarySession } from "@/lib/commentary-permissions";
import { errorMessage } from "@/lib/eqs/utils";
import { runVoiceToCommentary } from "@/lib/voice/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://127.0.0.1:8000";
const isLocalAiService =
  AI_SERVICE_URL.includes("127.0.0.1") || AI_SERVICE_URL.includes("localhost");

/** Largest clip accepted. Long clips blow the latency budget before STT even starts. */
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

async function transcribeWithLegacyService(audioFile: File): Promise<Record<string, unknown>> {
  const proxyForm = new FormData();
  proxyForm.append("audio", audioFile);

  const response = await fetch(`${AI_SERVICE_URL}/transcribe`, {
    method: "POST",
    body: proxyForm,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(errorBody || "Legacy transcription service failed");
  }

  return (await response.json()) as Record<string, unknown>;
}

export async function POST(request: Request) {
  const session = await auth();
  const user = session?.user as { id: string; role: string } | undefined;

  if (!canCreateCommentarySession(user)) {
    return NextResponse.json({ error: "Sign in to use voice-to-text" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    const sessionIdValue = formData.get("sessionId");
    const sessionId =
      typeof sessionIdValue === "string" && sessionIdValue.trim().length > 0
        ? sessionIdValue.trim()
        : null;

    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    if (audioFile.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        {
          error: `Audio clip is too large. Keep clips under ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))}MB.`,
          code: "AUDIO_TOO_LARGE",
        },
        { status: 413 },
      );
    }

    // Only offer the legacy service when it is actually reachable from here.
    const canUseLegacyService =
      Boolean(process.env.AI_SERVICE_URL) &&
      !(process.env.NODE_ENV === "production" && isLocalAiService);

    const result = await runVoiceToCommentary({
      audio: audioFile,
      sessionId,
      moderatorId: user?.id ?? null,
      transcribeWithLegacyService: canUseLegacyService ? transcribeWithLegacyService : null,
    });

    return NextResponse.json({
      ...result.providerPayload,
      provider: result.provider,
      rawText: result.rawText,
      text: result.text,
      confidence: result.confidence,
      // Latency budget reporting (spec section 10, stage 6).
      stages: result.stages,
      latencyMs: result.stages.totalMs,
      targetMs: result.targetMs,
      withinTarget: result.withinTarget,
      latencyWarning: result.latencyWarning,
      pipelineVersion: result.pipelineVersion,
      jobId: result.jobId,
    });
  } catch (error) {
    const code = (error as { code?: string }).code;

    if (code === "TRANSCRIPTION_SERVICE_UNAVAILABLE") {
      console.error("Transcription provider unavailable:", error);
      return NextResponse.json(
        { error: "No transcription provider is configured", code },
        { status: 503 },
      );
    }

    console.error("Transcription pipeline error:", error);
    return NextResponse.json(
      {
        error: "Failed to reach transcription service",
        code: "TRANSCRIPTION_SERVICE_UNAVAILABLE",
        detail: process.env.NODE_ENV === "production" ? undefined : errorMessage(error),
      },
      { status: 502 },
    );
  }
}
