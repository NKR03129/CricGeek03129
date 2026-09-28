import type { BallByBall, Match, Scorecard } from "@/types/cricket";
import type {
  HistoricalVenueSnapshot,
  LiveAnalyticsBundle,
  LiveBarDatum,
  LiveBoundaryPressureSummary,
  LiveHeatmapCell,
  LiveImpactDatum,
  LiveMatchupCell,
  LivePartnershipDatum,
  LivePressureSnapshot,
  LiveScenarioDatum,
  LiveTimelinePoint,
} from "@/types/eda";
import { clamp, getScheduledOvers, inferPhase, round } from "@/lib/eda/common";
import {
  computeBayesianWinProbability,
  entropyWeightedMomentum,
  wicketCascadeRisk,
  deathOverForecast,
  runProbabilityIndex,
  globalT20Prior,
} from "@/lib/eda/win-probability";
import { resourcePercentage } from "@/lib/eda/resource-curve";

type BallState = {
  ball: BallByBall;
  label: string;
  legalBalls: number;
  oversUsed: number;
  cumulativeRuns: number;
  cumulativeWickets: number;
  currentRunRate: number;
  requiredRate: number | null;
  pressure: number;
  winProbability: number;
  control: number;
  expectedRuns: number;
  projectedTotal: number;
  deltaWinProbability: number;
  impactScore: number;
};

function defaultParTotal(matchType: string) {
  const scheduledOvers = getScheduledOvers(matchType);
  if (scheduledOvers === 10) return 102;
  if (scheduledOvers === 20) return 168;
  if (scheduledOvers === 50) return 286;
  return 240;
}

function phaseBaseRunRate(matchType: string, phase: string) {
  const scheduledOvers = getScheduledOvers(matchType);

  if (scheduledOvers === 10) {
    if (phase === "Powerplay") return 9.8;
    if (phase === "Middle") return 8.9;
    return 11.2;
  }

  if (scheduledOvers === 20) {
    if (phase === "Powerplay") return 8.6;
    if (phase === "Middle") return 7.4;
    return 10.6;
  }

  if (scheduledOvers === 50) {
    if (phase === "Powerplay") return 5.6;
    if (phase === "Middle") return 5.1;
    return 7.1;
  }

  if (phase.includes("Opening")) return 3.2;
  if (phase.includes("Old-ball")) return 3.8;
  return 3.4;
}

function phaseBaseBoundaryRate(matchType: string, phase: string) {
  const scheduledOvers = getScheduledOvers(matchType);

  if (scheduledOvers === 10) {
    if (phase === "Powerplay") return 2.2;
    if (phase === "Middle") return 1.9;
    return 2.6;
  }

  if (scheduledOvers === 20) {
    if (phase === "Powerplay") return 1.9;
    if (phase === "Middle") return 1.45;
    return 2.2;
  }

  if (scheduledOvers === 50) {
    if (phase === "Powerplay") return 1.15;
    if (phase === "Middle") return 0.95;
    return 1.45;
  }

  if (phase.includes("Opening")) return 0.75;
  if (phase.includes("Old-ball")) return 1.05;
  return 0.9;
}

function statePressureIndex(input: {
  matchType: string;
  runs: number;
  wickets: number;
  oversUsed: number;
  target: number | null;
  currentRunRate: number;
  requiredRate: number | null;
  venuePar: number | null;
}) {
  const scheduledOvers = getScheduledOvers(input.matchType);

  if (input.target && input.requiredRate !== null) {
    const oversRemaining = scheduledOvers !== null ? Math.max(scheduledOvers - input.oversUsed, 0) : 0;
    return clamp(
      45 +
        (input.requiredRate - input.currentRunRate) * 8 +
        input.wickets * 2.6 +
        (oversRemaining <= 5 ? 6 : 0),
      0,
      100
    );
  }

  if (scheduledOvers !== null) {
    const parRate = (input.venuePar ?? defaultParTotal(input.matchType)) / scheduledOvers;
    return clamp(
      32 + Math.max(0, parRate - input.currentRunRate) * 7 + input.wickets * 3 + Math.max(0, input.oversUsed - scheduledOvers * 0.72) * 2,
      0,
      100
    );
  }

  return clamp(25 + input.wickets * 4 - input.currentRunRate * 1.5, 0, 100);
}

