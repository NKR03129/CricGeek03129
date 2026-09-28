/**
 * Scorecard claim matching, shared by the BQS pipeline (`src/lib/scoring.ts`) and the
 * EQS cricket-verification stage (`src/lib/eqs/stages/cricket-verification.ts`).
 *
 * Kept in one place so both scorers agree on what "verified against the scorecard"
 * means, per the spec's rule that specialist systems stay modular and that an LLM is
 * never the authority for cricket statistics.
 */

import type { BattingEntry, BowlingEntry, Scorecard } from "@/types/cricket";

/** Metrics that can be checked directly against a single match scorecard. */
export type ScorecardMetric =
  | "runs"
  | "wickets"
  | "strike_rate"
  | "economy"
  | "overs"
  | "fours"
  | "sixes";

export const SCORECARD_METRICS: ScorecardMetric[] = [
  "runs",
  "wickets",
  "strike_rate",
  "economy",
  "overs",
  "fours",
  "sixes",
];

export function isScorecardMetric(value: unknown): value is ScorecardMetric {
  return typeof value === "string" && SCORECARD_METRICS.includes(value as ScorecardMetric);
}

export interface ScorecardStatClaim {
  player: string;
  metric: ScorecardMetric;
  value: number;
}

export type ScorecardPlayerIndex = {
  batting: BattingEntry[];
  bowling: BowlingEntry[];
};

export function normalisePlayerName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Indexes every player in the scorecards by full name, and additionally by surname
 * when that surname is unambiguous across the match.
 */
export function buildScorecardPlayerIndex(scorecards: Scorecard[]): Map<string, ScorecardPlayerIndex> {
  const index = new Map<string, ScorecardPlayerIndex>();
  const surnameCounts = new Map<string, number>();

  const ensure = (name: string) => {
    const key = normalisePlayerName(name);
    let entry = index.get(key);
    if (!entry) {
      entry = { batting: [], bowling: [] };
      index.set(key, entry);
    }
    return entry;
  };

  for (const scorecard of scorecards) {
    for (const row of scorecard.batting) {
      ensure(row.batsman.name).batting.push(row);
      const surname = normalisePlayerName(row.batsman.name.split(" ").slice(-1).join(" "));
      surnameCounts.set(surname, (surnameCounts.get(surname) ?? 0) + 1);
    }

    for (const row of scorecard.bowling) {
      ensure(row.bowler.name).bowling.push(row);
      const surname = normalisePlayerName(row.bowler.name.split(" ").slice(-1).join(" "));
      surnameCounts.set(surname, (surnameCounts.get(surname) ?? 0) + 1);
    }
  }

  for (const [fullName, value] of [...index.entries()]) {
    const surname = fullName.split(" ").slice(-1).join(" ").trim();
    if (!surname) continue;
    if ((surnameCounts.get(surname) ?? 0) === 1 && !index.has(surname)) {
      index.set(surname, value);
    }
  }

  return index;
}

function matchesClaimValue(actual: number, expected: number, metric: ScorecardMetric) {
  const tolerance =
    metric === "strike_rate" || metric === "economy" ? 0.2 : metric === "overs" ? 0.1 : 0;

  return Math.abs(actual - expected) <= tolerance;
}

/** The scorecard value(s) a claim was compared against, used as stored evidence. */
export function describeScorecardValues(
  claim: ScorecardStatClaim,
  playerData: ScorecardPlayerIndex | undefined,
): number[] {
  if (!playerData) return [];

  switch (claim.metric) {
    case "runs":
      return playerData.batting.map((row) => row.r);
    case "fours":
      return playerData.batting.map((row) => row["4s"]);
    case "sixes":
      return playerData.batting.map((row) => row["6s"]);
    case "strike_rate":
      return playerData.batting.map((row) => Number(row.sr));
    case "wickets":
      return playerData.bowling.map((row) => row.w);
    case "economy":
      return playerData.bowling.map((row) => Number(row.eco));
    case "overs":
      return playerData.bowling.map((row) => row.o);
    default:
      return [];
  }
}

export function claimMatchesScorecard(
  claim: ScorecardStatClaim,
  playerData: ScorecardPlayerIndex | undefined,
): boolean {
  if (!playerData) return false;

  return describeScorecardValues(claim, playerData).some(
    (actual) => Number.isFinite(actual) && matchesClaimValue(actual, claim.value, claim.metric),
  );
}

/**
 * Three-way result so callers can tell "the scorecard disagrees" (contradicted) apart
 * from "the scorecard has nothing on this player" (inconclusive). The spec treats
 * those very differently: only a contradiction should pull a score down.
 */
export type ScorecardVerdict = "supported" | "contradicted" | "inconclusive";

export function verifyClaimAgainstScorecard(
  claim: ScorecardStatClaim,
  index: Map<string, ScorecardPlayerIndex>,
): { verdict: ScorecardVerdict; actualValues: number[] } {
  const playerData = index.get(normalisePlayerName(claim.player));
  const actualValues = describeScorecardValues(claim, playerData).filter((value) =>
    Number.isFinite(value),
  );

  if (!playerData || actualValues.length === 0) {
    return { verdict: "inconclusive", actualValues: [] };
  }

  return {
    verdict: claimMatchesScorecard(claim, playerData) ? "supported" : "contradicted",
    actualValues,
  };
}
