import { getMatchCommentary, getMatchScorecard } from "@/lib/cricket-api";
import { forwardInsightsService } from "@/lib/ai-service";
import {
  inferPhase,
  buildConfidence,
  buildFreshness,
  buildMetricQuality,
  dedupeSources,
  clamp,
  round,
  getScheduledOvers,
} from "@/lib/eda/common";
import { buildLiveAnalyticsBundle } from "@/lib/eda/live-analytics";
import { getVenueSnapshot } from "@/lib/eda/historical";
import {
  runProbabilityIndex,
  globalT20Prior,
  type WinProbabilityPrior,
} from "@/lib/eda/win-probability";
import type { Commentary, Match, Score, Scorecard } from "@/types/cricket";
import type { InsightsAdvisorResponse } from "@/types/insights";
import type { LiveEdaReport, LivePressureSnapshot } from "@/types/eda";

export const LIVE_EDA_POLL_INTERVAL_SECONDS = 15;

function liveModelConfidence(priorSampleSize: number, ballsTracked: number, options?: { strict?: boolean }) {
  const evidence = Math.min(Math.max(priorSampleSize, 0), 24) + Math.min(Math.max(ballsTracked, 0), 24);
  const highCut = options?.strict ? 30 : 24;
  const mediumCut = options?.strict ? 16 : 12;

  if (evidence >= highCut) return "high" as const;
  if (evidence >= mediumCut) return "medium" as const;
  return "low" as const;
}

function liveModelWarning(label: string, priorSampleSize: number, ballsTracked: number) {
  if (priorSampleSize < 5 && ballsTracked < 12) {
    return `${label} is leaning on a thin historical prior and limited live ball tracking.`;
  }
  if (priorSampleSize < 5) {
    return `${label} is leaning more on the global T20 prior because venue history is thin.`;
  }
  if (ballsTracked < 12) {
    return `${label} is still early and may move quickly as more live balls are tracked.`;
  }
  return null;
}

function buildReadiness(current: number, required: number, unit: "balls" | "overs", label: string) {
  if (current >= required) return null;
  return {
    label,
    current,
    required,
    unit,
  } as const;
}

function isT20Match(match: Match) {
  return /t20/i.test(match.matchType);
}

function inferMatchGender(match: Match) {
  const haystack = `${match.name} ${match.status} ${match.teams.join(" ")}`.toLowerCase();
  return haystack.includes("women") ? "female" : "male";
}

function inferBattingTeam(score: Score, match: Match, inningsIndex: number) {
  const label = score.inning.toLowerCase();

  for (const team of match.teamInfo) {
    if (label.includes(team.name.toLowerCase()) || label.includes(team.shortname.toLowerCase())) {
      return team.name;
    }
  }

  return match.teams[inningsIndex] || match.teams[0] || score.inning;
}

