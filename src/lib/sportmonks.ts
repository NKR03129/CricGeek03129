/**
 * SportMonks Cricket API v2 Client
 *
 * Endpoints used:
 *   - GET /livescores                       → all live fixtures
 *   - GET /fixtures/{id}                    → single fixture detail
 *   - GET /fixtures?filter[starts_between]  → upcoming fixtures
 *
 * Includes are appended as query params:
 *   include=localteam,visitorteam,runs,league
 *
 * Token is passed via api_token query param (never exposed to browser).
 * All responses are normalised to the existing `Match` type so the UI
 * doesn't need any changes.
 */

import { BattingEntry, BowlingEntry, CalendarMatch, Commentary, Match, Player, Score, Scorecard, Squad, TeamInfo } from "@/types/cricket";

const BASE_URL =
  process.env.SPORTMONKS_BASE_URL ||
  "https://cricket.sportmonks.com/api/v2.0";
const API_TOKEN = process.env.SPORTMONKS_API_TOKEN || "";

// ── Raw SportMonks shapes ────────────────────────────────────────────

export interface SMRun {
  id: number;
  fixture_id: number;
  team_id: number;
  inning: number;
  score: number | null;
  wickets: number | null;
  overs: number | null;
  pp1: string | null;
  pp2: string | null;
  pp3: string | null;
  updated_at: string;
}

export interface SMTeam {
  id: number;
  name: string;
  code: string;
  image_path: string;
  country_id: number;
  national_team: boolean;
}

export interface SMLeague {
  id: number;
  name: string;
  code: string;
  image_path: string;
  country_id: number;
}

export interface SMVenue {
  id: number;
  name: string;
  city: string | null;
  country: string | null;
  capacity: number | null;
}

export interface SMFixture {
  resource: string;
  id: number;
  league_id: number;
  season_id: number;
  stage_id: number;
  round: string | null;
  localteam_id: number;
  visitorteam_id: number;
  starting_at: string;
  type: string;        // "T20I", "ODI", "Test", "T20", etc.
  live: boolean;
  status: string;      // "1st Innings", "Stumps", "Finished", "Not Started", etc.
  last_period: string | null;
  note: string;
  venue_id: number | null;
  toss_won_team_id: number | null;
  winner_team_id: number | null;
  draw_noresult: boolean | null;
  elected: string | null;     // "batting" | "fielding"
  super_over: boolean;
  follow_on: boolean;
  total_overs_played: number | null;
  // Includes
  localteam?: SMTeam;
  visitorteam?: SMTeam;
  runs?: SMRun[];
  scorecards?: unknown;
  scorecard?: unknown;
  batting?: unknown;
  bowling?: unknown;
  balls?: unknown;
  lineup?: unknown;
  league?: SMLeague;
  venue?: SMVenue;
}

interface SMResponse<T> {
  data: T;
  links?: unknown;
  meta?: unknown;
}

interface SportMonksRequestOptions {
  fresh?: boolean;
  revalidateSeconds?: number;
}

// ── Fetch helper ─────────────────────────────────────────────────────

async function smFetch<T>(
  path: string,
  params: Record<string, string> = {},
  options: SportMonksRequestOptions = {}
): Promise<T | null> {
  if (!API_TOKEN) {
    return null; // Token not set — caller falls back to mock
  }

  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("api_token", API_TOKEN);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  try {
    const res = await fetch(url.toString(), {
      ...(options.fresh
        ? { cache: "no-store" as const }
        : { next: { revalidate: options.revalidateSeconds ?? 30 } }),
    });

    if (!res.ok) {
      console.error(
        `[SportMonks] ${path} → ${res.status} ${res.statusText}`
      );
      return null;
    }

    const json: SMResponse<T> = await res.json();
    return json.data ?? null;
  } catch (err) {
    console.error(`[SportMonks] fetch error for ${path}:`, err);
    return null;
  }
}

// ── Normalise a single fixture to Match ─────────────────────────────

// SM status codes that mean 'not yet started'
const NS_STATUSES = new Set(["ns", "not started", "sch", "scheduled", ""]);
// SM status codes that mean 'finished'
const FINISHED_STATUSES = [
  "finished", "completed", "result", "abandoned", "no result",
  "cancelled", "ld",
];

function statusToState(fixture: SMFixture): {
  matchStarted: boolean;
  matchEnded: boolean;
} {
  const s = fixture.status?.toLowerCase() ?? "";

  if (FINISHED_STATUSES.some((k) => s.includes(k)) || fixture.winner_team_id != null)
    return { matchStarted: true, matchEnded: true };
  if (fixture.live) return { matchStarted: true, matchEnded: false };
  if (NS_STATUSES.has(s)) return { matchStarted: false, matchEnded: false };
  return { matchStarted: true, matchEnded: false };
}

function formatStartTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return `Starts ${d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      day: "numeric",
      month: "short",
    })} IST`;
  } catch {
    return "Upcoming";
  }
}

