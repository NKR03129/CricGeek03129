import { inferPhase } from "@/lib/eda/common";
import type {
  BallByBall,
  BattingEntry,
  BowlingEntry,
  Match,
  Player,
  Scorecard,
  Squad,
} from "@/types/cricket";
import type {
  BattingRecommendation,
  BowlingRecommendation,
  InsightsAdvisorResponse,
  LiveRecommendationEngineState,
} from "@/types/insights";

const MAX_T20_BOWLER_OVERS = 4;
const ACTIVE_BATTER_DISMISSALS = new Set(["batting", "not out"]);
const UNAVAILABLE_DISMISSALS = new Set(["retired hurt", "retired out", "absent hurt"]);

type TeamSquadState = {
  players: Player[];
  confirmed: boolean;
};

type BattingCandidate = {
  name: string;
  squadPlayer: Player | null;
  battingOrderIndex: number | null;
  role: string | null;
  battingHand: "left" | "right" | "unknown";
  active: boolean;
  dismissed: boolean;
  unavailable: boolean;
};

type BowlingCandidate = {
  name: string;
  squadPlayer: Player | null;
  role: string | null;
  bowlingStyle: string | null;
  battingHand: "left" | "right" | "unknown";
  bowlingHand: "left" | "right" | "unknown";
  bowlingKind: "pace" | "spin" | "unknown";
  oversBowled: number;
  economy: number | null;
  oversRemaining: number;
  recentOversBowled: number;
  bowledLastCompletedOver: boolean;
  likelyBowler: boolean;
  unavailable: boolean;
};

type LiveRecommendationContext = {
  match: Match;
  innings: number;
  runs: number;
  overs: number;
  completedOvers: number;
  wickets: number;
  target: number | null;
  battingTeam: string;
  bowlingTeam: string;
  phase: string;
  currentRunRate: number;
  requiredRunRate: number | null;
  battingSquad: TeamSquadState;
  bowlingSquad: TeamSquadState;
  activeBatters: string[];
  activeBatterProfiles: BattingCandidate[];
  dismissedBatters: string[];
  unavailableBatters: string[];
  likelyCurrentBowler: Player | null;
  battingCandidates: BattingCandidate[];
  bowlingCandidates: BowlingCandidate[];
  latestWicketBall: BallByBall | null;
  latestWicketKey: string | null;
  latestWicketReason: string | null;
  bowlingTriggerKey: string | null;
  bowlingTriggerReason: string | null;
};

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lastToken(value: string) {
  const tokens = normalizeName(value).split(" ").filter(Boolean);
  return tokens[tokens.length - 1] ?? "";
}

function firstInitial(value: string) {
  return normalizeName(value).charAt(0);
}

