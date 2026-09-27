import { clamp, getScheduledOvers, round } from "@/lib/eda/common";
import type { BallByBall, Match, Scorecard } from "@/types/cricket";
import type {
  PostMatchCollapsePeriod,
  PostMatchContributorSummary,
  PostMatchInningsAnalytics,
  PostMatchOverSummary,
  PostMatchPartnershipSummary,
  PostMatchPhaseSummary,
  PostMatchPredictionReview,
  PostMatchSummaryAnalytics,
} from "@/types/eda";

type InningsMeta = {
  inning: string;
  team: string;
  totalRuns: number;
  totalWickets: number;
  totalOvers: number;
  batting: Scorecard["batting"];
  bowling: Scorecard["bowling"];
  balls: BallByBall[];
};

function inningTeamName(summaryInning: string) {
  return summaryInning.replace(/\s+Innings\s+\d+$/i, "").trim();
}

function oppositionTeam(match: Match, battingTeam: string) {
  return match.teams.find((team) => team.toLowerCase() !== battingTeam.toLowerCase()) ?? match.teams[1] ?? battingTeam;
}

function inferWinner(match: Match) {
  const normalizedStatus = match.status.toLowerCase();

  for (const team of match.teams) {
    if (normalizedStatus.includes(team.toLowerCase())) {
      return team;
    }
  }

  for (const team of match.teamInfo) {
    if (normalizedStatus.includes(team.shortname.toLowerCase())) {
      return team.name;
    }
  }

  return null;
}

