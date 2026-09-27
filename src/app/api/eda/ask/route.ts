import { NextResponse } from "next/server";
import { buildEdaAskResponse } from "@/lib/eda/ask";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      question?: string;
      matchId?: string | null;
      team?: string | null;
      tournament?: string | null;
    };

    if (!body.question?.trim()) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const response = await buildEdaAskResponse({
      question: body.question,
      matchId: body.matchId ?? null,
      team: body.team ?? null,
      tournament: body.tournament ?? null,
    });

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[/api/eda/ask]", error);
    const detail = error instanceof Error ? error.message : "Unable to answer this EDA question.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
