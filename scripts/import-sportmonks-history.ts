/**
 * import-sportmonks-history.ts
 *
 * Backfills the CricGeek historical fact-checking warehouse by fetching
 * completed fixtures from the SportMonks Cricket API v2 and upserting
 * them into the Prisma historical tables (HistoricalMatch,
 * HistoricalBattingInnings, HistoricalBowlingInnings, HistoricalPlayerAlias).
 *
 * Usage:
 *   npx tsx scripts/import-sportmonks-history.ts [options]
 *
 * Options:
 *   --pages <n>          Number of fixture pages to fetch (default: 5)
 *   --per-page <n>       Results per page (default: 100, max: 100)
 *   --match-type <type>  Filter by type, e.g. Test, ODI, T20I (optional)
 *   --days-back <n>      Only import fixtures started within last N days (0 = all, default: 0)
 *   --dry-run            Parse fixtures but do not write to DB
 *   --help               Show help
 *
 * Example:
 *   npx tsx scripts/import-sportmonks-history.ts --pages 10 --match-type ODI
 */

import { prisma } from "@/lib/db";
import {
  buildHistoricalImportBundleFromSportMonks,
  type SMFixtureForImport,
} from "@/lib/historical-warehouse";

const BASE_URL =
  process.env.SPORTMONKS_BASE_URL || "https://cricket.sportmonks.com/api/v2.0";
const API_TOKEN = process.env.SPORTMONKS_API_TOKEN || "";

const FIXTURE_PAGE_INCLUDES =
  "localteam,visitorteam,league,venue,season";
// Includes needed to build batting/bowling rows
const IMPORT_INCLUDES =
  "localteam,visitorteam,runs,batting,bowling,lineup,league,venue,season,manofmatch";

// ── Arg parsing ───────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags.set(token, true);
      continue;
    }
    flags.set(token, next);
    i++;
  }

  const get = (key: string, fallback: string) => {
    const v = flags.get(key);
    return typeof v === "string" ? v : fallback;
  };

  return {
    pages: Math.max(1, Number.parseInt(get("--pages", "5"), 10) || 5),
    perPage: Math.min(100, Math.max(1, Number.parseInt(get("--per-page", "100"), 10) || 100)),
    matchType: get("--match-type", ""),
    daysBack: Number.parseInt(get("--days-back", "0"), 10) || 0,
    dryRun: flags.get("--dry-run") === true,
    help: flags.get("--help") === true,
  };
}

// ── SportMonks fetch helper ───────────────────────────────────────────

async function smFetch<T>(
  path: string,
  params: Record<string, string>
): Promise<{ data: T; meta?: { pagination?: { current_page: number; total_pages: number } } } | null> {
  if (!API_TOKEN) {
    console.error("[import] SPORTMONKS_API_TOKEN is not set.");
    return null;
  }

  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("api_token", API_TOKEN);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[import] SportMonks ${path} → ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.json() as { data: T; meta?: { pagination?: { current_page: number; total_pages: number } } };
  } catch (err) {
    console.warn("[import] Fetch error:", err);
    return null;
  }
}

function needsFixtureHydration(fixture: SMFixtureForImport): boolean {
  return (
    !Array.isArray(fixture.runs) ||
    fixture.runs.length === 0 ||
    !Array.isArray(fixture.batting) ||
    fixture.batting.length === 0 ||
    !Array.isArray(fixture.bowling) ||
    fixture.bowling.length === 0 ||
    !Array.isArray(fixture.lineup) ||
    fixture.lineup.length === 0
  );
}

async function fetchFixtureDetail(fixtureId: number): Promise<SMFixtureForImport | null> {
  const response = await smFetch<SMFixtureForImport>(`/fixtures/${fixtureId}`, {
    include: IMPORT_INCLUDES,
  });

  return response?.data ?? null;
}

// ── Upsert one bundle ─────────────────────────────────────────────────