function projectTotalAtState(input: {
  matchType: string;
  runs: number;
  wickets: number;
  oversUsed: number;
  currentRunRate: number;
}) {
  const scheduledOvers = getScheduledOvers(input.matchType);
  if (scheduledOvers === null) return input.runs;

  const oversRemaining = Math.max(scheduledOvers - input.oversUsed, 0);
  const wicketsPenalty = scheduledOvers === 50 ? input.wickets * 0.06 : input.wickets * 0.12;
  const phaseRate = phaseBaseRunRate(input.matchType, inferPhase(input.oversUsed, input.matchType));
  const retainedRate = Math.max(phaseRate, input.currentRunRate * Math.max(0.55, 1 - wicketsPenalty));

  return clamp(
    round(input.runs + oversRemaining * retainedRate, 0),
    input.runs,
    scheduledOvers === 50 ? 450 : scheduledOvers === 20 ? 260 : 180
  );
}

/** Delegate to Bayesian engine for ball-level win probability */
function winProbabilityAtState(input: {
  matchType: string;
  runs: number;
  wickets: number;
  oversUsed: number;
  currentRunRate: number;
  requiredRate: number | null;
  target: number | null;
  projectedTotal: number;
  venuePar: number | null;
  venueChaseWinPct: number | null;
  pressure: number;
  recentRunRate?: number | null;
  phase: string;
}) {
  const scheduledOvers = getScheduledOvers(input.matchType) ?? 20;
  const prior = globalT20Prior(input.venueChaseWinPct);
  if (input.venuePar !== null) prior.avgTarget = input.venuePar;

  const result = computeBayesianWinProbability(
    {
      innings: input.target !== null ? 2 : 1,
      runs: input.runs,
      wickets: input.wickets,
      overs: input.oversUsed,
      scheduledOvers,
      target: input.target,
      currentRunRate: input.currentRunRate,
      requiredRunRate: input.requiredRate,
      recentRunRate: input.recentRunRate ?? null,
      matchType: input.matchType,
      phase: input.phase,
    },
    prior
  );
  return result.probability;
}

function sortBallsAscending(balls: BallByBall[]) {
  return [...balls].sort((left, right) => {
    const leftTime = new Date(left.timestamp).getTime();
    const rightTime = new Date(right.timestamp).getTime();

    if (leftTime !== rightTime && Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return leftTime - rightTime;
    }

    if (left.over !== right.over) return left.over - right.over;
    if (left.ball !== right.ball) return left.ball - right.ball;
    return left.id.localeCompare(right.id);
  });
}

function sliceTrailingInningsBalls(balls: BallByBall[]) {
  const ordered = sortBallsAscending(balls);
  if (ordered.length <= 1) return ordered;

  const trailing: BallByBall[] = [];
  let latestOver = Number.POSITIVE_INFINITY;

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const ball = ordered[index];
    if (trailing.length > 0 && ball.over > latestOver) {
      break;
    }

    trailing.push(ball);
    latestOver = ball.over;
  }

  return trailing.reverse();
}