function buildStatusLabel(fixture: SMFixture): string {
  const s = fixture.status?.toLowerCase() ?? "";

  // Result
  if (fixture.winner_team_id) {
    const winner =
      fixture.winner_team_id === fixture.localteam_id
        ? fixture.localteam?.name
        : fixture.winner_team_id === fixture.visitorteam_id
          ? fixture.visitorteam?.name
          : fixture.status;
    return `${winner ?? "Match"} won`;
  }
  if (fixture.draw_noresult) return "No Result / Draw";
  if (FINISHED_STATUSES.some((k) => s.includes(k))) {
    return fixture.status || "Finished";
  }

  // Live match — show innings status
  if (fixture.live) {
    return `LIVE · ${fixture.status || "In Progress"}`;
  }

  // Not started — show scheduled kick-off time
  if (NS_STATUSES.has(s)) {
    return formatStartTime(fixture.starting_at);
  }

  // In progress but not yet marked live
  if (fixture.status && !NS_STATUSES.has(s)) return fixture.status;

  return "—";
}

export function normaliseFixture(f: SMFixture): Match {
  const local = f.localteam;
  const visitor = f.visitorteam;
  const runs = f.runs ?? [];
  const { matchStarted, matchEnded } = statusToState(f);

  const teamInfo: TeamInfo[] = [
    {
      name: local?.name ?? `Team ${f.localteam_id}`,
      shortname: local?.code ?? String(f.localteam_id),
      img: local?.image_path ?? "",
    },
    {
      name: visitor?.name ?? `Team ${f.visitorteam_id}`,
      shortname: visitor?.code ?? String(f.visitorteam_id),
      img: visitor?.image_path ?? "",
    },
  ];

  // Map runs per team (can be multiple innings)
  const scoreMap: Record<number, Score[]> = {};
  for (const run of runs) {
    if (!scoreMap[run.team_id]) scoreMap[run.team_id] = [];
    scoreMap[run.team_id].push({
      r: run.score ?? 0,
      w: run.wickets ?? 0,
      o: run.overs ?? 0,
      inning: `Innings ${run.inning}`,
    });
  }

  const score: Score[] = [
    ...(scoreMap[f.localteam_id] ?? []),
    ...(scoreMap[f.visitorteam_id] ?? []),
  ];

  const teams = [
    local?.name ?? `Team ${f.localteam_id}`,
    visitor?.name ?? `Team ${f.visitorteam_id}`,
  ];

  const venueName = f.venue
    ? `${f.venue.name}${f.venue.city ? `, ${f.venue.city}` : ""}`
    : "";

  const matchLabel = `${teams[0]} vs ${teams[1]}`;
  const roundLabel = f.round ? ` — ${f.round}` : "";
  const leagueLabel = f.league ? ` (${f.league.name})` : "";

  return {
    id: String(f.id),
    name: `${matchLabel}${roundLabel}${leagueLabel}`,
    matchType: normaliseMatchType(f.type),
    status: buildStatusLabel(f),
    venue: venueName,
    date: f.starting_at?.split("T")[0] ?? "",
    dateTimeGMT: f.starting_at ?? "",
    teams,
    teamInfo,
    score,
    matchStarted,
    matchEnded,
  };
}

function toCalendarMatch(match: Match): CalendarMatch {
  return {
    id: match.id,
    name: match.name,
    matchType: match.matchType,
    date: match.date,
    dateTimeGMT: match.dateTimeGMT,
    teams: match.teams,
    teamInfo: match.teamInfo,
    score: match.score,
    venue: match.venue,
    status: match.status,
    series_id: match.series_id,
    matchStarted: match.matchStarted,
    matchEnded: match.matchEnded,
  };
}

// ── Match type normalisation ─────────────────────────────────────────
// SportMonks uses lowercase type strings ("t20", "4day", "odm", etc.).
// Normalise to consistent uppercase short forms for badge display.
function normaliseMatchType(raw: string | undefined | null): string {
  if (!raw) return "T20";
  const t = raw.toLowerCase().trim();
  const MAP: Record<string, string> = {
    t20: "T20", t20i: "T20I",
    odi: "ODI", "odi-w": "ODI-W", odm: "ODI",
    test: "Test", "test-w": "Test",
    "4day": "4-Day", fc: "FC",
    "t10": "T10", "hundredball": "100-Ball",
    "list a": "List A", "lista": "List A",
  };
  return MAP[t] ?? raw.toUpperCase();
}

// ── Public API ────────────────────────────────────────────────────────

const INCLUDES = "localteam,visitorteam,runs,league,venue";
const DETAIL_INCLUDES = `${INCLUDES}`;
const SQUAD_INCLUDES = "localteam,visitorteam,lineup";
const SCORECARD_INCLUDES = "localteam,visitorteam,runs,batting,bowling,lineup,scoreboards";
const COMMENTARY_INCLUDES = "balls";

interface SMFixtureWindowOptions {
  daysBack?: number;
  daysAhead?: number;
  maxPages?: number;
  perPage?: number;
  revalidateSeconds?: number;
}

/**
 * Fetch all live fixtures from SportMonks.
 * Returns null if the token is not configured.
 */
export async function getSMLivescores(): Promise<Match[] | null> {
  const data = await smFetch<SMFixture[]>("/livescores", {
    include: INCLUDES,
  }, { revalidateSeconds: 20 });

  if (!data) return null;
  return data.map(normaliseFixture);
}

/**
 * Fetch a single fixture by ID with full includes.
 */
