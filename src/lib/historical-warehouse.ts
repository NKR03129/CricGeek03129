import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type HistoricalComparison = "eq" | "gte" | "lte" | "gt" | "lt";
export type HistoricalMetric =
  | "matches"
  | "runs"
  | "wickets"
  | "batting_average"
  | "strike_rate"
  | "economy"
  | "centuries"
  | "fifties"
  | "four_wicket_hauls"
  | "five_wicket_hauls"
  | "head_to_head_wins"
  | "wins_at_venue";
export type HistoricalSubjectType = "player" | "team" | "venue";

export interface HistoricalQueryIntent {
  subjectType: HistoricalSubjectType;
  subject: string;
  metric: HistoricalMetric;
  comparison?: HistoricalComparison | null;
  expectedValue?: number | null;
  matchType?: string | null;
  competition?: string | null;
  opponent?: string | null;
  venue?: string | null;
  team?: string | null;
  since?: string | null;
  until?: string | null;
}

export interface HistoricalWarehouseStatus {
  enabled: boolean;
  available: boolean;
  matchesLoaded: number;
  battingRowsLoaded: number;
  bowlingRowsLoaded: number;
  aliasesLoaded: number;
  error?: string | null;
}

export interface HistoricalEvidenceSource {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  publishedDate?: string | null;
}

export interface HistoricalWarehouseVerdictEntry {
  claim: string;
  query: string;
  category: string;
  verdict: "supported" | "contradicted" | "inconclusive";
  confidence: number;
  evidence: string;
  sources: HistoricalEvidenceSource[];
  route: "historical_structured";
  intent: HistoricalQueryIntent;
}

export interface HistoricalWarehouseClaim {
  claim: string;
  query: string;
  category: string;
  intent: HistoricalQueryIntent;
}

export interface HistoricalFactCheckReport {
  warehouseAvailable: boolean;
  warehouseError?: string | null;
  claimsDetected: number;
  claimsRouted: number;
  claimsResolved: number;
  supported: number;
  contradicted: number;
  inconclusive: number;
  score: number;
  summary: string;
  verdicts: HistoricalWarehouseVerdictEntry[];
  fallbackClaims: HistoricalWarehouseClaim[];
}

type AggregateResult = {
  value: number | null;
  sampleSize: number;
  summary: string;
};

type CricsheetMatch = {
  info?: {
    dates?: string[];
    season?: string | number;
    match_type?: string;
    event?: { name?: string };
    venue?: string;
    city?: string;
    teams?: string[];
    outcome?: {
      winner?: string;
      by?: {
        runs?: number;
        wickets?: number;
        innings?: number;
      };
      result?: string;
    };
    player_of_match?: string[];
    registry?: {
      people?: Record<string, string>;
    };
  };
  innings?: Array<{
    team?: string;
    overs?: Array<{
      over?: number;
      deliveries?: Array<{
        batter?: string;
        bowler?: string;
        non_striker?: string;
        runs?: {
          batter?: number;
          extras?: number;
          total?: number;
        };
        extras?: {
          byes?: number;
          legbyes?: number;
          noballs?: number;
          wides?: number;
          penalty?: number;
        };
        wickets?: Array<{
          kind?: string;
          player_out?: string;
        }>;
      }>;
    }>;
  }>;
};

type HistoricalImportBundle = {
  match: Prisma.HistoricalMatchUncheckedCreateInput;
  battingRows: Prisma.HistoricalBattingInningsUncheckedCreateInput[];
  bowlingRows: Prisma.HistoricalBowlingInningsUncheckedCreateInput[];
  aliases: Prisma.HistoricalPlayerAliasUncheckedCreateInput[];
};

const DEFAULT_SUMMARY = "No structured historical evidence was available for this claim.";
const FLOAT_TOLERANCE_BY_METRIC: Partial<Record<HistoricalMetric, number>> = {
  batting_average: 0.25,
  strike_rate: 0.25,
  economy: 0.2,
};
const WICKET_KINDS = new Set([
  "bowled",
  "caught",
  "caught and bowled",
  "lbw",
  "stumped",
  "hit wicket",
]);
const NON_DISMISSAL_KINDS = new Set(["retired hurt"]);
const SUPPORTED_MATCH_TYPES = new Set(["test", "odi", "t20", "it20", "mdm", "odm"]);

let cachedStatus: HistoricalWarehouseStatus | null = null;

