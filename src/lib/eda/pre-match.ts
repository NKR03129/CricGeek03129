import { buildMatchPreviewIntel } from "@/lib/match-intelligence";
import { getCricketNews } from "@/lib/news/cricket-news-service";
import {
  deriveCompetitionLabel,
  buildConfidence,
  buildFreshness,
  buildMetricQuality,
  dedupeSources,
  round,
  shrinkRate,
} from "@/lib/eda/common";
import {
  getHeadToHeadSnapshot,
  getPlayerTrendSnapshots,
  getTeamFormSnapshot,
  getVenueSnapshot,
} from "@/lib/eda/historical";
import type { Match, Squad } from "@/types/cricket";
import type { PreMatchEdaReport } from "@/types/eda";
import type { MetricUncertainty } from "@/types/metrics";

function formatMetricInterval(interval?: MetricUncertainty | null) {
  if (!interval) return undefined;
  const unit = interval.unit ?? "";
  return `${interval.label} ${interval.lower}–${interval.upper}${unit}`;
}

function buildMatchupEdge(input: {
  teamA: string;
  teamB: string;
  teamAFormWins: number;
  teamAFormResolved: number;
  teamBFormWins: number;
  teamBFormResolved: number;
  h2hWinsA: number;
  h2hWinsB: number;
  h2hResolved: number;
}) {
  const teamAFormRate =
    input.teamAFormResolved > 0 ? input.teamAFormWins / input.teamAFormResolved : 0.5;
  const teamBFormRate =
    input.teamBFormResolved > 0 ? input.teamBFormWins / input.teamBFormResolved : 0.5;
  const priorRateA = (teamAFormRate + (1 - teamBFormRate)) / 2;
  const blendedRateA = shrinkRate(input.h2hWinsA, input.h2hResolved, priorRateA, 6);
  const blendedPct = round(blendedRateA * 100, 1);
  const leader =
    blendedPct >= 52.5 ? input.teamA : blendedPct <= 47.5 ? input.teamB : "Even";

  return {
    blendedPct,
    leader,
    priorPctA: round(priorRateA * 100, 1),
  };
}