function buildBallStates(
  match: Match,
  balls: BallByBall[],
  snapshot: LivePressureSnapshot,
  venue: HistoricalVenueSnapshot
) {
  const scheduledOvers = getScheduledOvers(match.matchType);
  const totalBalls = scheduledOvers !== null ? scheduledOvers * 6 : null;
  const orderedBalls = sortBallsAscending(balls);
  let cumulativeRuns = 0;
  let cumulativeWickets = 0;
  let legalBalls = 0;
  let previousWinProbability = 50;

  return orderedBalls.map((ball, index) => {
    cumulativeRuns += ball.score;
    cumulativeWickets += ball.isWicket ? 1 : 0;
    legalBalls += ball.legalBall === false ? 0 : 1;

    const oversUsed = legalBalls > 0 ? legalBalls / 6 : 0;
    const currentRunRate = oversUsed > 0 ? cumulativeRuns / oversUsed : 0;
    const requiredRate =
      snapshot.target && totalBalls !== null
        ? Math.max(snapshot.target - cumulativeRuns, 0) / Math.max((totalBalls - legalBalls) / 6, 0.1)
        : null;
    const phase = inferPhase(oversUsed, match.matchType);
    const expectedRuns = phaseBaseRunRate(match.matchType, phase) / 6;

    // Compute recent run rate from the trailing 12 balls up to this state.
    const recentBalls = orderedBalls.slice(Math.max(0, index - 11), index + 1);
    const recentLegal = recentBalls.filter((b) => b.legalBall !== false);
    const recentRunRate = recentLegal.length >= 3
      ? (recentBalls.reduce((s, b) => s + b.score, 0) / Math.max(recentLegal.length / 6, 0.1))
      : null;

    const projectedTotal = projectTotalAtState({
      matchType: match.matchType,
      runs: cumulativeRuns,
      wickets: cumulativeWickets,
      oversUsed,
      currentRunRate,
    });
    const pressure = statePressureIndex({
      matchType: match.matchType,
      runs: cumulativeRuns,
      wickets: cumulativeWickets,
      oversUsed,
      target: snapshot.target,
      currentRunRate,
      requiredRate,
      venuePar: venue.avgFirstInningsScore,
    });
    const winProbability = winProbabilityAtState({
      matchType: match.matchType,
      runs: cumulativeRuns,
      wickets: cumulativeWickets,
      oversUsed,
      currentRunRate,
      requiredRate,
      target: snapshot.target,
      projectedTotal,
      venuePar: venue.avgFirstInningsScore,
      venueChaseWinPct: venue.chaseWinPct,
      pressure,
      recentRunRate,
      phase,
    });
    const deltaWinProbability = round(winProbability - previousWinProbability, 1);
    previousWinProbability = winProbability;

    return {
      ball,
      label: `${ball.over}.${ball.ball}`,
      legalBalls,
      oversUsed,
      cumulativeRuns,
      cumulativeWickets,
      currentRunRate: round(currentRunRate, 2),
      requiredRate: requiredRate !== null ? round(requiredRate, 2) : null,
      pressure: round(pressure, 1),
      winProbability: round(winProbability, 1),
      control: round((winProbability - 50) * 2, 1),
      expectedRuns: round(expectedRuns, 2),
      projectedTotal,
      deltaWinProbability,
      impactScore: round(
        Math.abs(deltaWinProbability) +
          (ball.isWicket ? 8 : 0) +
          (ball.isBoundary ? 2.5 : 0) +
          (ball.score === 0 && pressure >= 60 ? 1.2 : 0),
        1
      ),
    } satisfies BallState;
  });
}

function toTimelinePoint(id: string, label: string, value: number, note: string, input?: { over?: number; ball?: number; secondaryValue?: number | null; isWicket?: boolean; }) {
  return {
    id,
    label,
    over: input?.over ?? 0,
    ball: input?.ball ?? 0,
    value: round(value, 1),
    secondaryValue: input?.secondaryValue ?? null,
    note,
    isWicket: input?.isWicket ?? false,
  } satisfies LiveTimelinePoint;
}

function buildRateTimeline(
  states: BallState[],
  match: Match,
  venue: HistoricalVenueSnapshot
) {
  const scheduledOvers = getScheduledOvers(match.matchType);
  const parRate =
    scheduledOvers !== null
      ? round((venue.avgFirstInningsScore ?? defaultParTotal(match.matchType)) / scheduledOvers, 2)
      : null;

  const overMap = new Map<number, BallState>();
  for (const state of states) {
    overMap.set(state.ball.over, state);
  }

  return [...overMap.values()].map((state) =>
    toTimelinePoint(
      `rate-${state.ball.over}`,
      `${state.ball.over}`,
      state.currentRunRate,
      `${state.ball.over} overs: actual rate ${state.currentRunRate}${state.requiredRate !== null ? ` vs required ${state.requiredRate}` : parRate !== null ? ` vs par ${parRate}` : ""}.`,
      {
        over: state.ball.over,
        ball: state.ball.ball,
        secondaryValue: state.requiredRate ?? parRate,
        isWicket: state.ball.isWicket,
      }
    )
  );
}

function buildTurningBallBars(states: BallState[]) {
  return [...states]
    .sort((left, right) => right.impactScore - left.impactScore)
    .slice(0, 6)
    .map((state) => ({
      label: state.label,
      value: state.impactScore,
      note: state.ball.commentary,
    } satisfies LiveBarDatum));
}

