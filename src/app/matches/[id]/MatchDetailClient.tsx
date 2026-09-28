"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { BarChart3, ChevronRight, Radio, RefreshCw } from "lucide-react";
import type { Match, Scorecard, Commentary, Squad } from "@/types/cricket";
import ScorecardTable from "@/components/matches/ScorecardTable";
import CommentaryFeed from "@/components/matches/CommentaryFeed";
import SquadList from "@/components/matches/SquadList";
import MatchLiveCommentary from "@/components/matches/MatchLiveCommentary";
import LiveEdaPanel from "@/components/matches/LiveEdaPanel";
import LiveRecommendationBubble from "@/components/matches/LiveRecommendationBubble";
import AdSlot from "@/components/ads/AdSlot";
import CricketNewsSidebar from "@/components/news/CricketNewsSidebar";
import { cn } from "@/lib/utils";

type Tab = "live" | "scorecard" | "commentary" | "squads" | "analysis";

interface MatchDetailClientProps {
  match: Match;
  scorecard: Scorecard[] | null;
  commentary: Commentary | null;
  squads: Squad[] | null;
  initialTab?: Tab;
  source?: "sportmonks" | "mock" | "none";
}

type MatchLiveResponse = {
  match: Match;
  scorecard: Scorecard[] | null;
  commentary: Commentary | null;
  squads: Squad[] | null;
  source: "sportmonks" | "mock" | "none";
  fetchedAt: string;
};

function formatOvers(value: number) {
  if (!Number.isFinite(value)) return "0 ov";
  return `${value} ov`;
}

function getScheduledOvers(matchType: string) {
  const normalized = matchType.toLowerCase();
  if (normalized.includes("t20")) return 20;
  if (normalized.includes("odi")) return 50;
  return null;
}

