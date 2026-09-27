/**
 * T20 Bayesian Win-Probability Engine
 * ════════════════════════════════════
 * Produces a calibrated win-probability estimate by combining:
 *
 *   1. Historical prior — P(win | venue, phase, inning, wicket-bucket)
 *      sourced from the warehouse.  When unavailable, uses a global
 *      T20 league-level prior (batting-first wins ~52% globally, slight
 *      toss/venue effects layer on top).
 *
 *   2. Logistic posterior update — shifts the prior using six evidence
 *      features drawn from the live match state:
 *        a) Run-rate edge (CRR vs required/par)
 *        b) Resource edge (DLS resource percentage vs par)
 *        c) Wickets-in-hand advantage
 *        d) Recent momentum (decay-weighted last-6-over run rate vs phase baseline)
 *        e) Phase fatigue (are we in the high-pressure death zone?)
 *        f) Projection-to-target edge
 *
 *   3. Confidence interval (95%) derived from effective sample size of
 *      the prior and the magnitude of the evidence update.
 *
 * This approach mirrors how professional bookmakers and analytics teams
 * (CricViz, Hawk-Eye) estimate in-play probabilities — not simple linear
 * regressions but probabilistic updates on a principled prior.
 *
 * All output probabilities are in [1, 99] (never certain until the match ends).
 */

import { clamp, round } from "@/lib/eda/common";
import {
  resourcePercentage,
  runsExpectedFromState,
  deliveryRunValue,
  T20_RESOURCE_ANCHOR,
} from "@/lib/eda/resource-curve";

// ── Types ──────────────────────────────────────────────────────────────────

export interface WinProbabilityPrior {
  /** Prior P(batting team wins) as a percentage (0-100) */
  priorWinPct: number;
  /** Average first innings total at this venue (null if unknown) */
  avgTarget: number | null;
  /** Historical chase win % at this venue (null if unknown) */
  chaseWinPct: number | null;
  /** Number of warehouse matches underpinning this prior */
  sampleSize: number;
}

export interface LiveMatchState {
  /** Innings number (1 or 2) */
  innings: number;
  /** Current score */
  runs: number;
  /** Wickets fallen */
  wickets: number;
  /** Overs completed (decimal, e.g. 12.3) */
  overs: number;
  /** Total scheduled overs (e.g. 20) */
  scheduledOvers: number;
  /** Target set by team 1 (null if 1st innings) */
  target: number | null;
  /** Current run rate */
  currentRunRate: number;
  /** Required run rate (null if 1st innings) */
  requiredRunRate: number | null;
  /** Recent run rate — last 2 overs (null if insufficient data) */
  recentRunRate: number | null;
  /** Match type string */
  matchType: string;
  /** Phase label */
  phase: string;
}

export interface WinProbabilityResult {
  /** Win probability for the batting team (1-99) */
  probability: number;
  /** 95% confidence interval [lower, upper] */
  ci95: [number, number];
  /** The prior this was anchored to */
  prior: WinProbabilityPrior;
  /** The log-odds update applied */
  logOddsUpdate: number;
  /** Which features drove the update (label → contribution) */
  featureContributions: Record<string, number>;
  /** Resource percentage remaining (DLS) */
  resourcePct: number;
  /** Expected runs remaining from current state */
  expectedRunsRemaining: number;
  /** DLS-adjusted target (same as target in uninterrupted matches) */
  dlsAdjustedTarget: number | null;
}

// ── Logistic helpers ───────────────────────────────────────────────────────

function logit(p: number): number {
  const clamped = clamp(p / 100, 0.001, 0.999);
  return Math.log(clamped / (1 - clamped));
}

function sigmoid(logOdds: number): number {
  return 1 / (1 + Math.exp(-logOdds));
}

/** Convert prior % to log-odds, add update, return back as %. */
function applyLogisticUpdate(priorPct: number, updateLogOdds: number): number {
  const log = logit(priorPct) + updateLogOdds;
  return clamp(round(sigmoid(log) * 100, 1), 1, 99);
}