function buildTurningOverBars(states: BallState[]) {
  const overMap = new Map<number, { impact: number; runs: number; wickets: number }>();

  for (const state of states) {
    const current = overMap.get(state.ball.over) ?? { impact: 0, runs: 0, wickets: 0 };
    current.impact += state.impactScore;
    current.runs += state.ball.score;
    current.wickets += state.ball.isWicket ? 1 : 0;
    overMap.set(state.ball.over, current);
  }

  return [...overMap.entries()]
    .map(([over, value]) => ({
      label: `Over ${over}`,
      value: round(value.impact, 1),
      note: `${value.runs} runs and ${value.wickets} wicket${value.wickets === 1 ? "" : "s"} created the biggest state change in this over.`,
    }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 6);
}

function buildBatterImpact(states: BallState[]) {
  const players = new Map<string, { actual: number; expected: number; balls: number; boundaries: number; dots: number }>();

  for (const state of states) {
    const batter = state.ball.batsman;
    const current = players.get(batter) ?? { actual: 0, expected: 0, balls: 0, boundaries: 0, dots: 0 };
    current.actual += state.ball.batsmanRuns ?? state.ball.score;
    current.expected += state.expectedRuns * 0.86;
    current.balls += state.ball.legalBall === false ? 0 : 1;
    current.boundaries += state.ball.isBoundary ? 1 : 0;
    current.dots += state.ball.score === 0 ? 1 : 0;
    players.set(batter, current);
  }

  return [...players.entries()]
    .map(([label, value]) => ({
      label,
      actual: round(value.actual, 1),
      expected: round(value.expected, 1),
      delta: round(value.actual - value.expected + value.boundaries * 0.5 - value.dots * 0.18, 1),
      sample: value.balls,
      note: `${value.actual} runs from ${value.balls} tracked balls with ${value.boundaries} boundaries and ${value.dots} dots.`,
    } satisfies LiveImpactDatum))
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 8);
}

function buildBowlerImpact(states: BallState[]) {
  const bowlers = new Map<string, { actual: number; expected: number; balls: number; dots: number; wickets: number }>();

  for (const state of states) {
    const bowler = state.ball.bowler;
    const current = bowlers.get(bowler) ?? { actual: 0, expected: 0, balls: 0, dots: 0, wickets: 0 };
    current.actual += state.ball.score;
    current.expected += state.expectedRuns;
    current.balls += state.ball.legalBall === false ? 0 : 1;
    current.dots += state.ball.score === 0 ? 1 : 0;
    current.wickets += state.ball.isWicket ? 1 : 0;
    bowlers.set(bowler, current);
  }

  const impacts = [...bowlers.entries()].map(([label, value]) => {
    const runsSaved = value.expected - value.actual;

    return {
      label,
      actual: round(value.actual, 1),
      expected: round(value.expected, 1),
      delta: round(runsSaved + value.wickets * 7 + value.dots * 0.25, 1),
      sample: value.balls,
      note: `${round(runsSaved, 1)} runs saved versus expected with ${value.wickets} wicket${value.wickets === 1 ? "" : "s"} in ${value.balls} tracked balls.`,
    } satisfies LiveImpactDatum;
  });

  return impacts.sort((left, right) => right.delta - left.delta).slice(0, 8);
}

function buildBowlerRunsSaved(states: BallState[]) {
  const bowlers = new Map<string, { actual: number; expected: number; balls: number }>();

  for (const state of states) {
    const bowler = state.ball.bowler;
    const current = bowlers.get(bowler) ?? { actual: 0, expected: 0, balls: 0 };
    current.actual += state.ball.score;
    current.expected += state.expectedRuns;
    current.balls += state.ball.legalBall === false ? 0 : 1;
    bowlers.set(bowler, current);
  }

  return [...bowlers.entries()]
    .map(([label, value]) => ({
      label,
      actual: round(value.actual, 1),
      expected: round(value.expected, 1),
      delta: round(value.expected - value.actual, 1),
      sample: value.balls,
      note: `${round(value.expected - value.actual, 1)} runs saved across ${value.balls} tracked balls.`,
    } satisfies LiveImpactDatum))
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 8);
}

