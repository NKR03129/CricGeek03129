import { NextResponse } from "next/server";
import { getMatchInfo } from "@/lib/cricket-api";
import { buildLiveEdaReport } from "@/lib/eda/live";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const matchId = url.searchParams.get("matchId");

    if (!matchId) {
      return NextResponse.json({ error: "matchId is required" }, { status: 400 });
    }

    const match = await getMatchInfo(matchId, { fresh: true });
    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    if (!match.matchStarted) {
      return NextResponse.json({ error: "This fixture is not live yet." }, { status: 400 });
    }

    const report = await buildLiveEdaReport(match);
    return NextResponse.json(report, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[/api/eda/live]", error);
    const detail = error instanceof Error ? error.message : "Unable to build the live EDA report.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