async function upsertBundle(
  bundle: ReturnType<typeof buildHistoricalImportBundleFromSportMonks>,
  dryRun: boolean
): Promise<boolean> {
  if (!bundle) return false;

  if (dryRun) {
    console.log(
      `[dry-run] Would import ${bundle.match.teamA} vs ${bundle.match.teamB} (${bundle.match.sourceMatchId}) — ${bundle.battingRows.length} batting, ${bundle.bowlingRows.length} bowling rows`
    );
    return true;
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.historicalMatch.upsert({
        where: {
          source_sourceMatchId: {
            source: "sportmonks",
            sourceMatchId: bundle.match.sourceMatchId,
          },
        },
        create: bundle.match,
        update: {
          startedAt: bundle.match.startedAt,
          season: bundle.match.season,
          matchType: bundle.match.matchType,
          eventName: bundle.match.eventName,
          eventNameKey: bundle.match.eventNameKey,
          venue: bundle.match.venue,
          venueKey: bundle.match.venueKey,
          city: bundle.match.city,
          teamA: bundle.match.teamA,
          teamAKey: bundle.match.teamAKey,
          teamB: bundle.match.teamB,
          teamBKey: bundle.match.teamBKey,
          winner: bundle.match.winner,
          winnerKey: bundle.match.winnerKey,
          resultText: bundle.match.resultText,
          playerOfMatch: bundle.match.playerOfMatch,
        },
      });

      // Replace batting/bowling rows with latest data
      await tx.historicalBattingInnings.deleteMany({ where: { matchId: bundle.match.id } });
      await tx.historicalBowlingInnings.deleteMany({ where: { matchId: bundle.match.id } });

      if (bundle.battingRows.length > 0) {
        await tx.historicalBattingInnings.createMany({ data: bundle.battingRows });
      }
      if (bundle.bowlingRows.length > 0) {
        await tx.historicalBowlingInnings.createMany({ data: bundle.bowlingRows });
      }
      if (bundle.aliases.length > 0) {
        await tx.historicalPlayerAlias.createMany({
          data: bundle.aliases,
          skipDuplicates: true,
        });
      }
    },
    { maxWait: 15_000, timeout: 60_000 }
  );

  return true;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`
SportMonks → Historical Warehouse Importer

Usage:
  npx tsx scripts/import-sportmonks-history.ts [options]

Options:
  --pages <n>          Fixture pages to fetch (default: 5)
  --per-page <n>       Per page (default: 100, max 100)
  --match-type <type>  Filter e.g. Test, ODI, T20I (optional)
  --days-back <n>      Only import last N days (0 = all, default: 0)
  --dry-run            Do not write to DB
  --help               This message
`);
    return;
  }

  if (!API_TOKEN) {
    console.error("[import] SPORTMONKS_API_TOKEN is not set. Aborting.");
    process.exit(1);
  }

  const cutoffDate =
    args.daysBack > 0
      ? new Date(Date.now() - args.daysBack * 86_400_000)
      : null;

  console.log(
    `[import] Starting SportMonks historical import. Pages: ${args.pages}, perPage: ${args.perPage}${args.matchType ? `, matchType: ${args.matchType}` : ""}${args.dryRun ? " [DRY RUN]" : ""}`
  );

  let imported = 0;
  let skipped = 0;
  let pagesFetched = 0;
  let totalPages = args.pages;

  for (let page = 1; page <= totalPages; page++) {
    const params: Record<string, string> = {
      include: FIXTURE_PAGE_INCLUDES,
      per_page: String(args.perPage),
      page: String(page),
      // Only finished matches have batting/bowling data
      "filter[status]": "Finished",
    };

    if (args.matchType) {
      params["filter[type]"] = args.matchType;
    }

    console.log(`[import] Fetching page ${page}/${totalPages}…`);
    const response = await smFetch<SMFixtureForImport[]>("/fixtures", params);

    if (!response?.data || !Array.isArray(response.data)) {
      console.warn(`[import] Page ${page}: no data returned, stopping.`);
      break;
    }

    pagesFetched++;

    // Update total pages from API metadata on first fetch
    if (page === 1 && response.meta?.pagination?.total_pages) {
      totalPages = Math.min(args.pages, response.meta.pagination.total_pages);
      console.log(
        `[import] API reports ${response.meta.pagination.total_pages} total pages. Will process ${totalPages}.`
      );
    }

    const fixtures = response.data;
    console.log(`[import] Page ${page}: ${fixtures.length} fixtures received.`);

    for (const fixture of fixtures) {
      // Date filter
      if (cutoffDate && fixture.starting_at) {
        const fixtureDate = new Date(fixture.starting_at);
        if (fixtureDate < cutoffDate) {
          skipped++;
          continue;
        }
      }

      try {
        const hydratedFixture = needsFixtureHydration(fixture)
          ? await fetchFixtureDetail(fixture.id)
          : fixture;

        if (!hydratedFixture) {
          console.warn(`[import] Fixture ${fixture.id}: detail fetch failed`);
          skipped++;
          continue;
        }

        const bundle = buildHistoricalImportBundleFromSportMonks(hydratedFixture);
        if (!bundle) {
          skipped++;
          continue;
        }

        const ok = await upsertBundle(bundle, args.dryRun);
        if (ok) imported++;
        else skipped++;
      } catch (err) {
        console.warn(`[import] Failed fixture ${fixture.id}:`, err);
        skipped++;
      }
    }

    console.log(`[import] Progress: ${imported} imported, ${skipped} skipped.`);

    // Rate-limit: small delay between pages to be polite to the API
    if (page < totalPages) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(
    `\n[import] Done. Pages fetched: ${pagesFetched}. Imported: ${imported}. Skipped: ${skipped}.`
  );
}

main()
  .catch((err) => {
    console.error("[import] Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