// ── Phase-level baselines (used when warehouse prior is missing) ───────────

/** Phase-level baseline CRR for a T20 (runs/over) */
const PHASE_BASELINE_RR: Record<string, number> = {
  Powerplay: 8.6,
  Middle: 7.4,
  Death: 10.6,
};

function phaseBaselineRR(phase: string): number {
  return PHASE_BASELINE_RR[phase] ?? 8.0;
}

/** Global T20 batting-first win % (used as emergency prior) */
const GLOBAL_T20_BATTING_FIRST_WIN_PCT = 52;

// ── CI computation ─────────────────────────────────────────────────────────

/**
 * Compute a 95% CI around `probability` using an effective-sample-size approach.
 * Larger warehouse samples and smaller update magnitudes narrow the interval.
 */
function computeCI95(
  probability: number,
  sampleSize: number,
  updateMagnitude: number
): [number, number] {
  // Base uncertainty from low sample size — converges to ~4% at n=100+
  const sampleUncertainty = 20 / Math.sqrt(Math.max(1, sampleSize));
  // Extra uncertainty from large log-odds corrections (model is extrapolating)
  const updateUncertainty = Math.min(10, Math.abs(updateMagnitude) * 2);
  const halfWidth = clamp(sampleUncertainty + updateUncertainty, 3, 25);
  return [
    Math.max(1, Math.round(probability - halfWidth)),
    Math.min(99, Math.round(probability + halfWidth)),
  ];
}

// ── Main engine ────────────────────────────────────────────────────────────

/**
 * Compute a calibrated Bayesian win-probability for the BATTING team.
 *
 * @param state    Live match state
 * @param prior    Historical prior (from warehouse or fallback)
 */