function sortBallsChronologically(balls: BallByBall[]) {
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

function splitCommentaryIntoInnings(balls: BallByBall[]) {
  const ordered = sortBallsChronologically(balls);
  if (ordered.length === 0) return [] as BallByBall[][];

  const innings: BallByBall[][] = [];
  let current: BallByBall[] = [];
  let previousOver = ordered[0].over;

  for (const ball of ordered) {
    if (current.length > 0 && ball.over < previousOver) {
      innings.push(current);
      current = [];
    }

    current.push(ball);
    previousOver = ball.over;
  }

  if (current.length > 0) {
    innings.push(current);
  }

  return innings;
}

function buildInningsMeta(match: Match, scorecards: Scorecard[] | null, commentaryBalls: BallByBall[]): InningsMeta[] {
  const inningsSegments = splitCommentaryIntoInnings(commentaryBalls);

  if (scorecards && scorecards.length > 0) {
    const relevantSegments = inningsSegments.slice(-scorecards.length);
    const offset = scorecards.length - relevantSegments.length;

    return scorecards.map((card, index) => ({
      inning: card.inning,
      team: inningTeamName(card.inning),
      totalRuns: card.totalRuns,
      totalWickets: card.totalWickets,
      totalOvers: card.totalOvers,
      batting: card.batting,
      bowling: card.bowling,
      balls: index >= offset ? relevantSegments[index - offset] ?? [] : [],
    }));
  }

  if (match.score.length > 0) {
    const relevantSegments = inningsSegments.slice(-match.score.length);
    const offset = match.score.length - relevantSegments.length;

    return match.score.map((score, index) => ({
      inning: score.inning,
      team: inningTeamName(score.inning),
      totalRuns: score.r,
      totalWickets: score.w,
      totalOvers: score.o,
      batting: [],
      bowling: [],
      balls: index >= offset ? relevantSegments[index - offset] ?? [] : [],
    }));
  }

  return inningsSegments.map((segment, index) => {
    const lastBall = segment[segment.length - 1];
    const totalRuns = segment.reduce((sum, ball) => sum + ball.score, 0);
    const totalWickets = segment.filter((ball) => ball.isWicket).length;

    return {
      inning: `Innings ${index + 1}`,
      team: `Team ${index + 1}`,
      totalRuns,
      totalWickets,
      totalOvers: lastBall ? lastBall.over + 1 : 0,
      batting: [],
      bowling: [],
      balls: segment,
    };
  });
}

function phaseForOver(over: number, scheduledOvers: number | null) {
  if (scheduledOvers === 10) {
    if (over < 3) return "Powerplay";
    if (over < 8) return "Middle";
    return "Death";
  }

  if (scheduledOvers === 50) {
    if (over < 10) return "Powerplay";
    if (over < 40) return "Middle";
    return "Death";
  }

  if (over < 6) return "Powerplay";
  if (over < 16) return "Middle";
  return "Death";
}

function phaseBaseline(phase: string, scheduledOvers: number | null) {
  if (scheduledOvers === 10) {
    if (phase === "Powerplay") return 10.2;
    if (phase === "Middle") return 11.3;
    return 13.2;
  }

  if (scheduledOvers === 50) {
    if (phase === "Powerplay") return 5.8;
    if (phase === "Middle") return 5.5;
    return 8.4;
  }

  if (phase === "Powerplay") return 8.3;
  if (phase === "Middle") return 7.6;
  return 10.8;
}

function buildOverSummaries(input: {
  inning: string;
  team: string;
  balls: BallByBall[];
  scheduledOvers: number | null;
}): PostMatchOverSummary[] {
  if (input.balls.length === 0) return [];

  const overMap = new Map<number, { runs: number; wickets: number; legalBalls: number }>();

  for (const ball of input.balls) {
    const current = overMap.get(ball.over) ?? { runs: 0, wickets: 0, legalBalls: 0 };
    current.runs += ball.score;
    current.wickets += ball.isWicket ? 1 : 0;
    current.legalBalls += ball.legalBall === false ? 0 : 1;
    overMap.set(ball.over, current);
  }

  let cumulativeRuns = 0;
  let cumulativeWickets = 0;

  return [...overMap.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([over, value]) => {
      cumulativeRuns += value.runs;
      cumulativeWickets += value.wickets;
      const phase = phaseForOver(over, input.scheduledOvers);
      const runRate = value.legalBalls > 0 ? round((value.runs * 6) / value.legalBalls, 2) : 0;
      const leverage = round(Math.abs(runRate - phaseBaseline(phase, input.scheduledOvers)) + value.wickets * 2.6, 1);

      return {
        id: `${input.inning}-over-${over}`,
        inning: input.inning,
        team: input.team,
        over,
        phase,
        runs: value.runs,
        wickets: value.wickets,
        legalBalls: value.legalBalls,
        cumulativeRuns,
        cumulativeWickets,
        runRate,
        leverage,
        note:
          value.wickets > 0
            ? `Over ${over + 1} returned ${value.runs} runs and ${value.wickets} wickets in the ${phase.toLowerCase()}.`
            : `Over ${over + 1} produced ${value.runs} runs in the ${phase.toLowerCase()} phase.`,
      } satisfies PostMatchOverSummary;
    });
}

function buildPhaseStats(overSummaries: PostMatchOverSummary[], totalRuns: number): PostMatchPhaseSummary[] {
  const phaseMap = new Map<string, { inning: string; team: string; runs: number; wickets: number; legalBalls: number }>();

  for (const over of overSummaries) {
    const current = phaseMap.get(over.phase) ?? {
      inning: over.inning,
      team: over.team,
      runs: 0,
      wickets: 0,
      legalBalls: 0,
    };
    current.runs += over.runs;
    current.wickets += over.wickets;
    current.legalBalls += over.legalBalls;
    phaseMap.set(over.phase, current);
  }

  return ["Powerplay", "Middle", "Death"].map((phase) => {
    const current = phaseMap.get(phase) ?? {
      inning: overSummaries[0]?.inning ?? phase,
      team: overSummaries[0]?.team ?? "",
      runs: 0,
      wickets: 0,
      legalBalls: 0,
    };
    const runRate = current.legalBalls > 0 ? round((current.runs * 6) / current.legalBalls, 2) : 0;

    return {
      inning: current.inning,
      team: current.team,
      phase,
      runs: current.runs,
      wickets: current.wickets,
      legalBalls: current.legalBalls,
      runRate,
      runShare: totalRuns > 0 ? round((current.runs / totalRuns) * 100, 1) : 0,
      note:
        current.legalBalls > 0
          ? `${current.team} scored ${current.runs}/${current.wickets} in the ${phase.toLowerCase()} at ${runRate} rpo.`
          : `${phase} data was unavailable for ${current.team}.`,
    } satisfies PostMatchPhaseSummary;
  });
}

function buildPartnerships(inning: string, team: string, balls: BallByBall[]): PostMatchPartnershipSummary[] {
  if (balls.length === 0) return [];

  const partnerships: PostMatchPartnershipSummary[] = [];
  let wicketNumber = 1;
  let runs = 0;
  let legalBalls = 0;
  let startOver = balls[0]?.over ?? 0;
  let endOver = startOver;
  let batters: string[] = [];

  const pushPartnership = () => {
    if (runs <= 0 && legalBalls <= 0) return;

    const pair = batters.length >= 2 ? `${batters[0]} & ${batters[1]}` : batters[0] ?? `Partnership ${wicketNumber}`;
    partnerships.push({
      id: `${inning}-partnership-${partnerships.length + 1}`,
      inning,
      team,
      pair,
      runs,
      balls: legalBalls,
      wicketNumber,
      startOver,
      endOver,
      note: `${pair} added ${runs} runs in ${legalBalls} balls between overs ${startOver + 1} and ${endOver + 1}.`,
    });
  };

  for (const ball of balls) {
    runs += ball.score;
    legalBalls += ball.legalBall === false ? 0 : 1;
    endOver = ball.over;

    if (ball.batsman && !batters.includes(ball.batsman)) {
      batters = [...batters, ball.batsman].slice(0, 3);
    }

    if (ball.isWicket) {
      pushPartnership();
      wicketNumber += 1;
      runs = 0;
      legalBalls = 0;
      startOver = ball.over;
      endOver = ball.over;
      batters = [];
    }
  }

  pushPartnership();

  return partnerships
    .filter((partnership) => partnership.runs > 0)
    .sort((left, right) => {
      if (right.runs !== left.runs) return right.runs - left.runs;
      return right.balls - left.balls;
    });
}

function buildCollapsePeriods(inning: string, team: string, overSummaries: PostMatchOverSummary[]) {
  const periods: PostMatchCollapsePeriod[] = [];

  for (let start = 0; start < overSummaries.length; start += 1) {
    let runs = 0;
    let wickets = 0;
    let legalBalls = 0;

    for (let end = start; end < Math.min(start + 3, overSummaries.length); end += 1) {
      runs += overSummaries[end].runs;
      wickets += overSummaries[end].wickets;
      legalBalls += overSummaries[end].legalBalls;

      if (legalBalls >= 12 && wickets >= 2) {
        periods.push({
          id: `${inning}-collapse-${start}-${end}`,
          inning,
          team,
          startOver: overSummaries[start].over,
          endOver: overSummaries[end].over,
          wickets,
          runs,
          legalBalls,
          note: `${team} lost ${wickets} wickets for ${runs} runs between overs ${overSummaries[start].over + 1} and ${overSummaries[end].over + 1}.`,
        });
      }
    }
  }

  return periods
    .sort((left, right) => {
      if (right.wickets !== left.wickets) return right.wickets - left.wickets;
      if (left.runs !== right.runs) return left.runs - right.runs;
      return left.startOver - right.startOver;
    })
    .filter((period, index, array) => array.findIndex((candidate) => candidate.startOver === period.startOver && candidate.endOver === period.endOver) === index)
    .slice(0, 3);
}

function buildPredictionReview(input: {
  match: Match;
  innings: InningsMeta[];
  venueAvgFirstInnings?: number | null;
  venueChaseWinPct?: number | null;
}): PostMatchPredictionReview | null {
  if (input.innings.length < 2) return null;

  const winner = inferWinner(input.match);
  const firstInnings = input.innings[0];
  const defendingTeam = firstInnings.team;
  const chasingTeam = input.innings[1].team;
  const venueBase = input.venueChaseWinPct ?? 50;
  const parDelta = input.venueAvgFirstInnings != null ? firstInnings.totalRuns - input.venueAvgFirstInnings : 0;
  const expectedChaseWinPct = clamp(round(venueBase - parDelta * 1.1, 1), 8, 92);
  const expectedWinner = expectedChaseWinPct >= 50 ? chasingTeam : defendingTeam;
  const aligned =
    winner !== null &&
    (winner.toLowerCase() === expectedWinner.toLowerCase() ||
      winner.toLowerCase().includes(expectedWinner.toLowerCase()) ||
      expectedWinner.toLowerCase().includes(winner.toLowerCase()));

  return {
    expectedWinner,
    actualWinner: winner,
    expectedWinPct: expectedChaseWinPct,
    aligned,
    note:
      input.venueAvgFirstInnings != null
        ? `Pre-chase expectation leaned ${expectedWinner} at ${expectedChaseWinPct}% because ${defendingTeam} finished ${round(parDelta, 0)} runs versus the venue first-innings par.`
        : `Pre-chase expectation leaned ${expectedWinner} at ${expectedChaseWinPct}% using venue chase history and the posted target.`,
  };
}

function buildContributorLists(match: Match, innings: InningsMeta[]) {
  const battingContributors = innings.flatMap((inning) =>
    inning.batting.map((entry) => ({
      id: `${inning.inning}-bat-${entry.batsman.id || entry.batsman.name}`,
      name: entry.batsman.name,
      team: inning.team,
      impact: entry.r + Number(entry.sr || 0) / 20 + entry["6s"] * 1.5 + entry["4s"] * 0.5,
      metric: `${entry.r} off ${entry.b} · SR ${entry.sr}`,
      note: `${entry.batsman.name} scored ${entry.r} from ${entry.b} balls for ${inning.team}.`,
    }))
  );

  const bowlingContributors = innings.flatMap((inning) =>
    inning.bowling.map((entry) => ({
      id: `${inning.inning}-bowl-${entry.bowler.id || entry.bowler.name}`,
      name: entry.bowler.name,
      team: oppositionTeam(match, inning.team),
      impact: entry.w * 18 + Math.max(0, 8 - Number(entry.eco || 0)) * 3 + entry.m * 2,
      metric: `${entry.w}/${entry.r} · Econ ${entry.eco}`,
      note: `${entry.bowler.name} returned ${entry.w}/${entry.r} in ${entry.o} overs for ${oppositionTeam(match, inning.team)}.`,
    }))
  );

  const allContributors = [...battingContributors, ...bowlingContributors].sort((left, right) => right.impact - left.impact);
  const topPerformers: PostMatchContributorSummary[] = allContributors.slice(0, 4).map((entry) => ({
    id: entry.id,
    name: entry.name,
    team: entry.team,
    metric: entry.metric,
    note: entry.note,
  }));

  const hiddenContributors: PostMatchContributorSummary[] = allContributors
    .filter((entry) => !topPerformers.some((topPerformer) => topPerformer.id === entry.id))
    .filter((entry) => entry.impact >= 18)
    .slice(0, 4)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      team: entry.team,
      metric: entry.metric,
      note: `${entry.note} This contribution was meaningful without becoming the headline performance.`,
    }));

  return {
    topPerformers,
    hiddenContributors,
  };
}