function normalisePlayerName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sortCommentaryBalls(balls: Commentary["bbb"]) {
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

function sliceTrailingInningsBalls(balls: Commentary["bbb"]) {
  const ordered = sortCommentaryBalls(balls);
  if (ordered.length <= 1) return ordered;

  const trailing: Commentary["bbb"] = [];
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

function getRollingOverWindow(commentary: Commentary | null, oversWindow = 4) {
  const balls = commentary?.bbb ? sliceTrailingInningsBalls(commentary.bbb) : [];
  const overs = [...new Set(balls.map((ball) => ball.over))];
  const latestOverIndex = overs.length - 1;
  const blockStartIndex =
    latestOverIndex >= 0 ? Math.floor(latestOverIndex / oversWindow) * oversWindow : 0;
  const recentOvers = overs.slice(blockStartIndex, blockStartIndex + oversWindow);
  const recentBalls = balls.filter((ball) => recentOvers.includes(ball.over));

  return {
    recentBalls,
    label:
      recentOvers.length === 0
        ? "Live window unavailable"
        : recentOvers.length === 1
          ? `4-over leaders · over ${recentOvers[0]}`
          : `4-over leaders · overs ${recentOvers[0]}-${recentOvers[recentOvers.length - 1]}`,
  };
}

function scoreMatchesTeam(score: Match["score"][number], team: Match["teamInfo"][number]) {
  const inning = score.inning.toLowerCase();
  return inning.includes(team.name.toLowerCase()) || inning.includes(team.shortname.toLowerCase());
}

function getTeamScoreRows(match: Match) {
  return match.teamInfo.map((team, index) => {
    const matchedScore =
      match.score.find((score) => scoreMatchesTeam(score, team)) ??
      match.score[index];

    return {
      team,
      score: matchedScore,
    };
  });
}

function scoreMatchesInningLabel(score: Match["score"][number] | undefined, inningLabel: string) {
  if (!score || !inningLabel) return false;
  return score.inning.toLowerCase().includes(inningLabel.toLowerCase());
}

function getPrimaryScore(scorecard: Scorecard[] | null, commentary: Commentary | null, matchEnded: boolean) {
  if (!scorecard || scorecard.length === 0) return null;

  const activeInnings =
    [...scorecard]
      .reverse()
      .find((inning) => inning.batting.some((entry) => entry.dismissal === "batting")) ??
    scorecard[scorecard.length - 1];

  if (!activeInnings) return null;

  const liveBatters = activeInnings.batting.filter((entry) => entry.dismissal === "batting");
  const battingIndex = new Map(
    activeInnings.batting.map((entry) => [normalisePlayerName(entry.batsman.name), entry] as const)
  );
  const bowlingIndex = new Map(
    activeInnings.bowling.map((entry) => [normalisePlayerName(entry.bowler.name), entry] as const)
  );

  const appendUniqueBatters = (
    preferred: Scorecard["batting"],
    fallback: Scorecard["batting"]
  ) => {
    const selected: Scorecard["batting"] = [];
    const seen = new Set<string>();
    for (const entry of [...preferred, ...fallback]) {
      const key = entry.batsman.id || normalisePlayerName(entry.batsman.name);
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(entry);
      if (selected.length >= 2) break;
    }
    return selected;
  };

  const appendUniqueBowlers = (
    preferred: Scorecard["bowling"],
    fallback: Scorecard["bowling"]
  ) => {
    const selected: Scorecard["bowling"] = [];
    const seen = new Set<string>();
    for (const entry of [...preferred, ...fallback]) {
      const key = entry.bowler.id || normalisePlayerName(entry.bowler.name);
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(entry);
      if (selected.length >= 2) break;
    }
    return selected;
  };

  const liveBatterFallback = (liveBatters.length > 0 ? liveBatters : activeInnings.batting).slice(0, 2);
  const overallBattingLeaders = [...activeInnings.batting]
    .sort((left, right) => {
      if (right.r !== left.r) return right.r - left.r;
      return Number(right.sr) - Number(left.sr);
    });
  const overallBowlingLeaders = [...activeInnings.bowling]
    .sort((left, right) => {
      if (right.w !== left.w) return right.w - left.w;
      if (Number(left.eco) !== Number(right.eco)) return Number(left.eco) - Number(right.eco);
      return Number(right.o) - Number(left.o);
    });

  let featuredBatters = appendUniqueBatters(liveBatterFallback, overallBattingLeaders);
  let featuredBowlers = appendUniqueBowlers(overallBowlingLeaders, overallBowlingLeaders);
  let batterContextLabel = matchEnded ? "Final innings leaders" : "Current batters";
  let bowlerContextLabel = matchEnded ? "Final innings leaders" : "Current bowling leaders";

  if (!matchEnded && commentary?.bbb?.length) {
    const rollingWindow = getRollingOverWindow(commentary, 4);
    const batterWindow = new Map<string, { runs: number; balls: number; boundaries: number }>();
    const bowlerWindow = new Map<string, { wickets: number; runs: number; balls: number; dots: number }>();

    for (const ball of rollingWindow.recentBalls) {
      const batterKey = normalisePlayerName(ball.batsman);
      const bowlerKey = normalisePlayerName(ball.bowler);

      if (batterKey) {
        const current = batterWindow.get(batterKey) ?? { runs: 0, balls: 0, boundaries: 0 };
        current.runs += ball.batsmanRuns ?? Math.max(0, ball.score - (ball.extras ?? 0) - (ball.byes ?? 0) - (ball.legByes ?? 0));
        current.balls += ball.legalBall === false ? 0 : 1;
        current.boundaries += ball.isBoundary ? 1 : 0;
        batterWindow.set(batterKey, current);
      }

      if (bowlerKey) {
        const current = bowlerWindow.get(bowlerKey) ?? { wickets: 0, runs: 0, balls: 0, dots: 0 };
        current.wickets += ball.isWicket ? 1 : 0;
        current.runs += ball.score;
        current.balls += ball.legalBall === false ? 0 : 1;
        current.dots += ball.score === 0 ? 1 : 0;
        bowlerWindow.set(bowlerKey, current);
      }
    }

    const rollingBatters = [...batterWindow.entries()]
      .map(([key, value]) => ({
        key,
        entry: battingIndex.get(key),
        runs: value.runs,
        strikeRate: value.balls > 0 ? (value.runs * 100) / value.balls : 0,
        boundaries: value.boundaries,
      }))
      .filter((item): item is { key: string; entry: NonNullable<typeof item.entry>; runs: number; strikeRate: number; boundaries: number } => Boolean(item.entry))
      .sort((left, right) => {
        if (right.runs !== left.runs) return right.runs - left.runs;
        if (right.strikeRate !== left.strikeRate) return right.strikeRate - left.strikeRate;
        return right.boundaries - left.boundaries;
      })
      .map((item) => item.entry);

    const rollingBowlers = [...bowlerWindow.entries()]
      .map(([key, value]) => ({
        key,
        entry: bowlingIndex.get(key),
        wickets: value.wickets,
        economy: value.balls > 0 ? (value.runs * 6) / value.balls : Number.POSITIVE_INFINITY,
        dots: value.dots,
        balls: value.balls,
      }))
      .filter((item): item is { key: string; entry: NonNullable<typeof item.entry>; wickets: number; economy: number; dots: number; balls: number } => Boolean(item.entry))
      .sort((left, right) => {
        if (right.wickets !== left.wickets) return right.wickets - left.wickets;
        if (left.economy !== right.economy) return left.economy - right.economy;
        if (right.dots !== left.dots) return right.dots - left.dots;
        return right.balls - left.balls;
      })
      .map((item) => item.entry);

    if (rollingBatters.length > 0) {
      featuredBatters = appendUniqueBatters(rollingBatters, liveBatterFallback);
      batterContextLabel = rollingWindow.label;
    }

    if (rollingBowlers.length > 0) {
      featuredBowlers = appendUniqueBowlers(rollingBowlers, overallBowlingLeaders);
      bowlerContextLabel = rollingWindow.label;
    }
  }

  return {
    inning: activeInnings,
    runRate:
      activeInnings.totalOvers > 0
        ? (activeInnings.totalRuns / activeInnings.totalOvers).toFixed(2)
        : "0.00",
    featuredBatters,
    featuredBowlers,
    batterContextLabel,
    bowlerContextLabel,
  };
}

// ── Innings split-view with toggle tabs ──────────────────────────────────────

interface InningsSplitViewProps {
  scorecards: import("@/types/cricket").Scorecard[];
  selectedInning: number;
  onSelectInning: (index: number) => void;
}

function InningsSplitView({ scorecards, selectedInning, onSelectInning }: InningsSplitViewProps) {
  const safeIndex = Math.min(selectedInning, scorecards.length - 1);
  const active = scorecards[safeIndex];
  const [pressedInning, setPressedInning] = useState<number | null>(null);
  const currentRunRate =
    active.totalOvers > 0 ? (active.totalRuns / active.totalOvers).toFixed(2) : "0.00";

  // Extract the team name from an inning label like "Royal Challengers Bengaluru Innings 1"
  // by stripping the trailing " Innings N" suffix.
  function extractTeamName(inning: string): string {
    return inning.replace(/\s+Innings\s+\d+$/i, "").trim();
  }

  function teamCode(name: string): string {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length === 0) return "TEAM";
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words
      .map((word) => word[0])
      .join("")
      .slice(0, 3)
      .toUpperCase();
  }

  function resolveTeamBranding(name: string): { abbr: string; color: string } {
    const normalized = name.toLowerCase();
    const knownTeams: Array<{ match: string; abbr: string; color: string }> = [
      { match: "royal challengers", abbr: "RCB", color: "#ec1c24" },
      { match: "mumbai indians", abbr: "MI", color: "#005da0" },
      { match: "chennai super kings", abbr: "CSK", color: "#fdb913" },
      { match: "rajasthan royals", abbr: "RR", color: "#ea1a85" },
      { match: "kolkata knight riders", abbr: "KKR", color: "#3a225d" },
      { match: "sunrisers hyderabad", abbr: "SRH", color: "#ff822a" },
      { match: "delhi capitals", abbr: "DC", color: "#17479e" },
      { match: "lucknow super giants", abbr: "LSG", color: "#00a3e0" },
      { match: "gujarat titans", abbr: "GT", color: "#1c2c5b" },
      { match: "punjab kings", abbr: "PBKS", color: "#d71920" },
      { match: "india", abbr: "IND", color: "#1a4da1" },
      { match: "australia", abbr: "AUS", color: "#f7c948" },
      { match: "england", abbr: "ENG", color: "#c8102e" },
      { match: "south africa", abbr: "SA", color: "#007749" },
      { match: "new zealand", abbr: "NZ", color: "#111111" },
      { match: "pakistan", abbr: "PAK", color: "#0e7c3b" },
    ];

    const matched = knownTeams.find((team) => normalized.includes(team.match));
    if (matched) return { abbr: matched.abbr, color: matched.color };

    return { abbr: teamCode(name), color: "#22C55E" };
  }

  function handleInningSelect(index: number) {
    setPressedInning(index);
    onSelectInning(index);
    window.setTimeout(() => {
      setPressedInning((current) => (current === index ? null : current));
    }, 260);
  }

  return (
    <div className="innings-stage overflow-hidden rounded-[24px] border border-white/8 bg-[#171a1b]">
      {/* Innings toggle tabs */}
      <div className="border-b border-white/8 bg-[#141718]/90">
        {/* Header row with innings label + toggle tabs */}
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
          {scorecards.length > 1 && (
            <div className="innings-ball-rack">
              {scorecards.map((card, i) => {
                const teamName = extractTeamName(card.inning);
                const branding = resolveTeamBranding(teamName);
                return (
                  <button
                    key={i}
                    title={teamName}
                    onClick={() => handleInningSelect(i)}
                    style={{ "--team-accent": branding.color } as CSSProperties}
                    className={cn(
                      "innings-ball-trigger",
                      i === safeIndex && "is-active",
                      i === pressedInning && "is-clicked"
                    )}
                  >
                    <span className="inning-ball-code">{branding.abbr}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Active innings hero line */}
        <div key={active.inning} className="innings-content-reveal px-5 pb-5">
          <h3 className="text-[22px] font-semibold leading-tight tracking-tight text-white sm:text-[24px]">
            {active.inning}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <p className="inline-flex items-center rounded-full border border-[#2f5a42] bg-[#102218] px-3 py-1 text-sm font-semibold text-[#31d260]">
              {active.totalRuns}/{active.totalWickets}
              <span className="ml-1.5 font-normal text-[#8e887d]">({active.totalOvers} ov)</span>
            </p>
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-[#d5d0c8]">
              RR {currentRunRate}
            </span>
          </div>
        </div>
      </div>

      <ScorecardTable scorecard={active} />
    </div>
  );
}

export default function MatchDetailClient({
  match,
  scorecard,
  commentary,
  squads,
  initialTab = "scorecard",
  source = "none",
}: MatchDetailClientProps) {
  const [activeTab, setActiveTab] = useState<Tab>(
    initialTab === "scorecard" && match.matchStarted && !match.matchEnded ? "live" : initialTab
  );
  const [liveMatch, setLiveMatch] = useState(match);
  const [liveScorecard, setLiveScorecard] = useState(scorecard);
  const [liveCommentary, setLiveCommentary] = useState(commentary);
  const [liveSquads, setLiveSquads] = useState(squads);
  const [liveSource, setLiveSource] = useState(source);
  const [lastUpdated, setLastUpdated] = useState(() => new Date().toISOString());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // Innings toggle — 0 = first innings, 1 = second innings, etc.
  const [selectedInning, setSelectedInning] = useState(0);
  // Whether the current user can start a live commentary session
  const [canStartSession, setCanStartSession] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const isLive = liveMatch.matchStarted && !liveMatch.matchEnded;
  const isUpcoming = !liveMatch.matchStarted;
  const shouldAutoRefresh = isLive || isUpcoming;
  const refreshIntervalMs = isLive
    ? activeTab === "commentary" || activeTab === "live"
      ? 8_000
      : 15_000
    : 60_000;

  const tabs: { id: Tab; label: string }[] = [
    { id: "live", label: isLive ? "Live" : "Match Centre" },
    { id: "scorecard", label: "Scorecard" },
    { id: "commentary", label: "Commentary" },
    { id: "squads", label: "Squads" },
    { id: "analysis", label: "Analysis" },
  ];

  useEffect(() => {
    setLiveMatch(match);
    setLiveScorecard(scorecard);
    setLiveCommentary(commentary);
    setLiveSquads(squads);
    setLiveSource(source);
    setRefreshError(null);
    setLastUpdated(new Date().toISOString());
  }, [commentary, match, scorecard, source, squads]);

  // Check auth to know if the user can start a commentary session
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data: unknown) => {
        const user = (data as { user?: { role?: string } })?.user;
        if (!user) return;
        const role = user.role ?? "user";
        setCanStartSession(role === "admin" || role === "moderator" || role === "writer" || role === "user");
      })
      .catch(() => { /* ignore — anonymous user */ });
  }, []);

  useEffect(() => {
    if (!shouldAutoRefresh) return;

    let cancelled = false;

    const refresh = async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsRefreshing(true);

      try {
        const response = await fetch(`/api/matches/${encodeURIComponent(liveMatch.id)}/live`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Live update failed with ${response.status}`);
        }

        const payload = await response.json() as MatchLiveResponse;

        if (cancelled) return;

        setLiveMatch(payload.match);
        setLiveScorecard((current) => payload.scorecard ?? current);
        setLiveCommentary((current) => payload.commentary ?? current);
        setLiveSquads((current) => payload.squads ?? current);
        setLiveSource(payload.source);
        setLastUpdated(payload.fetchedAt);
        setRefreshError(null);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof Error && error.name === "AbortError") return;
        setRefreshError("Live updates are temporarily delayed.");
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    };

    refresh();
    const interval = window.setInterval(refresh, refreshIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [liveMatch.id, refreshIntervalMs, shouldAutoRefresh]);

  const hasScorecard = Boolean(liveScorecard && liveScorecard.length > 0);
  const hasCommentary = Boolean(liveCommentary && liveCommentary.bbb.length > 0);
  const hasSquads = Boolean(liveSquads && liveSquads.length > 0);
  const lastUpdatedLabel = new Date(lastUpdated).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const primaryScore = getPrimaryScore(liveScorecard, liveCommentary, liveMatch.matchEnded);
  const scheduledOvers = getScheduledOvers(liveMatch.matchType);
  const teamScoreRows = getTeamScoreRows(liveMatch).sort((left, right) => {
    const leftPriority = scoreMatchesInningLabel(left.score, primaryScore?.inning.inning ?? "") ? 1 : 0;
    const rightPriority = scoreMatchesInningLabel(right.score, primaryScore?.inning.inning ?? "") ? 1 : 0;
    return rightPriority - leftPriority;
  });
  const teamHint = liveMatch.teamInfo[0]?.name ?? liveMatch.teams[0] ?? undefined;
  const tournamentHint = liveMatch.name.toUpperCase().includes("IPL") ? "IPL" : liveMatch.matchType;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Match Header */}
      <div className="mb-6 overflow-hidden rounded-[28px] border border-white/10 bg-[#171a1b] shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <div className="border-b border-white/8 px-6 py-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#a7a39a]">
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-semibold uppercase tracking-[0.18em] text-white/75">
              {liveMatch.matchType}
            </span>
            {isLive && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#ff5b5b]">
                <span className="h-2 w-2 rounded-full bg-[#ff5b5b] animate-pulse" />
                Live
              </span>
            )}
            <span>{liveMatch.date}</span>
            <span className="text-white/45">•</span>
            <span>{liveMatch.venue}</span>
          </div>
        </div>

        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.35fr,0.65fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#8e887d]">
              {liveMatch.name}
            </p>
            <div className="mt-4 space-y-4">
              {teamScoreRows.map(({ team, score }) => (
                <div key={team.shortname} className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-4">
                    {team.img ? (
                      <Image
                        src={team.img}
                        alt={team.shortname}
                        width={40}
                        height={40}
                        unoptimized
                        className="h-10 w-10 rounded-full object-cover ring-1 ring-white/10"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-sm font-bold text-white/80 ring-1 ring-white/10">
                        {team.shortname}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className={cn(
                        "truncate text-[18px] font-semibold tracking-tight",
                        scoreMatchesInningLabel(score, primaryScore?.inning.inning ?? "")
                          ? "text-white"
                          : "text-[#c5c0b6]"
                      )}>
                        {team.name}
                      </p>
                      <p className="mt-0.5 text-sm text-[#9b958b]">
                        {score ? score.inning : "Awaiting innings data"}
                      </p>
                    </div>
                  </div>

                  {score ? (
                    <div className="text-right">
                      <p className="text-[17px] font-bold text-white">
                        {score.r}/{score.w}
                      </p>
                      <p className="text-sm text-[#b5b0a5]">
                        ({score.o}{scheduledOvers ? `/${scheduledOvers}` : ""} ov)
                      </p>
                    </div>
                  ) : (
                    <div className="text-right text-sm text-[#8f8a80]">Yet to bat</div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-5 space-y-2 text-[#cbc6bc]">
              <p className="text-[22px] font-semibold leading-tight text-white">
                {liveMatch.status}
              </p>
              {primaryScore && (
                <>
                  <p className="text-[15px] text-[#b1ab9f]">
                    Current RR: <span className="font-semibold text-white">{primaryScore.runRate}</span>
                  </p>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#2d5a41] bg-[#102417] px-3 py-1.5 text-sm font-medium text-[#7be090]">
                    <BarChart3 size={14} />
                    Live Snapshot Ready
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="rounded-[24px] border border-white/8 bg-[#111415] p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8e887d]">
                Match Centre
              </p>
              <Link
                href={`/insights?matchId=${encodeURIComponent(liveMatch.id)}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-[#62b7ff] hover:text-[#8bc9ff]"
              >
                Stats view <ChevronRight size={16} />
              </Link>
            </div>

            <div className="mt-5 space-y-4 text-sm">
              <div className="flex items-center gap-2 text-[#d0cbc1]">
                <Radio size={14} className={cn(isLive ? "text-[#ff5b5b]" : "text-[#8e887d]")} />
                <span className="font-medium">{isLive ? "Live feed active" : "Match centre synced"}</span>
              </div>
              <p className="text-[#a7a39a]">
                Source <span className="font-semibold text-white">{liveSource}</span> · Updated {lastUpdatedLabel}
              </p>
              {shouldAutoRefresh && (
                <div className="flex items-center gap-2 text-[#a7a39a]">
                  <RefreshCw size={14} className={cn(isRefreshing ? "animate-spin text-[#31d260]" : "text-[#8e887d]")} />
                  <span>{isRefreshing ? "Refreshing live feed…" : `Auto-refresh every ${Math.round(refreshIntervalMs / 1000)}s`}</span>
                </div>
              )}
              {refreshError && (
                <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-amber-200">
                  {refreshError}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 overflow-x-auto border-b border-white/8">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "relative mr-8 whitespace-nowrap border-b-2 px-1 pb-4 pt-1 text-[17px] font-semibold tracking-tight transition-colors",
              activeTab === tab.id
                ? "border-[#38a3ff] text-[#66b9ff]"
                : "border-transparent text-[#b1ab9f] hover:text-white"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.85fr)_minmax(320px,1fr)]">
        <div className="min-w-0">
          {activeTab === "live" && primaryScore && (
            <div className="mb-6 overflow-hidden rounded-[24px] border border-white/8 bg-[#171a1b]">
              <div className="grid gap-px bg-white/8 lg:grid-cols-[1.3fr,0.9fr]">
                <div className="bg-[#171a1b] px-6 py-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8e887d]">
                    Top batters
                  </p>
                  <p className="mt-1 text-xs text-[#a79f94]">{primaryScore.batterContextLabel}</p>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[420px] text-sm">
                      <thead className="text-[#8f897f]">
                        <tr>
                          <th className="pb-3 text-left font-semibold">Name</th>
                          <th className="pb-3 text-center font-semibold">R</th>
                          <th className="pb-3 text-center font-semibold">B</th>
                          <th className="pb-3 text-center font-semibold">4s</th>
                          <th className="pb-3 text-center font-semibold">6s</th>
                          <th className="pb-3 text-center font-semibold">SR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {primaryScore.featuredBatters.map((entry) => (
                          <tr key={entry.batsman.id} className="border-t border-white/6 text-white">
                            <td className="py-3 pr-4 font-semibold">
                              {entry.batsman.name}
                              {entry.dismissal === "batting" && <span className="ml-1 text-[#31d260]">*</span>}
                            </td>
                            <td className="py-3 text-center">{entry.r}</td>
                            <td className="py-3 text-center text-[#c3bdb2]">{entry.b}</td>
                            <td className="py-3 text-center text-[#c3bdb2]">{entry["4s"]}</td>
                            <td className="py-3 text-center text-[#c3bdb2]">{entry["6s"]}</td>
                            <td className="py-3 text-center text-[#c3bdb2]">{entry.sr}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-[#171a1b] px-6 py-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8e887d]">
                    Top bowlers
                  </p>
                  <p className="mt-1 text-xs text-[#a79f94]">{primaryScore.bowlerContextLabel}</p>
                  <div className="mt-4 space-y-4">
                    {primaryScore.featuredBowlers.map((entry) => (
                      <div key={entry.bowler.id} className="border-b border-white/6 pb-4 last:border-b-0 last:pb-0">
                        <p className="text-base font-semibold text-white">{entry.bowler.name}</p>
                        <p className="mt-1 text-sm text-[#c3bdb2]">
                          {entry.o} ov · {entry.m} maidens · {entry.r} runs · {entry.w} wickets
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[#8e887d]">
                          Economy {entry.eco}
                        </p>
                      </div>
                    ))}
                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-[#c3bdb2]">
                      {primaryScore.inning.inning} · {primaryScore.inning.totalRuns}/{primaryScore.inning.totalWickets} ({formatOvers(primaryScore.inning.totalOvers)})
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "live" && (
            <LiveEdaPanel
              matchId={liveMatch.id}
              enabled={isLive}
            />
          )}
          {activeTab === "live" && isLive && (
            <LiveRecommendationBubble
              matchId={liveMatch.id}
              matchType={liveMatch.matchType}
              enabled={isLive}
              className="mt-4"
            />
          )}
          {activeTab === "live" && (
            <div className="mt-6">
              <MatchLiveCommentary
                matchId={liveMatch.id}
                matchName={liveMatch.name}
                matchType={liveMatch.matchType}
                isLive={isLive}
                canStartSession={canStartSession}
              />
            </div>
          )}
          {activeTab === "live" && hasCommentary && (
            <div className="mt-6">
              <CommentaryFeed commentary={liveCommentary!} />
            </div>
          )}
          {activeTab === "live" && !hasCommentary && (
            <div className="mt-6 rounded-xl border border-gray-800 bg-cg-dark-2 p-6 text-sm text-gray-400">
              {isUpcoming
                ? "Ball-by-ball commentary will appear here once the match goes live."
                : "Ball-by-ball commentary has not arrived yet. We’ll keep polling the API and place it here automatically."}
            </div>
          )}

          {/* Scorecard Tab — innings split view */}
          {activeTab === "scorecard" && hasScorecard && (
            <InningsSplitView
              scorecards={liveScorecard!}
              selectedInning={selectedInning}
              onSelectInning={setSelectedInning}
            />
          )}
          {activeTab === "scorecard" && !hasScorecard && (
            <div className="rounded-xl border border-gray-800 bg-cg-dark-2 p-6 text-sm text-gray-400">
              {isUpcoming
                ? "The full innings scorecard will appear once the first innings begins."
                : "Full scorecard data has not landed yet from the provider."}
            </div>
          )}

          {/* Commentary Tab */}
          {activeTab === "commentary" && hasCommentary && (
            <CommentaryFeed commentary={liveCommentary!} />
          )}
          {activeTab === "commentary" && !hasCommentary && (
            <div className="rounded-xl border border-gray-800 bg-cg-dark-2 p-6 text-sm text-gray-400">
              {isUpcoming
                ? "Ball-by-ball commentary unlocks when the match goes live."
                : "Ball-by-ball commentary has not arrived yet. We’ll keep polling the API."}
            </div>
          )}

          {/* Squads Tab */}
          {activeTab === "squads" && hasSquads && <SquadList squads={liveSquads!} />}
          {activeTab === "squads" && !hasSquads && (
            <div className="rounded-xl border border-gray-800 bg-cg-dark-2 p-6 text-sm text-gray-400">
              Squad data is not available for this fixture yet.
            </div>
          )}

          {/* Analysis Tab */}
          {activeTab === "analysis" && (
            <div className="space-y-6">
              <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-6">
                <h3 className="text-lg font-bold text-white mb-2">
                  Pre-Match Analysis
                </h3>
                <div className="text-gray-400 text-sm space-y-3">
                  <p>
                    Match previews now have a dedicated intelligence page with tactical
                    questions, pressure forecasts, linked commentary, and match-linked
                    blogs. Use it before the first ball to get the full context.
                  </p>
                  <div className="bg-cg-green/5 border border-cg-green/20 rounded-lg p-4">
                    <p className="text-cg-green text-xs font-bold uppercase mb-1">
                      Preview Centre
                    </p>
                    <p className="text-gray-300 text-sm">
                      {liveMatch.venue} — open the preview page for tactical angles,
                      matchup questions, and squad-based watchlists.
                    </p>
                    <Link
                      href={`/matches/${liveMatch.id}/preview`}
                      className="mt-3 inline-flex rounded-lg bg-cg-green px-3 py-2 text-xs font-bold text-black hover:bg-cg-green-dark"
                    >
                      Open Match Preview
                    </Link>
                  </div>
                </div>
              </div>
              <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-6">
                <h3 className="text-lg font-bold text-white mb-2">
                  AI Insights
                </h3>
                <p className="text-gray-400 text-sm">
                  Open the integrated T20 decision-support view for deeper live recommendations,
                  model evaluation, and player explorer tooling on top of the new in-page live EDA panel.
                </p>
                <Link
                  href={`/insights?matchId=${encodeURIComponent(liveMatch.id)}`}
                  className="mt-4 inline-flex rounded-lg border border-gray-700 bg-white/5 px-3 py-2 text-xs font-bold text-white hover:bg-white/10"
                >
                  Open AI Insights
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-[24px] border border-white/8 bg-[#171a1b] p-5">
            <h4 className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-[#8e887d]">Match Info</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#9e988d]">Type</span>
                <span className="text-white">{liveMatch.matchType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9e988d]">Date</span>
                <span className="text-white">{liveMatch.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9e988d]">Venue</span>
                <span className="text-white text-right text-xs max-w-[150px]">
                  {liveMatch.venue}
                </span>
              </div>
            </div>
            <div className="mt-5 space-y-2 border-t border-white/8 pt-5">
              <Link
                href={`/matches/${liveMatch.id}/preview`}
                className="block rounded-xl bg-white/[0.05] px-3 py-3 text-center text-xs font-semibold text-white hover:bg-white/[0.09]"
              >
                Match Preview Page
              </Link>
              <Link
                href={`/matches/${liveMatch.id}/post-match`}
                className="block rounded-xl bg-[#0f2a17] px-3 py-3 text-center text-xs font-semibold text-[#31d260] hover:bg-[#16361f]"
              >
                Post-Match Analysis Page
              </Link>
              <Link
                href={`/insights?matchId=${encodeURIComponent(liveMatch.id)}`}
                className="block rounded-xl bg-white/[0.05] px-3 py-3 text-center text-xs font-semibold text-white hover:bg-white/[0.09]"
              >
                AI Insights Page
              </Link>
            </div>
          </div>
          <CricketNewsSidebar
            limit={6}
            team={teamHint}
            tournament={tournamentHint}
          />
          <AdSlot slot="match-sidebar" format="rectangle" />
        </div>
      </div>
    </div>
  );
}