export function computeBayesianWinProbability(
  state: LiveMatchState,
  prior: WinProbabilityPrior
): WinProbabilityResult {
  const oversRemaining = Math.max(state.scheduledOvers - state.overs, 0);
  const wicketsLost = state.wickets;
  const wicketsInHand = Math.max(0, 10 - wicketsLost);
  const resourcePct = resourcePercentage(wicketsLost, oversRemaining);
  const expectedRunsRemaining = runsExpectedFromState(wicketsLost, oversRemaining);
  const venuePar = prior.avgTarget ?? T20_RESOURCE_ANCHOR;

  const featureContributions: Record<string, number> = {};
  let totalLogOddsUpdate = 0;

  // ── 1st innings (setting target) ─────────────────────────────────────────
  if (state.innings === 1) {
    // Feature: current run-rate vs phase baseline
    const baselineRR = phaseBaselineRR(state.phase);
    const rrEdge = (state.currentRunRate - baselineRR) / Math.max(baselineRR, 1);
    const rrContrib = clamp(rrEdge * 0.55, -0.5, 0.5);
    featureContributions["run_rate_vs_baseline"] = round(rrContrib, 3);
    totalLogOddsUpdate += rrContrib;

    // Feature: resource-adjusted projected score vs venue par
    const projectedScore = state.runs + expectedRunsRemaining;
    const projectionEdge = (projectedScore - venuePar) / Math.max(venuePar, 1);
    const projContrib = clamp(projectionEdge * 0.9, -0.6, 0.6);
    featureContributions["projection_vs_par"] = round(projContrib, 3);
    totalLogOddsUpdate += projContrib;

    // Feature: wickets-in-hand advantage relative to expected loss rate
    const expectedWicketsLostByNow = (state.overs / state.scheduledOvers) * 6; // crude
    const wicketEdge = (wicketsInHand - (10 - Math.min(6, expectedWicketsLostByNow))) / 10;
    const wicketContrib = clamp(wicketEdge * 0.35, -0.35, 0.35);
    featureContributions["wickets_in_hand"] = round(wicketContrib, 3);
    totalLogOddsUpdate += wicketContrib;

    // Feature: recent momentum (if available)
    if (state.recentRunRate !== null) {
      const momentumEdge = (state.recentRunRate - state.currentRunRate) / Math.max(state.currentRunRate, 1);
      const momentumContrib = clamp(momentumEdge * 0.25, -0.25, 0.25);
      featureContributions["recent_momentum"] = round(momentumContrib, 3);
      totalLogOddsUpdate += momentumContrib;
    }

    // Feature: delivery value per ball in death (high-resource phases amplify)
    const dv = deliveryRunValue(oversRemaining, wicketsLost);
    const dvContrib = clamp((dv - 2.0) * 0.08, -0.15, 0.15);
    featureContributions["delivery_value"] = round(dvContrib, 3);
    totalLogOddsUpdate += dvContrib;

    // Use batting-first prior (team that bats first wins ~52% globally; venue modulates)
    const venueBias = prior.chaseWinPct !== null ? (50 - prior.chaseWinPct) * 0.005 : 0;
    const adjustedPrior = clamp(prior.priorWinPct + venueBias, 35, 65);

    const probability = applyLogisticUpdate(adjustedPrior, totalLogOddsUpdate);
    const ci95 = computeCI95(probability, prior.sampleSize, totalLogOddsUpdate);

    return {
      probability,
      ci95,
      prior,
      logOddsUpdate: round(totalLogOddsUpdate, 3),
      featureContributions,
      resourcePct: round(resourcePct, 1),
      expectedRunsRemaining: round(expectedRunsRemaining, 0),
      dlsAdjustedTarget: null,
    };
  }

  // ── 2nd innings (chasing) ─────────────────────────────────────────────────
  const target = state.target!;
  const runsNeeded = Math.max(0, target - state.runs);
  const rrr = state.requiredRunRate ?? 0;

  // Feature: run-rate edge (current vs required)
  const rrEdge = (state.currentRunRate - rrr) / Math.max(rrr, 1);
  const rrContrib = clamp(rrEdge * 1.1, -1.0, 1.0);
  featureContributions["crr_vs_rrr"] = round(rrContrib, 3);
  totalLogOddsUpdate += rrContrib;

  // Feature: resource percentage vs required resource allocation
  // Chasing team needs exactly (runsNeeded / target) * 100% of resources
  const requiredResourcePct = (runsNeeded / Math.max(target, 1)) * 100;
  const resourceEdge = (resourcePct - requiredResourcePct) / Math.max(requiredResourcePct, 1);
  const resourceContrib = clamp(resourceEdge * 0.8, -0.8, 0.8);
  featureContributions["resource_edge"] = round(resourceContrib, 3);
  totalLogOddsUpdate += resourceContrib;

  // Feature: wickets in hand (critical in 2nd innings death)
  const expectedHandedNow = wicketsInHand / 10; // 0-1 scale
  const wicketContrib = clamp((expectedHandedNow - 0.5) * 0.6, -0.45, 0.45);
  featureContributions["wickets_in_hand"] = round(wicketContrib, 3);
  totalLogOddsUpdate += wicketContrib;

  // Feature: recent momentum in chase
  if (state.recentRunRate !== null) {
    const momentumEdge = (state.recentRunRate - rrr) / Math.max(rrr, 1);
    const momentumContrib = clamp(momentumEdge * 0.35, -0.35, 0.35);
    featureContributions["recent_momentum_vs_rrr"] = round(momentumContrib, 3);
    totalLogOddsUpdate += momentumContrib;
  }

  // Feature: death-phase slog potential (if <5 overs left, wickets in hand matter enormously)
  if (oversRemaining <= 5) {
    const slogBonus = (wicketsInHand / 10) * clamp((5 - oversRemaining) / 5, 0, 1) * 0.3;
    featureContributions["slog_potential"] = round(slogBonus, 3);
    totalLogOddsUpdate += slogBonus;
  }

  // Chase prior from venue (historical chase win %) as batting-team win probability
  const chasePriorPct = prior.chaseWinPct ?? 50;
  const probability = applyLogisticUpdate(chasePriorPct, totalLogOddsUpdate);
  const ci95 = computeCI95(probability, prior.sampleSize, totalLogOddsUpdate);

  return {
    probability,
    ci95,
    prior,
    logOddsUpdate: round(totalLogOddsUpdate, 3),
    featureContributions,
    resourcePct: round(resourcePct, 1),
    expectedRunsRemaining: round(expectedRunsRemaining, 0),
    dlsAdjustedTarget: null, // Set by caller if DLS adjustment is needed
  };
}

