import type {
  Match,
  MatchPreviewIntel,
  PostMatchBattingLeader,
  PostMatchBowlingLeader,
  PostMatchEdaCard,
  PostMatchInningsSummary,
  PostMatchIntel,
  PostMatchSignal,
  Scorecard,
  Squad,
} from "@/types/cricket";
import { getOllamaHeaders, getOllamaUrl, OLLAMA_REQUEST_TIMEOUT_MS } from "@/lib/ollama";
import { buildMetricQuality } from "@/lib/eda/common";

const OLLAMA_URL = getOllamaUrl();
const OLLAMA_MATCH_MODEL =
  process.env.OLLAMA_MATCH_MODEL || process.env.OLLAMA_BQS_MODEL || process.env.OLLAMA_MODEL || "qwen3.5:latest";
const OLLAMA_MATCH_TIMEOUT_MS = Number(process.env.OLLAMA_MATCH_TIMEOUT_MS || 4000);

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundStat(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}

function oversToBalls(overs: number) {
  const wholeOvers = Math.floor(overs);
  const partialBalls = Math.round((overs - wholeOvers) * 10);
  return wholeOvers * 6 + partialBalls;
}

function ballsToOvers(balls: number) {
  const wholeOvers = Math.floor(balls / 6);
  const partialBalls = balls % 6;
  return `${wholeOvers}.${partialBalls}`;
}

function percentage(part: number, total: number) {
  if (!total) return 0;
  return roundStat((part / total) * 100, 1);
}

function formatPercentage(value: number) {
  return `${roundStat(value, 1)}%`;
}

function getTopBatters(scorecards: Scorecard[]) {
  return scorecards
    .flatMap((card) =>
      card.batting.map((entry) => ({
        name: entry.batsman.name,
        runs: entry.r,
        strikeRate: Number(entry.sr),
        inning: card.inning,
      }))
    )
    .sort((left, right) => right.runs - left.runs)
    .slice(0, 3);
}

function getTopBowlers(scorecards: Scorecard[]) {
  return scorecards
    .flatMap((card) =>
      card.bowling.map((entry) => ({
        name: entry.bowler.name,
        wickets: entry.w,
        economy: Number(entry.eco),
        inning: card.inning,
      }))
    )
    .sort((left, right) => {
      if (right.wickets !== left.wickets) return right.wickets - left.wickets;
      return left.economy - right.economy;
    })
    .slice(0, 3);
}

function parseExtras(extras: string) {
  const bracketMatch = extras.match(/\((\d+)\)/);
  if (bracketMatch) return Number(bracketMatch[1]);

  const leadingNumber = extras.match(/^(\d+)/);
  if (leadingNumber) return Number(leadingNumber[1]);

  return 0;
}

async function generateStructuredNarrative<T>(prompt: string): Promise<T | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: getOllamaHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: OLLAMA_MATCH_MODEL,
        prompt,
        format: "json",
        think: false,
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 700,
        },
      }),
      signal: AbortSignal.timeout(Math.min(OLLAMA_REQUEST_TIMEOUT_MS, OLLAMA_MATCH_TIMEOUT_MS)),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    if (!data.response) return null;
    return JSON.parse(data.response) as T;
  } catch {
    return null;
  }
}