export async function getSMFixture(id: string, options: SportMonksRequestOptions = {}): Promise<Match | null> {
  const data = await smFetch<SMFixture>(`/fixtures/${id}`, {
    include: DETAIL_INCLUDES,
  }, { revalidateSeconds: 20, ...options });

  if (!data) return null;
  return normaliseFixture(data);
}

function normaliseBattingRow(row: Record<string, unknown>): BattingEntry {
  return {
    batsman: {
      id: String(row.player_id ?? row.playerId ?? row.id ?? row.batsman_id ?? row.batsmanId ?? "unknown"),
      name: String(row.player_name ?? row.playerName ?? row.batsman ?? row.name ?? "Unknown Batter"),
    },
    dismissal: String(row.result ?? row.dismissal ?? row.how_out ?? row.howOut ?? "batting"),
    r: Number(row.score ?? row.runs ?? row.r ?? 0),
    b: Number(row.ball ?? row.balls ?? row.b ?? 0),
    "4s": Number(row.four_x ?? row.fours ?? row["4s"] ?? 0),
    "6s": Number(row.six_x ?? row.sixes ?? row["6s"] ?? 0),
    sr: String(row.rate ?? row.strike_rate ?? row.strikeRate ?? "0"),
  };
}

function normaliseBowlingRow(row: Record<string, unknown>): BowlingEntry {
  return {
    bowler: {
      id: String(row.player_id ?? row.playerId ?? row.id ?? row.bowler_id ?? row.bowlerId ?? "unknown"),
      name: String(row.player_name ?? row.playerName ?? row.bowler ?? row.name ?? "Unknown Bowler"),
    },
    o: Number(row.overs ?? row.o ?? 0),
    m: Number(row.maidens ?? row.m ?? 0),
    r: Number(row.runs ?? row.r ?? 0),
    w: Number(row.wickets ?? row.w ?? 0),
    eco: String(row.rate ?? row.econ_rate ?? row.economy ?? row.eco ?? "0"),
  };
}