export async function buildPreMatchEdaReport(match: Match, squads: Squad[] | null): Promise<PreMatchEdaReport> {
  const teamA = match.teams[0] || match.teamInfo[0]?.name || "Team A";
  const teamB = match.teams[1] || match.teamInfo[1]?.name || "Team B";

  const [intel, teamAForm, teamBForm, headToHead, venue, playerTrends, newsResult] = await Promise.all([
    buildMatchPreviewIntel(match, squads),
    getTeamFormSnapshot(teamA, match.matchType),
    getTeamFormSnapshot(teamB, match.matchType),
    getHeadToHeadSnapshot(teamA, teamB, match.matchType),
    getVenueSnapshot(match.venue, match.matchType),
    getPlayerTrendSnapshots(squads, match),
    getCricketNews({
      team: match.teams.join(" "),
      tournament: deriveCompetitionLabel(match),
      limit: 4,
    }),
  ]);
  const teamAResolved = teamAForm.resolvedMatches ?? teamAForm.wins + teamAForm.losses;
  const teamBResolved = teamBForm.resolvedMatches ?? teamBForm.wins + teamBForm.losses;
  const h2hResolved = headToHead.teamAWins + headToHead.teamBWins;
  const matchupEdge = buildMatchupEdge({
    teamA,
    teamB,
    teamAFormWins: teamAForm.wins,
    teamAFormResolved: teamAResolved,
    teamBFormWins: teamBForm.wins,
    teamBFormResolved: teamBResolved,
    h2hWinsA: headToHead.teamAWins,
    h2hWinsB: headToHead.teamBWins,
    h2hResolved,
  });
  const squadCandidateCount = squads
    ? [...new Set(
        squads.flatMap((squad) => squad.players.slice(0, 7).map((player) => player.name.toLowerCase()))
      )].length
    : 0;
  const chaseSampleSize = venue.chaseSampleSize ?? venue.sampleSize;
  const suppressChaseRate = chaseSampleSize > 0 && chaseSampleSize < 3;

  const cards = [
    {
      id: "team-a-form",
      label: `${teamA} form`,
      value: teamAForm.available ? `${teamAForm.wins}-${teamAForm.losses}-${teamAForm.noResult}` : "Waiting",
      insight: teamAForm.summary,
      tone: teamAForm.wins >= teamAForm.losses ? "good" as const : "neutral" as const,
      subValue: teamAForm.avgRuns !== null ? `Avg ${teamAForm.avgRuns} runs` : undefined,
      quality: buildMetricQuality({
        sampleSize: teamAForm.sampleSize,
        provenance: "historical",
        confidence: teamAForm.confidence,
        warning: teamAForm.warning,
        uncertainty: teamAForm.winPctInterval ?? null,
      }),
    },
    {
      id: "team-b-form",
      label: `${teamB} form`,
      value: teamBForm.available ? `${teamBForm.wins}-${teamBForm.losses}-${teamBForm.noResult}` : "Waiting",
      insight: teamBForm.summary,
      tone: teamBForm.wins >= teamBForm.losses ? "good" as const : "neutral" as const,
      subValue: teamBForm.avgRuns !== null ? `Avg ${teamBForm.avgRuns} runs` : undefined,
      quality: buildMetricQuality({
        sampleSize: teamBForm.sampleSize,
        provenance: "historical",
        confidence: teamBForm.confidence,
        warning: teamBForm.warning,
        uncertainty: teamBForm.winPctInterval ?? null,
      }),
    },
    {
      id: "head-to-head",
      label: "Matchup edge",
      value:
        matchupEdge.leader === "Even"
          ? "Near even"
          : `${matchupEdge.blendedPct}% ${matchupEdge.leader}`,
      insight:
        h2hResolved > 0
          ? `Blended direct history with recent team strength. Raw meetings sit at ${headToHead.teamAWins}-${headToHead.teamBWins}, while the form-based prior gives ${teamA} a ${matchupEdge.priorPctA}% starting edge.`
          : `No direct warehouse meetings were available, so this matchup edge falls back to recent team form alone (${teamA} prior ${matchupEdge.priorPctA}%).`,
      subValue: headToHead.available ? `Raw H2H ${headToHead.teamAWins}-${headToHead.teamBWins}` : "Form prior only",
      tone:
        matchupEdge.leader === teamA || matchupEdge.leader === teamB
          ? "good" as const
          : "neutral" as const,
      quality: buildMetricQuality({
        sampleSize: headToHead.sampleSize,
        provenance: "blended",
        confidence: headToHead.confidence,
        warning: headToHead.warning ?? (h2hResolved === 0 ? "No direct head-to-head sample was available; this is a form-prior estimate." : null),
        uncertainty: headToHead.rawWinInterval ?? null,
      }),
    },
    {
      id: "venue-benchmark",
      label: "Venue first-innings mean",
      value: venue.avgFirstInningsScore !== null ? `${venue.avgFirstInningsScore}` : "Waiting",
      insight: venue.summary,
      tone: venue.avgFirstInningsScore !== null ? "good" as const : "warning" as const,
      subValue: formatMetricInterval(venue.avgFirstInningsInterval),
      quality: buildMetricQuality({
        sampleSize: venue.sampleSize,
        provenance: "historical",
        confidence: venue.confidence,
        warning: venue.warning,
        uncertainty: venue.avgFirstInningsInterval ?? null,
      }),
    },
    {
      id: "chase-rate",
      label: "Venue chase wins",
      value:
        suppressChaseRate
          ? "Suppressed"
          : venue.chaseWinPct !== null
            ? `${venue.chaseWinPct}%`
            : "Waiting",
      insight:
        suppressChaseRate
          ? `${venue.venue} only has ${chaseSampleSize} completed comparable chase${chaseSampleSize === 1 ? "" : "s"}, so the chase split is hidden until the sample is more stable.`
          : venue.chaseWinPct !== null
            ? `${venue.venue} has seen chasing sides win ${venue.chaseWinPct}% of ${chaseSampleSize} completed comparable warehouse matches.`
            : "Chase split becomes available once enough venue history has been imported.",
      subValue: formatMetricInterval(venue.chaseWinInterval),
      tone:
        !suppressChaseRate && venue.chaseWinPct !== null && venue.chaseWinPct >= 55
          ? "warning" as const
          : "neutral" as const,
      quality: buildMetricQuality({
        sampleSize: chaseSampleSize,
        provenance: "historical",
        confidence: chaseSampleSize >= 12 ? "high" : chaseSampleSize >= 5 ? "medium" : "low",
        warning:
          suppressChaseRate
            ? `Suppressed because only ${chaseSampleSize} completed comparable chases exist for this venue.`
            : venue.warning,
        suppressed: suppressChaseRate,
        uncertainty: venue.chaseWinInterval ?? null,
      }),
    },
    {
      id: "lineup-coverage",
      label: "Lineup history coverage",
      value: squadCandidateCount > 0 ? `${playerTrends.length}/${squadCandidateCount}` : `${playerTrends.length}`,
      insight:
        squadCandidateCount > 0
          ? `${playerTrends.length} of ${squadCandidateCount} likely squad players have recent warehouse history to anchor the preview.`
          : playerTrends.length > 0
            ? `${playerTrends[0].name}${playerTrends.length > 1 ? ` and ${playerTrends.length - 1} more squad players` : ""} have recent warehouse form to compare against this matchup.`
            : "Lineup and warehouse history will enrich this card once enough comparable player data exists.",
      tone: playerTrends.length > 0 ? "good" as const : "neutral" as const,
      quality: buildMetricQuality({
        sampleSize: squadCandidateCount || playerTrends.length,
        provenance: "observed",
      }),
    },
  ];

  const reasons = [
    "SportMonks fixture data is available for the live match shell.",
    teamAForm.available && teamBForm.available
      ? "Historical warehouse team-form snapshots were available."
      : "Historical warehouse team-form snapshots were limited.",
    venue.available ? "Venue benchmark data was available." : "Venue benchmark data was limited.",
    newsResult.articles.length > 0
      ? "Recent cricket news context was available."
      : "No live news context was available for this briefing.",
  ];

  const confidenceScore =
    45 +
    (teamAForm.available ? 10 : 0) +
    (teamBForm.available ? 10 : 0) +
    (headToHead.available ? 10 : 0) +
    (venue.available ? 10 : 0) +
    (playerTrends.length > 0 ? 5 : 0) +
    (newsResult.articles.length > 0 ? 10 : 0);

  const sources = dedupeSources([
    {
      id: "sportmonks-fixture",
      type: "sportmonks" as const,
      title: match.name,
      note: "Live fixture shell and squads came from SportMonks-backed match routes.",
      updatedAt: match.dateTimeGMT || null,
    },
    {
      id: "warehouse-team-form",
      type: "historical_warehouse" as const,
      title: "Historical team form",
      note: `${teamAForm.summary} ${teamBForm.summary}`,
    },
    {
      id: "warehouse-venue",
      type: "historical_warehouse" as const,
      title: "Venue benchmark",
      note: venue.summary,
    },
    ...newsResult.articles.map((article) => ({
      id: article.id,
      type: "news" as const,
      title: article.title,
      note: article.description || article.sourceName,
      url: article.articleUrl,
      updatedAt: article.publishedAt,
    })),
      {
        id: "llm-preview",
        type: "llm" as const,
        title: "Preview narrative",
        note: "Narrative summary generated from deterministic match, squad, and warehouse context.",
      },
      ...playerTrends.map((player) => ({
        id: `player-trend-${player.name}`,
        type: "historical_warehouse" as const,
        title: `${player.name} trend`,
        note: player.summary,
      })),
    ]);

  return {
    match,
    squads,
    summary: intel.summary,
    cards,
    keyQuestions: intel.keyQuestions,
    tacticalAngles: intel.tacticalAngles,
    watchPlayers: intel.watchPlayers,
    predictedPressurePhase: intel.predictedPressurePhase,
    historical: {
      teamForms: [teamAForm, teamBForm],
      headToHead,
      venue,
      playerTrends,
    },
    relatedNews: newsResult.articles,
    confidence: buildConfidence(confidenceScore, reasons),
    freshness: buildFreshness({
      match,
      historicalAvailable: teamAForm.available || teamBForm.available || headToHead.available || venue.available,
      newsUpdatedAt: newsResult.articles[0]?.publishedAt ?? newsResult.updatedAt ?? null,
      notes: [
        "Pre-match briefing blends SportMonks fixture context, local historical warehouse data, and recent cricket news when available.",
      ],
    }),
    sources,
  };
}