export async function buildMatchPreviewIntel(match: Match, squads: Squad[] | null): Promise<MatchPreviewIntel> {
  const watchPlayers =
    squads?.flatMap((squad) => squad.players.slice(0, 2).map((player) => player.name)).slice(0, 4) ??
    [];

  const fallback: MatchPreviewIntel = {
    headline: `${match.teams[0]} vs ${match.teams[1]} preview`,
    summary: `${match.teams[0]} and ${match.teams[1]} meet in a ${match.matchType} contest at ${match.venue}. The preview focus is on matchup control, phase management, and who handles pressure better once the game speeds up.`,
    keyQuestions: [
      `Which side controls the first 6 overs in ${match.matchType} conditions?`,
      "Can the bowling unit defend middle-overs pressure without leaking boundary balls?",
      "Which batting core looks better prepared for game-state changes?",
    ],
    tacticalAngles: [
      "Watch how both sides manage strike rotation before trying to force boundary pressure.",
      "The bowling side that changes pace earliest may own the middle overs.",
      "Early field settings will hint at whether captains trust containment or wicket-taking lines.",
    ],
    watchPlayers,
    predictedPressurePhase: "Middle overs",
  };

  const narrative = await generateStructuredNarrative<Partial<MatchPreviewIntel>>(
    `You are a cricket analyst writing a sharp pre-match preview. Return strict JSON.
Keys: headline, summary, keyQuestions, tacticalAngles, watchPlayers, predictedPressurePhase.
Match: ${match.name}
Type: ${match.matchType}
Venue: ${match.venue}
Status: ${match.status}
Players to consider: ${watchPlayers.join(", ") || "Not supplied"}`
  );

  return {
    headline: narrative?.headline || fallback.headline,
    summary: narrative?.summary || fallback.summary,
    keyQuestions: Array.isArray(narrative?.keyQuestions) && narrative.keyQuestions.length > 0
      ? narrative.keyQuestions.slice(0, 3)
      : fallback.keyQuestions,
    tacticalAngles: Array.isArray(narrative?.tacticalAngles) && narrative.tacticalAngles.length > 0
      ? narrative.tacticalAngles.slice(0, 3)
      : fallback.tacticalAngles,
    watchPlayers: Array.isArray(narrative?.watchPlayers) && narrative.watchPlayers.length > 0
      ? narrative.watchPlayers.slice(0, 4)
      : fallback.watchPlayers,
    predictedPressurePhase: narrative?.predictedPressurePhase || fallback.predictedPressurePhase,
  };
}

function buildInningsSummaries(scorecards: Scorecard[]): PostMatchInningsSummary[] {
  return scorecards.map((card) => {
    const battingRuns = card.batting.reduce((sum, entry) => sum + entry.r, 0);
    const parsedExtras = parseExtras(card.extras);
    const extras = parsedExtras > 0 ? parsedExtras : Math.max(0, card.totalRuns - battingRuns);
    const boundaryRuns = card.batting.reduce((sum, entry) => sum + entry["4s"] * 4 + entry["6s"] * 6, 0);
    const topScorer = [...card.batting].sort((left, right) => right.r - left.r)[0];
    const supportRuns = Math.max(0, battingRuns - (topScorer?.r ?? 0));
    const lowerOrderRuns = card.batting.slice(5).reduce((sum, entry) => sum + entry.r, 0);

    return {
      inning: card.inning,
      totalRuns: card.totalRuns,
      totalWickets: card.totalWickets,
      totalOvers: card.totalOvers,
      runRate: roundStat(card.totalRuns / Math.max(card.totalOvers, 1), 2),
      extras,
      extrasPct: percentage(extras, card.totalRuns),
      boundaryRuns,
      boundaryPct: percentage(boundaryRuns, battingRuns),
      topScorerName: topScorer?.batsman.name || "N/A",
      topScorerRuns: topScorer?.r || 0,
      topScorerStrikeRate: roundStat(Number(topScorer?.sr || 0), 2),
      topScorerPct: percentage(topScorer?.r || 0, battingRuns),
      supportRuns,
      supportPct: percentage(supportRuns, battingRuns),
      lowerOrderRuns,
      lowerOrderPct: percentage(lowerOrderRuns, battingRuns),
    };
  });
}

function buildBattingLeaders(scorecards: Scorecard[]): PostMatchBattingLeader[] {
  return scorecards
    .flatMap((card) =>
      card.batting.map((entry) => {
        const boundaryRuns = entry["4s"] * 4 + entry["6s"] * 6;
        const battingRuns = card.batting.reduce((sum, batter) => sum + batter.r, 0);
        return {
          name: entry.batsman.name,
          inning: card.inning,
          runs: entry.r,
          balls: entry.b,
          strikeRate: roundStat(Number(entry.sr || 0), 2),
          fours: entry["4s"],
          sixes: entry["6s"],
          boundaryPct: percentage(boundaryRuns, Math.max(entry.r, 1)),
          sharePct: percentage(entry.r, battingRuns),
        };
      })
    )
    .sort((left, right) => {
      if (right.runs !== left.runs) return right.runs - left.runs;
      return right.strikeRate - left.strikeRate;
    })
    .slice(0, 6);
}

function buildBowlingLeaders(scorecards: Scorecard[]): PostMatchBowlingLeader[] {
  return scorecards
    .flatMap((card) =>
      card.bowling.map((entry) => ({
        name: entry.bowler.name,
        inning: `vs ${card.inning}`,
        wickets: entry.w,
        overs: entry.o,
        maidens: entry.m,
        runsConceded: entry.r,
        economy: roundStat(Number(entry.eco || 0), 2),
        ballsPerWicket: entry.w > 0 ? roundStat(oversToBalls(entry.o) / entry.w, 1) : null,
      }))
    )
    .sort((left, right) => {
      if (right.wickets !== left.wickets) return right.wickets - left.wickets;
      return left.economy - right.economy;
    })
    .slice(0, 6);
}