function normaliseScoreboardLabel(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function scoreboardsInOrder(labels: Iterable<string>): string[] {
  return [...new Set([...labels].filter(Boolean))].sort((left, right) => {
    const leftNum = Number.parseInt(left.replace(/[^0-9]/g, ""), 10);
    const rightNum = Number.parseInt(right.replace(/[^0-9]/g, ""), 10);

    if (Number.isNaN(leftNum) && Number.isNaN(rightNum)) return left.localeCompare(right);
    if (Number.isNaN(leftNum)) return 1;
    if (Number.isNaN(rightNum)) return -1;
    return leftNum - rightNum;
  });
}

function buildPlayerNameIndex(lineup: unknown, localTeam?: SMTeam, visitorTeam?: SMTeam) {
  const index = new Map<string, string>();
  const teamPlayers = new Map<number, Player[]>();

  if (!Array.isArray(lineup)) {
    return { playerNameById: index, teamPlayers };
  }

  for (const row of lineup) {
    const player = row as Record<string, unknown>;
    const id = String(player.id ?? "");
    const fullName =
      typeof player.fullname === "string"
        ? player.fullname
        : [player.firstname, player.lastname].filter((value) => typeof value === "string" && value.trim()).join(" ");

    if (id && fullName) {
      index.set(id, fullName);
    }

    const lineupMeta = (player.lineup as Record<string, unknown> | undefined) ?? {};
    const teamId = Number(lineupMeta.team_id ?? 0);
    if (!teamId) continue;

    const playerEntry: Player = {
      id: id || String(player.id ?? "unknown"),
      name: fullName || "Unknown Player",
      role: typeof (player.position as Record<string, unknown> | undefined)?.name === "string"
        ? String((player.position as Record<string, unknown>).name)
        : undefined,
      battingStyle: typeof player.battingstyle === "string" ? player.battingstyle : undefined,
      bowlingStyle: typeof player.bowlingstyle === "string" ? player.bowlingstyle : undefined,
      playerImg: typeof player.image_path === "string" ? player.image_path : undefined,
    };

    if (!teamPlayers.has(teamId)) teamPlayers.set(teamId, []);
    teamPlayers.get(teamId)!.push(playerEntry);
  }

  if (localTeam && !teamPlayers.has(localTeam.id)) {
    teamPlayers.set(localTeam.id, []);
  }
  if (visitorTeam && !teamPlayers.has(visitorTeam.id)) {
    teamPlayers.set(visitorTeam.id, []);
  }

  return { playerNameById: index, teamPlayers };
}

/**
 * SportMonks uses `score_id` / `wicket_id` as the dismissal TYPE — a numeric ID
 * pointing to their /scores catalogue.  These are the real values confirmed from
 * the live API (GET /scores):
 *
 *   54  Catch Out              → c [fielder] b [bowler]
 *   55  Catch Out (Sub)        → c sub [fielder] b [bowler]
 *   56  Stump Out              → st [keeper] b [bowler]
 *   57  Stump Out (Sub)        → st sub [keeper] b [bowler]
 *   58  Bowled                 → b [bowler]
 *   63  Run Out                → run out ([runout_by_id])
 *   64  Run Out (Sub)          → run out (sub, [runout_by_id])
 *   65–68 Run Out + runs       → run out ([runout_by_id])
 *   78  Obstructing the Field  → obstructing
 *   79  Clean Bowled           → b [bowler]
 *   83  LBW OUT                → lbw b [bowler]
 *   84  Not Out / still batting → not out
 *   85  Retired Hurt           → retired hurt
 *   86  Hit the ball twice     → hit the ball twice
 *   87  Hit Wicket             → hit wicket b [bowler]
 *   138 Retired Out            → retired out
 *   Various + Run Out combos (3, 5, 22–25, 28–29, 32, 36, 42) → run out
 */

/** Dismissal kind derived from score_id */
type DismissalKind =
  | "caught" | "stumped" | "bowled" | "lbw"
  | "run out" | "hit wicket" | "retired hurt"
  | "retired out" | "obstructing" | "hit twice"
  | "not out" | "did not bat";

function scoreIdToKind(id: number): DismissalKind | null {
  // Catch Out
  if (id === 54 || id === 55) return "caught";
  // Stump Out
  if (id === 56 || id === 57) return "stumped";
  // Bowled (both clean and generic bowled)
  if (id === 58 || id === 79) return "bowled";
  // Run Out — all variants
  if ([3, 5, 22, 23, 24, 25, 28, 29, 32, 36, 42, 63, 64, 65, 66, 67, 68].includes(id)) return "run out";
  // LBW
  if (id === 83) return "lbw";
  // Hit Wicket
  if (id === 87) return "hit wicket";
  // Obstructing
  if (id === 78) return "obstructing";
  // Hit the ball twice
  if (id === 86) return "hit twice";
  // Retired Hurt (not a wicket, but displayed)
  if (id === 85) return "retired hurt";
  // Retired Out
  if (id === 138) return "retired out";
  // Not Out / Absent (no wicket)
  if (id === 84 || id === 80 || id === 81) return "not out";
  return null;
}

/**
 * Builds a cricket-shorthand dismissal string from a raw SportMonks batting row.
 *
 * Key fields (all confirmed from live API):
 *   score_id / wicket_id      — dismissal TYPE (numeric, see scoreIdToKind)
 *   bowling_player_id         — bowler who took the wicket
 *   catch_stump_player_id     — fielder/keeper for catches & stumpings
 *   runout_by_id              — fielder who ran the batter out
 *   active                    — true if batter is currently at crease
 *
 * All player IDs are resolved via playerNameById (built from lineup include).
 */
function buildDismissalString(
  raw: Record<string, unknown>,
  playerNameById: Map<string, string>
): string {
  // Still at the crease
  if (raw.active === true) return "batting";

  // Determine the dismissal type from score_id or wicket_id
  const scoreId = Number(raw.score_id ?? raw.wicket_id ?? 0);
  const kind = scoreIdToKind(scoreId);

  // score_id=0 or unrecognised + no wicket_id → did not bat
  if (!scoreId || kind === null) return "did not bat";
  if (kind === "not out") return "not out";
  if (kind === "retired hurt") return "retired hurt";
  if (kind === "retired out") return "retired out";

  // Resolve player names
  const resolveName = (id: unknown): string | null => {
    if (!id || id === 0 || id === "0" || id === "") return null;
    return playerNameById.get(String(id)) ?? null;
  };

  const bowler  = resolveName(raw.bowling_player_id);
  // catch_stump_player_id is the fielder/keeper for catches and stumpings
  const fielder = resolveName(raw.catch_stump_player_id);
  // runout_by_id is the fielder who effected the run-out
  const runoutBy = resolveName(raw.runout_by_id ?? raw.run_out_player_id);

  switch (kind) {
    case "caught":
      // c & b when bowler took the catch themselves
      if (fielder && bowler && fielder !== bowler) return `c ${fielder} b ${bowler}`;
      if (bowler) return `c & b ${bowler}`;
      if (fielder) return `c ${fielder}`;
      return "caught";

    case "bowled":
      return bowler ? `b ${bowler}` : "bowled";

    case "lbw":
      return bowler ? `lbw b ${bowler}` : "lbw";

    case "stumped":
      if (fielder && bowler) return `st ${fielder} b ${bowler}`;
      if (bowler) return `st b ${bowler}`;
      return "stumped";

    case "run out":
      return runoutBy ? `run out (${runoutBy})` : "run out";

    case "hit wicket":
      return bowler ? `hit wicket b ${bowler}` : "hit wicket";

    case "obstructing":
      return "obstructing the field";

    case "hit twice":
      return "hit the ball twice";

    default:
      return "out";
  }
}


function parseSportMonksScorecards(fixture: SMFixture): Scorecard[] | null {
  const battingRows = Array.isArray(fixture.batting) ? fixture.batting : [];
  const bowlingRows = Array.isArray(fixture.bowling) ? fixture.bowling : [];
  const runs = Array.isArray(fixture.runs) ? fixture.runs : [];
  const { playerNameById } = buildPlayerNameIndex(fixture.lineup, fixture.localteam, fixture.visitorteam);

  const scoreboardLabels = scoreboardsInOrder([
    ...battingRows.map((row) => normaliseScoreboardLabel((row as Record<string, unknown>).scoreboard)),
    ...bowlingRows.map((row) => normaliseScoreboardLabel((row as Record<string, unknown>).scoreboard)),
  ]);

  const parsed = scoreboardLabels
    .map((scoreboardLabel, index) => {
      const battingSourceRow = battingRows.find(
        (row) => normaliseScoreboardLabel((row as Record<string, unknown>).scoreboard) === scoreboardLabel
      ) as Record<string, unknown> | undefined;
      const battingForInning = battingRows
        .filter((row) => normaliseScoreboardLabel((row as Record<string, unknown>).scoreboard) === scoreboardLabel)
        .map((row) => {
          const raw = row as Record<string, unknown>;
          return normaliseBattingRow({
            ...raw,
            player_name: playerNameById.get(String(raw.player_id ?? "")) ?? raw.player_name,
            // Build the real dismissal string from SportMonks fields.
            // This MUST come after the spread so it overrides any raw.dismissal.
            dismissal: buildDismissalString(raw, playerNameById),
          });
        });

      const bowlingForInning = bowlingRows
        .filter((row) => normaliseScoreboardLabel((row as Record<string, unknown>).scoreboard) === scoreboardLabel)
        .map((row) => {
          const raw = row as Record<string, unknown>;
          return normaliseBowlingRow({
            ...raw,
            player_name: playerNameById.get(String(raw.player_id ?? "")) ?? raw.player_name,
            maidens: raw.medians,
          });
        });

      const battingTeamId = Number(battingSourceRow?.team_id ?? 0);
      const runRow =
        runs.find((run) => Number(run.inning ?? 0) === index + 1) ??
        runs.find((run) => Number(run.team_id) === battingTeamId) ??
        runs[index];
      const resolvedBattingTeamId = battingTeamId || Number(runRow?.team_id ?? 0);

      const battingTeamName =
        resolvedBattingTeamId === fixture.localteam?.id
          ? fixture.localteam.name
          : resolvedBattingTeamId === fixture.visitorteam?.id
            ? fixture.visitorteam.name
            : `Team ${resolvedBattingTeamId}`;
      const totalRuns = Number(runRow?.score ?? 0);
      const battingRuns = battingForInning.reduce((sum, entry) => sum + entry.r, 0);
      const inferredExtras = Math.max(0, totalRuns - battingRuns);

      return {
        inning: `${battingTeamName} Innings ${index + 1}`,
        totalRuns,
        totalWickets: Number(runRow?.wickets ?? 0),
        totalOvers: Number(runRow?.overs ?? 0),
        extras: String(inferredExtras),
        batting: battingForInning,
        bowling: bowlingForInning,
      };
    })
    .filter((inning) => inning.batting.length > 0 || inning.bowling.length > 0 || inning.totalRuns > 0);

  return parsed.length > 0 ? parsed : null;
}

export async function getSMScorecard(id: string, options: SportMonksRequestOptions = {}): Promise<Scorecard[] | null> {
  const data = await smFetch<SMFixture>(`/fixtures/${id}`, {
    include: SCORECARD_INCLUDES,
  }, { revalidateSeconds: 20, ...options });

  if (!data) return null;
  return parseSportMonksScorecards(data);
}

function decimalBallToParts(value: unknown) {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? 0));
  if (!Number.isFinite(numeric)) {
    return { over: 0, ball: 0 };
  }

  const over = Math.floor(numeric);
  const ball = Math.round((numeric - over) * 10);
  return { over, ball };
}

