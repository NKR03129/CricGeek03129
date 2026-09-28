import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getHistoricalWarehouseStatus, normaliseKey } from "@/lib/historical-warehouse";
import type {
  HistoricalHeadToHeadSnapshot,
  HistoricalPlayerTrend,
  HistoricalTeamFormSnapshot,
  HistoricalVenueSnapshot,
} from "@/types/eda";
import type { Match, Squad } from "@/types/cricket";
import {
  average,
  confidenceTierFromSample,
  lowSampleWarning,
  meanInterval,
  pct,
  round,
  warehouseMatchType,
  wilsonInterval,
} from "@/lib/eda/common";

function buildMatchTypeFilter(matchType: string): Prisma.HistoricalMatchWhereInput {
  const normalized = warehouseMatchType(matchType);

  if (!normalized) {
    return {};
  }

  if (normalized === "T20") {
    return {
      matchType: {
        startsWith: "T20",
      },
    };
  }

  return {
    matchType: {
      equals: normalized,
    },
  };
}

function unavailableTeamForm(team: string, reason: string): HistoricalTeamFormSnapshot {
  return {
    team,
    available: false,
    sampleSize: 0,
    confidence: "low",
    warning: reason,
    wins: 0,
    losses: 0,
    noResult: 0,
    resolvedMatches: 0,
    winPct: null,
    winPctInterval: null,
    avgRuns: null,
    recentRecord: [],
    summary: reason,
  };
}

export async function getTeamFormSnapshot(team: string, matchType: string): Promise<HistoricalTeamFormSnapshot> {
  const status = await getHistoricalWarehouseStatus();
  if (!status.available) {
    return unavailableTeamForm(team, status.error ?? "Historical warehouse is unavailable.");
  }

  const teamKey = normaliseKey(team);
  if (!teamKey) {
    return unavailableTeamForm(team, "Team name could not be normalized for the historical warehouse.");
  }

  const matches = await prisma.historicalMatch.findMany({
    where: {
      ...buildMatchTypeFilter(matchType),
      OR: [{ teamAKey: teamKey }, { teamBKey: teamKey }],
    },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    take: 5,
    select: {
      id: true,
      winnerKey: true,
      startedAt: true,
    },
  });

  if (matches.length === 0) {
    return unavailableTeamForm(team, `No ${matchType} history was found for ${team}.`);
  }

  const wins = matches.filter((match) => match.winnerKey === teamKey).length;
  const losses = matches.filter((match) => match.winnerKey && match.winnerKey !== teamKey).length;
  const noResult = matches.filter((match) => !match.winnerKey).length;
  const resolvedMatches = wins + losses;
  const recentRecord = matches.map((match) => {
    if (!match.winnerKey) return "NR";
    return match.winnerKey === teamKey ? "W" : "L";
  });

  const battingRows = await prisma.historicalBattingInnings.findMany({
    where: {
      matchId: { in: matches.map((match) => match.id) },
      inningsTeamKey: teamKey,
    },
    select: {
      matchId: true,
      runs: true,
    },
  });

  const totalsByMatch = new Map<string, number>();
  for (const row of battingRows) {
    totalsByMatch.set(row.matchId, (totalsByMatch.get(row.matchId) ?? 0) + row.runs);
  }

  const avgRuns = totalsByMatch.size > 0 ? round(average([...totalsByMatch.values()]), 1) : null;
  const sampleSize = matches.length;
  const warning = lowSampleWarning(sampleSize, { medium: 3, high: 5 });
  const confidence = confidenceTierFromSample(sampleSize, { medium: 3, high: 5 });
  const winPct = resolvedMatches > 0 ? pct(wins, resolvedMatches) : null;

  return {
    team,
    available: true,
    sampleSize,
    confidence,
    warning,
    wins,
    losses,
    noResult,
    resolvedMatches,
    winPct,
    winPctInterval: resolvedMatches > 0 ? wilsonInterval(wins, resolvedMatches) : null,
    avgRuns,
    recentRecord,
    summary:
      avgRuns !== null
        ? `${team} are ${wins}-${losses}-${noResult} in their last ${sampleSize} warehouse matches, averaging ${avgRuns} runs.${warning ? ` ${warning}` : ""}`
        : `${team} are ${wins}-${losses}-${noResult} in their last ${sampleSize} warehouse matches.${warning ? ` ${warning}` : ""}`,
  };
}

function unavailableHeadToHead(teamA: string, teamB: string, reason: string): HistoricalHeadToHeadSnapshot {
  return {
    available: false,
    teamA,
    teamB,
    sampleSize: 0,
    confidence: "low",
    warning: reason,
    teamAWins: 0,
    teamBWins: 0,
    noResult: 0,
    rawTeamAWinPct: null,
    rawWinInterval: null,
    recentEdge: "Unavailable",
    summary: reason,
  };
}