export function buildPostMatchSummaryAnalytics(input: {
  match: Match;
  scorecards: Scorecard[] | null;
  commentaryBalls: BallByBall[];
  venueAvgFirstInnings?: number | null;
  venueChaseWinPct?: number | null;
}): PostMatchSummaryAnalytics | null {
  const innings = buildInningsMeta(input.match, input.scorecards, input.commentaryBalls);

  if (innings.length === 0) {
    return null;
  }

  const scheduledOvers = getScheduledOvers(input.match.matchType);
  const inningsAnalytics: PostMatchInningsAnalytics[] = innings.map((inning) => {
    const overSummaries = buildOverSummaries({
      inning: inning.inning,
      team: inning.team,
      balls: inning.balls,
      scheduledOvers,
    });
    const phaseStats = buildPhaseStats(overSummaries, inning.totalRuns);
    const topPartnerships = buildPartnerships(inning.inning, inning.team, inning.balls).slice(0, 4);
    const collapsePeriods = buildCollapsePeriods(inning.inning, inning.team, overSummaries);
    const highestImpactOver = overSummaries.length > 0 ? [...overSummaries].sort((left, right) => right.leverage - left.leverage)[0] : null;
    const bestBattingPhase = phaseStats.filter((phase) => phase.legalBalls > 0).sort((left, right) => right.runRate - left.runRate)[0] ?? null;
    const powerplay = phaseStats.find((phase) => phase.phase === "Powerplay" && phase.legalBalls > 0) ?? null;
    const deathOvers = phaseStats.find((phase) => phase.phase === "Death" && phase.legalBalls > 0) ?? null;

    return {
      inning: inning.inning,
      team: inning.team,
      overSummaries,
      phaseStats,
      topPartnerships,
      collapsePeriods,
      highestImpactOver,
      bestBattingPhase,
      powerplay,
      deathOvers,
    };
  });

  const allPhases = inningsAnalytics.flatMap((inning) => inning.phaseStats.filter((phase) => phase.legalBalls > 0));
  const allOvers = inningsAnalytics.flatMap((inning) => inning.overSummaries);
  const allPartnerships = inningsAnalytics.flatMap((inning) => inning.topPartnerships);
  const allCollapses = inningsAnalytics.flatMap((inning) => inning.collapsePeriods);
  const { topPerformers, hiddenContributors } = buildContributorLists(input.match, innings);
  const bestBattingPhase = allPhases.sort((left, right) => right.runRate - left.runRate)[0] ?? null;
  const worstBowlingPhase = allPhases.sort((left, right) => right.runRate - left.runRate)[0] ?? null;
  const highestImpactOver = allOvers.sort((left, right) => right.leverage - left.leverage)[0] ?? null;
  const decisivePartnership = allPartnerships.sort((left, right) => right.runs - left.runs)[0] ?? null;
  const biggestCollapse = allCollapses.sort((left, right) => {
    if (right.wickets !== left.wickets) return right.wickets - left.wickets;
    return left.runs - right.runs;
  })[0] ?? null;
  const predictionReview = buildPredictionReview({
    match: input.match,
    innings,
    venueAvgFirstInnings: input.venueAvgFirstInnings,
    venueChaseWinPct: input.venueChaseWinPct,
  });

  const narrativeHighlights = [
    highestImpactOver
      ? `${highestImpactOver.team}'s over ${highestImpactOver.over + 1} was the highest-impact passage: ${highestImpactOver.note}`
      : "No over-level impact swing could be isolated from the available score flow.",
    bestBattingPhase
      ? `${bestBattingPhase.team}'s best batting phase was the ${bestBattingPhase.phase.toLowerCase()} at ${bestBattingPhase.runRate} rpo.`
      : "The best batting phase could not be isolated cleanly from the available data.",
    biggestCollapse
      ? `${biggestCollapse.note}`
      : "No meaningful collapse spell was detected from the tracked innings flow.",
    decisivePartnership
      ? `${decisivePartnership.pair} produced the biggest stand with ${decisivePartnership.runs} runs.`
      : "The innings did not surface one standout partnership from the tracked ball sequence.",
    predictionReview ? predictionReview.note : "Prediction review was unavailable because the chase context could not be reconstructed fully.",
  ];

  return {
    innings: inningsAnalytics,
    bestBattingPhase,
    worstBowlingPhase,
    highestImpactOver,
    decisivePartnership,
    biggestCollapse,
    topPerformers,
    hiddenContributors,
    predictionReview,
    narrativeHighlights,
  };
}