function scoreboardRank(value: string | undefined): number {
  if (!value) return 0;
  const numeric = Number.parseInt(value.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function describeBallScore(score: Record<string, unknown>, ballLabel: string, bowler: string, batter: string, dismissedBatter?: string) {
  const scoreName = typeof score.name === "string" ? score.name : "";
  const runs = Number(score.runs ?? 0);
  const byes = Number(score.bye ?? 0);
  const legByes = Number(score.leg_bye ?? 0);
  const noBallRuns = Number(score.noball_runs ?? 0);
  const isWicket = Boolean(score.is_wicket || score.out);

  if (isWicket) {
    const wicketLabel = dismissedBatter ? `${dismissedBatter} is out` : "Wicket";
    return `${ballLabel} ${bowler} to ${batter}, ${scoreName || "Wicket"}! ${wicketLabel}.`;
  }

  if (byes > 0) return `${ballLabel} ${bowler} to ${batter}, ${byes} bye${byes === 1 ? "" : "s"}.`;
  if (legByes > 0) return `${ballLabel} ${bowler} to ${batter}, ${legByes} leg bye${legByes === 1 ? "" : "s"}.`;
  if (noBallRuns > 0 && runs === 0) return `${ballLabel} ${bowler} to ${batter}, no-ball for ${noBallRuns}.`;
  if (score.four) return `${ballLabel} ${bowler} to ${batter}, FOUR.`;
  if (score.six) return `${ballLabel} ${bowler} to ${batter}, SIX.`;
  if (runs === 0) return `${ballLabel} ${bowler} to ${batter}, no run.`;
  if (runs === 1) return `${ballLabel} ${bowler} to ${batter}, 1 run.`;
  return `${ballLabel} ${bowler} to ${batter}, ${runs} runs.`;
}

function getPersonName(record: unknown): string | null {
  const value = record as Record<string, unknown> | undefined;
  if (!value) return null;

  const fullName =
    typeof value.fullname === "string"
      ? value.fullname
      : [value.firstname, value.lastname]
          .filter((item) => typeof item === "string" && item.trim())
          .join(" ");

  return fullName || null;
}

function getDismissedBatter(entry: Record<string, unknown>): string | null {
  return (
    getPersonName(entry.wicket as Record<string, unknown> | undefined) ||
    getPersonName(entry.dismissed as Record<string, unknown> | undefined) ||
    getPersonName(entry.batsmanout as Record<string, unknown> | undefined) ||
    getPersonName(entry.playerout as Record<string, unknown> | undefined) ||
    null
  );
}

export async function getSMCommentary(id: string, options: SportMonksRequestOptions = {}): Promise<Commentary | null> {
  const data = await smFetch<SMFixture>(`/fixtures/${id}`, {
    include: COMMENTARY_INCLUDES,
  }, { revalidateSeconds: 10, ...options });

  if (!data || !Array.isArray(data.balls)) return null;

  const balls = data.balls as Array<Record<string, unknown>>;
  if (balls.length === 0) return null;

  const rows = balls
    .map((entry) => {
      const { over, ball } = decimalBallToParts(entry.ball);
      const batsmanRecord = entry.batsman as Record<string, unknown> | undefined;
      const bowlerRecord = entry.bowler as Record<string, unknown> | undefined;
      const batter = getPersonName(batsmanRecord) || "Unknown Batter";
      const bowler = getPersonName(bowlerRecord) || "Unknown Bowler";
      const score = ((entry.score as Record<string, unknown> | undefined) ?? {});
      const batsmanRuns = Number(score.runs ?? 0);
      const byes = Number(score.bye ?? score.byes ?? 0);
      const legByes = Number(score.leg_bye ?? score.legbyes ?? 0);
      const noBallRuns = Number(score.noball_runs ?? score.no_ball ?? score.noball ?? 0);
      const wideRuns = Number(score.wide ?? score.wides ?? score.wide_runs ?? 0);
      const extras = byes + legByes + noBallRuns + wideRuns;
      const scoreValue = batsmanRuns + extras;
      const ballLabel = `${over}.${ball}`;
      const scoreboard = typeof entry.scoreboard === "string" ? entry.scoreboard : undefined;
      const timestamp = typeof entry.updated_at === "string" ? entry.updated_at : new Date().toISOString();
      const timestampMs = new Date(timestamp).getTime();
      const dismissedBatter = getDismissedBatter(entry);
      const isWicket = Boolean(score.is_wicket || score.out || entry.wicket_id);

      return {
        id: String(entry.id ?? `${over}-${ball}`),
        scoreboard,
        scoreboardOrder: scoreboardRank(scoreboard),
        timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
        over,
        ball,
        score: Number.isFinite(scoreValue) ? scoreValue : 0,
        batsman: batter,
        bowler,
        commentary: describeBallScore(score, ballLabel, bowler, batter, dismissedBatter ?? undefined),
        timestamp,
        batsmanId: batsmanRecord?.id ? String(batsmanRecord.id) : null,
        bowlerId: bowlerRecord?.id ? String(bowlerRecord.id) : null,
        batsmanRuns: Number.isFinite(batsmanRuns) ? batsmanRuns : 0,
        extras: Number.isFinite(extras) ? extras : 0,
        byes: Number.isFinite(byes) ? byes : 0,
        legByes: Number.isFinite(legByes) ? legByes : 0,
        noBallRuns: Number.isFinite(noBallRuns) ? noBallRuns : 0,
        wideRuns: Number.isFinite(wideRuns) ? wideRuns : 0,
        isBoundary: Boolean(score.four || score.six || batsmanRuns === 4 || batsmanRuns === 6),
        isFour: Boolean(score.four || batsmanRuns === 4),
        isSix: Boolean(score.six || batsmanRuns === 6),
        isWicket,
        wicketType: typeof score.name === "string" && isWicket ? score.name : null,
        dismissedBatter,
        legalBall: wideRuns === 0 && noBallRuns === 0,
      };
    });

  const latestRow = [...rows].sort((left, right) => {
    if (right.timestampMs !== left.timestampMs) return right.timestampMs - left.timestampMs;
    return right.scoreboardOrder - left.scoreboardOrder;
  })[0];

  const activeScoreboard = latestRow?.scoreboard;
  const activeRows =
    activeScoreboard && rows.some((row) => row.scoreboard === activeScoreboard)
      ? rows.filter((row) => row.scoreboard === activeScoreboard)
      : rows;

  const commentary = activeRows
    .sort((left, right) => {
      if (right.timestampMs !== left.timestampMs) return right.timestampMs - left.timestampMs;
      const leftValue = left.over * 10 + left.ball;
      const rightValue = right.over * 10 + right.ball;
      return rightValue - leftValue;
    })
    .map(({ id, over, ball, score, batsman, bowler, commentary, timestamp, scoreboard, batsmanId, bowlerId, batsmanRuns, extras, byes, legByes, noBallRuns, wideRuns, isBoundary, isFour, isSix, isWicket, wicketType, dismissedBatter, legalBall }) => ({
      id,
      over,
      ball,
      score,
      batsman,
      bowler,
      commentary,
      timestamp,
      scoreboard,
      batsmanId,
      bowlerId,
      batsmanRuns,
      extras,
      byes,
      legByes,
      noBallRuns,
      wideRuns,
      isBoundary,
      isFour,
      isSix,
      isWicket,
      wicketType,
      dismissedBatter,
      legalBall,
    }));

  return { bbb: commentary };
}

export async function getSMSquads(id: string, options: SportMonksRequestOptions = {}): Promise<Squad[] | null> {
  const data = await smFetch<SMFixture>(`/fixtures/${id}`, {
    include: SQUAD_INCLUDES,
  }, { revalidateSeconds: 60, ...options });

  if (!data || !Array.isArray(data.lineup) || !data.localteam || !data.visitorteam) {
    return null;
  }

  const { teamPlayers } = buildPlayerNameIndex(data.lineup, data.localteam, data.visitorteam);
  const teams = [data.localteam, data.visitorteam];

  return teams.map((team) => ({
    teamName: team.name,
    shortname: team.code,
    img: team.image_path,
    players: teamPlayers.get(team.id) ?? [],
  }));
}

async function getSMFixturesWindow({
  daysBack = 0,
  daysAhead = 45,
  maxPages = 4,
  perPage = 100,
  revalidateSeconds = 600,
}: SMFixtureWindowOptions = {}): Promise<Match[] | null> {
  const now = new Date();
  const past = new Date(now);
  const future = new Date(now);
  past.setDate(now.getDate() - daysBack);
  future.setDate(now.getDate() + daysAhead);

  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const fixtures: Match[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const data = await smFetch<SMFixture[]>(
      "/fixtures",
      {
        include: INCLUDES,
        "filter[starts_between]": `${fmt(past)},${fmt(future)}`,
        per_page: String(perPage),
        page: String(page),
        sort: "starting_at",
      },
      { revalidateSeconds }
    );

    if (!data) {
      return page === 1 ? null : fixtures;
    }

    if (data.length === 0) {
      break;
    }

    fixtures.push(...data.map(normaliseFixture));

    if (data.length < perPage) {
      break;
    }
  }

  return [...new Map(fixtures.map((fixture) => [fixture.id, fixture])).values()].sort((left, right) =>
    left.dateTimeGMT.localeCompare(right.dateTimeGMT)
  );
}

/**
 * Fetch upcoming fixtures (next 7 days).
 */
export async function getSMUpcoming({
  daysAhead = 7,
  maxPages = 2,
  perPage = 100,
}: Pick<SMFixtureWindowOptions, "daysAhead" | "maxPages" | "perPage"> = {}): Promise<Match[] | null> {
  const fixtures = await getSMFixturesWindow({
    daysBack: 0,
    daysAhead,
    maxPages,
    perPage,
    revalidateSeconds: 300,
  });

  if (!fixtures) return null;
  return fixtures
    .filter((m) => !m.matchStarted)
    .sort((a, b) => a.dateTimeGMT.localeCompare(b.dateTimeGMT))
    .slice(0, 20);
}

export async function getSMCalendarFixtures({
  daysBack = 30,
  daysAhead = 45,
  maxPages = 4,
  perPage = 100,
}: SMFixtureWindowOptions = {}): Promise<CalendarMatch[] | null> {
  const fixtures = await getSMFixturesWindow({
    daysBack,
    daysAhead,
    maxPages,
    perPage,
    revalidateSeconds: 600,
  });

  if (!fixtures) return null;
  return fixtures.map(toCalendarMatch);
}

export async function getSMRecentResults({
  daysBack = 30,
  maxPages = 4,
  perPage = 100,
}: Pick<SMFixtureWindowOptions, "daysBack" | "maxPages" | "perPage"> = {}): Promise<Match[] | null> {
  const fixtures = await getSMFixturesWindow({
    daysBack,
    daysAhead: 0,
    maxPages,
    perPage,
    revalidateSeconds: 180,
  });

  if (!fixtures) return null;
  return fixtures
    .filter((m) => m.matchEnded)
    .sort((a, b) => b.dateTimeGMT.localeCompare(a.dateTimeGMT))
    .slice(0, 20);
}

/** Health check — returns true if token is configured */
export function isSportMonksConfigured(): boolean {
  return API_TOKEN.length > 0;
}

/**
 * Given a list of lowercase team code/name hints (e.g. ["kkr", "mi"]),
 * searches recent and upcoming fixtures to find the most recent match
 * involving each team, then fetches the full lineup for those fixtures
 * and returns the matching squads.
 *
 * Results are cached for 1 h via Next.js fetch cache so that per-transcription
 * calls don't hammer the SportMonks API.
 */
export async function getSMTeamRostersForHints(
  teamHints: string[]
): Promise<Squad[]> {
  if (!isSportMonksConfigured() || teamHints.length === 0) return [];

  const [live, upcoming, recent] = await Promise.all([
    getSMLivescores(),
    getSMUpcoming({ daysAhead: 14, maxPages: 2 }),
    getSMRecentResults({ daysBack: 7, maxPages: 2 }),
  ]);

  const fixtures = [...(live ?? []), ...(upcoming ?? []), ...(recent ?? [])];
  if (fixtures.length === 0) return [];

  const uniqueFixtures = new Map<string, Match>();
  for (const fixture of fixtures) {
    uniqueFixtures.set(fixture.id, fixture);
  }

  const sorted = [...uniqueFixtures.values()].sort((left, right) => {
    const leftLive = left.matchStarted && !left.matchEnded;
    const rightLive = right.matchStarted && !right.matchEnded;
    if (leftLive !== rightLive) return leftLive ? -1 : 1;
    return new Date(right.dateTimeGMT || right.date).getTime() - new Date(left.dateTimeGMT || left.date).getTime();
  });

  const normalizedHints = [...new Set(teamHints.map((hint) => hint.toLowerCase()))];
  let targetFixture: Match | null = null;
  let fallbackFixtures = [...sorted];

  for (const fixture of sorted) {
    const codes = fixture.teamInfo.map((team) => team.shortname.toLowerCase());
    const allMatch = normalizedHints.every((hint) => codes.includes(hint));
    if (allMatch) {
      targetFixture = fixture;
      break;
    }
  }

  if (!targetFixture) {
    const now = new Date();
    const past = new Date(now);
    past.setDate(now.getDate() - 365);
    const future = new Date(now);
    future.setDate(now.getDate() + 180);
    const fmt = (d: Date) => d.toISOString().split("T")[0];

    const rawFixtures = await smFetch<SMFixture[]>(
      "/fixtures",
      {
        include: "localteam,visitorteam,runs,league,venue",
        "filter[starts_between]": `${fmt(past)},${fmt(future)}`,
      },
      { revalidateSeconds: 3600 }
    );

    if (rawFixtures && rawFixtures.length > 0) {
      const normalizedRaw = rawFixtures
        .map(normaliseFixture)
        .sort(
          (left, right) =>
            new Date(right.dateTimeGMT || right.date).getTime() - new Date(left.dateTimeGMT || left.date).getTime()
        );

      fallbackFixtures = [...new Map(
        [...sorted, ...normalizedRaw].map((fixture) => [fixture.id, fixture])
      ).values()].sort((left, right) => {
        const leftLive = left.matchStarted && !left.matchEnded;
        const rightLive = right.matchStarted && !right.matchEnded;
        if (leftLive !== rightLive) return leftLive ? -1 : 1;
        return new Date(right.dateTimeGMT || right.date).getTime() - new Date(left.dateTimeGMT || left.date).getTime();
      });

      for (const fixture of normalizedRaw) {
        const codes = fixture.teamInfo.map((team) => team.shortname.toLowerCase());
        const allMatch = normalizedHints.every((hint) => codes.includes(hint));
        if (allMatch) {
          targetFixture = fixture;
          break;
        }
      }
    }
  }

  if (!targetFixture) {
    const teamSpecificSquads = new Map<string, Squad>();

    for (const hint of normalizedHints) {
      for (const fixture of fallbackFixtures) {
        const codes = fixture.teamInfo.map((team) => team.shortname.toLowerCase());
        if (!codes.includes(hint)) continue;

        const squadsForFixture = await getSMSquads(fixture.id, { fresh: false });
        if (!squadsForFixture || squadsForFixture.length === 0) continue;

        const matchingSquad = squadsForFixture.find(
          (squad) => squad.shortname.toLowerCase() === hint
        );

        if (matchingSquad && matchingSquad.players.length > 0) {
          teamSpecificSquads.set(hint, matchingSquad);
          break;
        }
      }
    }

    return normalizedHints
      .map((hint) => teamSpecificSquads.get(hint))
      .filter((squad): squad is Squad => Boolean(squad));
  }

  const squads = await getSMSquads(targetFixture.id, { fresh: false });
  if (!squads) {
    const teamSpecificSquads = new Map<string, Squad>();

    for (const hint of normalizedHints) {
      for (const fixture of sorted) {
        const codes = fixture.teamInfo.map((team) => team.shortname.toLowerCase());
        if (!codes.includes(hint)) continue;

        const squadsForFixture = await getSMSquads(fixture.id, { fresh: false });
        if (!squadsForFixture || squadsForFixture.length === 0) continue;

        const matchingSquad = squadsForFixture.find(
          (squad) => squad.shortname.toLowerCase() === hint
        );

        if (matchingSquad && matchingSquad.players.length > 0) {
          teamSpecificSquads.set(hint, matchingSquad);
          break;
        }
      }
    }

    return normalizedHints
      .map((hint) => teamSpecificSquads.get(hint))
      .filter((squad): squad is Squad => Boolean(squad));
  }

  const exactMatchSquads = squads.filter((squad) =>
    normalizedHints.includes(squad.shortname.toLowerCase())
  );

  if (exactMatchSquads.length === normalizedHints.length) {
    return exactMatchSquads;
  }

  const resolvedSquads = new Map<string, Squad>(
    exactMatchSquads.map((squad) => [squad.shortname.toLowerCase(), squad])
  );

  for (const hint of normalizedHints) {
    if (resolvedSquads.has(hint)) continue;

    for (const fixture of fallbackFixtures) {
      const codes = fixture.teamInfo.map((team) => team.shortname.toLowerCase());
      if (!codes.includes(hint)) continue;

      const squadsForFixture = await getSMSquads(fixture.id, { fresh: false });
      if (!squadsForFixture || squadsForFixture.length === 0) continue;

      const matchingSquad = squadsForFixture.find(
        (squad) => squad.shortname.toLowerCase() === hint
      );

      if (matchingSquad && matchingSquad.players.length > 0) {
        resolvedSquads.set(hint, matchingSquad);
        break;
      }
    }
  }

  return normalizedHints
    .map((hint) => resolvedSquads.get(hint))
    .filter((squad): squad is Squad => Boolean(squad));
}
