import type { MetricQuality } from "@/types/metrics";

export interface Match {
  id: string;
  name: string;
  matchType: string; // T20, ODI, Test
  status: string;
  venue: string;
  date: string;
  dateTimeGMT: string;
  teams: string[];
  teamInfo: TeamInfo[];
  score: Score[];
  series_id?: string;
  fantasyEnabled?: boolean;
  bbbEnabled?: boolean;
  hasSquad?: boolean;
  matchStarted: boolean;
  matchEnded: boolean;
}

export interface TeamInfo {
  name: string;
  shortname: string;
  img: string;
}

export interface Score {
  r: number; // runs
  w: number; // wickets
  o: number; // overs
  inning: string;
}

export interface Scorecard {
  batting: BattingEntry[];
  bowling: BowlingEntry[];
  extras: string;
  totalRuns: number;
  totalWickets: number;
  totalOvers: number;
  inning: string;
}

export interface BattingEntry {
  batsman: BatsmanInfo;
  dismissal: string;
  r: number;
  b: number;
  "4s": number;
  "6s": number;
  sr: string;
}

export interface BatsmanInfo {
  id: string;
  name: string;
}

export interface BowlingEntry {
  bowler: BowlerInfo;
  o: number;
  m: number;
  r: number;
  w: number;
  eco: string;
}

export interface BowlerInfo {
  id: string;
  name: string;
}

export interface Commentary {
  bbb: BallByBall[];
}

export interface BallByBall {
  id: string;
  over: number;
  ball: number;
  score: number;
  batsman: string;
  bowler: string;
  commentary: string;
  timestamp: string;
  scoreboard?: string;
  batsmanId?: string | null;
  bowlerId?: string | null;
  batsmanRuns?: number;
  extras?: number;
  byes?: number;
  legByes?: number;
  noBallRuns?: number;
  wideRuns?: number;
  isBoundary?: boolean;
  isFour?: boolean;
  isSix?: boolean;
  isWicket?: boolean;
  wicketType?: string | null;
  dismissedBatter?: string | null;
  legalBall?: boolean;
}

export interface Squad {
  teamName: string;
  shortname: string;
  img: string;
  players: Player[];
}

export interface Player {
  id: string;
  name: string;
  role?: string;
  battingStyle?: string;
  bowlingStyle?: string;
  country?: string;
  playerImg?: string;
}

export interface CalendarMatch {
  id: string;
  name: string;
  matchType: string;
  date: string;
  dateTimeGMT: string;
  teams: string[];
  teamInfo: TeamInfo[];
  score?: Score[];
  venue: string;
  status: string;
  series_id?: string;
  matchStarted?: boolean;
  matchEnded?: boolean;
}

export interface MatchAnalysis {
  id: string;
  matchId: string;
  type: "pre-match" | "post-match";
  title: string;
  content: string;
  author: string;
  createdAt: string;
}

export interface MatchPreviewIntel {
  headline: string;
  summary: string;
  keyQuestions: string[];
  tacticalAngles: string[];
  watchPlayers: string[];
  predictedPressurePhase: string;
}

export interface PostMatchEdaCard {
  id: string;
  label: string;
  value: string;
  insight: string;
  subValue?: string;
  tone?: "neutral" | "good" | "warning";
  quality?: MetricQuality;
}

export interface PostMatchSignal {
  id: string;
  label: string;
  value: string;
  insight: string;
  tone?: "neutral" | "good" | "warning";
  quality?: MetricQuality;
}

export interface PostMatchInningsSummary {
  inning: string;
  totalRuns: number;
  totalWickets: number;
  totalOvers: number;
  runRate: number;
  extras: number;
  extrasPct: number;
  boundaryRuns: number;
  boundaryPct: number;
  topScorerName: string;
  topScorerRuns: number;
  topScorerStrikeRate: number;
  topScorerPct: number;
  supportRuns: number;
  supportPct: number;
  lowerOrderRuns: number;
  lowerOrderPct: number;
}

export interface PostMatchBattingLeader {
  name: string;
  inning: string;
  runs: number;
  balls: number;
  strikeRate: number;
  fours: number;
  sixes: number;
  boundaryPct: number;
  sharePct: number;
}

export interface PostMatchBowlingLeader {
  name: string;
  inning: string;
  wickets: number;
  overs: number;
  maidens: number;
  runsConceded: number;
  economy: number;
  ballsPerWicket: number | null;
}

export interface PostMatchIntel {
  headline: string;
  summary: string;
  turningPoints: string[];
  tacticalTakeaways: string[];
  standoutPerformers: string[];
  edaCards: PostMatchEdaCard[];
  matchSignals: PostMatchSignal[];
  inningsSummaries: PostMatchInningsSummary[];
  battingLeaders: PostMatchBattingLeader[];
  bowlingLeaders: PostMatchBowlingLeader[];
  reportNotes: string[];
}

export interface VenueInfo {
  name: string;
  city: string;
  country: string;
  capacity?: number;
  pitchType?: string;
  avgFirstInningsScore?: number;
  description?: string;
}