export async function getHeadToHeadSnapshot(
  teamA: string,
  teamB: string,
  matchType: string
): Promise<HistoricalHeadToHeadSnapshot> {
  const status = await getHistoricalWarehouseStatus();
  if (!status.available) {
    return unavailableHeadToHead(teamA, teamB, status.error ?? "Historical warehouse is unavailable.");
  }

  const teamAKey = normaliseKey(teamA);
  const teamBKey = normaliseKey(teamB);
  if (!teamAKey || !teamBKey) {
    return unavailableHeadToHead(teamA, teamB, "Teams could not be normalized for the historical warehouse.");
  }

  const matches = await prisma.historicalMatch.findMany({
    where: {
      ...buildMatchTypeFilter(matchType),
      OR: [
        { teamAKey, teamBKey },
        { teamAKey: teamBKey, teamBKey: teamAKey },
      ],
    },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    take: 12,
    select: {
      winnerKey: true,
      startedAt: true,
    },
  });

  if (matches.length === 0) {
    return unavailableHeadToHead(teamA, teamB, `No ${matchType} head-to-head history was found for ${teamA} vs ${teamB}.`);
  }

  const teamAWins = matches.filter((match) => match.winnerKey === teamAKey).length;
  const teamBWins = matches.filter((match) => match.winnerKey === teamBKey).length;
  const noResult = matches.length - teamAWins - teamBWins;
  const resolvedMatches = teamAWins + teamBWins;
  const sampleSize = matches.length;
  const confidence = confidenceTierFromSample(sampleSize, { medium: 5, high: 10 });
  const warning = lowSampleWarning(sampleSize, { medium: 5, high: 10 });
  const recentEdge =
    teamAWins === teamBWins
      ? "Even"
      : teamAWins > teamBWins
        ? `${teamA} edge`
        : `${teamB} edge`;

  return {
    available: true,
    teamA,
    teamB,
    sampleSize,
    confidence,
    warning,
    teamAWins,
    teamBWins,
    noResult,
    rawTeamAWinPct: resolvedMatches > 0 ? pct(teamAWins, resolvedMatches) : null,
    rawWinInterval: resolvedMatches > 0 ? wilsonInterval(teamAWins, resolvedMatches) : null,
    recentEdge,
    summary:
      `${teamA} lead ${teamAWins}-${teamBWins}${noResult > 0 ? ` with ${noResult} no-result matches` : ""} in ${sampleSize} warehouse meetings.` +
      (warning ? ` ${warning}` : ""),
  };
}

function unavailableVenue(venue: string, reason: string): HistoricalVenueSnapshot {
  return {
    venue,
    available: false,
    sampleSize: 0,
    chaseSampleSize: 0,
    confidence: "low",
    warning: reason,
    avgFirstInningsScore: null,
    avgFirstInningsInterval: null,
    chaseWinPct: null,
    chaseWinInterval: null,
    summary: reason,
  };
}

export async function getVenueSnapshot(venue: string, matchType: string): Promise<HistoricalVenueSnapshot> {
  const status = await getHistoricalWarehouseStatus();
  if (!status.available) {
    return unavailableVenue(venue, status.error ?? "Historical warehouse is unavailable.");
  }

  const venueKey = normaliseKey(venue.split(",")[0] || venue);
  if (!venueKey) {
    return unavailableVenue(venue, "Venue could not be normalized for the historical warehouse.");
  }

  const baseWhere = buildMatchTypeFilter(matchType);
  let matches = await prisma.historicalMatch.findMany({
    where: {
      ...baseWhere,
      venueKey: {
        startsWith: venueKey,
      },
    },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    take: 80,
    select: {
      id: true,
      winnerKey: true,
    },
  });

  if (matches.length === 0) {
    matches = await prisma.historicalMatch.findMany({
      where: {
        ...baseWhere,
        venueKey: {
          contains: venueKey,
        },
      },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
      take: 80,
      select: {
        id: true,
        winnerKey: true,
      },
    });
  }

  if (matches.length === 0) {
    return unavailableVenue(venue, `No ${matchType} venue history was found for ${venue}.`);
  }

  const matchIds = matches.map((match) => match.id);
  const firstInningsRows = await prisma.historicalBattingInnings.findMany({
    where: {
      matchId: { in: matchIds },
      inningsNumber: 1,
    },
    select: {
      matchId: true,
      runs: true,
    },
  });
  const secondInningsRows = await prisma.historicalBattingInnings.findMany({
    where: {
      matchId: { in: matchIds },
      inningsNumber: 2,
    },
    select: {
      matchId: true,
      inningsTeamKey: true,
    },
  });

  const firstInningsTotals = new Map<string, number>();
  for (const row of firstInningsRows) {
    firstInningsTotals.set(row.matchId, (firstInningsTotals.get(row.matchId) ?? 0) + row.runs);
  }

  const chasingTeamByMatch = new Map<string, string>();
  for (const row of secondInningsRows) {
    if (!chasingTeamByMatch.has(row.matchId)) {
      chasingTeamByMatch.set(row.matchId, row.inningsTeamKey);
    }
  }

  const chaseWins = matches.filter((match) => {
    const chasingTeamKey = chasingTeamByMatch.get(match.id);
    return chasingTeamKey && match.winnerKey === chasingTeamKey;
  }).length;
  const comparableChases = matches.filter((match) => {
    const chasingTeamKey = chasingTeamByMatch.get(match.id);
    return Boolean(chasingTeamKey && match.winnerKey);
  }).length;
  const firstInningsValues = [...firstInningsTotals.values()];
  const sampleSize = matches.length;
  const warning = lowSampleWarning(sampleSize, { medium: 5, high: 12 });
  const confidence = confidenceTierFromSample(sampleSize, { medium: 5, high: 12 });
  const avgFirstInningsScore =
    firstInningsValues.length > 0 ? round(average(firstInningsValues), 1) : null;

  return {
    venue,
    available: true,
    sampleSize,
    chaseSampleSize: comparableChases,
    confidence,
    warning,
    avgFirstInningsScore,
    avgFirstInningsInterval: meanInterval(firstInningsValues),
    chaseWinPct: comparableChases > 0 ? pct(chaseWins, comparableChases) : null,
    chaseWinInterval: comparableChases > 0 ? wilsonInterval(chaseWins, comparableChases) : null,
    summary:
      avgFirstInningsScore !== null
        ? `${venue} has ${sampleSize} comparable warehouse matches with an average first-innings score of ${avgFirstInningsScore}.${warning ? ` ${warning}` : ""}`
        : `${venue} has ${sampleSize} comparable warehouse matches in the local history.${warning ? ` ${warning}` : ""}`,
  };
}

