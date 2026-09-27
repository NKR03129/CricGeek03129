import "server-only";

import { prisma } from "@/lib/db";
import { getMatchInfo, getMatchSquad } from "@/lib/cricket-api";
import { getManualAliasesForPlayer } from "@/lib/commentary-player-correction";
import { extractTeamHintsFromTitle, formatCommentaryTitleFromCodes } from "@/lib/commentary-team-lookup";
import { getSMTeamRostersForHints, isSportMonksConfigured } from "@/lib/sportmonks";

export interface MatchContextPlayer {
  name: string;
  role?: string;
  team?: string;
  aliases?: string[];
}

export async function getCommentarySessionMatchContext(sessionId: string | null) {
  if (!sessionId) {
    return {
      keyterms: [] as string[],
      playerNames: [] as string[],
      players: [] as MatchContextPlayer[],
    };
  }

  const commentarySession = await prisma.liveCommentarySession.findUnique({
    where: { id: sessionId },
    select: { matchId: true, matchName: true, matchType: true },
  });

  if (!commentarySession) {
    return {
      keyterms: [] as string[],
      playerNames: [] as string[],
      players: [] as MatchContextPlayer[],
    };
  }

  // ── 1. Fetch via matchId (existing behaviour) ───────────────────────────
  const [match, squads] = await Promise.all([
    getMatchInfo(commentarySession.matchId, { fresh: true }),
    getMatchSquad(commentarySession.matchId, { fresh: true }),
  ]);

  const terms = new Set<string>();
  const playerNames = new Set<string>();
  const players: MatchContextPlayer[] = [];

  const addTerm = (value?: string | null) => {
    const term = value?.trim();
    if (term) terms.add(term);
  };

  addTerm(commentarySession.matchName);
  addTerm(commentarySession.matchType);

  for (const team of match?.teams ?? []) addTerm(team);
  for (const teamInfo of match?.teamInfo ?? []) {
    addTerm(teamInfo.name);
    addTerm(teamInfo.shortname);
  }

  const addPlayersFromSquad = (squad: { teamName: string; shortname: string; players: Array<{ name?: string; role?: string }> }) => {
    addTerm(squad.teamName);
    addTerm(squad.shortname);
    for (const player of squad.players) {
      const name = player.name?.trim();
      if (!name || playerNames.has(name)) continue;
      addTerm(name);
      playerNames.add(name);
      players.push({
        name,
        role: normalisePlayerRole(player.role?.trim() || "") || undefined,
        team: squad.teamName || undefined,
        aliases: getManualAliasesForPlayer(name),
      });
    }
  };

  for (const squad of squads ?? []) addPlayersFromSquad(squad);

  // ── 2. Title-based team roster lookup ──────────────────────────────────
  // Parse team names / codes from the session title (e.g. "KKR", "MI", "India")
  // and fetch their rosters from SportMonks. This enriches the context even
  // for test sessions that aren't tied to a real live match.
  if (isSportMonksConfigured()) {
    const canonicalTitle =
      match?.teamInfo && match.teamInfo.length >= 2
        ? formatCommentaryTitleFromCodes(match.teamInfo[0].shortname, match.teamInfo[1].shortname)
        : commentarySession.matchName;
    const hints = extractTeamHintsFromTitle(canonicalTitle);
    if (hints.length > 0) {
      const titleSquads = await getSMTeamRostersForHints(hints);
      for (const squad of titleSquads) addPlayersFromSquad(squad);
    }
  }

  return {
    keyterms: [...terms],
    playerNames: [...playerNames],
    players,
  };
}

/**
 * Map SportMonks / CricAPI role strings into clean labels Qwen can use.
 * e.g. "Bowling Allrounder" → "All-rounder (Bowler)"
 */
function normalisePlayerRole(raw: string): string {
  const lower = raw.toLowerCase();
  if (!lower) return "";
  if (lower.includes("wk") || lower.includes("wicket")) {
    return lower.includes("bat") ? "Wicket-keeper Batter" : "Wicket-keeper";
  }
  if (lower.includes("allround") || lower.includes("all-round") || lower.includes("all round")) {
    if (lower.includes("bowl")) return "All-rounder (Bowler)";
    if (lower.includes("bat")) return "All-rounder (Batter)";
    return "All-rounder";
  }
  if (lower.includes("bowl")) return "Bowler";
  if (lower.includes("bat")) return "Batter";
  return raw;
}
