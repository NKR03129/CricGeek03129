import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canCreateCommentarySession } from "@/lib/commentary-permissions";
import { polishCommentaryForSubmission } from "@/lib/commentary-polish";
import { hasDeepgramConfigured, transcribeWithDeepgram } from "@/lib/deepgram";
import { getCommentarySessionMatchContext } from "@/lib/commentary-match-context";
import { correctPlayerNamesInCommentary } from "@/lib/commentary-player-correction";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://127.0.0.1:8000";
const isLocalAiService =
  AI_SERVICE_URL.includes("127.0.0.1") || AI_SERVICE_URL.includes("localhost");

async function transcribeWithLegacyService(audioFile: File) {
  const proxyForm = new FormData();
  proxyForm.append("audio", audioFile);

  const response = await fetch(`${AI_SERVICE_URL}/transcribe`, {
    method: "POST",
    body: proxyForm,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(errorBody || "Legacy transcription service failed");
  }

  return response.json();
}

type TranscriptionPayload = Record<string, unknown> & {
  text?: string;
};

// POST /api/commentary/transcribe — proxy audio to Python Whisper service
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
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    const deepgramConfigured = hasDeepgramConfigured();
    const canUseLegacyService =
      Boolean(process.env.AI_SERVICE_URL) &&
      !(process.env.NODE_ENV === "production" && isLocalAiService);

    if (!deepgramConfigured && !canUseLegacyService) {
      return NextResponse.json(
        {
          error: "No transcription provider is configured",
          code: "TRANSCRIPTION_SERVICE_UNAVAILABLE",
        },
        { status: 503 }
      );
    }

    let result: TranscriptionPayload;
    let provider = "legacy";
    const matchContext = await getCommentarySessionMatchContext(sessionId);

    try {
      if (deepgramConfigured) {
        result = await transcribeWithDeepgram(audioFile, {
          keyterms: matchContext.keyterms,
        });
        provider = "deepgram";
      } else {
        result = await transcribeWithLegacyService(audioFile);
      }
    } catch (error) {
      if (!canUseLegacyService || !deepgramConfigured) {
        throw error;
      }

      console.error("Deepgram transcription error, falling back to legacy service:", error);
      result = await transcribeWithLegacyService(audioFile);
    }

    const rawText = typeof result.text === "string" ? result.text : "";
    const canonicalizedText = correctPlayerNamesInCommentary(rawText, matchContext.playerNames);
    const beautifiedText = await polishCommentaryForSubmission(rawText, {
      playerNames: matchContext.playerNames,
      players: matchContext.players,
      keyterms: matchContext.keyterms,
      preNormalizedText: canonicalizedText,
    });
    const finalText = correctPlayerNamesInCommentary(beautifiedText, matchContext.playerNames);

    return NextResponse.json({
      ...result,
      provider,
      rawText: canonicalizedText,
      text: finalText,
    });
  } catch (error) {
    console.error("Transcription proxy error:", error);
    return NextResponse.json(
      {
        error: "Failed to reach transcription service",
        code: "TRANSCRIPTION_SERVICE_UNAVAILABLE",
      },
      { status: 502 }
    );
  }
}