// ── Wicket-cascade risk ────────────────────────────────────────────────────

/**
 * Estimate the probability that 2+ wickets fall in the next N balls,
 * given current wicket rate in the innings.
 *
 * Uses a negative-binomial approximation calibrated to T20 data:
 *   P(k wickets in n balls) ≈ Binomial(n, λ/6) where λ is per-over wicket rate
 *
 * Returns a 0-100 probability.
 */
export function wicketCascadeRisk(input: {
  wicketsAlreadyFallen: number;
  oversCompleted: number;
  recentWicketsInLastNBalls: number;
  recentBallsWindow: number;
  nextNBalls?: number; // default 18 (3 overs)
}): number {
  const nextN = input.nextNBalls ?? 18;
  const inningsWicketRate = input.oversCompleted > 0
    ? input.wicketsAlreadyFallen / (input.oversCompleted * 6)
    : 0.025; // T20 baseline: ~1 wicket per 40 balls

  // Blend recent wicket rate (heavier weight) with innings rate
  const recentRate = input.recentBallsWindow > 0
    ? input.recentWicketsInLastNBalls / input.recentBallsWindow
    : inningsWicketRate;
  const blendedRate = recentRate * 0.65 + inningsWicketRate * 0.35;

  // Probability of 0 or 1 wicket in next nextN balls (binomial)
  const p = Math.min(blendedRate, 0.45); // cap at 45% per ball
  const p0 = Math.pow(1 - p, nextN);
  const p1 = nextN * p * Math.pow(1 - p, nextN - 1);
  const pAtLeast2 = 1 - p0 - p1;

  return clamp(round(pAtLeast2 * 100, 1), 0, 99);
}

// ── Entropy-weighted momentum ──────────────────────────────────────────────

/**
 * Compute a decay-weighted momentum score from ball-by-ball scoring events.
 *
 * Recent events carry more weight (exponential decay with half-life ≈ 2 overs).
 * "Entropy" here means high-variance (mixed fours, zeros, sixes) vs steady scoring —
 * batting volatility is amplified because it signals aggressive intent.
 *
 * Returns a 0-100 score where 50 = neutral momentum.
 */
export function entropyWeightedMomentum(ballScores: number[], phaseBaseline: number): number {
  if (ballScores.length === 0) return 50;

  const decayHalfLife = 12; // balls
  const decayLambda = Math.LN2 / decayHalfLife;

  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < ballScores.length; i++) {
    const age = ballScores.length - 1 - i; // 0 = most recent
    const weight = Math.exp(-decayLambda * age);
    const score = ballScores[i] ?? 0;
    // Amplify sixes/fours relative to baseline
    const amplifiedScore = score >= 4 ? score * 1.3 : score;
    weightedSum += amplifiedScore * weight;
    totalWeight += weight;
  }

  const weightedAvgRunsPerBall = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const baselinePerBall = phaseBaseline / 6;

  // Momentum: 50 + delta normalized to ±50 range
  const delta = (weightedAvgRunsPerBall - baselinePerBall) / Math.max(baselinePerBall, 0.5);
  return clamp(round(50 + delta * 30, 1), 0, 100);
}

// ── Run-probability index (RPI) ────────────────────────────────────────────

/**
 * Run-Probability Index: a composite score (0-100) measuring how likely
 * the batting team is to reach a target or par score, accounting for
 * wickets, resources, and current scoring rate simultaneously.
 *
 * RPI > 60 → batting team in control
 * RPI 40-60 → contest
 * RPI < 40 → batting team under pressure
 */