function buildPartnershipInfluence(states: BallState[], currentInning: Scorecard | null) {
  const battingOrder = currentInning?.batting.map((entry) => entry.batsman.name).filter(Boolean) ?? [];
  if (battingOrder.length < 2) return [] satisfies LivePartnershipDatum[];

  const partnerships: LivePartnershipDatum[] = [];
  let nextBatterIndex = 2;
  let activeBatters = battingOrder.slice(0, 2);
  let current: LivePartnershipDatum | null = null;

  function openPartnership(pair: string[]) {
    const normalizedPair = [...new Set(pair.filter(Boolean))];
    if (normalizedPair.length < 2) return null;

    const partnership = {
      label: `P${partnerships.length + 1}`,
      pair: `${normalizedPair[0]} & ${normalizedPair[1]}`,
      runs: 0,
      balls: 0,
      influence: 0,
      note: "Live partnership state inferred from batting order and tracked balls.",
    } satisfies LivePartnershipDatum;

    partnerships.push(partnership);
    return partnership;
  }

  current = openPartnership(activeBatters);

  for (const state of states) {
    if (!activeBatters.includes(state.ball.batsman)) {
      const survivingBatter = activeBatters.find((name) => name !== state.ball.batsman) ?? activeBatters[0];
      activeBatters = [survivingBatter, state.ball.batsman].filter(Boolean);
      current = openPartnership(activeBatters);
    }

    if (!current) {
      current = openPartnership(activeBatters);
      if (!current) continue;
    }

    current.runs += state.ball.score;
    current.balls += state.ball.legalBall === false ? 0 : 1;
    current.influence += state.deltaWinProbability;
    current.note = `${current.runs} runs from ${current.balls} tracked balls. Influence ${round(current.influence, 1)} win-probability points.`;

    if (state.ball.isWicket) {
      const dismissedBatter = state.ball.dismissedBatter || state.ball.batsman;
      activeBatters = activeBatters.filter((name) => name !== dismissedBatter);
      while (nextBatterIndex < battingOrder.length && activeBatters.includes(battingOrder[nextBatterIndex])) {
        nextBatterIndex += 1;
      }
      const incomingBatter = battingOrder[nextBatterIndex];
      if (incomingBatter) {
        activeBatters = [...activeBatters, incomingBatter];
        nextBatterIndex += 1;
      }
      current = null;
    }
  }

  return partnerships
    .filter((entry) => entry.balls > 0)
    .map((entry) => ({
      ...entry,
      influence: round(entry.influence, 1),
    }))
    .sort((left, right) => Math.abs(right.influence) - Math.abs(left.influence))
    .slice(0, 8);
}

function buildCounterfactuals(states: BallState[], snapshot: LivePressureSnapshot, match: Match, venue: HistoricalVenueSnapshot) {
  if (states.length === 0) return [] satisfies LiveScenarioDatum[];

  const lastState = states[states.length - 1];
  const scheduledOvers = getScheduledOvers(match.matchType);
  const lastTwelveBalls = states.slice(-12);
  const recentRunRate =
    lastTwelveBalls.filter((state) => state.ball.legalBall !== false).length > 0
      ? (lastTwelveBalls.reduce((sum, state) => sum + state.ball.score, 0) /
          Math.max(lastTwelveBalls.filter((state) => state.ball.legalBall !== false).length / 6, 0.1))
      : lastState.currentRunRate;
  const oversRemaining = scheduledOvers !== null ? Math.max(scheduledOvers - snapshot.overs, 0) : 0;
  const venuePar = venue.avgFirstInningsScore ?? defaultParTotal(match.matchType);

  const currentTrend = {
    label: "Current trend",
    projectedTotal: snapshot.projectedTotal,
    winProbability: lastState.winProbability,
    note: "Maintains the present scoring tempo and wicket profile.",
  } satisfies LiveScenarioDatum;

  const surge = {
    label: "Attack surge",
    projectedTotal: round(snapshot.runs + oversRemaining * Math.max(recentRunRate, lastState.currentRunRate) * 1.12, 0),
    winProbability: clamp(round(lastState.winProbability + 9, 1), 1, 99),
    note: "Assumes the next phase scores about 12% faster than the current trend.",
  } satisfies LiveScenarioDatum;

  const squeeze = {
    label: "Bowling squeeze",
    projectedTotal: round(Math.max(snapshot.runs, snapshot.projectedTotal - oversRemaining * 0.9), 0),
    winProbability: clamp(round(lastState.winProbability - 12, 1), 1, 99),
    note: "Assumes one extra wicket and a visible slowdown through the next phase.",
  } satisfies LiveScenarioDatum;

  const venueFinish = {
    label: "Venue-par finish",
    projectedTotal: round(venuePar, 0),
    winProbability: clamp(
      round(lastState.winProbability + (venuePar - snapshot.projectedTotal) * (snapshot.target ? -0.08 : 0.08), 1),
      1,
      99
    ),
    note: "Benchmarks the innings against the local warehouse venue expectation.",
  } satisfies LiveScenarioDatum;

  return [currentTrend, surge, squeeze, venueFinish];
}

function buildHeatmap(states: BallState[], match: Match) {
  const scheduledOvers = getScheduledOvers(match.matchType);
  const recentWindowSize = scheduledOvers !== null && scheduledOvers <= 20 ? scheduledOvers * 6 : 72;

  return states
    .slice(-recentWindowSize)
    .map((state) => ({
      over: state.ball.over,
      ball: state.ball.ball,
      runs: state.ball.score,
      pressure: state.pressure,
      label: state.label,
      isDot: state.ball.score === 0,
      isWicket: Boolean(state.ball.isWicket),
    } satisfies LiveHeatmapCell));
}