export function normaliseKey(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function roundMetric(metric: HistoricalMetric, value: number): number {
  if (metric === "batting_average" || metric === "strike_rate" || metric === "economy") {
    return Math.round(value * 100) / 100;
  }

  return Math.round(value);
}

function clampUnit(value: number, fallback = 0.5): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function clampScore(value: number, fallback = 75): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function formatMetricLabel(metric: HistoricalMetric): string {
  return metric.replace(/_/g, " ");
}

function parseOptionalDate(value?: string | null) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function buildHistoricalMatchWhere(intent: HistoricalQueryIntent): Prisma.HistoricalMatchWhereInput {
  const where: Prisma.HistoricalMatchWhereInput = {};
  const dateFilters: Prisma.DateTimeFilter = {};

  const since = parseOptionalDate(intent.since);
  if (since) dateFilters.gte = since;
  const until = parseOptionalDate(intent.until);
  if (until) dateFilters.lte = until;
  if (Object.keys(dateFilters).length > 0) where.startedAt = dateFilters;

  const matchType = normaliseKey(intent.matchType);
  if (matchType && matchType !== "all") {
    if (SUPPORTED_MATCH_TYPES.has(matchType)) {
      where.matchType = { equals: matchType.toUpperCase() };
    } else {
      where.eventNameKey = { contains: matchType };
    }
  }

  const competition = normaliseKey(intent.competition);
  if (competition) {
    where.eventNameKey = { contains: competition };
  }

  const venue = normaliseKey(intent.venue);
  if (venue) {
    where.venueKey = { contains: venue };
  }

  return where;
}

async function resolvePlayerKeys(subject: string): Promise<string[]> {
  const subjectKey = normaliseKey(subject);
  if (!subjectKey) return [];

  try {
    const aliases = await prisma.historicalPlayerAlias.findMany({
      where: {
        OR: [
          { aliasNameKey: subjectKey },
          { aliasNameKey: { contains: subjectKey } },
        ],
      },
      select: {
        playerKey: true,
      },
      take: 8,
    });

    const unique = [...new Set(aliases.map((alias) => alias.playerKey).filter(Boolean))];
    return unique;
  } catch {
    return [];
  }
}

function isComparisonTrue(
  actualValue: number,
  comparison: HistoricalComparison | null | undefined,
  expectedValue: number | null | undefined,
  metric: HistoricalMetric
) {
  if (!comparison || typeof expectedValue !== "number" || Number.isNaN(expectedValue)) {
    return null;
  }

  const tolerance = FLOAT_TOLERANCE_BY_METRIC[metric] ?? 0;

  if (comparison === "eq") {
    return Math.abs(actualValue - expectedValue) <= tolerance;
  }

  if (comparison === "gte") {
    return actualValue + tolerance >= expectedValue;
  }

  if (comparison === "lte") {
    return actualValue - tolerance <= expectedValue;
  }

  if (comparison === "gt") {
    return actualValue > expectedValue;
  }

  return actualValue < expectedValue;
}

function confidenceFromSample(sampleSize: number, contradicted: boolean) {
  const base = sampleSize >= 20 ? 0.9 : sampleSize >= 8 ? 0.78 : sampleSize >= 3 ? 0.68 : 0.55;
  return clampUnit(contradicted ? Math.max(base, 0.7) : base);
}

function sourceForHistoricalSummary(intent: HistoricalQueryIntent, summary: string): HistoricalEvidenceSource {
  return {
    title: `Structured cricket history check: ${intent.subject}`,
    url: "",
    snippet: summary,
    domain: "historical-warehouse",
    publishedDate: null,
  };
}

export async function getHistoricalWarehouseStatus(force = false): Promise<HistoricalWarehouseStatus> {
  if (!force && cachedStatus) return cachedStatus;

  if (process.env.FACT_CHECK_HISTORICAL_ENABLED === "false") {
    cachedStatus = {
      enabled: false,
      available: false,
      matchesLoaded: 0,
      battingRowsLoaded: 0,
      bowlingRowsLoaded: 0,
      aliasesLoaded: 0,
      error: "Historical warehouse is disabled by FACT_CHECK_HISTORICAL_ENABLED=false.",
    };
    return cachedStatus;
  }

  try {
    const [matchesLoaded, battingRowsLoaded, bowlingRowsLoaded, aliasesLoaded] = await Promise.all([
      prisma.historicalMatch.count(),
      prisma.historicalBattingInnings.count(),
      prisma.historicalBowlingInnings.count(),
      prisma.historicalPlayerAlias.count(),
    ]);

    cachedStatus = {
      enabled: true,
      available: matchesLoaded > 0,
      matchesLoaded,
      battingRowsLoaded,
      bowlingRowsLoaded,
      aliasesLoaded,
      error: matchesLoaded > 0 ? null : "Historical warehouse tables exist but no historical matches have been imported yet.",
    };
    return cachedStatus;
  } catch (error) {
    cachedStatus = {
      enabled: true,
      available: false,
      matchesLoaded: 0,
      battingRowsLoaded: 0,
      bowlingRowsLoaded: 0,
      aliasesLoaded: 0,
      error:
        error instanceof Error
          ? `Historical warehouse is unavailable: ${error.message}`
          : "Historical warehouse is unavailable.",
    };
    return cachedStatus;
  }
}

export function isHistoricalIntentSupported(intent: HistoricalQueryIntent | null | undefined): intent is HistoricalQueryIntent {
  if (!intent) return false;
  if (!intent.subject || !intent.metric || !intent.subjectType) return false;
  return (
    intent.subjectType === "player" ||
    intent.subjectType === "team" ||
    intent.subjectType === "venue"
  );
}

async function runPlayerAggregate(intent: HistoricalQueryIntent): Promise<AggregateResult | null> {
  const playerKeys = await resolvePlayerKeys(intent.subject);
  const playerNameKey = normaliseKey(intent.subject);
  const matchWhere = buildHistoricalMatchWhere(intent);
  const teamKey = normaliseKey(intent.team);

  const battingWhere: Prisma.HistoricalBattingInningsWhereInput = {
    OR: [
      ...(playerKeys.length > 0 ? [{ playerKey: { in: playerKeys } }] : []),
      { playerNameKey },
    ],
    ...(teamKey ? { inningsTeamKey: teamKey } : {}),
    historicalMatch: matchWhere,
  };

  const bowlingWhere: Prisma.HistoricalBowlingInningsWhereInput = {
    OR: [
      ...(playerKeys.length > 0 ? [{ playerKey: { in: playerKeys } }] : []),
      { playerNameKey },
    ],
    ...(teamKey ? { inningsTeamKey: teamKey } : {}),
    historicalMatch: matchWhere,
  };

  if (intent.metric === "runs") {
    const aggregate = await prisma.historicalBattingInnings.aggregate({
      where: battingWhere,
      _sum: { runs: true },
      _count: { _all: true },
    });

    return {
      value: aggregate._sum.runs ?? 0,
      sampleSize: aggregate._count._all,
      summary: `${intent.subject} has ${aggregate._sum.runs ?? 0} runs across ${aggregate._count._all} innings in the structured history warehouse.`,
    };
  }

  if (intent.metric === "matches") {
    const battingMatches = await prisma.historicalBattingInnings.findMany({
      where: battingWhere,
      select: { matchId: true },
      distinct: ["matchId"],
    });
    const bowlingMatches = await prisma.historicalBowlingInnings.findMany({
      where: bowlingWhere,
      select: { matchId: true },
      distinct: ["matchId"],
    });
    const matchIds = new Set([...battingMatches, ...bowlingMatches].map((row) => row.matchId));

    return {
      value: matchIds.size,
      sampleSize: matchIds.size,
      summary: `${intent.subject} appears in ${matchIds.size} distinct matches in the structured history warehouse.`,
    };
  }

  if (intent.metric === "wickets") {
    const aggregate = await prisma.historicalBowlingInnings.aggregate({
      where: bowlingWhere,
      _sum: { wickets: true },
      _count: { _all: true },
    });

    return {
      value: aggregate._sum.wickets ?? 0,
      sampleSize: aggregate._count._all,
      summary: `${intent.subject} has ${aggregate._sum.wickets ?? 0} wickets across ${aggregate._count._all} bowling innings in the structured history warehouse.`,
    };
  }

  if (intent.metric === "strike_rate") {
    const aggregate = await prisma.historicalBattingInnings.aggregate({
      where: battingWhere,
      _sum: { runs: true, balls: true },
      _count: { _all: true },
    });
    const balls = aggregate._sum.balls ?? 0;
    const value = balls > 0 ? ((aggregate._sum.runs ?? 0) * 100) / balls : null;

    return {
      value,
      sampleSize: aggregate._count._all,
      summary:
        value === null
          ? DEFAULT_SUMMARY
          : `${intent.subject} has a strike rate of ${roundMetric(intent.metric, value)} across ${aggregate._count._all} innings in the structured history warehouse.`,
    };
  }

  if (intent.metric === "batting_average") {
    const innings = await prisma.historicalBattingInnings.findMany({
      where: battingWhere,
      select: { runs: true, notOut: true },
    });
    const runs = innings.reduce((sum, row) => sum + row.runs, 0);
    const dismissals = innings.reduce((sum, row) => sum + (row.notOut ? 0 : 1), 0);
    const value = dismissals > 0 ? runs / dismissals : null;

    return {
      value,
      sampleSize: innings.length,
      summary:
        value === null
          ? DEFAULT_SUMMARY
          : `${intent.subject} has a batting average of ${roundMetric(intent.metric, value)} across ${innings.length} innings in the structured history warehouse.`,
    };
  }

  if (intent.metric === "economy") {
    const aggregate = await prisma.historicalBowlingInnings.aggregate({
      where: bowlingWhere,
      _sum: { runsConceded: true, overs: true },
      _count: { _all: true },
    });
    const overs = aggregate._sum.overs ?? 0;
    const value = overs > 0 ? (aggregate._sum.runsConceded ?? 0) / overs : null;

    return {
      value,
      sampleSize: aggregate._count._all,
      summary:
        value === null
          ? DEFAULT_SUMMARY
          : `${intent.subject} has an economy rate of ${roundMetric(intent.metric, value)} across ${aggregate._count._all} bowling innings in the structured history warehouse.`,
    };
  }

  if (intent.metric === "centuries" || intent.metric === "fifties") {
    const thresholdWhere: Prisma.HistoricalBattingInningsWhereInput = {
      ...battingWhere,
      runs: intent.metric === "centuries" ? { gte: 100 } : { gte: 50, lt: 100 },
    };
    const count = await prisma.historicalBattingInnings.count({ where: thresholdWhere });

    return {
      value: count,
      sampleSize: count,
      summary: `${intent.subject} has ${count} ${formatMetricLabel(intent.metric)} recorded in the structured history warehouse.`,
    };
  }

  if (intent.metric === "four_wicket_hauls" || intent.metric === "five_wicket_hauls") {
    const thresholdWhere: Prisma.HistoricalBowlingInningsWhereInput = {
      ...bowlingWhere,
      wickets: intent.metric === "five_wicket_hauls" ? { gte: 5 } : { gte: 4, lt: 5 },
    };
    const count = await prisma.historicalBowlingInnings.count({ where: thresholdWhere });

    return {
      value: count,
      sampleSize: count,
      summary: `${intent.subject} has ${count} ${formatMetricLabel(intent.metric)} recorded in the structured history warehouse.`,
    };
  }

  return null;
}

async function runTeamAggregate(intent: HistoricalQueryIntent): Promise<AggregateResult | null> {
  const teamKey = normaliseKey(intent.subject);
  const opponentKey = normaliseKey(intent.opponent);
  const venueKey = normaliseKey(intent.venue);
  const baseMatchWhere = buildHistoricalMatchWhere(intent);

  if (intent.metric === "head_to_head_wins" && opponentKey) {
    const matchupWhere: Prisma.HistoricalMatchWhereInput = {
      ...baseMatchWhere,
      OR: [
        { teamAKey: teamKey, teamBKey: opponentKey },
        { teamAKey: opponentKey, teamBKey: teamKey },
      ],
    };
    const [wins, total] = await Promise.all([
      prisma.historicalMatch.count({
        where: {
          ...matchupWhere,
          winnerKey: teamKey,
        },
      }),
      prisma.historicalMatch.count({ where: matchupWhere }),
    ]);

    return {
      value: wins,
      sampleSize: total,
      summary: `${intent.subject} has ${wins} wins against ${intent.opponent} across ${total} structured historical matches.`,
    };
  }

  if (intent.metric === "wins_at_venue" && venueKey) {
    const venueWhere: Prisma.HistoricalMatchWhereInput = {
      ...baseMatchWhere,
      venueKey: { contains: venueKey },
      OR: [
        { teamAKey: teamKey },
        { teamBKey: teamKey },
      ],
    };
    const [wins, total] = await Promise.all([
      prisma.historicalMatch.count({
        where: {
          ...venueWhere,
          winnerKey: teamKey,
        },
      }),
      prisma.historicalMatch.count({ where: venueWhere }),
    ]);

    return {
      value: wins,
      sampleSize: total,
      summary: `${intent.subject} has ${wins} wins at ${intent.venue} across ${total} structured historical matches.`,
    };
  }

  return null;
}

async function executeHistoricalIntent(intent: HistoricalQueryIntent): Promise<AggregateResult | null> {
  if (intent.subjectType === "player") {
    return runPlayerAggregate(intent);
  }

  if (intent.subjectType === "team") {
    return runTeamAggregate(intent);
  }

  return null;
}

function buildHistoricalScore(
  supported: number,
  contradicted: number,
  inconclusive: number
) {
  const total = supported + contradicted + inconclusive;
  if (total === 0) return 75;

  const resolved = supported + contradicted;
  if (resolved === 0) return 75;

  const base = (supported / resolved) * 100;
  const contradictionPenalty = (contradicted / total) * 24;
  const coverageBonus = (resolved / total) * 8;

  return clampScore(base - contradictionPenalty + coverageBonus, 75);
}

export async function runHistoricalWarehouseCheck(
  claims: HistoricalWarehouseClaim[]
): Promise<HistoricalFactCheckReport> {
  const status = await getHistoricalWarehouseStatus();

  if (!status.available) {
    return {
      warehouseAvailable: false,
      warehouseError: status.error ?? null,
      claimsDetected: claims.length,
      claimsRouted: claims.length,
      claimsResolved: 0,
      supported: 0,
      contradicted: 0,
      inconclusive: 0,
      score: 75,
      summary:
        claims.length > 0
          ? "Historical structured verification is unavailable, so these claims should fall back to web search."
          : "No structured historical claims were routed to the warehouse.",
      verdicts: [],
      fallbackClaims: claims,
    };
  }

  const verdicts: HistoricalWarehouseVerdictEntry[] = [];
  const fallbackClaims: HistoricalWarehouseClaim[] = [];

  for (const claim of claims) {
    try {
      const aggregate = await executeHistoricalIntent(claim.intent);

      if (!aggregate || aggregate.value === null || aggregate.sampleSize === 0) {
        fallbackClaims.push(claim);
        continue;
      }

      const roundedValue = roundMetric(claim.intent.metric, aggregate.value);
      const comparisonResult = isComparisonTrue(
        roundedValue,
        claim.intent.comparison,
        claim.intent.expectedValue,
        claim.intent.metric
      );

      if (comparisonResult === null) {
        fallbackClaims.push(claim);
        continue;
      }

      const contradicted = !comparisonResult;
      verdicts.push({
        claim: claim.claim,
        query: claim.query,
        category: claim.category,
        verdict: contradicted ? "contradicted" : "supported",
        confidence: confidenceFromSample(aggregate.sampleSize, contradicted),
        evidence: aggregate.summary,
        sources: [sourceForHistoricalSummary(claim.intent, aggregate.summary)],
        route: "historical_structured",
        intent: claim.intent,
      });
    } catch {
      fallbackClaims.push(claim);
    }
  }

  const supported = verdicts.filter((entry) => entry.verdict === "supported").length;
  const contradicted = verdicts.filter((entry) => entry.verdict === "contradicted").length;
  const inconclusive = verdicts.filter((entry) => entry.verdict === "inconclusive").length;

  return {
    warehouseAvailable: true,
    warehouseError: null,
    claimsDetected: claims.length,
    claimsRouted: claims.length,
    claimsResolved: verdicts.length,
    supported,
    contradicted,
    inconclusive,
    score: buildHistoricalScore(supported, contradicted, inconclusive),
    summary:
      verdicts.length > 0
        ? `${verdicts.length} structured historical claims were checked against the local cricket warehouse.`
        : claims.length > 0
          ? "Structured historical claims were detected, but the warehouse could not resolve them confidently."
          : "No structured historical claims were routed to the warehouse.",
    verdicts,
    fallbackClaims,
  };
}

function inningsOpponent(teams: string[], battingTeam: string) {
  const opponent = teams.find((team) => team !== battingTeam);
  return opponent || null;
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function makePlayerKey(name: string, registry: Record<string, string>) {
  return registry[name] || normaliseKey(name);
}

export function buildHistoricalImportBundleFromCricsheet(
  sourceMatchId: string,
  payload: CricsheetMatch
): HistoricalImportBundle | null {
  const info = payload.info;
  if (!info?.teams || info.teams.length < 2) return null;

  const registry = info.registry?.people || {};
  const startedAt = parseOptionalDate(info.dates?.[0]);
  const teamA = info.teams[0];
  const teamB = info.teams[1];
  const outcomeBy = info.outcome?.by
    ? info.outcome.by.runs
      ? `${info.outcome.by.runs} runs`
      : info.outcome.by.wickets
        ? `${info.outcome.by.wickets} wickets`
        : info.outcome.by.innings
          ? `${info.outcome.by.innings} innings`
          : null
    : null;

  const matchId = createHash("sha1").update(sourceMatchId).digest("hex").slice(0, 30);
  const battingRows: Prisma.HistoricalBattingInningsUncheckedCreateInput[] = [];
  const bowlingRows: Prisma.HistoricalBowlingInningsUncheckedCreateInput[] = [];
  const aliases = new Map<string, Prisma.HistoricalPlayerAliasUncheckedCreateInput>();

  for (const [aliasName, key] of Object.entries(registry)) {
    aliases.set(`${key}:${normaliseKey(aliasName)}`, {
      playerKey: key || normaliseKey(aliasName),
      aliasName,
      aliasNameKey: normaliseKey(aliasName),
      source: "cricsheet",
    });
  }

  for (const [inningsIndex, innings] of (payload.innings || []).entries()) {
    const battingTeam = innings.team || "";
    if (!battingTeam) continue;
    const opponent = inningsOpponent(info.teams, battingTeam);
    const battingTeamKey = normaliseKey(battingTeam);
    const opponentKey = normaliseKey(opponent);
    const batting = new Map<
      string,
      {
        playerName: string;
        playerKey: string;
        runs: number;
        balls: number;
        fours: number;
        sixes: number;
        dismissalKind?: string | null;
        notOut: boolean;
      }
    >();
    const bowling = new Map<
      string,
      {
        playerName: string;
        playerKey: string;
        balls: number;
        maidens: number;
        runsConceded: number;
        wickets: number;
        dotBalls: number;
      }
    >();
    const overRuns = new Map<string, Map<number, number>>();

    for (const over of innings.overs || []) {
      const overNumber = safeNumber(over.over);

      for (const delivery of over.deliveries || []) {
        const batterName = delivery.batter || "";
        const bowlerName = delivery.bowler || "";
        const batterKey = makePlayerKey(batterName, registry);
        const bowlerKey = makePlayerKey(bowlerName, registry);
        const batterRuns = safeNumber(delivery.runs?.batter);
        const totalRuns = safeNumber(delivery.runs?.total);
        const wides = safeNumber(delivery.extras?.wides);
        const noBalls = safeNumber(delivery.extras?.noballs);
        const byes = safeNumber(delivery.extras?.byes);
        const legByes = safeNumber(delivery.extras?.legbyes);
        const legalBall = wides === 0 && noBalls === 0;
        const batterBallFaced = wides === 0;
        const bowlerRuns = batterRuns + wides + noBalls;

        if (batterName) {
          const current =
            batting.get(batterName) || {
              playerName: batterName,
              playerKey: batterKey,
              runs: 0,
              balls: 0,
              fours: 0,
              sixes: 0,
              dismissalKind: null,
              notOut: true,
            };
          current.runs += batterRuns;
          if (batterBallFaced) current.balls += 1;
          if (batterRuns === 4) current.fours += 1;
          if (batterRuns === 6) current.sixes += 1;
          batting.set(batterName, current);
        }

        if (bowlerName) {
          const current =
            bowling.get(bowlerName) || {
              playerName: bowlerName,
              playerKey: bowlerKey,
              balls: 0,
              maidens: 0,
              runsConceded: 0,
              wickets: 0,
              dotBalls: 0,
            };
          if (legalBall) current.balls += 1;
          current.runsConceded += bowlerRuns;
          if (totalRuns === 0 && legalBall && byes === 0 && legByes === 0) current.dotBalls += 1;
          bowling.set(bowlerName, current);

          const bowlerOvers = overRuns.get(bowlerName) || new Map<number, number>();
          bowlerOvers.set(overNumber, (bowlerOvers.get(overNumber) ?? 0) + bowlerRuns);
          overRuns.set(bowlerName, bowlerOvers);
        }

        for (const wicket of delivery.wickets || []) {
          const playerOut = wicket.player_out || "";
          if (!playerOut) continue;
          const current =
            batting.get(playerOut) || {
              playerName: playerOut,
              playerKey: makePlayerKey(playerOut, registry),
              runs: 0,
              balls: 0,
              fours: 0,
              sixes: 0,
              dismissalKind: null,
              notOut: true,
            };
          const kind = (wicket.kind || "").toLowerCase();
          current.dismissalKind = kind || null;
          current.notOut = NON_DISMISSAL_KINDS.has(kind) ? true : false;
          batting.set(playerOut, current);

          if (WICKET_KINDS.has(kind) && bowlerName) {
            const bowler = bowling.get(bowlerName);
            if (bowler) {
              bowler.wickets += 1;
              bowling.set(bowlerName, bowler);
            }
          }
        }
      }
    }

    for (const [bowlerName, overMap] of overRuns.entries()) {
      const bowler = bowling.get(bowlerName);
      if (!bowler) continue;
      bowler.maidens = [...overMap.values()].filter((value) => value === 0).length;
      bowling.set(bowlerName, bowler);
    }

    for (const row of batting.values()) {
      battingRows.push({
        matchId,
        inningsNumber: inningsIndex + 1,
        inningsTeam: battingTeam,
        inningsTeamKey: battingTeamKey,
        oppositionTeam: opponent || undefined,
        oppositionTeamKey: opponentKey || undefined,
        playerName: row.playerName,
        playerNameKey: normaliseKey(row.playerName),
        playerKey: row.playerKey,
        runs: row.runs,
        balls: row.balls,
        fours: row.fours,
        sixes: row.sixes,
        strikeRate: row.balls > 0 ? Math.round((row.runs * 10000) / row.balls) / 100 : 0,
        dismissalKind: row.dismissalKind || undefined,
        notOut: row.notOut,
      });
      aliases.set(`${row.playerKey}:${normaliseKey(row.playerName)}`, {
        playerKey: row.playerKey,
        aliasName: row.playerName,
        aliasNameKey: normaliseKey(row.playerName),
        source: "cricsheet",
      });
    }

    for (const row of bowling.values()) {
      bowlingRows.push({
        matchId,
        inningsNumber: inningsIndex + 1,
        inningsTeam: battingTeam,
        inningsTeamKey: battingTeamKey,
        oppositionTeam: opponent || undefined,
        oppositionTeamKey: opponentKey || undefined,
        playerName: row.playerName,
        playerNameKey: normaliseKey(row.playerName),
        playerKey: row.playerKey,
        overs: row.balls / 6,
        maidens: row.maidens,
        runsConceded: row.runsConceded,
        wickets: row.wickets,
        economy: row.balls > 0 ? Math.round(((row.runsConceded * 6) / row.balls) * 100) / 100 : 0,
        dotBalls: row.dotBalls,
      });
      aliases.set(`${row.playerKey}:${normaliseKey(row.playerName)}`, {
        playerKey: row.playerKey,
        aliasName: row.playerName,
        aliasNameKey: normaliseKey(row.playerName),
        source: "cricsheet",
      });
    }
  }

  return {
    match: {
      id: matchId,
      source: "cricsheet",
      sourceMatchId,
      startedAt,
      season: typeof info.season === "string" ? info.season : typeof info.season === "number" ? String(info.season) : undefined,
      matchType: info.match_type?.toUpperCase(),
      eventName: info.event?.name,
      eventNameKey: normaliseKey(info.event?.name),
      venue: info.venue,
      venueKey: normaliseKey(info.venue),
      city: info.city,
      teamA,
      teamAKey: normaliseKey(teamA),
      teamB,
      teamBKey: normaliseKey(teamB),
      winner: info.outcome?.winner,
      winnerKey: normaliseKey(info.outcome?.winner),
      resultText: info.outcome?.result || outcomeBy || undefined,
      playerOfMatch: info.player_of_match?.[0],
      rawInfo: info as Prisma.InputJsonValue,
    },
    battingRows,
    bowlingRows,
    aliases: [...aliases.values()],
  };
}

// ── SportMonks Import ─────────────────────────────────────────────────

/**
 * Raw SportMonks fixture shape (subset we care about for warehouse import).
 * Matches the SMFixture type in sportmonks.ts without creating a circular import.
 */
export type SMFixtureForImport = {
  id: number;
  starting_at?: string | null;
  type?: string | null;
  status?: string | null;
  winner_team_id?: number | null;
  man_of_match_id?: number | null;
  note?: string | null;
  localteam?: { id: number; name: string; code?: string } | null;
  visitorteam?: { id: number; name: string; code?: string } | null;
  league?: { id: number; name: string } | null;
  venue?: { id: number; name: string; city?: string | null } | null;
  season?: { id: number; name?: string | null } | null;
  runs?: Array<{
    id: number;
    fixture_id: number;
    team_id: number;
    inning: number;
    score: number | null;
    wickets: number | null;
    overs: number | null;
  }> | null;
  batting?: Array<Record<string, unknown>> | null;
  bowling?: Array<Record<string, unknown>> | null;
  lineup?: Array<Record<string, unknown>> | null;
  manofmatch?: { id: number; fullname?: string; firstname?: string; lastname?: string } | null;
};

function safeStr(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Build a player name index from the SportMonks lineup array.
 * Returns a Map<playerId, fullName>.
 */
function buildSmPlayerIndex(lineup: Array<Record<string, unknown>>): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of lineup) {
    const id = String(entry.id ?? "");
    const fullname =
      safeStr(entry.fullname) ||
      [safeStr(entry.firstname), safeStr(entry.lastname)].filter(Boolean).join(" ");
    if (id && fullname) index.set(id, fullname);
  }
  return index;
}

/**
 * Converts a completed SportMonks fixture (with batting + bowling includes)
 * into a HistoricalImportBundle ready to be upserted into the warehouse.
 *
 * Returns null when the fixture does not have enough data to be useful.
 */
export function buildHistoricalImportBundleFromSportMonks(
  fixture: SMFixtureForImport
): HistoricalImportBundle | null {
  const localTeam = fixture.localteam;
  const visitorTeam = fixture.visitorteam;

  if (!localTeam || !visitorTeam) return null;

  // Only import completed / result fixtures
  const status = (fixture.status ?? "").toLowerCase();
  const isCompleted =
    !!fixture.winner_team_id ||
    status.includes("finished") ||
    status.includes("completed") ||
    status.includes("result") ||
    status.includes("abandoned");

  if (!isCompleted) return null;

  const teamA = localTeam.name;
  const teamB = visitorTeam.name;
  const sourceMatchId = String(fixture.id);
  // Use a deterministic 30-char ID so upserts work
  const matchId = createHash("sha1")
    .update(`sportmonks:${sourceMatchId}`)
    .digest("hex")
    .slice(0, 30);

  const startedAt = fixture.starting_at ? new Date(fixture.starting_at) : undefined;
  const venueName = fixture.venue?.name ?? undefined;
  const venueCity = fixture.venue?.city ?? undefined;
  const leagueName = fixture.league?.name ?? undefined;
  const seasonName = fixture.season?.name ?? undefined;

  // Winner resolution
  let winner: string | undefined;
  if (fixture.winner_team_id === localTeam.id) winner = localTeam.name;
  else if (fixture.winner_team_id === visitorTeam.id) winner = visitorTeam.name;

  // Man of match
  const mom = fixture.manofmatch;
  const playerOfMatch = mom
    ? safeStr(mom.fullname) ||
      [safeStr(mom.firstname), safeStr(mom.lastname)].filter(Boolean).join(" ") ||
      undefined
    : undefined;

  const playerIndex = buildSmPlayerIndex(fixture.lineup ?? []);
  const battingRows: Prisma.HistoricalBattingInningsUncheckedCreateInput[] = [];
  const bowlingRows: Prisma.HistoricalBowlingInningsUncheckedCreateInput[] = [];
  const aliases = new Map<string, Prisma.HistoricalPlayerAliasUncheckedCreateInput>();

  const ensureAlias = (playerName: string, playerKey: string) => {
    const k = `${playerKey}:${normaliseKey(playerName)}`;
    if (!aliases.has(k)) {
      aliases.set(k, {
        playerKey,
        aliasName: playerName,
        aliasNameKey: normaliseKey(playerName),
        source: "sportmonks",
      });
    }
  };

  // Inning number by scoreboard label (S1 → 1, S2 → 2, …)
  const scoreboardToInning = (scoreboard: unknown): number => {
    const s = String(scoreboard ?? "");
    const n = Number.parseInt(s.replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };

  // Team lookup by id
  const teamNameById = (id: unknown): string => {
    const tid = Number(id);
    if (tid === localTeam.id) return localTeam.name;
    if (tid === visitorTeam.id) return visitorTeam.name;
    return "";
  };

  const oppositionOf = (teamName: string): string => {
    if (teamName === localTeam.name) return visitorTeam.name;
    if (teamName === visitorTeam.name) return localTeam.name;
    return "";
  };

  // ── Batting rows ──────────────────────────────────────────────────
  for (const raw of fixture.batting ?? []) {
    const playerIdStr = String(raw.player_id ?? "");
    const playerName =
      playerIndex.get(playerIdStr) ||
      safeStr(raw.player_name) ||
      safeStr(raw.fullname) ||
      "Unknown";
    const playerKey = normaliseKey(playerName);
    const inningsTeamId = Number(raw.team_id ?? 0);
    const inningsTeam = teamNameById(inningsTeamId);
    const inningsTeamKey = normaliseKey(inningsTeam);
    const oppositionTeam = oppositionOf(inningsTeam);
    const scoreId = Number(raw.score_id ?? 0);
    const isNotOut = scoreId === 84 || scoreId === 80 || scoreId === 81 || raw.active === true;
    const runs = safeNum(raw.score ?? raw.runs);
    const balls = safeNum(raw.ball ?? raw.balls);

    battingRows.push({
      matchId,
      inningsNumber: scoreboardToInning(raw.scoreboard),
      inningsTeam: inningsTeam || teamA,
      inningsTeamKey: inningsTeamKey || normaliseKey(teamA),
      oppositionTeam: oppositionTeam || undefined,
      oppositionTeamKey: normaliseKey(oppositionTeam) || undefined,
      playerName,
      playerNameKey: normaliseKey(playerName),
      playerKey,
      runs,
      balls,
      fours: safeNum(raw.four_x ?? raw.fours),
      sixes: safeNum(raw.six_x ?? raw.sixes),
      strikeRate: balls > 0 ? Math.round((runs * 10000) / balls) / 100 : 0,
      dismissalKind: undefined,
      notOut: isNotOut,
    });

    if (playerName !== "Unknown") ensureAlias(playerName, playerKey);
  }

  // ── Bowling rows ──────────────────────────────────────────────────
  for (const raw of fixture.bowling ?? []) {
    const playerIdStr = String(raw.player_id ?? "");
    const playerName =
      playerIndex.get(playerIdStr) ||
      safeStr(raw.player_name) ||
      safeStr(raw.fullname) ||
      "Unknown";
    const playerKey = normaliseKey(playerName);
    // Bowling team_id is the fielding team. We need to find which team is fielding.
    const bowlingTeamId = Number(raw.team_id ?? 0);
    const bowlingTeam = teamNameById(bowlingTeamId);
    const bowlingTeamKey = normaliseKey(bowlingTeam);
    const oppositionTeam = oppositionOf(bowlingTeam);
    const overs = safeNum(raw.overs ?? raw.o);
    const runsConceded = safeNum(raw.runs ?? raw.r);
    const balls = overs > 0 ? Math.round(overs * 6) : 0;

    bowlingRows.push({
      matchId,
      inningsNumber: scoreboardToInning(raw.scoreboard),
      inningsTeam: bowlingTeam || teamA,
      inningsTeamKey: bowlingTeamKey || normaliseKey(teamA),
      oppositionTeam: oppositionTeam || undefined,
      oppositionTeamKey: normaliseKey(oppositionTeam) || undefined,
      playerName,
      playerNameKey: normaliseKey(playerName),
      playerKey,
      overs,
      maidens: safeNum(raw.medians ?? raw.maidens),
      runsConceded,
      wickets: safeNum(raw.wickets ?? raw.w),
      economy: balls > 0 ? Math.round(((runsConceded * 6) / balls) * 100) / 100 : 0,
      dotBalls: 0, // Not available from batting/bowling summary endpoint
    });

    if (playerName !== "Unknown") ensureAlias(playerName, playerKey);
  }

  if (battingRows.length === 0 && bowlingRows.length === 0) return null;

  return {
    match: {
      id: matchId,
      source: "sportmonks",
      sourceMatchId,
      startedAt: startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt : undefined,
      season: seasonName,
      matchType: fixture.type?.toUpperCase() ?? undefined,
      eventName: leagueName,
      eventNameKey: normaliseKey(leagueName),
      venue: venueName ? (venueCity ? `${venueName}, ${venueCity}` : venueName) : undefined,
      venueKey: normaliseKey(venueName),
      city: venueCity,
      teamA,
      teamAKey: normaliseKey(teamA),
      teamB,
      teamBKey: normaliseKey(teamB),
      winner,
      winnerKey: normaliseKey(winner),
      resultText: fixture.note ?? undefined,
      playerOfMatch,
      rawInfo: undefined,
    },
    battingRows,
    bowlingRows,
    aliases: [...aliases.values()],
  };
}
