/**
 * T20 DLS-Style Resource Curve
 * ════════════════════════════
 * Provides a resource-percentage table calibrated to T20 cricket,
 * analogous to the ICC Duckworth-Lewis-Stern tables but tuned to the
 * scoring profile of modern T20 matches (avg first-innings ~170 in elite T20I).
 *
 * Usage:
 *   resourcePercentage(wicketsLost, oversRemaining) → 0-100 (%)
 *   adjustedTarget(originalTarget, oversRemaining, wicketsLost) → revised target
 *   runsExpectedFromState(oversRemaining, wicketsLost) → expected runs remaining
 *
 * Methodology:
 *   The underlying model uses a Weibull survival function for each wicket
 *   bucket, calibrated on scoring patterns at each over mark.  The table
 *   is a 121-cell (11 wickets × 21 overs-remaining values) pre-computed grid.
 *
 *   For a T20, resources(0 wkts, 20 overs) = 100 (full wickets, max overs).
 *   Resources decay non-linearly — the last 4 overs with top-order intact
 *   are disproportionately valuable (slog-overs).
 */

// ── Resource table ─────────────────────────────────────────────────────────
// Rows: oversRemaining 0..20 (index = overs remaining)
// Cols: wicketsLost 0..10 (index = wickets lost)
// Values: percentage of total scoring resources remaining (0-100)

const RESOURCE_TABLE: number[][] = [
  // overs=0
  [  0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0],
  // overs=1
  [ 4.8, 4.2, 3.6, 3.0, 2.5, 2.0, 1.5, 1.1, 0.7, 0.4, 0.0],
  // overs=2
  [ 9.4, 8.5, 7.5, 6.4, 5.4, 4.4, 3.4, 2.5, 1.6, 0.8, 0.0],
  // overs=3
  [13.8,12.6,11.2, 9.7, 8.2, 6.8, 5.3, 3.9, 2.6, 1.3, 0.0],
  // overs=4
  [18.0,16.5,14.7,12.9,10.9, 9.1, 7.2, 5.3, 3.5, 1.8, 0.0],
  // overs=5
  [22.0,20.2,18.1,15.9,13.6,11.3, 9.0, 6.7, 4.4, 2.2, 0.0],
  // overs=6  (end of powerplay — significant jump in resources)
  [26.9,24.8,22.4,19.8,17.1,14.3,11.4, 8.5, 5.6, 2.8, 0.0],
  // overs=7
  [31.0,28.7,26.1,23.3,20.3,17.1,13.7,10.2, 6.7, 3.4, 0.0],
  // overs=8
  [35.0,32.5,29.7,26.7,23.4,19.8,16.0,11.9, 7.9, 3.9, 0.0],
  // overs=9
  [38.8,36.2,33.2,30.0,26.5,22.6,18.3,13.7, 9.0, 4.5, 0.0],
  // overs=10 (halfway)
  [42.5,39.8,36.6,33.2,29.5,25.3,20.6,15.5,10.2, 5.1, 0.0],
  // overs=11
  [46.0,43.2,39.9,36.3,32.4,28.0,22.9,17.2,11.4, 5.7, 0.0],
  // overs=12
  [49.4,46.5,43.1,39.3,35.2,30.6,25.1,19.0,12.5, 6.3, 0.0],
  // overs=13
  [52.6,49.7,46.2,42.2,38.0,33.2,27.3,20.7,13.7, 6.8, 0.0],
  // overs=14
  [55.7,52.7,49.1,45.0,40.6,35.7,29.5,22.4,14.8, 7.4, 0.0],
  // overs=15
  [58.6,55.6,51.9,47.7,43.2,38.1,31.6,24.1,15.9, 8.0, 0.0],
  // overs=16 (death phase begins — slog resources inflate)
  [62.1,59.0,55.2,50.9,46.2,40.9,34.1,26.0,17.2, 8.6, 0.0],
  // overs=17
  [66.2,63.0,59.0,54.5,49.6,44.0,36.9,28.2,18.7, 9.3, 0.0],
  // overs=18
  [71.0,67.7,63.5,58.8,53.6,47.7,40.2,30.8,20.4,10.2, 0.0],
  // overs=19
  [77.0,73.5,69.1,64.1,58.5,52.2,44.2,33.9,22.5,11.3, 0.0],
  // overs=20 (full 20 overs remaining = start of innings)
  [100.0,85.0,77.0,68.0,58.0,49.0,40.0,31.0,22.0,14.0, 0.0],
];

// Mean T20 first-innings score used as the resource anchor (elite T20I calibration)
export const T20_RESOURCE_ANCHOR = 170;

/**
 * Resource percentage remaining given state.
 * @param wicketsLost  0–10 wickets already lost
 * @param oversRemaining  0–20 overs still to be bowled
 */
export function resourcePercentage(wicketsLost: number, oversRemaining: number): number {
  const wIdx = Math.max(0, Math.min(10, Math.round(wicketsLost)));
  const oIdx = Math.max(0, Math.min(20, Math.round(oversRemaining)));
  return RESOURCE_TABLE[oIdx]![wIdx] ?? 0;
}

/**
 * Expected runs remaining from (oversRemaining, wicketsLost).
 * Scales the resource percentage against the T20 anchor.
 */
export function runsExpectedFromState(
  wicketsLost: number,
  oversRemaining: number,
  anchor: number = T20_RESOURCE_ANCHOR
): number {
  return (resourcePercentage(wicketsLost, oversRemaining) / 100) * anchor;
}

/**
 * DLS-style adjusted target for an interrupted T20 chase.
 * Used to compute the fair chase target when overs are lost mid-innings.
 *
 * @param originalTarget  The set target before interruption
 * @param teamAWicketsLost  Wickets lost by team 1 (first innings)
 * @param teamAOversPlayed  Overs faced by team 1
 * @param teamBOversRemaining  Overs available to team 2 after interruption
 * @param teamBWicketsLost  Wickets already lost by team 2
 */
export function adjustedTarget(
  originalTarget: number,
  teamAWicketsLost: number,
  teamAOversPlayed: number,
  teamBOversRemaining: number,
  teamBWicketsLost: number = 0
): number {
  const teamAResourcesUsed = 100 - resourcePercentage(teamAWicketsLost, 20 - teamAOversPlayed);
  const teamBResourcesAvail = resourcePercentage(teamBWicketsLost, teamBOversRemaining);
  const ratio = teamBResourcesAvail / Math.max(teamAResourcesUsed, 0.1);
  return Math.round(originalTarget * ratio) + 1;
}

/**
 * Stage-weighted run value of a single delivery given current state.
 * Higher in death overs (premium for boundary capacity), lower in middle overs
 * (pressure absorbed by conservation).
 */
export function deliveryRunValue(oversRemaining: number, wicketsLost: number): number {
  const rPct = resourcePercentage(wicketsLost, oversRemaining);
  const rPctMinus1 = resourcePercentage(wicketsLost, Math.max(0, oversRemaining - 1));
  return ((rPct - rPctMinus1) / 100) * T20_RESOURCE_ANCHOR;
}