function buildMatchSignals(summaries: PostMatchInningsSummary[], bowlingLeaders: PostMatchBowlingLeader[]): PostMatchSignal[] {
  if (summaries.length === 0) {
    return [
      {
        id: "signal-waiting",
        label: "Comparative read",
        value: "Pending",
        insight: "Once scorecards land, this section surfaces how the match tilted beyond the raw result.",
        tone: "warning",
        quality: buildMetricQuality({
          sampleSize: 0,
          provenance: "observed",
          confidence: "low",
          warning: "Live scorecards are still unavailable.",
        }),
      },
    ];
  }

  const comparisonWarning =
    summaries.length <= 1
      ? "Only one innings is available, so comparative signals are provisional."
      : null;
  const fastestInnings = [...summaries].sort((left, right) => right.runRate - left.runRate)[0];
  const boundaryHeavyInnings = [...summaries].sort((left, right) => right.boundaryPct - left.boundaryPct)[0];
  const balancedInnings = [...summaries].sort((left, right) => right.supportPct - left.supportPct)[0];
  const lowerOrderLift = [...summaries].sort((left, right) => right.lowerOrderPct - left.lowerOrderPct)[0];
  const extrasLeak = [...summaries].sort((left, right) => right.extrasPct - left.extrasPct)[0];
  const bestBowling = bowlingLeaders[0];

  return [
    {
      id: "signal-fastest",
      label: "Tempo winner",
      value: `${fastestInnings.inning} · ${fastestInnings.runRate}`,
      insight: "Fastest scoring innings by run rate, which often maps to scoreboard pressure control.",
      tone: fastestInnings.runRate >= 8 ? "good" : "neutral",
      quality: buildMetricQuality({
        sampleSize: summaries.length,
        provenance: "observed",
        warning: comparisonWarning,
      }),
    },
    {
      id: "signal-balance",
      label: "Best support batting",
      value: `${balancedInnings.inning} · ${formatPercentage(balancedInnings.supportPct)}`,
      insight: "Higher support share means the innings was not carried by one batter alone.",
      tone: balancedInnings.supportPct >= 55 ? "good" : "neutral",
      quality: buildMetricQuality({
        sampleSize: summaries.length,
        provenance: "observed",
        warning: comparisonWarning,
      }),
    },
    {
      id: "signal-boundaries",
      label: "Boundary dependence",
      value: `${boundaryHeavyInnings.inning} · ${formatPercentage(boundaryHeavyInnings.boundaryPct)}`,
      insight: "Shows which innings leaned most on fours and sixes rather than strike rotation.",
      tone: boundaryHeavyInnings.boundaryPct >= 55 ? "warning" : "neutral",
      quality: buildMetricQuality({
        sampleSize: summaries.length,
        provenance: "observed",
        warning: comparisonWarning,
      }),
    },
    {
      id: "signal-lower-order",
      label: "Lower-order lift",
      value: `${lowerOrderLift.inning} · ${formatPercentage(lowerOrderLift.lowerOrderPct)}`,
      insight: "Useful read on whether the finishers or tail extended the total meaningfully.",
      tone: lowerOrderLift.lowerOrderPct >= 18 ? "good" : "neutral",
      quality: buildMetricQuality({
        sampleSize: summaries.length,
        provenance: "observed",
        warning: comparisonWarning,
      }),
    },
    {
      id: "signal-extras",
      label: "Discipline leak",
      value: `${extrasLeak.inning} · ${formatPercentage(extrasLeak.extrasPct)}`,
      insight: "Extras as a share of the innings total. Higher numbers usually reflect pressure release.",
      tone: extrasLeak.extrasPct >= 8 ? "warning" : "neutral",
      quality: buildMetricQuality({
        sampleSize: summaries.length,
        provenance: "observed",
        warning: comparisonWarning,
      }),
    },
    {
      id: "signal-bowling",
      label: "Best bowling control",
      value: bestBowling
        ? `${bestBowling.name} · ${bestBowling.wickets}/${bestBowling.runsConceded}`
        : "Waiting",
      insight: bestBowling
        ? "Top wicket-taking spell, with economy used as the tiebreaker."
        : "Bowling control becomes available once spell data is present.",
      tone: bestBowling ? "good" : "neutral",
      quality: buildMetricQuality({
        sampleSize: bestBowling ? oversToBalls(bestBowling.overs) : 0,
        provenance: "observed",
        warning: bestBowling ? comparisonWarning : "Bowling spell data is still unavailable.",
      }),
    },
  ];
}

