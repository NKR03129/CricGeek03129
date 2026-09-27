import { NextResponse } from "next/server";
import { getMatchInfo, getMatchSquad } from "@/lib/cricket-api";
import { buildPreMatchEdaReport } from "@/lib/eda/pre-match";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const matchId = url.searchParams.get("matchId");

    if (!matchId) {
      return NextResponse.json({ error: "matchId is required" }, { status: 400 });
    }

    const [match, squads] = await Promise.all([
      getMatchInfo(matchId, { fresh: true }),
      getMatchSquad(matchId, { fresh: true }),
    ]);

    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const report = await buildPreMatchEdaReport(match, squads);
    return NextResponse.json(report, {
      headers: {
        "Cache-Control": "s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error("[/api/eda/pre-match]", error);
    return NextResponse.json({ error: "Unable to build the pre-match EDA report." }, { status: 500 });
  }
}