export function deriveLivePressureSnapshot(match: Match): LivePressureSnapshot {
  const populatedScores = match.score.filter((score) => score.r > 0 || score.w > 0 || score.o > 0);
  const currentScore = populatedScores[populatedScores.length - 1];

  if (!currentScore) {
    throw new Error("This match has not started scoring yet.");
  }

  const scheduledOvers = getScheduledOvers(match.matchType);
  const innings = Math.min(2, populatedScores.length);
  const battingTeam = inferBattingTeam(currentScore, match, innings - 1);
  const bowlingTeam = match.teams.find((team) => team !== battingTeam) || "";
  const target = innings === 2 && populatedScores[0] ? populatedScores[0].r + 1 : null;
  const currentRunRate = currentScore.o > 0 ? round(currentScore.r / currentScore.o, 2) : 0;
  const oversRemaining =
    scheduledOvers !== null ? Math.max(round(scheduledOvers - currentScore.o, 1), 0) : null;
  const requiredRunRate =
    innings === 2 && target && scheduledOvers !== null
      ? round(Math.max(0, target - currentScore.r) / Math.max(scheduledOvers - currentScore.o, 0.1), 2)
      : null;
  const wicketPenalty = innings === 1 ? currentScore.w * 4.5 : currentScore.w * 5;
  const projectedTotal =
    scheduledOvers !== null
      ? clamp(
          round(
            currentScore.r +
              Math.max(0, scheduledOvers - currentScore.o) *
                Math.max(4.2, currentRunRate - wicketPenalty / Math.max(scheduledOvers, 1)),
            0
          ),
          currentScore.r,
          scheduledOvers === 50 ? 450 : scheduledOvers === 20 ? 260 : 180
        )
      : currentScore.r;
  const pressureIndex = clamp(
    innings === 2 && requiredRunRate !== null
      ? 45 +
          (requiredRunRate - currentRunRate) * 8 +
          currentScore.w * 2.5 +
          (oversRemaining !== null && oversRemaining <= 5 ? 6 : 0)
      : scheduledOvers !== null
        ? 30 + currentScore.w * 3 + Math.max(0, currentScore.o - scheduledOvers * 0.7) * 2
        : 25 + currentScore.w * 4,
    0,
    100
  );
  const momentumIndex = clamp(
    innings === 2 && requiredRunRate !== null
      ? 55 + (currentRunRate - requiredRunRate) * 10 - currentScore.w * 1.5
      : scheduledOvers !== null
        ? 50 + (currentRunRate - (scheduledOvers === 50 ? 5.8 : scheduledOvers === 10 ? 9.5 : 8)) * 8 - currentScore.w
        : 50 - currentScore.w,
    0,
    100
  );

  return {
    innings,
    battingTeam,
    bowlingTeam,
    runs: currentScore.r,
    wickets: currentScore.w,
    wicketsInHand: Math.max(0, 10 - currentScore.w),
    overs: currentScore.o,
    target,
    currentRunRate,
    requiredRunRate,
    projectedTotal,
    ballsRemaining: scheduledOvers !== null ? Math.max(scheduledOvers * 6 - Math.round(currentScore.o * 6), 0) : null,
    pressureIndex: round(pressureIndex, 1),
    momentumIndex: round(momentumIndex, 1),
    phase: inferPhase(currentScore.o, match.matchType),
  };
}

async function getAdvisor(match: Match, snapshot: LivePressureSnapshot): Promise<InsightsAdvisorResponse | null> {
  if (!isT20Match(match)) {
    return null;
  }

  try {
    const upstream = await forwardInsightsService("/t20-insights/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runs: snapshot.runs,
        wickets: snapshot.wickets,
        overs: snapshot.overs,
        innings: snapshot.innings,
        target: snapshot.target,
        batting_team: snapshot.battingTeam,
        bowling_team: snapshot.bowlingTeam,
        match_gender: inferMatchGender(match),
        strategy: "balanced",
        top_n: 5,
      }),
    });

    if (!upstream.ok) {
      return null;
    }

    return JSON.parse(upstream.body) as InsightsAdvisorResponse;
  } catch {
    return null;
  }
}

type BuildLiveEdaReportOptions = {
  commentary?: Commentary | null;
  scorecards?: Scorecard[] | null;
  fresh?: boolean;
};