function buildReportNotes(match: Match, summaries: PostMatchInningsSummary[]) {
  const notes = [
    "This report is derived from innings totals, batting scorecards, bowling spells, and extras from the provider feed or inferred from total runs minus batting runs when the extras breakout is omitted.",
    "We intentionally avoid fake phase claims when ball-by-ball tempo splits are not available from the scorecard feed.",
  ];

  if (!match.matchEnded) {
    notes.push("The match is still live or incomplete, so the EDA report will evolve as more innings data arrives.");
  }

  if (summaries.length <= 1) {
    notes.push("Only one innings is available right now, so comparative insights are partial rather than full-match conclusions.");
  }

  return notes;
}

function buildFallbackTurningPoints(summaries: PostMatchInningsSummary[], signals: PostMatchSignal[]) {
  if (summaries.length === 0) {
    return [
      "Scorecard data has not settled yet, so the turning-point model is still waiting on innings context.",
      "Once totals and bowling spells are available, this section will isolate the main pressure swing.",
      "Use the match centre scorecard in the meantime for the raw live state.",
    ];
  }

  const fastestInnings = [...summaries].sort((left, right) => right.runRate - left.runRate)[0];
  const highestTotal = [...summaries].sort((left, right) => right.totalRuns - left.totalRuns)[0];
  const extrasLeak = signals.find((signal) => signal.id === "signal-extras");

  return [
    `${fastestInnings.inning} set the pace benchmark at ${fastestInnings.runRate} runs per over, which shaped the chase or defence tempo.`,
    `${highestTotal.inning} produced the strongest scoreboard base with ${highestTotal.totalRuns}/${highestTotal.totalWickets}.`,
    extrasLeak ? `${extrasLeak.label} mattered too: ${extrasLeak.value} shows where free runs eased pressure.` : "Bowling discipline helped separate the cleaner innings from the messier one.",
  ];
}

function buildFallbackTakeaways(summaries: PostMatchInningsSummary[], bowlingLeaders: PostMatchBowlingLeader[]) {
  if (summaries.length === 0) {
    return [
      "Post-match tactical takeaways unlock once scorecards are available.",
      "Look for innings balance, extras control, and bowling efficiency once the data lands.",
      "This page will refresh automatically as richer scorecard data becomes available.",
    ];
  }

  const balancedInnings = [...summaries].sort((left, right) => right.supportPct - left.supportPct)[0];
  const boundaryHeavyInnings = [...summaries].sort((left, right) => right.boundaryPct - left.boundaryPct)[0];
  const bestBowling = bowlingLeaders[0];

  return [
    `${balancedInnings.inning} showed the healthiest batting shape, with ${formatPercentage(balancedInnings.supportPct)} of runs coming outside the top scorer.`,
    `${boundaryHeavyInnings.inning} leaned hardest on boundary scoring, a sign that strike rotation may have been less stable there.`,
    bestBowling
      ? `${bestBowling.name}'s ${bestBowling.wickets}/${bestBowling.runsConceded} in ${bestBowling.inning} was the cleanest spell of control in the data.`
      : "Bowling control will read more clearly once wicket-taking spells are fully available.",
  ];
}

