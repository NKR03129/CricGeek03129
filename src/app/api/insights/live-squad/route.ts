import { NextResponse } from "next/server";
import { getMatchDetailBundle } from "@/lib/cricket-api";
import {
  buildLiveRecommendationContext,
  buildLiveRecommendationEngineState,
} from "@/lib/insights/live-engine";
import type { LiveRecommendationEngineState } from "@/types/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface LiveSquadResponse {
  matchId: string;
  squad: string[];
  situation: {
    runs: number;
    wickets: number;
    overs: number;
    innings: number;
    completedOvers: number;
    battingTeam: string;
    bowlingTeam: string;
    lastWicketOver: number | null;
  } | null;
  engine: LiveRecommendationEngineState;
}

function emptyEngineState(): LiveRecommendationEngineState {
  return {
    batting: {
      ready: false,
      shouldRefresh: false,
      triggerKey: null,
      triggerReason: null,
      holdReason: "Batting recommendations unlock after the next wicket.",
      currentEvidence: 0,
      requiredEvidence: 1,
      evidenceUnit: "wickets",
      candidateCount: 0,
      squadConfirmed: false,
      warning: null,
    },
    bowling: {
      ready: false,
      shouldRefresh: false,
      triggerKey: null,
      triggerReason: null,
      holdReason: "Bowling recommendations unlock after 4 completed overs.",
      currentEvidence: 0,
      requiredEvidence: 4,
      evidenceUnit: "overs",
      candidateCount: 0,
      squadConfirmed: false,
      warning: null,
    },
    squadSource: "fallback",
    squadWarning: "Confirmed squads were unavailable.",
    battingSquadSize: 0,
    bowlingSquadSize: 0,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const matchId = url.searchParams.get("matchId");
  const lastBattingTriggerKey = url.searchParams.get("lastBattingTriggerKey");
  const lastBowlingTriggerKey = url.searchParams.get("lastBowlingTriggerKey");

  if (!matchId) {
    return NextResponse.json(
      { error: "matchId is required" },
      { status: 400 }
    );
  }

  const bundle = await getMatchDetailBundle(matchId, { fresh: true });
  if (!bundle.match) {
    return NextResponse.json<LiveSquadResponse>({
      matchId,
      squad: [],
      situation: null,
      engine: emptyEngineState(),
    });
  }

  const context = buildLiveRecommendationContext(
    bundle.match,
    bundle.scorecard,
    bundle.commentary?.bbb ?? [],
    bundle.squads
  );

  if (!context) {
    return NextResponse.json<LiveSquadResponse>({
      matchId,
      squad: [],
      situation: null,
      engine: emptyEngineState(),
    });
  }

  const engine = buildLiveRecommendationEngineState(context, {
    lastBattingTriggerKey,
    lastBowlingTriggerKey,
  });
  const battingSquad = context.battingSquad.players.map((player) => player.name);
  const bowlingSquad = context.bowlingSquad.players.map((player) => player.name);

  return NextResponse.json<LiveSquadResponse>({
    matchId,
    squad: [...new Set([...battingSquad, ...bowlingSquad])],
    situation: {
      runs: context.runs,
      wickets: context.wickets,
      overs: context.overs,
      innings: context.innings,
      completedOvers: context.completedOvers,
      battingTeam: context.battingTeam,
      bowlingTeam: context.bowlingTeam,
      lastWicketOver: context.latestWicketBall ? context.latestWicketBall.over : null,
    },
    engine,
  });
}