function namesMatch(left: string, right: string) {
  const normalizedLeft = normalizeName(left);
  const normalizedRight = normalizeName(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return true;

  const leftSurname = lastToken(normalizedLeft);
  const rightSurname = lastToken(normalizedRight);
  if (leftSurname && leftSurname === rightSurname && firstInitial(normalizedLeft) === firstInitial(normalizedRight)) {
    return true;
  }

  return false;
}

function extractTeamNameFromInningLabel(value: string) {
  return value.replace(/\s+innings\s+\d+$/i, "").trim();
}

function getCurrentScore(match: Match) {
  const populatedScores = match.score.filter((score) => score.r > 0 || score.w > 0 || score.o > 0);
  return populatedScores[populatedScores.length - 1] ?? null;
}

function inferBattingTeam(match: Match, currentScoreLabel: string, scorecards: Scorecard[] | null) {
  const lowerLabel = currentScoreLabel.toLowerCase();

  for (const team of match.teamInfo) {
    if (lowerLabel.includes(team.name.toLowerCase()) || lowerLabel.includes(team.shortname.toLowerCase())) {
      return team.name;
    }
  }

  for (const team of match.teams) {
    if (lowerLabel.includes(team.toLowerCase())) {
      return team;
    }
  }

  const latestScorecard = scorecards?.[scorecards.length - 1];
  if (latestScorecard?.inning) {
    return extractTeamNameFromInningLabel(latestScorecard.inning);
  }

  return match.teams[0] ?? match.teamInfo[0]?.name ?? currentScoreLabel;
}

function resolveSquadForTeam(squads: Squad[] | null, teamName: string): TeamSquadState {
  const matchingSquad = (squads ?? []).find((squad) => {
    return namesMatch(squad.teamName, teamName) || namesMatch(squad.shortname, teamName);
  });

  return {
    players: matchingSquad?.players ?? [],
    confirmed: Boolean(matchingSquad && matchingSquad.players.length > 0),
  };
}

function findPlayerByName(players: Player[], candidateName: string) {
  return players.find((player) => namesMatch(player.name, candidateName)) ?? null;
}

function parseDismissal(value: string) {
  return value.toLowerCase().trim();
}

function isDismissed(entry: BattingEntry) {
  const dismissal = parseDismissal(entry.dismissal);
  return dismissal !== "" && !ACTIVE_BATTER_DISMISSALS.has(dismissal) && dismissal !== "did not bat" && !UNAVAILABLE_DISMISSALS.has(dismissal);
}

function isUnavailable(entry: BattingEntry) {
  const dismissal = parseDismissal(entry.dismissal);
  return UNAVAILABLE_DISMISSALS.has(dismissal);
}

function currentInningsScorecard(scorecards: Scorecard[] | null, battingTeam: string) {
  if (!scorecards || scorecards.length === 0) return null;

  return (
    [...scorecards]
      .reverse()
      .find((scorecard) => namesMatch(extractTeamNameFromInningLabel(scorecard.inning), battingTeam)) ??
    scorecards[scorecards.length - 1]
  );
}

function sortBallsAscending(balls: BallByBall[]) {
  return [...balls].sort((left, right) => {
    const leftTime = new Date(left.timestamp).getTime();
    const rightTime = new Date(right.timestamp).getTime();
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    if (left.over !== right.over) return left.over - right.over;
    if (left.ball !== right.ball) return left.ball - right.ball;
    return left.id.localeCompare(right.id);
  });
}

function groupCompletedOvers(balls: BallByBall[]) {
  const grouped = new Map<number, BallByBall[]>();

  for (const ball of sortBallsAscending(balls)) {
    if (!grouped.has(ball.over)) grouped.set(ball.over, []);
    grouped.get(ball.over)?.push(ball);
  }

  const completedOvers = [...grouped.entries()]
    .map(([over, overBalls]) => ({
      over,
      balls: overBalls,
      legalBalls: overBalls.filter((ball) => ball.legalBall !== false).length,
      leadBowler: overBalls[0]?.bowler ?? null,
      totalRuns: overBalls.reduce((sum, ball) => sum + ball.score, 0),
      wickets: overBalls.filter((ball) => ball.isWicket).length,
    }))
    .filter((entry) => entry.legalBalls >= 6)
    .sort((left, right) => left.over - right.over);

  return completedOvers;
}

function battingHand(style?: string | null): "left" | "right" | "unknown" {
  const value = (style ?? "").toLowerCase();
  if (value.includes("left")) return "left";
  if (value.includes("right")) return "right";
  return "unknown";
}

function bowlingHand(style?: string | null): "left" | "right" | "unknown" {
  const value = (style ?? "").toLowerCase();
  if (value.includes("left")) return "left";
  if (value.includes("right")) return "right";
  return "unknown";
}

function bowlingKind(style?: string | null): "pace" | "spin" | "unknown" {
  const value = (style ?? "").toLowerCase();
  if (!value) return "unknown";
  if (value.includes("medium") || value.includes("fast")) return "pace";
  if (
    value.includes("spin") ||
    value.includes("break") ||
    value.includes("orthodox") ||
    value.includes("chinaman")
  ) {
    return "spin";
  }
  return "unknown";
}

function roleValue(player: Player | null) {
  return player?.role?.toLowerCase() ?? "";
}

function likelyBowlerFromRole(player: Player | null) {
  const role = roleValue(player);
  if (!player) return false;
  if (role.includes("allround")) return true;
  if (role.includes("bowler")) return true;
  return Boolean(player.bowlingStyle);
}

function computeBattingMatchupBonus(
  batter: BattingCandidate,
  currentBowler: Player | null
) {
  if (!currentBowler) return 0;
  const batterHand = batter.battingHand;
  const bowlerStyle = (currentBowler.bowlingStyle ?? "").toLowerCase();
  const bowlerKindValue = bowlingKind(currentBowler.bowlingStyle);
  const bowlerHandValue = bowlingHand(currentBowler.bowlingStyle);

  if (batterHand === "unknown" || !bowlerStyle) return 0;

  if (bowlerKindValue === "pace") {
    if (bowlerHandValue === "left" && batterHand === "right") return -2;
    if (bowlerHandValue === "right" && batterHand === "left") return -1;
    return 0;
  }

  if (bowlerStyle.includes("off")) {
    return batterHand === "left" ? -3 : 1;
  }
  if (bowlerStyle.includes("orthodox")) {
    return batterHand === "right" ? -3 : 1;
  }
  if (bowlerStyle.includes("leg") || bowlerStyle.includes("chinaman")) {
    return batterHand === "right" ? -2 : -1;
  }

  return 0;
}

function computeBowlingMatchupBonus(
  bowler: BowlingCandidate,
  activeBatters: BattingCandidate[]
) {
  if (activeBatters.length === 0) return 0;

  const bonuses = activeBatters.map((batter) => {
    if (batter.battingHand === "unknown") return 0;
    if (bowler.bowlingKind === "pace") {
      if (bowler.bowlingHand === "left" && batter.battingHand === "right") return 2;
      if (bowler.bowlingHand === "right" && batter.battingHand === "left") return 1;
      return 0;
    }

    const style = (bowler.bowlingStyle ?? "").toLowerCase();
    if (style.includes("off")) return batter.battingHand === "left" ? 3 : 0;
    if (style.includes("orthodox")) return batter.battingHand === "right" ? 3 : 0;
    if (style.includes("leg") || style.includes("chinaman")) return batter.battingHand === "right" ? 2 : 1;
    return 0;
  });

  return bonuses.reduce<number>((sum, value) => sum + value, 0) / bonuses.length;
}

function clampScore(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildBattingCandidates(
  battingTeam: string,
  battingSquad: TeamSquadState,
  activeInning: Scorecard | null
) {
  const battingRows = activeInning?.batting ?? [];
  const activeBatters = battingRows.filter((entry) => ACTIVE_BATTER_DISMISSALS.has(parseDismissal(entry.dismissal)));
  const dismissedBatters = battingRows.filter(isDismissed);
  const unavailableBatters = battingRows.filter(isUnavailable);
  const seen = new Set<string>();
  const candidates: BattingCandidate[] = [];

  const appendCandidate = (name: string, squadPlayer: Player | null, orderIndex: number | null, battingEntry?: BattingEntry) => {
    const normalized = normalizeName(name);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push({
      name,
      squadPlayer,
      battingOrderIndex: orderIndex,
      role: squadPlayer?.role ?? null,
      battingHand: battingHand(squadPlayer?.battingStyle),
      active: Boolean(battingEntry && ACTIVE_BATTER_DISMISSALS.has(parseDismissal(battingEntry.dismissal))),
      dismissed: Boolean(battingEntry && isDismissed(battingEntry)),
      unavailable: Boolean(battingEntry && isUnavailable(battingEntry)),
    });
  };

  battingRows.forEach((entry, index) => {
    appendCandidate(
      entry.batsman.name,
      findPlayerByName(battingSquad.players, entry.batsman.name),
      index,
      entry
    );
  });

  if (battingSquad.confirmed) {
    battingSquad.players.forEach((player) => {
      const matchedIndex = battingRows.findIndex((entry) => namesMatch(entry.batsman.name, player.name));
      const matchedEntry = matchedIndex >= 0 ? battingRows[matchedIndex] : undefined;
      appendCandidate(player.name, player, matchedIndex >= 0 ? matchedIndex : null, matchedEntry);
    });
  }

  return {
    candidates: candidates.filter((candidate) => !candidate.active && !candidate.dismissed && !candidate.unavailable),
    activeBatters: activeBatters.map((entry) => entry.batsman.name),
    activeBatterProfiles: candidates.filter((candidate) => candidate.active),
    dismissedBatters: dismissedBatters.map((entry) => entry.batsman.name),
    unavailableBatters: unavailableBatters.map((entry) => entry.batsman.name),
    battingTeam,
  };
}

function buildBowlingCandidates(
  bowlingSquad: TeamSquadState,
  activeInning: Scorecard | null,
  completedOvers: ReturnType<typeof groupCompletedOvers>
) {
  const bowlingRows = activeInning?.bowling ?? [];
  const recentOvers = completedOvers.slice(-3);
  const lastCompletedOver = completedOvers[completedOvers.length - 1] ?? null;
  const seen = new Set<string>();
  const candidates: BowlingCandidate[] = [];

  const appendCandidate = (name: string, squadPlayer: Player | null, bowlingEntry?: BowlingEntry) => {
    const normalized = normalizeName(name);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);

    const oversBowled = Number(bowlingEntry?.o ?? 0);
    const recentOversBowled = recentOvers.filter((entry) => entry.leadBowler && namesMatch(entry.leadBowler, name)).length;
    const role = squadPlayer?.role ?? null;
    const style = squadPlayer?.bowlingStyle ?? null;
    const likelyBowler = Boolean(bowlingEntry) || likelyBowlerFromRole(squadPlayer);

    candidates.push({
      name,
      squadPlayer,
      role,
      bowlingStyle: style,
      battingHand: battingHand(squadPlayer?.battingStyle),
      bowlingHand: bowlingHand(style),
      bowlingKind: bowlingKind(style),
      oversBowled,
      economy: bowlingEntry ? Number(bowlingEntry.eco) : null,
      oversRemaining: Math.max(0, MAX_T20_BOWLER_OVERS - oversBowled),
      recentOversBowled,
      bowledLastCompletedOver: Boolean(lastCompletedOver?.leadBowler && namesMatch(lastCompletedOver.leadBowler, name)),
      likelyBowler,
      unavailable: false,
    });
  };

  bowlingRows.forEach((entry) => {
    appendCandidate(
      entry.bowler.name,
      findPlayerByName(bowlingSquad.players, entry.bowler.name),
      entry
    );
  });

  if (bowlingSquad.confirmed) {
    bowlingSquad.players.forEach((player) => {
      const matchedEntry = bowlingRows.find((entry) => namesMatch(entry.bowler.name, player.name));
      appendCandidate(player.name, player, matchedEntry);
    });
  }

  return candidates.filter((candidate) => {
    if (candidate.oversRemaining <= 0) return false;
    if (candidate.bowledLastCompletedOver) return false;
    if (!candidate.likelyBowler && bowlingSquad.confirmed) return false;
    return true;
  });
}

export function buildLiveRecommendationContext(
  match: Match,
  scorecards: Scorecard[] | null,
  commentary: BallByBall[],
  squads: Squad[] | null
): LiveRecommendationContext | null {
  const currentScore = getCurrentScore(match);
  if (!currentScore) return null;

  const innings = Math.max(1, match.score.filter((score) => score.r > 0 || score.w > 0 || score.o > 0).length);
  const battingTeam = inferBattingTeam(match, currentScore.inning, scorecards);
  const bowlingTeam = match.teams.find((team) => !namesMatch(team, battingTeam)) ?? match.teams[1] ?? "";
  const activeInning = currentInningsScorecard(scorecards, battingTeam);
  const battingSquad = resolveSquadForTeam(squads, battingTeam);
  const bowlingSquad = resolveSquadForTeam(squads, bowlingTeam);
  const completedOvers = groupCompletedOvers(commentary);
  const latestWicketBall = [...sortBallsAscending(commentary)].reverse().find((ball) => ball.isWicket) ?? null;
  const battingPool = buildBattingCandidates(battingTeam, battingSquad, activeInning);
  const bowlingPool = buildBowlingCandidates(bowlingSquad, activeInning, completedOvers);
  const currentBowlerName = commentary.length > 0 ? sortBallsAscending(commentary)[commentary.length - 1]?.bowler ?? null : null;
  const currentBowler = currentBowlerName ? findPlayerByName(bowlingSquad.players, currentBowlerName) : null;
  const latestCompletedOver = completedOvers[completedOvers.length - 1] ?? null;
  const wicketBallIsMidOver =
    latestWicketBall !== null &&
    (latestCompletedOver === null || latestWicketBall.over > latestCompletedOver.over);
  const latestWicketKey = latestWicketBall ? `innings:${innings}:wicket:${latestWicketBall.id}` : null;
  const latestWicketReason = latestWicketBall
    ? `wicket at ${latestWicketBall.over}.${latestWicketBall.ball}`
    : null;
  const bowlingTriggerKey =
    wicketsBallEligible(wicketBallIsMidOver, latestWicketKey, completedOvers.length, innings);
  const bowlingTriggerReason =
    wicketBallIsMidOver && latestWicketReason
      ? `refresh after ${latestWicketReason}`
      : completedOvers.length >= 4
        ? `refresh after ${completedOvers.length} completed overs`
        : null;

  return {
    match,
    innings,
    runs: currentScore.r,
    overs: currentScore.o,
    completedOvers: completedOvers.length,
    wickets: currentScore.w,
    target: innings === 2 && match.score[0] ? match.score[0].r + 1 : null,
    battingTeam,
    bowlingTeam,
    phase: inferPhase(currentScore.o, match.matchType),
    currentRunRate: currentScore.o > 0 ? currentScore.r / currentScore.o : 0,
    requiredRunRate:
      innings === 2 && match.score[0]
        ? Math.max((match.score[0].r + 1 - currentScore.r) / Math.max(20 - currentScore.o, 0.1), 0)
        : null,
    battingSquad,
    bowlingSquad,
    activeBatters: battingPool.activeBatters,
    activeBatterProfiles: battingPool.activeBatterProfiles,
    dismissedBatters: battingPool.dismissedBatters,
    unavailableBatters: battingPool.unavailableBatters,
    likelyCurrentBowler: currentBowler,
    battingCandidates: battingPool.candidates,
    bowlingCandidates: bowlingPool,
    latestWicketBall,
    latestWicketKey,
    latestWicketReason,
    bowlingTriggerKey,
    bowlingTriggerReason,
  };
}

function wicketsBallEligible(
  wicketBallIsMidOver: boolean,
  latestWicketKey: string | null,
  completedOvers: number,
  innings: number
) {
  if (wicketBallIsMidOver && latestWicketKey) return latestWicketKey;
  if (completedOvers >= 4) return `innings:${innings}:over:${completedOvers}`;
  return null;
}

function battingOrderFitScore(candidate: BattingCandidate, expectedEntryIndex: number) {
  if (candidate.battingOrderIndex === null) return 4;
  const distance = Math.abs(candidate.battingOrderIndex - expectedEntryIndex);
  return Math.max(0, 14 - distance * 4);
}

function battingRoleScore(candidate: BattingCandidate) {
  const role = (candidate.role ?? "").toLowerCase();
  if (role.includes("wicketkeeper") || role.includes("bat")) return 5;
  if (role.includes("allround")) return 3;
  if (role.includes("bowler")) return -8;
  return 0;
}

function phaseSpecialistScore(candidate: BowlingCandidate, phase: string) {
  if (phase === "Powerplay") {
    return candidate.bowlingKind === "pace" ? 5 : candidate.bowlingKind === "spin" ? -2 : 0;
  }
  if (phase === "Middle") {
    return candidate.bowlingKind === "spin" ? 5 : candidate.bowlingKind === "pace" ? 1 : 0;
  }
  if (phase === "Death") {
    return candidate.bowlingKind === "pace" ? 6 : candidate.bowlingKind === "spin" ? -4 : 0;
  }
  return 0;
}

function updateBattingRecommendation(
  recommendation: BattingRecommendation,
  candidate: BattingCandidate,
  context: LiveRecommendationContext
): BattingRecommendation {
  const expectedEntryIndex = Math.max(2, context.wickets + 1);
  const orderScore = battingOrderFitScore(candidate, expectedEntryIndex);
  const roleScore = battingRoleScore(candidate);
  const collapseMode = context.wickets >= 4 && context.overs < 14;
  const accelerationMode =
    context.phase === "Death" ||
    (context.requiredRunRate !== null && context.requiredRunRate - context.currentRunRate >= 1.25) ||
    (context.phase === "Middle" && context.wickets <= 4 && context.currentRunRate < 8);
  const situationScore =
    (accelerationMode ? (recommendation.situationStrikeRate - 115) / 6 : 0) +
    (collapseMode ? (1 - recommendation.dismissalProbability) * 10 + recommendation.consistency * 1.5 : 0);
  const matchupScore = computeBattingMatchupBonus(candidate, context.likelyCurrentBowler);
  const liveScore = recommendation.situationSuitability + orderScore + roleScore + situationScore + matchupScore;
  const roleText = candidate.role ? `${candidate.role.toLowerCase()} role` : "batting role";
  const additionalReasons = [
    `Confirmed in ${context.battingTeam}'s announced squad.`,
    candidate.battingOrderIndex !== null
      ? `Batting-order fit is strongest around slot ${candidate.battingOrderIndex + 1} for the current wicket state.`
      : `Squad fit is valid, but batting-order evidence is limited.`,
    accelerationMode
      ? `Current phase needs acceleration, so higher strike-rotation and finishing upside matter more.`
      : collapseMode
        ? `Current phase rewards stability after the wicket, so dismissal resistance matters more.`
        : `Current phase favors a balanced batter who can keep the innings moving.`,
    context.likelyCurrentBowler
      ? `${candidate.name} is being checked against the likely bowler matchup (${context.likelyCurrentBowler.name}).`
      : `Bowler matchup context is limited, so selection leans more on order fit and form.`,
    `${roleText} was used as a live-context tiebreaker.`,
  ];

  return {
    ...recommendation,
    reasons: [...additionalReasons, ...recommendation.reasons].slice(0, 5),
    support: recommendation.support
      ? {
          ...recommendation.support,
          warning:
            recommendation.support.warning ??
            (!context.battingSquad.confirmed
              ? `${context.battingTeam}'s confirmed 15 was unavailable, so only live scorecard exclusions could be enforced.`
              : null),
        }
      : undefined,
    modelScore: liveScore,
  };
}

function updateBowlingRecommendation(
  recommendation: BowlingRecommendation,
  candidate: BowlingCandidate,
  activeBatters: BattingCandidate[],
  context: LiveRecommendationContext
): BowlingRecommendation {
  const pressureGap =
    context.requiredRunRate !== null ? context.requiredRunRate - context.currentRunRate : 0;
  const controlMode = pressureGap <= 0.75 && context.wickets <= 5;
  const wicketMode = pressureGap > 0.75 || context.wickets >= 5 || context.phase === "Death";
  const quotaScore = candidate.oversRemaining * 4;
  const fatiguePenalty = candidate.recentOversBowled >= 2 ? 6 : candidate.recentOversBowled === 1 ? 2 : 0;
  const specialistScore = phaseSpecialistScore(candidate, context.phase);
  const matchupScore = computeBowlingMatchupBonus(candidate, activeBatters);
  const economyScore =
    candidate.economy === null
      ? 0
      : clampScore((context.currentRunRate - candidate.economy) * 3, -8, 8);
  const modeScore =
    (controlMode ? (8 - recommendation.expectedRunsConceded) : 0) +
    (wicketMode ? recommendation.expectedWickets * 6 : 0);
  const liveScore = recommendation.utilityScore * 18 + quotaScore + specialistScore + matchupScore + economyScore + modeScore - fatiguePenalty;
  const additionalReasons = [
    `Confirmed in ${context.bowlingTeam}'s announced squad.`,
    `${candidate.oversRemaining.toFixed(1)} overs of quota remain after ${candidate.oversBowled.toFixed(1)} already bowled.`,
    candidate.recentOversBowled >= 2
      ? `Recent workload is high, so fatigue was applied as a live penalty.`
      : `Recent workload is manageable, so quota and phase fit remain live positives.`,
    controlMode
      ? `The current state rewards control and run suppression more than pure strike rate.`
      : `The current state rewards wicket-taking upside and phase-specialist bowling.`,
    `Matchup scoring was blended against the current batters at the crease.`,
  ];

  return {
    ...recommendation,
    reasons: [...additionalReasons, ...recommendation.reasons].slice(0, 5),
    support: recommendation.support
      ? {
          ...recommendation.support,
          warning:
            recommendation.support.warning ??
            (!context.bowlingSquad.confirmed
              ? `${context.bowlingTeam}'s confirmed 15 was unavailable, so bowling eligibility falls back to scorecard usage only.`
              : null),
        }
      : undefined,
    utilityScore: Number(liveScore.toFixed(3)),
  };
}

function fallbackWarning(context: LiveRecommendationContext) {
  if (context.battingSquad.confirmed && context.bowlingSquad.confirmed) return null;
  if (!context.battingSquad.confirmed && !context.bowlingSquad.confirmed) {
    return "Confirmed squads were unavailable, so recommendation eligibility is being enforced from the live scorecard context only.";
  }
  if (!context.battingSquad.confirmed) {
    return `${context.battingTeam}'s confirmed squad was unavailable, so batting eligibility falls back to live scorecard state.`;
  }
  if (!context.bowlingSquad.confirmed) {
    return `${context.bowlingTeam}'s confirmed squad was unavailable, so bowling eligibility falls back to current bowling usage.`;
  }
  return null;
}

function buildEngineState(
  context: LiveRecommendationContext,
  triggerState?: {
    lastBattingTriggerKey?: string | null;
    lastBowlingTriggerKey?: string | null;
  }
): LiveRecommendationEngineState {
  const battingReady = Boolean(context.latestWicketKey) && context.battingCandidates.length > 0;
  const bowlingReady = context.completedOvers >= 4 && context.bowlingCandidates.length > 0;

  return {
    batting: {
      ready: battingReady,
      shouldRefresh:
        battingReady &&
        Boolean(triggerState) &&
        context.latestWicketKey !== null &&
        context.latestWicketKey !== (triggerState?.lastBattingTriggerKey ?? null),
      triggerKey: battingReady ? context.latestWicketKey : null,
      triggerReason: battingReady ? context.latestWicketReason : null,
      holdReason:
        battingReady
          ? null
          : context.wickets === 0
            ? "Batting recommendations unlock after the next wicket."
            : "No eligible incoming batters were found in the current squad context.",
      currentEvidence: context.wickets,
      requiredEvidence: 1,
      evidenceUnit: "wickets",
      candidateCount: context.battingCandidates.length,
      squadConfirmed: context.battingSquad.confirmed,
      warning: !context.battingSquad.confirmed
        ? `${context.battingTeam}'s confirmed 15 is missing, so only scorecard-based exclusions are enforced.`
        : null,
    },
    bowling: {
      ready: bowlingReady,
      shouldRefresh:
        bowlingReady &&
        Boolean(triggerState) &&
        context.bowlingTriggerKey !== null &&
        context.bowlingTriggerKey !== (triggerState?.lastBowlingTriggerKey ?? null),
      triggerKey: bowlingReady ? context.bowlingTriggerKey : null,
      triggerReason: bowlingReady ? context.bowlingTriggerReason : null,
      holdReason:
        bowlingReady
          ? null
          : context.completedOvers < 4
            ? "Bowling recommendations unlock after 4 completed overs."
            : "No eligible bowlers remain after quota and fatigue filters.",
      currentEvidence: context.completedOvers,
      requiredEvidence: 4,
      evidenceUnit: "overs",
      candidateCount: context.bowlingCandidates.length,
      squadConfirmed: context.bowlingSquad.confirmed,
      warning: !context.bowlingSquad.confirmed
        ? `${context.bowlingTeam}'s confirmed 15 is missing, so bowling eligibility falls back to current spell usage.`
        : null,
    },
    squadSource:
      context.battingSquad.confirmed && context.bowlingSquad.confirmed
        ? "confirmed"
        : "fallback",
    squadWarning: fallbackWarning(context),
    battingSquadSize: context.battingSquad.players.length,
    bowlingSquadSize: context.bowlingSquad.players.length,
  };
}

export function buildLiveRecommendationEngineState(
  context: LiveRecommendationContext,
  triggerState?: {
    lastBattingTriggerKey?: string | null;
    lastBowlingTriggerKey?: string | null;
  }
) {
  return buildEngineState(context, triggerState);
}

export function applyLiveRecommendationEngine(
  rawAdvisor: InsightsAdvisorResponse,
  context: LiveRecommendationContext,
  triggerState?: {
    lastBattingTriggerKey?: string | null;
    lastBowlingTriggerKey?: string | null;
  }
) {
  const engine = buildEngineState(context, triggerState);

  const battingCandidates = rawAdvisor.battingRecommendations
    .filter((recommendation) => namesMatch(recommendation.team, context.battingTeam) || recommendation.team === "")
    .filter((recommendation) => {
      const candidate = context.battingCandidates.find((item) => namesMatch(item.name, recommendation.player));
      return Boolean(candidate);
    })
    .map((recommendation) => {
      const candidate = context.battingCandidates.find((item) => namesMatch(item.name, recommendation.player));
      return candidate ? updateBattingRecommendation(recommendation, candidate, context) : recommendation;
    })
    .sort((left, right) => Number(right.modelScore ?? 0) - Number(left.modelScore ?? 0));

  const bowlingCandidates = rawAdvisor.bowlingRecommendations
    .filter((recommendation) => namesMatch(recommendation.team, context.bowlingTeam) || recommendation.team === "")
    .filter((recommendation) => {
      const candidate = context.bowlingCandidates.find((item) => namesMatch(item.name, recommendation.player));
      return Boolean(candidate);
    })
    .map((recommendation) => {
      const candidate = context.bowlingCandidates.find((item) => namesMatch(item.name, recommendation.player));
      return candidate ? updateBowlingRecommendation(recommendation, candidate, context.activeBatterProfiles, context) : recommendation;
    })
    .sort((left, right) => right.utilityScore - left.utilityScore);

  const warnings = [...rawAdvisor.warnings];
  if (engine.squadWarning) {
    warnings.unshift(engine.squadWarning);
  }
  if (!engine.batting.ready) {
    warnings.push(engine.batting.holdReason ?? "Batting recommendations are waiting on the next wicket.");
  }
  if (!engine.bowling.ready) {
    warnings.push(engine.bowling.holdReason ?? "Bowling recommendations are waiting on enough completed overs.");
  }

  return {
    advisor: {
      ...rawAdvisor,
      battingRecommendations: engine.batting.ready ? battingCandidates.slice(0, 5) : [],
      bowlingRecommendations: engine.bowling.ready ? bowlingCandidates.slice(0, 5) : [],
      warnings: [...new Set(warnings.filter(Boolean))],
    },
    engine,
  };
}