export async function buildPostMatchIntel(match: Match, scorecards: Scorecard[] | null): Promise<PostMatchIntel> {
  const summaries = buildInningsSummaries(scorecards ?? []);
  const battingLeaders = buildBattingLeaders(scorecards ?? []);
  const bowlingLeaders = buildBowlingLeaders(scorecards ?? []);
  const matchSignals = buildMatchSignals(summaries, bowlingLeaders);
  const edaCards = buildPostMatchEdaCards(scorecards ?? []);
  const topBatters = getTopBatters(scorecards ?? []);
  const topBowlers = getTopBowlers(scorecards ?? []);
  const reportNotes = buildReportNotes(match, summaries);

  const fallback: PostMatchIntel = {
    headline: `${match.name} post-match EDA report`,
    summary: `The result at ${match.venue} was shaped by scoring speed, batting support, and how much pressure each side released through boundaries and extras. This report combines deterministic innings fingerprints with model-written post-match context.`,
    turningPoints: buildFallbackTurningPoints(summaries, matchSignals),
    tacticalTakeaways: buildFallbackTakeaways(summaries, bowlingLeaders),
    standoutPerformers: [
      ...topBatters.map((entry) => `${entry.name}: ${entry.runs} runs in ${entry.inning}`),
      ...topBowlers.map((entry) => `${entry.name}: ${entry.wickets} wickets in ${entry.inning}`),
    ].slice(0, 4),
    edaCards,
    matchSignals,
    inningsSummaries: summaries,
    battingLeaders,
    bowlingLeaders,
    reportNotes,
  };

  const narrative = await generateStructuredNarrative<Partial<PostMatchIntel>>(
    `You are a senior cricket analyst writing a concise, evidence-aware post-match EDA summary. Return strict JSON.
Keys: headline, summary, turningPoints, tacticalTakeaways, standoutPerformers.
Do not invent phase data or ball-by-ball trends unless directly implied by the scorecard metrics below.
Match: ${match.name}
Venue: ${match.venue}
Status: ${match.status}
Ended: ${match.matchEnded ? "yes" : "no"}
Innings fingerprints: ${summaries.map((summary) => `${summary.inning} ${summary.totalRuns}/${summary.totalWickets} in ${summary.totalOvers} overs, RR ${summary.runRate}, boundary share ${summary.boundaryPct}%, support share ${summary.supportPct}%, lower-order share ${summary.lowerOrderPct}%, extras ${summary.extras} (${summary.extrasPct}%)`).join("; ") || "No scorecard summaries available"}
Batting leaders: ${battingLeaders.map((entry) => `${entry.name} ${entry.runs}(${entry.balls}) SR ${entry.strikeRate} in ${entry.inning}`).join("; ") || "No batting leaders available"}
Bowling leaders: ${bowlingLeaders.map((entry) => `${entry.name} ${entry.wickets}/${entry.runsConceded} economy ${entry.economy} ${entry.inning}`).join("; ") || "No bowling leaders available"}
Signals: ${matchSignals.map((signal) => `${signal.label}: ${signal.value} (${signal.insight})`).join("; ")}`
  );

  return {
    headline: narrative?.headline || fallback.headline,
    summary: narrative?.summary || fallback.summary,
    turningPoints: Array.isArray(narrative?.turningPoints) && narrative.turningPoints.length > 0
      ? narrative.turningPoints.slice(0, 3)
      : fallback.turningPoints,
    tacticalTakeaways: Array.isArray(narrative?.tacticalTakeaways) && narrative.tacticalTakeaways.length > 0
      ? narrative.tacticalTakeaways.slice(0, 3)
      : fallback.tacticalTakeaways,
    standoutPerformers: Array.isArray(narrative?.standoutPerformers) && narrative.standoutPerformers.length > 0
      ? narrative.standoutPerformers.slice(0, 5)
      : fallback.standoutPerformers,
    edaCards,
    matchSignals,
    inningsSummaries: summaries,
    battingLeaders,
    bowlingLeaders,
    reportNotes,
  };
}