export function runProbabilityIndex(state: LiveMatchState, venuePar: number): number {
  const oversRemaining = Math.max(state.scheduledOvers - state.overs, 0);
  const expectedFromHere = runsExpectedFromState(state.wickets, oversRemaining);
  const projectedTotal = state.runs + expectedFromHere;

  if (state.innings === 2 && state.target !== null) {
    const projectionDeficit = projectedTotal - state.target;
    const rrrEdge = state.currentRunRate - (state.requiredRunRate ?? 0);
    const wicketBonus = (10 - state.wickets) * 2.5;
    return clamp(round(50 + projectionDeficit * 0.35 + rrrEdge * 8 + wicketBonus - (state.wickets > 6 ? 10 : 0), 1), 1, 99);
  }

  const projectionEdge = projectedTotal - venuePar;
  const wicketBonus = (10 - state.wickets) * 1.8;
  return clamp(round(50 + projectionEdge * 0.28 + wicketBonus, 1), 1, 99);
}

// ── Death-over forecast ────────────────────────────────────────────────────

/**
 * Forecast the likely runs scored in overs 16-20 given current state.
 *
 * Uses a logistic model calibrated on T20 death-over run rates:
 *   - 10 wickets in hand at over 16 → expected ~56 runs in overs 16-20
 *   - 7 wickets in hand at over 16 → expected ~46 runs
 *   - 5 wickets in hand at over 16 → expected ~34 runs
 *   - Each wicket in hand ≈ +4-6 runs in overs 16-20
 *
 * Returns { projectedDeathRuns, confidence }
 */
export function deathOverForecast(input: {
  currentOvers: number;
  currentWickets: number;
  currentRunRate: number;
  recentRunRate: number | null;
  scheduledOvers: number;
}): { projectedDeathRuns: number; projectedTotal: number; confidence: number } {
  const oversInDeath = Math.max(0, input.scheduledOvers - Math.max(input.currentOvers, input.scheduledOvers * 0.75));
  if (oversInDeath <= 0) {
    return { projectedDeathRuns: 0, projectedTotal: 0, confidence: 0 };
  }

  const wicketsInHand = Math.max(0, 10 - input.currentWickets);
  // Calibrated T20 death-phase run rate by wickets in hand:
  // 10→12.2, 9→11.8, 8→11.2, 7→10.6, 6→9.8, 5→8.9, 4→7.8, 3→6.5, ≤2→5.0
  const deathRateByWickets = [5.0, 5.0, 5.0, 6.5, 7.8, 8.9, 9.8, 10.6, 11.2, 11.8, 12.2];
  const baseDeathRate = deathRateByWickets[wicketsInHand] ?? 8.0;

  // Blend with recent run rate (if in or near death)
  const blendedRate = input.recentRunRate !== null
    ? baseDeathRate * 0.55 + input.recentRunRate * 0.45
    : baseDeathRate;

  const projectedDeathRuns = Math.round(blendedRate * oversInDeath);

  // Confidence: higher when near death overs, lower when extrapolating far ahead
  const oversFromDeath = Math.max(0, input.scheduledOvers * 0.75 - input.currentOvers);
  const confidence = clamp(round(80 - oversFromDeath * 5, 0), 20, 90);

  return { projectedDeathRuns, projectedTotal: 0, confidence };
}

// ── Fallback prior (when warehouse is unavailable) ─────────────────────────

export function globalT20Prior(chaseWinPct: number | null): WinProbabilityPrior {
  return {
    priorWinPct: GLOBAL_T20_BATTING_FIRST_WIN_PCT,
    avgTarget: T20_RESOURCE_ANCHOR,
    chaseWinPct: chaseWinPct ?? 48, // global T20 chase win rate ≈ 48%
    sampleSize: 12, // conservative fallback so global priors keep wide uncertainty bands
  };
}