function buildMatchupMatrix(states: BallState[]) {
  const matchupMap = new Map<string, LiveMatchupCell>();
  const batterWeight = new Map<string, number>();
  const bowlerWeight = new Map<string, number>();

  for (const state of states) {
    const key = `${state.ball.batsman}::${state.ball.bowler}`;
    const current = matchupMap.get(key) ?? {
      batter: state.ball.batsman,
      bowler: state.ball.bowler,
      runs: 0,
      balls: 0,
      dismissals: 0,
      dotPct: 0,
      strikeRate: 0,
      threat: 0,
    };

    current.runs += state.ball.batsmanRuns ?? state.ball.score;
    current.balls += state.ball.legalBall === false ? 0 : 1;
    current.dismissals += state.ball.isWicket ? 1 : 0;
    current.dotPct += state.ball.score === 0 ? 1 : 0;
    current.threat += (state.ball.score === 0 ? 1 : 0) + (state.ball.isWicket ? 8 : 0) - (state.ball.isBoundary ? 2 : 0);
    matchupMap.set(key, current);

    batterWeight.set(state.ball.batsman, (batterWeight.get(state.ball.batsman) ?? 0) + (state.ball.legalBall === false ? 0 : 1));
    bowlerWeight.set(state.ball.bowler, (bowlerWeight.get(state.ball.bowler) ?? 0) + (state.ball.legalBall === false ? 0 : 1));
  }

  const topBatters = [...batterWeight.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([name]) => name);
  const topBowlers = [...bowlerWeight.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([name]) => name);

  return [...matchupMap.values()]
    .filter((cell) => topBatters.includes(cell.batter) && topBowlers.includes(cell.bowler))
    .map((cell) => ({
      ...cell,
      dotPct: cell.balls > 0 ? round((cell.dotPct / cell.balls) * 100, 1) : 0,
      strikeRate: cell.balls > 0 ? round((cell.runs * 100) / cell.balls, 1) : 0,
      threat: round(cell.threat, 1),
    }))
    .sort((left, right) => right.threat - left.threat);
}

function buildTimelineSeries(states: BallState[]) {
  const winProbability = states.map((state) =>
    toTimelinePoint(
      `wp-${state.ball.id}`,
      state.label,
      state.winProbability,
      state.ball.commentary,
      {
        over: state.ball.over,
        ball: state.ball.ball,
        isWicket: state.ball.isWicket,
      }
    )
  );

  const control = states.map((state) =>
    toTimelinePoint(
      `control-${state.ball.id}`,
      state.label,
      state.control,
      `Control swing ${state.control} after ${state.ball.commentary}`,
      {
        over: state.ball.over,
        ball: state.ball.ball,
        isWicket: state.ball.isWicket,
      }
    )
  );

  const pressure = states.map((state) =>
    toTimelinePoint(
      `pressure-${state.ball.id}`,
      state.label,
      state.pressure,
      `Pressure index ${state.pressure} at ${state.label}.`,
      {
        over: state.ball.over,
        ball: state.ball.ball,
        isWicket: state.ball.isWicket,
      }
    )
  );

  return { winProbability, control, pressure };
}