export function buildPostMatchEdaCards(scorecards: Scorecard[]): PostMatchEdaCard[] {
  if (scorecards.length === 0) {
    return [
      {
        id: "no-scorecard",
        label: "Scorecard unavailable",
        value: "Waiting",
        insight: "Live scorecard data is required before post-match analytics can be generated.",
        tone: "warning",
        quality: buildMetricQuality({
          sampleSize: 0,
          provenance: "observed",
          confidence: "low",
          warning: "Provider scorecards have not arrived yet.",
        }),
      },
    ];
  }

  const summaries = buildInningsSummaries(scorecards);
  const battingLeaders = buildBattingLeaders(scorecards);
  const bowlingLeaders = buildBowlingLeaders(scorecards);
  const totals = summaries.map((summary) => summary.totalRuns);
  const runRates = summaries.map((summary) => summary.runRate);
  const highestTotal = [...summaries].sort((left, right) => right.totalRuns - left.totalRuns)[0];
  const fastestInnings = [...summaries].sort((left, right) => right.runRate - left.runRate)[0];
  const boundaryHeavyInnings = [...summaries].sort((left, right) => right.boundaryPct - left.boundaryPct)[0];
  const balancedInnings = [...summaries].sort((left, right) => right.supportPct - left.supportPct)[0];
  const lowerOrderLift = [...summaries].sort((left, right) => right.lowerOrderPct - left.lowerOrderPct)[0];
  const extrasLeak = [...summaries].sort((left, right) => right.extrasPct - left.extrasPct)[0];
  const topBatter = battingLeaders[0];
  const bestBowler = bowlingLeaders[0];
  const inningsWarning =
    summaries.length <= 1
      ? "Only one innings is available, so full-match comparisons are provisional."
      : null;

  return [
    {
      id: "top-total",
      label: "Peak innings total",
      value: `${Math.max(...totals)}`,
      insight: `${highestTotal.inning} posted the highest raw score in the match.`,
      tone: "good",
      quality: buildMetricQuality({
        sampleSize: 1,
        provenance: "observed",
      }),
    },
    {
      id: "avg-run-rate",
      label: "Average run rate",
      value: average(runRates).toFixed(2),
      insight: "Mean scoring speed across all available innings.",
      tone: average(runRates) >= 8 ? "good" : "neutral",
      quality: buildMetricQuality({
        sampleSize: summaries.length,
        provenance: "observed",
        warning: inningsWarning,
      }),
    },
    {
      id: "fastest-innings",
      label: "Fastest innings",
      value: `${fastestInnings.runRate} rpo`,
      insight: `${fastestInnings.inning} had the highest scoring tempo.`,
      tone: fastestInnings.runRate >= 8 ? "good" : "neutral",
      quality: buildMetricQuality({
        sampleSize: summaries.length,
        provenance: "observed",
        warning: inningsWarning,
      }),
    },
    {
      id: "boundary-reliance",
      label: "Highest boundary reliance",
      value: formatPercentage(boundaryHeavyInnings.boundaryPct),
      insight: `${boundaryHeavyInnings.inning} depended most on fours and sixes for scoring.`,
      tone: boundaryHeavyInnings.boundaryPct >= 55 ? "warning" : "neutral",
      quality: buildMetricQuality({
        sampleSize: summaries.length,
        provenance: "observed",
        warning: inningsWarning,
      }),
    },
    {
      id: "support-share",
      label: "Best support share",
      value: formatPercentage(balancedInnings.supportPct),
      insight: `${balancedInnings.inning} spread its runs best beyond the top scorer.`,
      tone: balancedInnings.supportPct >= 55 ? "good" : "neutral",
      quality: buildMetricQuality({
        sampleSize: summaries.length,
        provenance: "observed",
        warning: inningsWarning,
      }),
    },
    {
      id: "lower-order-lift",
      label: "Lower-order impact",
      value: formatPercentage(lowerOrderLift.lowerOrderPct),
      insight: `${lowerOrderLift.inning} got the biggest contribution from No. 6 and below.`,
      tone: lowerOrderLift.lowerOrderPct >= 18 ? "good" : "neutral",
      quality: buildMetricQuality({
        sampleSize: summaries.length,
        provenance: "observed",
        warning: inningsWarning,
      }),
    },
    {
      id: "extras-tax",
      label: "Extras tax",
      value: formatPercentage(extrasLeak.extrasPct),
      insight: `${extrasLeak.inning} benefited most from opposition indiscipline.`,
      tone: extrasLeak.extrasPct >= 8 ? "warning" : "neutral",
      quality: buildMetricQuality({
        sampleSize: summaries.length,
        provenance: "observed",
        warning: inningsWarning,
      }),
    },
    {
      id: "top-batter",
      label: "Top batter",
      value: topBatter ? `${topBatter.name} (${topBatter.runs})` : "N/A",
      insight: topBatter
        ? `${topBatter.inning} with ${formatPercentage(topBatter.sharePct)} of the batting runs.`
        : "No batting data available.",
      tone: "good",
      quality: buildMetricQuality({
        sampleSize: topBatter?.balls ?? 0,
        provenance: "observed",
        warning: topBatter ? null : "Batting card data was unavailable.",
      }),
    },
    {
      id: "top-bowler",
      label: "Top bowling spell",
      value: bestBowler ? `${bestBowler.name} (${bestBowler.wickets}/${bestBowler.runsConceded})` : "N/A",
      insight: bestBowler
        ? `${bestBowler.inning}${bestBowler.ballsPerWicket ? `, ${ballsToOvers(Math.round(bestBowler.ballsPerWicket))} balls per wicket.` : "."}`
        : "No bowling data available.",
      tone: "good",
      quality: buildMetricQuality({
        sampleSize: bestBowler ? oversToBalls(bestBowler.overs) : 0,
        provenance: "observed",
        warning: bestBowler ? null : "Bowling card data was unavailable.",
      }),
    },
  ];
}
