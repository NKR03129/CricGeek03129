import { NextResponse } from "next/server";
import { forwardInsightsService } from "@/lib/ai-service";
import { getMatchDetailBundle } from "@/lib/cricket-api";
import {
  applyLiveRecommendationEngine,
  buildLiveRecommendationContext,
} from "@/lib/insights/live-engine";
import type { Match } from "@/types/cricket";
import type { InsightsAdvisorResponse, LiveAdvisorResponse } from "@/types/insights";

export const runtime = "nodejs";
export const maxDuration = 120;

function isT20Match(match: Match) {
  return /t20/i.test(match.matchType);
}

function inferMatchGender(match: Match) {
  const haystack = `${match.name} ${match.status} ${match.teams.join(" ")}`.toLowerCase();
  return haystack.includes("women") ? "female" : "male";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const matchId = url.searchParams.get("matchId");
    const strategy = url.searchParams.get("strategy") || "balanced";
    const topN = Number(url.searchParams.get("topN") || 5);

    if (!matchId) {
      return NextResponse.json({ error: "matchId is required" }, { status: 400 });
    }

    const bundle = await getMatchDetailBundle(matchId, { fresh: true });
    const match = bundle.match;

    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    if (!isT20Match(match)) {
      return NextResponse.json(
        { error: "AI decision support is currently available for T20 matches only." },
        { status: 400 }
      );
    }

    const context = buildLiveRecommendationContext(
      match,
      bundle.scorecard,
      bundle.commentary?.bbb ?? [],
      bundle.squads
    );

    if (!context) {
      return NextResponse.json(
        { error: "This match has not started scoring yet." },
        { status: 400 }
      );
    }

    const upstream = await forwardInsightsService(
      "/t20-insights/advisor",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runs: context.runs,
          wickets: context.wickets,
          overs: context.overs,
          innings: context.innings,
          target: context.target,
          batting_team: context.battingTeam,
          bowling_team: context.bowlingTeam,
          match_gender: inferMatchGender(match),
          strategy,
          top_n: Number.isFinite(topN) ? Math.max(12, topN * 3) : 15,
        }),
      },
      request
    );

    if (!upstream.ok) {
      return new NextResponse(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": upstream.contentType },
      });
    }

    const rawAdvisor = JSON.parse(upstream.body) as InsightsAdvisorResponse;
    const { advisor, engine } = applyLiveRecommendationEngine(rawAdvisor, context);

    const payload: LiveAdvisorResponse = {
      ...advisor,
      match: {
        id: match.id,
        name: match.name,
        status: match.status,
        venue: match.venue,
        matchType: match.matchType,
      },
      sourceContext: {
        runs: context.runs,
        wickets: context.wickets,
        overs: context.overs,
        innings: context.innings,
        target: context.target,
        battingTeam: context.battingTeam,
        bowlingTeam: context.bowlingTeam,
        matchGender: inferMatchGender(match),
      },
      engine,
      squadFiltered: engine.squadSource === "confirmed",
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Insights live proxy error:", error);
    const detail =
      error instanceof Error ? error.message : "Unable to derive live match context.";
    const isLocalInsightsConnectionIssue =
      process.env.NODE_ENV !== "production" && /fetch failed|ECONNREFUSED/i.test(detail);

    return NextResponse.json(
      {
        error: isLocalInsightsConnectionIssue
          ? "Unable to reach the T20 insights service. Start it with `npm run dev:insights`."
          : detail,
      },
      { status: 502 }
    );
  }
}