function buildBoundaryPressureSummary(
  states: BallState[],
  match: Match
): LiveBoundaryPressureSummary | null {
  if (states.length === 0) return null;

  const latestState = states[states.length - 1];
  const recentOvers = [...new Set(states.map((state) => state.ball.over))].slice(-2);
  const recentWindow = states.filter((state) => recentOvers.includes(state.ball.over));
  const recentLegalBalls = recentWindow.filter((state) => state.ball.legalBall !== false).length;
  const inningsLegalBalls = states.filter((state) => state.ball.legalBall !== false).length;
  const recentOversUsed = Math.max(recentOvers.length, recentLegalBalls / 6, 0.1);
  const inningsOversUsed = Math.max(latestState.oversUsed, 0.1);
  const recentBoundaryBalls = recentWindow.filter((state) => state.ball.isBoundary).length;
  const recentFours = recentWindow.filter((state) => state.ball.isFour).length;
  const recentSixes = recentWindow.filter((state) => state.ball.isSix).length;
  const recentBoundaryRuns = recentWindow.reduce(
    (sum, state) => sum + (state.ball.isFour ? 4 : 0) + (state.ball.isSix ? 6 : 0),
    0
  );
  const recentRuns = recentWindow.reduce((sum, state) => sum + state.ball.score, 0);
  const recentBoundaryRate = round(recentBoundaryBalls / recentOversUsed, 2);
  const recentBoundaryRunShare =
    recentRuns > 0 ? round((recentBoundaryRuns / recentRuns) * 100, 1) : 0;
  const inningsBoundaryBalls = states.filter((state) => state.ball.isBoundary).length;
  const inningsBoundaryRate = round(inningsBoundaryBalls / inningsOversUsed, 2);
  const expectedBoundaryRate = round(
    phaseBaseBoundaryRate(match.matchType, inferPhase(latestState.oversUsed, match.matchType)),
    2
  );
  const forecastBoundaryRate = round(
    recentBoundaryRate * 0.6 + inningsBoundaryRate * 0.2 + expectedBoundaryRate * 0.2,
    2
  );
  const pressureIndex = clamp(
    round(
      45 +
        (recentBoundaryRate - expectedBoundaryRate) * 18 +
        (forecastBoundaryRate - expectedBoundaryRate) * 10 +
        recentSixes * 4 +
        Math.max(0, recentBoundaryRunShare - 45) * 0.5,
      1
    ),
    0,
    100
  );

  const recentLabel =
    recentOvers.length > 0
      ? recentOvers.length === 1
        ? `Over ${recentOvers[0]}`
        : `Overs ${recentOvers[0]}-${recentOvers[recentOvers.length - 1]}`
      : "Last 2 overs";

  return {
    recentOversLabel: recentLabel,
    recentBoundaryBalls,
    recentFours,
    recentSixes,
    recentBoundaryRuns,
    recentBoundaryRate,
    recentBoundaryRunShare,
    inningsBoundaryRate,
    expectedBoundaryRate,
    forecastBoundaryRate,
    pressureIndex,
    note:
      `${recentLabel}: ${recentFours} four${recentFours === 1 ? "" : "s"} and ${recentSixes} six${recentSixes === 1 ? "" : "es"}. ` +
      `Measured boundary rate ${recentBoundaryRate}/over, forecast ${forecastBoundaryRate}/over, phase baseline ${expectedBoundaryRate}/over.`,
  };
}

function pickCurrentInning(scorecards: Scorecard[] | null, snapshot: LivePressureSnapshot) {
  if (!scorecards || scorecards.length === 0) return null;

  return (
    scorecards.find((scorecard) => scorecard.inning.toLowerCase().includes(snapshot.battingTeam.toLowerCase())) ??
    scorecards[scorecards.length - 1]
  );
}