export async function buildLiveEdaReport(
  match: Match,
  options: BuildLiveEdaReportOptions = {}
): Promise<LiveEdaReport> {
  const snapshot = deriveLivePressureSnapshot(match);
  const scheduledOvers = getScheduledOvers(match.matchType);
  const fixedOvers = scheduledOvers ?? 20;
  const [venue, advisor, commentary, scorecards] = await Promise.all([
    getVenueSnapshot(match.venue, match.matchType),
    getAdvisor(match, snapshot),
    options.commentary !== undefined ? Promise.resolve(options.commentary) : getMatchCommentary(match.id, { fresh: options.fresh ?? true }),
    options.scorecards !== undefined ? Promise.resolve(options.scorecards) : getMatchScorecard(match.id, { fresh: options.fresh ?? true }),
  ]);
  const ballsTracked = commentary?.bbb.length ?? 0;
  const legalBallsTracked = commentary?.bbb.filter((ball) => ball.legalBall !== false).length ?? 0;

  // Build win-probability prior from venue warehouse data
  const winPrior: WinProbabilityPrior =
    (venue.chaseSampleSize ?? venue.sampleSize) >= 5
      ? {
          priorWinPct: 52,
          avgTarget: venue.avgFirstInningsScore,
          chaseWinPct: venue.chaseWinPct,
          sampleSize: venue.chaseSampleSize ?? venue.sampleSize,
        }
      : globalT20Prior(venue.chaseWinPct);
  if (venue.avgFirstInningsScore !== null) {
    winPrior.avgTarget = venue.avgFirstInningsScore;
  }
  if (venue.chaseWinPct !== null) {
    winPrior.chaseWinPct = venue.chaseWinPct;
  }
  const analytics = buildLiveAnalyticsBundle({
    match,
    commentaryBalls: commentary?.bbb ?? [],
    scorecards,
    snapshot,
    venue,
    winPrior: winPrior ?? undefined,
  });
  const topTurningBall = analytics.topTurningBalls[0];
  const boundaryPressure = analytics.boundaryPressure;
  const wp = analytics.winProbabilityDetail;
  const winProbabilitySample = wp?.priorSampleSize ?? winPrior.sampleSize;
  const winProbabilityConfidence = liveModelConfidence(winProbabilitySample, ballsTracked);
  const secondaryModelConfidence = liveModelConfidence(winProbabilitySample, ballsTracked, { strict: true });
  const pressureReadiness = buildReadiness(legalBallsTracked, 8, "balls", "Pressure index unlocks once at least 8 legal balls have shaped the innings tempo.");
  const momentumReadiness = buildReadiness(legalBallsTracked, 8, "balls", "Momentum needs at least 8 legal balls so one boundary or dot-ball burst does not dominate the read.");
  const cascadeReadiness = buildReadiness(legalBallsTracked, 12, "balls", "Wicket-cascade risk needs a longer sequence to stabilize dismissal clustering.");
  const boundaryReadiness = buildReadiness(legalBallsTracked, 8, "balls", "Boundary-pressure trends need at least 8 legal balls of tracked scoring.");
  const deathForecastReadiness = buildReadiness(
    legalBallsTracked,
    Math.max(12, Math.round(fixedOvers * 0.6) * 6),
    "balls",
    "Death-over forecasting unlocks deeper into the innings once enough runway has been observed."
  );

  // ── Run-Probability Index (RPI) ───────────────────────────────────────────
  const rpi = runProbabilityIndex(
    {
      innings: snapshot.innings,
      runs: snapshot.runs,
      wickets: snapshot.wickets,
      overs: snapshot.overs,
      scheduledOvers: fixedOvers,
      target: snapshot.target,
      currentRunRate: snapshot.currentRunRate,
      requiredRunRate: snapshot.requiredRunRate,
      recentRunRate: null,
      matchType: match.matchType,
      phase: snapshot.phase,
    },
    venue.avgFirstInningsScore ?? 168
  );

  const cards = [
    // ── Card 1: Bayesian Win Probability ───────────────────────────────────
    {
      id: "win-probability",
      label: "Win probability",
      value: wp ? `${wp.probability}%` : "—",
      subValue: wp ? `${wp.priorSampleSize} prior matches · ${ballsTracked} balls tracked` : undefined,
      insight: wp
        ? `${snapshot.battingTeam} have a ${wp.probability}% chance of winning (Bayesian model, ${wp.priorSampleSize} historical matches anchoring the prior). ` +
          `Resources remaining: ${wp.resourcePct}%, expected ${wp.expectedRunsRemaining} more runs from this position. ` +
          (Object.entries(wp.featureContributions).length > 0
            ? `Key drivers: ${Object.entries(wp.featureContributions)
                .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
                .slice(0, 3)
                .map(([k, v]) => `${k.replace(/_/g, " ")} (${v > 0 ? "+" : ""}${v})`)
                .join("; ")}.`
            : "")
        : "Win probability available once scoring begins.",
      tone: wp
        ? wp.probability >= 65 ? "good" as const
        : wp.probability <= 35 ? "warning" as const
        : "neutral" as const
        : "neutral" as const,
      quality: buildMetricQuality({
        sampleSize: winProbabilitySample,
        provenance: "modeled",
        confidence: winProbabilityConfidence,
        warning: liveModelWarning("Win probability", winProbabilitySample, ballsTracked),
        uncertainty: wp
          ? {
              label: "95% CI",
              lower: wp.ci95[0],
              upper: wp.ci95[1],
              unit: "%",
              decimals: 0,
            }
          : null,
      }),
    },
    // ── Card 2: DLS Resources ───────────────────────────────────────────────
    {
      id: "dls-resources",
      label: "DLS resources remaining",
      value: wp ? `${wp.resourcePct}%` : `${analytics.resourcePct}%`,
      insight:
        `${snapshot.battingTeam} have ${wp?.resourcePct ?? analytics.resourcePct}% of their batting resources left ` +
        `(${Math.max(0, (scheduledOvers ?? 20) - snapshot.overs).toFixed(1)} overs, ${10 - snapshot.wickets} wickets). ` +
        (wp ? `Expected ${wp.expectedRunsRemaining} more runs from this resource state.` : ""),
      tone: (wp?.resourcePct ?? analytics.resourcePct) >= 50 ? "good" as const : "neutral" as const,
      quality: buildMetricQuality({
        sampleSize: 10 - snapshot.wickets,
        provenance: "observed",
      }),
    },
    // ── Card 3: Run-Probability Index ─────────────────────────────────────────
    {
      id: "rpi",
      label: "State advantage index",
      value: pressureReadiness ? "Collecting…" : `${rpi}`,
      insight:
        pressureReadiness
          ? "Collecting enough live data to stabilize the blended state-advantage read."
          : rpi >= 60
            ? `Model-derived state score ${rpi}/100 — ${snapshot.battingTeam} are tracking above par when wickets, resources, and current tempo are blended together.`
            : rpi <= 40
              ? `Model-derived state score ${rpi}/100 — the fielding side holds the balance; a wicket or two could decide this match.`
              : `Model-derived state score ${rpi}/100 — this match is evenly poised; small state changes will swing it decisively.`,
      tone: pressureReadiness ? "neutral" as const : rpi >= 60 ? "good" as const : rpi <= 40 ? "warning" as const : "neutral" as const,
      quality: buildMetricQuality({
        sampleSize: winProbabilitySample,
        provenance: "modeled",
        confidence: secondaryModelConfidence,
        warning: pressureReadiness
          ? "Suppressed until the innings has at least 8 legal balls of tracked state."
          : "Secondary derived state score; use win probability as the primary calibrated model output.",
        suppressed: Boolean(pressureReadiness),
        readiness: pressureReadiness,
      }),
    },
    // ── Card 4: Entropy Momentum ────────────────────────────────────────────────
    {
      id: "entropy-momentum",
      label: "Batting momentum",
      value: momentumReadiness ? "Collecting…" : `${analytics.entropyMomentum}/100`,
      insight:
        momentumReadiness
          ? "Collecting enough live data to stabilize the momentum read."
          : analytics.entropyMomentum >= 60
            ? `Decay-weighted batting momentum is strong (${analytics.entropyMomentum}/100) — recent scoring has been above phase baseline with volatile, boundary-heavy deliveries.`
            : analytics.entropyMomentum <= 40
              ? `Batting momentum is suppressed (${analytics.entropyMomentum}/100) — the bowling side is applying effective control through dot balls and low-value deliveries.`
              : `Batting momentum is neutral (${analytics.entropyMomentum}/100) — neither side has established a clear tempo advantage in the last 4 overs.`,
      tone: momentumReadiness ? "neutral" as const : analytics.entropyMomentum >= 60 ? "good" as const : analytics.entropyMomentum <= 40 ? "warning" as const : "neutral" as const,
      quality: buildMetricQuality({
        sampleSize: Math.min(legalBallsTracked, 24),
        provenance: "modeled",
        confidence: liveModelConfidence(0, legalBallsTracked, { strict: true }),
        warning: momentumReadiness ? "Suppressed until at least 8 legal balls have been tracked." : legalBallsTracked < 12 ? "Momentum is based on fewer than 12 tracked balls." : null,
        suppressed: Boolean(momentumReadiness),
        readiness: momentumReadiness,
      }),
    },
    // ── Card 5: Wicket-Cascade Risk ────────────────────────────────────────────
    {
      id: "cascade-risk",
      label: "Wicket-cascade risk",
      value: cascadeReadiness ? "Collecting…" : `${analytics.wicketCascadeRisk}%`,
      insight:
        cascadeReadiness
          ? "Collecting enough live data to estimate short-window collapse risk."
          : analytics.wicketCascadeRisk >= 40
            ? `${analytics.wicketCascadeRisk}% probability of 2+ wickets in the next 3 overs — historical wicket-cluster patterns and recent dismissal rate suggest a mid-innings collapse is a live risk.`
            : analytics.wicketCascadeRisk <= 15
              ? `Low cascade risk (${analytics.wicketCascadeRisk}%) — scoring is fluid and dismissals have been spread across the innings so far.`
              : `Moderate cascade risk (${analytics.wicketCascadeRisk}%) — the match could pivot quickly if a wicket falls in the next over.`,
      tone: cascadeReadiness ? "neutral" as const : analytics.wicketCascadeRisk >= 40 ? "warning" as const : analytics.wicketCascadeRisk <= 15 ? "good" as const : "neutral" as const,
      quality: buildMetricQuality({
        sampleSize: Math.min(legalBallsTracked, 12),
        provenance: "modeled",
        confidence: liveModelConfidence(0, legalBallsTracked, { strict: true }),
        warning: cascadeReadiness ? "Suppressed until at least 12 legal balls have been tracked." : legalBallsTracked < 12 ? "Collapse risk is based on a very short live window." : null,
        suppressed: Boolean(cascadeReadiness),
        readiness: cascadeReadiness,
      }),
    },
    // ── Card 6: Death-Over Forecast ─────────────────────────────────────────────
    analytics.deathOverForecast !== null
      ? {
          id: "death-forecast",
          label: "Death-over forecast",
          value: deathForecastReadiness ? "Collecting…" : `+${analytics.deathOverForecast.projectedDeathRuns}`,
          insight:
            deathForecastReadiness
              ? "Collecting enough live data to stabilize the long-range death-over projection."
              : `Model projects ${analytics.deathOverForecast.projectedDeathRuns} more runs in the death overs ` +
                `(confidence ${analytics.deathOverForecast.confidence}%), based on ${10 - snapshot.wickets} wickets in hand ` +
                `and recent scoring momentum.`,
          tone: deathForecastReadiness ? "neutral" as const : analytics.deathOverForecast.projectedDeathRuns >= 50 ? "good" as const : "neutral" as const,
          quality: buildMetricQuality({
            sampleSize: Math.min(legalBallsTracked, 18),
            provenance: "modeled",
            confidence:
              snapshot.overs >= fixedOvers * 0.6
                ? liveModelConfidence(0, legalBallsTracked)
                : "low",
            warning:
              deathForecastReadiness
                ? "Suppressed until the innings has enough depth to support a death-over forecast."
                : snapshot.overs < fixedOvers * 0.6
                  ? "Long-range death forecast; confidence improves materially once the innings gets deeper."
                  : legalBallsTracked < 12
                    ? "Death forecast is based on a short recent scoring window."
                    : null,
            suppressed: Boolean(deathForecastReadiness),
            readiness: deathForecastReadiness,
          }),
        }
      : {
          id: "death-forecast",
          label: "Death-over forecast",
          value: "In death overs",
          insight: "Match is currently in the death phase — run tally updates after each delivery.",
          tone: "neutral" as const,
          quality: buildMetricQuality({
            sampleSize: Math.min(ballsTracked, 18),
            provenance: "observed",
          }),
        },
    // ── Legacy cards ─────────────────────────────────────────────────────────────
    {
      id: "current-rate",
      label: "Current run rate",
      value: `${snapshot.currentRunRate}`,
      insight: `${snapshot.battingTeam} are scoring at ${snapshot.currentRunRate} runs per over in the ${snapshot.phase.toLowerCase()}.`,
      tone: snapshot.currentRunRate >= 8 ? "good" as const : "neutral" as const,
      quality: buildMetricQuality({
        sampleSize: Math.max(Math.round(snapshot.overs * 6), 1),
        provenance: "observed",
      }),
    },
    {
      id: "pressure-index",
      label: "Pressure index",
      value: pressureReadiness ? "Collecting…" : `${snapshot.pressureIndex}`,
      insight:
        pressureReadiness
          ? "Collecting enough live data to stabilize the pressure profile."
          : snapshot.pressureIndex >= 65
            ? "The batting side is under strong scoreboard pressure."
            : "The current state is manageable, but one wicket can swing the pressure quickly.",
      tone: pressureReadiness ? "neutral" as const : snapshot.pressureIndex >= 65 ? "warning" as const : "neutral" as const,
      quality: buildMetricQuality({
        sampleSize: Math.max(legalBallsTracked, 1),
        provenance: "modeled",
        confidence: liveModelConfidence(winProbabilitySample, legalBallsTracked, { strict: true }),
        warning: pressureReadiness
          ? "Suppressed until at least 8 legal balls have been tracked."
          : "Derived from current run rate, wickets, and target pressure rather than a separately calibrated classifier.",
        suppressed: Boolean(pressureReadiness),
        readiness: pressureReadiness,
      }),
    },
    {
      id: "projection",
      label:
        scheduledOvers === null
          ? "Current total"
          : snapshot.innings === 1
            ? "Projected total"
            : "Projected finish",
      value: `${snapshot.projectedTotal}`,
      insight:
        scheduledOvers === null
          ? "This format does not have a fixed-overs projection, so the live report stays anchored to the current score state."
          : snapshot.innings === 1
            ? `A simple tempo-plus-wickets projection puts the innings around ${snapshot.projectedTotal}.`
            : `The chase trajectory currently points to roughly ${snapshot.projectedTotal} if the same tempo holds.`,
      tone: "neutral" as const,
      quality: buildMetricQuality({
        sampleSize: Math.max(Math.round(snapshot.overs * 6), 1),
        provenance: "modeled",
        confidence: snapshot.overs >= (scheduledOvers ?? 20) * 0.6 ? "medium" : "low",
        warning:
          scheduledOvers === null
            ? "Projection is intentionally conservative in non fixed-over formats."
            : snapshot.overs < (scheduledOvers ?? 20) * 0.5
              ? "Long-range tempo extrapolation; treat as directional rather than precise."
              : null,
      }),
    },
    {
      id: "required-rate",
      label: "Required run rate",
      value: snapshot.requiredRunRate !== null ? `${snapshot.requiredRunRate}` : "NA",
      insight:
        snapshot.requiredRunRate !== null
          ? `The chase still needs ${snapshot.requiredRunRate} runs per over.`
          : "Required rate applies once a chase is underway.",
      tone:
        snapshot.requiredRunRate !== null && snapshot.requiredRunRate > snapshot.currentRunRate + 1.2
          ? "warning" as const
          : "neutral" as const,
      quality: buildMetricQuality({
        sampleSize: snapshot.ballsRemaining ?? 0,
        provenance: "observed",
      }),
    },
    {
      id: "boundary-pressure",
      label: "Boundary pressure",
      value:
        boundaryReadiness || boundaryPressure === null
          ? "Collecting…"
          : boundaryPressure !== null
          ? `${boundaryPressure.recentBoundaryRate}/ov`
          : "Waiting",
      insight:
        boundaryReadiness || boundaryPressure === null
          ? "Collecting enough live data to stabilize the live boundary trend."
          : boundaryPressure !== null
          ? `${boundaryPressure.recentOversLabel}: ${boundaryPressure.recentFours}x4, ${boundaryPressure.recentSixes}x6. Forecast ${boundaryPressure.forecastBoundaryRate}/ov against a ${boundaryPressure.expectedBoundaryRate}/ov phase baseline.`
          : "Boundary pressure appears once enough tracked ball events are available.",
      tone:
        boundaryReadiness || boundaryPressure === null
          ? "neutral" as const
          : boundaryPressure !== null
          ? boundaryPressure.recentBoundaryRate >= boundaryPressure.expectedBoundaryRate
            ? "good" as const
            : "warning" as const
          : "neutral" as const,
      quality: buildMetricQuality({
        sampleSize: Math.min(legalBallsTracked, 12),
        provenance: "modeled",
        confidence: liveModelConfidence(0, legalBallsTracked, { strict: true }),
        warning:
          boundaryReadiness || boundaryPressure === null
            ? "Suppressed until the innings has enough tracked balls for a stable boundary trend."
            : legalBallsTracked < 12
              ? "Boundary-pressure forecast is based on fewer than 12 tracked balls."
              : null,
        suppressed: boundaryReadiness !== null || boundaryPressure === null,
        readiness: boundaryReadiness,
      }),
    },
    {
      id: "venue-par",
      label: "Venue first-innings par",
      value: venue.avgFirstInningsScore !== null ? `${venue.avgFirstInningsScore}` : "Waiting",
      insight: venue.summary,
      tone: venue.avgFirstInningsScore !== null ? "good" as const : "neutral" as const,
      subValue: venue.avgFirstInningsInterval
        ? `${venue.avgFirstInningsInterval.label} ${venue.avgFirstInningsInterval.lower}–${venue.avgFirstInningsInterval.upper}`
        : undefined,
      quality: buildMetricQuality({
        sampleSize: venue.sampleSize,
        provenance: "historical",
        confidence: venue.confidence,
        warning: venue.warning,
        uncertainty: venue.avgFirstInningsInterval ?? null,
      }),
    },
  ];

  const warnings: string[] = [];
  if (!advisor && isT20Match(match)) {
    warnings.push("The specialist T20 advisor was unavailable, so this live report is using deterministic analytics only.");
  }
  if (!venue.available) {
    warnings.push("Venue benchmark history is limited in the warehouse, so context is based mainly on the live score state.");
  }
  if (scheduledOvers === null) {
    warnings.push("This format does not use a fixed-over pace model, so projections and phase labels are more conservative.");
  }
  if ((commentary?.bbb.length ?? 0) === 0) {
    warnings.push("Ball-by-ball feed is unavailable right now, so advanced live charts are waiting on the SportMonks balls stream.");
  }
  if (!scorecards || scorecards.length === 0) {
    warnings.push("Live scorecards are limited, so batter, bowler, and partnership impact views may be lighter than usual.");
  }

  const reasons = [
    "SportMonks live state is available for the active innings.",
    (commentary?.bbb.length ?? 0) > 0
      ? "Ball-by-ball events were available for the live analytics layer."
      : "Ball-by-ball events were unavailable for the live analytics layer.",
    advisor ? "The specialist T20 advisor responded with player recommendations." : "The specialist T20 advisor was unavailable or not applicable.",
    venue.available ? "Historical venue context was available." : "Historical venue context was limited.",
  ];

  return {
    match,
    snapshot,
    cards,
    summary:
      snapshot.innings === 2 && snapshot.requiredRunRate !== null
        ? `${snapshot.battingTeam} are ${snapshot.runs}/${snapshot.wickets} after ${snapshot.overs} overs, needing ${snapshot.requiredRunRate} per over. The current pressure index is ${snapshot.pressureIndex}${boundaryPressure ? `, with ${boundaryPressure.recentFours} fours and ${boundaryPressure.recentSixes} sixes across ${boundaryPressure.recentOversLabel.toLowerCase()}.` : topTurningBall ? `, and the biggest recent swing came at ${topTurningBall.label}.` : "."}`
        : scheduledOvers !== null
          ? `${snapshot.battingTeam} are ${snapshot.runs}/${snapshot.wickets} after ${snapshot.overs} overs with a projected total of ${snapshot.projectedTotal}. The current pressure index is ${snapshot.pressureIndex}${boundaryPressure ? `, and boundary pressure is running at ${boundaryPressure.recentBoundaryRate}/over with a ${boundaryPressure.forecastBoundaryRate}/over forecast.` : topTurningBall ? `, and the sharpest state change came at ${topTurningBall.label}.` : "."}`
          : `${snapshot.battingTeam} are ${snapshot.runs}/${snapshot.wickets} after ${snapshot.overs} overs. Fixed-over projections are not applied in this format, so the live read leans on wickets, tempo, and venue context.`,
    advisor,
    pollIntervalSeconds: LIVE_EDA_POLL_INTERVAL_SECONDS,
    ballsTracked,
    analytics,
    confidence: buildConfidence(
      45 +
        (advisor ? 20 : 0) +
        (venue.available ? 10 : 0) +
        (match.matchStarted ? 10 : 0) +
        (scheduledOvers !== null ? 10 : 0) +
        ((commentary?.bbb.length ?? 0) > 0 ? 10 : 0),
      reasons
    ),
    freshness: buildFreshness({
      match,
      historicalAvailable: venue.available,
      notes: [
        `Live EDA refreshes every ${LIVE_EDA_POLL_INTERVAL_SECONDS} seconds from the SportMonks score state and commentary feed, then blends in venue benchmarks when available.`,
      ],
    }),
    warnings,
    sources: dedupeSources([
      {
        id: "live-sportmonks",
        type: "sportmonks" as const,
        title: match.name,
        note: "Live scoreboard state came from the SportMonks-backed match route.",
        updatedAt: new Date().toISOString(),
      },
      ...(commentary?.bbb.length
        ? [
            {
              id: "live-balls",
              type: "sportmonks" as const,
              title: "Ball-by-ball live feed",
              note: `${commentary.bbb.length} tracked balls were used for live timelines, turning points, heatmaps, and matchup analysis.`,
            },
          ]
        : []),
      {
        id: "live-venue",
        type: "historical_warehouse" as const,
        title: "Venue live benchmark",
        note: venue.summary,
      },
      ...(advisor
        ? [
            {
              id: "live-advisor",
              type: "application" as const,
              title: "Specialist T20 advisor",
              note: "Live player recommendations were blended into the report for T20 states.",
            },
          ]
        : []),
    ]),
  };
}
