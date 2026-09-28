/**
 * POST /api/commentary/stt-token — mint a short-lived streaming STT credential.
 *
 * Implements stage 2 of the Voice-to-Commentary spec (low-latency streaming STT) on
 * the server side: the browser can stream microphone audio straight to the provider
 * instead of uploading whole clips, without the long-lived API key ever leaving the
 * server.
 *
 * The existing batch route stays in place, so this is additive.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canCreateCommentarySession } from "@/lib/commentary-permissions";
import { getCommentarySessionMatchContext } from "@/lib/commentary-match-context";
import { errorMessage } from "@/lib/eqs/utils";
import { VOICE_FEATURES } from "@/lib/voice/config";
import { createStreamingSttToken, hasStreamingSttConfigured } from "@/lib/voice/streaming";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  const user = session?.user as { id: string; role: string } | undefined;

  if (!canCreateCommentarySession(user)) {
    return NextResponse.json({ error: "Sign in to use live commentary" }, { status: 401 });
  }

  if (!VOICE_FEATURES.streaming) {
    return NextResponse.json(
      { error: "Streaming transcription is disabled", code: "STREAMING_STT_DISABLED" },
      { status: 503 },
    );
  }

  if (!hasStreamingSttConfigured()) {
    return NextResponse.json(
      {
        error: "No streaming transcription provider is configured",
        code: "STREAMING_STT_UNAVAILABLE",
      },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { sessionId?: unknown };
    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : null;

    // Seed the provider with this match's roster so streamed names come back clean.
    const matchContext = await getCommentarySessionMatchContext(sessionId);
    const token = await createStreamingSttToken({ keyterms: matchContext.keyterms });

    return NextResponse.json(token, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "STREAMING_STT_ERROR";
    console.error("[voice] Failed to mint a streaming STT token", error);

    return NextResponse.json(
      {
        error: "Could not start a streaming transcription session",
        code,
        detail: process.env.NODE_ENV === "production" ? undefined : errorMessage(error),
      },
      { status: code === "STREAMING_STT_UNAVAILABLE" ? 503 : 502 },
    );
  }
}
