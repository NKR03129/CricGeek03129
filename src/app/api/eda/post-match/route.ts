import { NextResponse } from "next/server";
import { getMatchInfo, getMatchScorecard } from "@/lib/cricket-api";
import { buildPostMatchEdaReport } from "@/lib/eda/post-match";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const matchId = url.searchParams.get("matchId");

    if (!matchId) {
      return NextResponse.json({ error: "matchId is required" }, { status: 400 });
    }

    const [match, scorecards] = await Promise.all([
      getMatchInfo(matchId, { fresh: true }),
      getMatchScorecard(matchId, { fresh: true }),
    ]);

    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const report = await buildPostMatchEdaReport(match, scorecards);
    return NextResponse.json(report, {
      headers: {
        "Cache-Control": "s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error("[/api/eda/post-match]", error);
    const detail = error instanceof Error ? error.message : "Unable to build the post-match EDA report.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