export function buildLiveAnalyticsBundle(input: {
  match: Match;
  commentaryBalls: BallByBall[];
  scorecards: Scorecard[] | null;
  snapshot: LivePressureSnapshot;
  venue: HistoricalVenueSnapshot;
  winPrior?: import("@/lib/eda/win-probability").WinProbabilityPrior;
}): LiveAnalyticsBundle {
  const currentInningsBalls = sliceTrailingInningsBalls(input.commentaryBalls);
  const scheduledOvers = getScheduledOvers(input.match.matchType) ?? 20;
  const oversRemaining = Math.max(scheduledOvers - input.snapshot.overs, 0);

  // Always compute DLS resource pct from live snapshot
  const resourcePct = resourcePercentage(input.snapshot.wickets, oversRemaining);

  if (currentInningsBalls.length === 0) {
    // Even with no ball data, compute Bayesian win probability from score state
    const prior = input.winPrior ?? globalT20Prior(input.venue.chaseWinPct);
    if (input.venue.avgFirstInningsScore !== null) prior.avgTarget = input.venue.avgFirstInningsScore;
    const wpResult = computeBayesianWinProbability(
      {
        innings: input.snapshot.innings,
        runs: input.snapshot.runs,
        wickets: input.snapshot.wickets,
        overs: input.snapshot.overs,
        scheduledOvers,
        target: input.snapshot.target,
        currentRunRate: input.snapshot.currentRunRate,
        requiredRunRate: input.snapshot.requiredRunRate,
        recentRunRate: null,
        matchType: input.match.matchType,
        phase: input.snapshot.phase,
      },
      prior
    );

    return {
      ballWinProbability: [],
      matchControlSwing: [],
      pressureTimeline: [],
      topTurningBalls: [],
      topTurningOvers: [],
      batterImpact: [],
      bowlerImpact: [],
      bowlerRunsSaved: [],
      partnershipInfluence: [],
      counterfactuals: [],
      requiredVsActualRate: [],
      dotBallHeatmap: [],
      matchupMatrix: [],
      boundaryPressure: null,
      resourcePct: round(resourcePct, 1),
      entropyMomentum: 50,
      wicketCascadeRisk: 0,
      deathOverForecast: null,
      winProbabilityDetail: {
        probability: wpResult.probability,
        ci95: wpResult.ci95,
        resourcePct: wpResult.resourcePct,
        expectedRunsRemaining: wpResult.expectedRunsRemaining,
        featureContributions: wpResult.featureContributions,
        priorSampleSize: prior.sampleSize,
      },
    };
  }

  const states = buildBallStates(input.match, currentInningsBalls, input.snapshot, input.venue);
  const timelines = buildTimelineSeries(states);
  const currentInning = pickCurrentInning(input.scorecards, input.snapshot);
  const boundaryPressure = buildBoundaryPressureSummary(states, input.match);

  // ── Bayesian win probability from latest state ────────────────────────────
  const prior = input.winPrior ?? globalT20Prior(input.venue.chaseWinPct);
  if (input.venue.avgFirstInningsScore !== null) prior.avgTarget = input.venue.avgFirstInningsScore;
  const lastState = states[states.length - 1];
  const recent12 = currentInningsBalls.slice(-12);
  const recentLegal = recent12.filter((b) => b.legalBall !== false);
  const recentRunRate = recentLegal.length >= 3
    ? recent12.reduce((s, b) => s + b.score, 0) / Math.max(recentLegal.length / 6, 0.1)
    : null;

  const wpResult = computeBayesianWinProbability(
    {
      innings: input.snapshot.innings,
      runs: lastState?.cumulativeRuns ?? input.snapshot.runs,
      wickets: lastState?.cumulativeWickets ?? input.snapshot.wickets,
      overs: lastState?.oversUsed ?? input.snapshot.overs,
      scheduledOvers,
      target: input.snapshot.target,
      currentRunRate: lastState?.currentRunRate ?? input.snapshot.currentRunRate,
      requiredRunRate: lastState?.requiredRate ?? input.snapshot.requiredRunRate,
      recentRunRate,
      matchType: input.match.matchType,
      phase: input.snapshot.phase,
    },
    prior
  );

  // ── Entropy-weighted momentum ─────────────────────────────────────────────
  const recentScores = currentInningsBalls.slice(-24).map((b) => b.score);
  const phaseBaseline = phaseBaseRunRate(input.match.matchType, input.snapshot.phase);
  const eMomentum = entropyWeightedMomentum(recentScores, phaseBaseline);

  // ── Wicket-cascade risk ─────────────────────────────────────────────────
  const recentWickets = recent12.filter((b) => b.isWicket).length;
  const cascadeRisk = wicketCascadeRisk({
    wicketsAlreadyFallen: input.snapshot.wickets,
    oversCompleted: input.snapshot.overs,
    recentWicketsInLastNBalls: recentWickets,
    recentBallsWindow: recent12.filter((b) => b.legalBall !== false).length,
    nextNBalls: 18,
  });

  // ── Death-over forecast ──────────────────────────────────────────────────
  const deathForecast = input.snapshot.overs < scheduledOvers * 0.75
    ? deathOverForecast({
        currentOvers: input.snapshot.overs,
        currentWickets: input.snapshot.wickets,
        currentRunRate: input.snapshot.currentRunRate,
        recentRunRate,
        scheduledOvers,
      })
    : null;

  return {
    ballWinProbability: timelines.winProbability,
    matchControlSwing: timelines.control,
    pressureTimeline: timelines.pressure,
    topTurningBalls: buildTurningBallBars(states),
    topTurningOvers: buildTurningOverBars(states),
    batterImpact: buildBatterImpact(states),
    bowlerImpact: buildBowlerImpact(states),
    bowlerRunsSaved: buildBowlerRunsSaved(states),
    partnershipInfluence: buildPartnershipInfluence(states, currentInning),
    counterfactuals: buildCounterfactuals(states, input.snapshot, input.match, input.venue),
    requiredVsActualRate: buildRateTimeline(states, input.match, input.venue),
    dotBallHeatmap: buildHeatmap(states, input.match),
    matchupMatrix: buildMatchupMatrix(states),
    boundaryPressure,
    resourcePct: round(resourcePct, 1),
    entropyMomentum: round(eMomentum, 1),
    wicketCascadeRisk: round(cascadeRisk, 1),
    deathOverForecast: deathForecast
      ? { projectedDeathRuns: deathForecast.projectedDeathRuns, confidence: deathForecast.confidence }
      : null,
    winProbabilityDetail: {
      probability: wpResult.probability,
      ci95: wpResult.ci95,
      resourcePct: wpResult.resourcePct,
      expectedRunsRemaining: wpResult.expectedRunsRemaining,
      featureContributions: wpResult.featureContributions,
      priorSampleSize: prior.sampleSize,
    },
  };
}