export async function getPlayerTrendSnapshots(
  squads: Squad[] | null,
  match: Match
): Promise<HistoricalPlayerTrend[]> {
  const status = await getHistoricalWarehouseStatus();
  if (!status.available || !squads || squads.length === 0) {
    return [];
  }

  const candidates = squads.flatMap((squad) =>
    squad.players.slice(0, 7).map((player) => ({
      name: player.name,
      team: squad.teamName,
      key: normaliseKey(player.name),
    }))
  );

  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.key, candidate])).values()]
    .filter((candidate) => candidate.key);

  if (uniqueCandidates.length === 0) {
    return [];
  }

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);

  const nameKeys = uniqueCandidates.map((candidate) => candidate.key);
  const matchFilter = {
    ...buildMatchTypeFilter(match.matchType),
    startedAt: {
      gte: cutoff,
    },
  } satisfies Prisma.HistoricalMatchWhereInput;

  const battingRows = await prisma.historicalBattingInnings.findMany({
    where: {
      playerNameKey: { in: nameKeys },
      historicalMatch: matchFilter,
    },
    select: {
      playerName: true,
      playerNameKey: true,
      runs: true,
      balls: true,
      notOut: true,
    },
  });
  const bowlingRows = await prisma.historicalBowlingInnings.findMany({
    where: {
      playerNameKey: { in: nameKeys },
      historicalMatch: matchFilter,
    },
    select: {
      playerNameKey: true,
      wickets: true,
    },
  });

  const battingByPlayer = new Map<
    string,
    { name: string; runs: number; balls: number; innings: number; dismissals: number }
  >();
  for (const row of battingRows) {
    const current = battingByPlayer.get(row.playerNameKey) ?? {
      name: row.playerName,
      runs: 0,
      balls: 0,
      innings: 0,
      dismissals: 0,
    };
    current.runs += row.runs;
    current.balls += row.balls;
    current.innings += 1;
    current.dismissals += row.notOut ? 0 : 1;
    battingByPlayer.set(row.playerNameKey, current);
  }

  const wicketsByPlayer = new Map<string, number>();
  for (const row of bowlingRows) {
    wicketsByPlayer.set(row.playerNameKey, (wicketsByPlayer.get(row.playerNameKey) ?? 0) + row.wickets);
  }

  return uniqueCandidates
    .map((candidate) => {
      const batting = battingByPlayer.get(candidate.key);
      const wickets = wicketsByPlayer.get(candidate.key) ?? 0;
      const sampleSize = batting?.innings ?? 0;
      if (!batting && wickets === 0) return null;

      const battingAverage =
        batting && batting.dismissals > 0 ? round(batting.runs / batting.dismissals, 2) : null;
      const strikeRate =
        batting && batting.balls > 0 ? round((batting.runs * 100) / batting.balls, 2) : null;

      return {
        name: batting?.name || candidate.name,
        team: candidate.team,
        sampleSize,
        battingRuns: batting?.runs ?? 0,
        wickets,
        battingAverage,
        strikeRate,
        summary:
          batting && wickets > 0
            ? `${candidate.name} has ${batting.runs} runs and ${wickets} wickets in the last year of comparable warehouse history.`
            : batting
              ? `${candidate.name} has ${batting.runs} runs across ${sampleSize} comparable innings in the last year.`
              : `${candidate.name} has ${wickets} wickets in the last year of comparable warehouse history.`,
      } satisfies HistoricalPlayerTrend;
    })
    .filter((entry): entry is HistoricalPlayerTrend => Boolean(entry))
    .sort((left, right) => {
      if (right.battingRuns !== left.battingRuns) return right.battingRuns - left.battingRuns;
      return right.wickets - left.wickets;
    })
    .slice(0, 6);
}
