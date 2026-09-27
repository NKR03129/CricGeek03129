/**
 * POST /api/admin/seed-historical-warehouse
 *
 * Admin-only endpoint that seeds (or re-seeds) the historical fact-checking
 * warehouse from the SportMonks Cricket API.
 *
 * Body (JSON):
 *   {
 *     "pages"?:     number,  // pages of fixtures to fetch (default 5, max 20)
 *     "perPage"?:   number,  // fixtures per page (default 100, max 100)
 *     "matchType"?: string,  // optional filter e.g. "Test", "ODI", "T20I"
 *     "daysBack"?:  number,  // only import last N days (0 = all)
 *     "dryRun"?:   boolean,  // parse without writing
 *   }
 *
 * Auth:
 *   Requires X-Admin-Secret header matching ADMIN_SECRET env var,
 *   or a session belonging to a user with role="admin".
 */

import { prisma } from "@/lib/db";
import {
  buildHistoricalImportBundleFromSportMonks,
  getHistoricalWarehouseStatus,
  type SMFixtureForImport,
} from "@/lib/historical-warehouse";
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const BASE_URL =
  process.env.SPORTMONKS_BASE_URL || "https://cricket.sportmonks.com/api/v2.0";
const API_TOKEN = process.env.SPORTMONKS_API_TOKEN || "";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";

const FIXTURE_PAGE_INCLUDES =
  "localteam,visitorteam,league,venue,season";
const IMPORT_INCLUDES =
  "localteam,visitorteam,runs,batting,bowling,lineup,league,venue,season,manofmatch";

// ── Auth guard ────────────────────────────────────────────────────────

async function isAuthorized(request: Request): Promise<boolean> {
  // Header-based secret (for server-to-server / CI)
  const headerSecret = request.headers.get("x-admin-secret");
  if (ADMIN_SECRET && headerSecret === ADMIN_SECRET) return true;

  // Session-based (logged-in admin user)
  const session = await auth();
  if (session?.user && (session.user as { role?: string }).role === "admin") return true;

  return false;
}

// ── SportMonks pagination fetch ───────────────────────────────────────

async function fetchFixturePage(
  page: number,
  perPage: number,
  matchType?: string
): Promise<{ data: SMFixtureForImport[]; totalPages: number } | null> {
  if (!API_TOKEN) return null;

  const url = new URL(`${BASE_URL}/fixtures`);
  url.searchParams.set("api_token", API_TOKEN);
  url.searchParams.set("include", FIXTURE_PAGE_INCLUDES);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", String(page));
  url.searchParams.set("filter[status]", "Finished");
  if (matchType) url.searchParams.set("filter[type]", matchType);

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data: SMFixtureForImport[];
      meta?: { pagination?: { total_pages?: number } };
    };
    return {
      data: Array.isArray(json.data) ? json.data : [],
      totalPages: json.meta?.pagination?.total_pages ?? 1,
    };
  } catch {
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
  if (!API_TOKEN) return null;

  const url = new URL(`${BASE_URL}/fixtures/${fixtureId}`);
  url.searchParams.set("api_token", API_TOKEN);
  url.searchParams.set("include", IMPORT_INCLUDES);

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;

    const json = (await res.json()) as { data?: SMFixtureForImport | null };
    return json.data ?? null;
  } catch {
    return null;
  }
}

// ── Upsert bundle ─────────────────────────────────────────────────────

async function upsertBundle(
  bundle: NonNullable<ReturnType<typeof buildHistoricalImportBundleFromSportMonks>>
): Promise<void> {
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
    { maxWait: 20_000, timeout: 90_000 }
  );
}

// ── Route handler ─────────────────────────────────────────────────────

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!API_TOKEN) {
    return NextResponse.json(
      { error: "SPORTMONKS_API_TOKEN is not configured on this server." },
      { status: 503 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // body is optional
  }

  const pages = Math.min(20, Math.max(1, Number(body.pages ?? 5)));
  const perPage = Math.min(100, Math.max(1, Number(body.perPage ?? 100)));
  const matchType = typeof body.matchType === "string" ? body.matchType.trim() : undefined;
  const daysBack = Number(body.daysBack ?? 0);
  const dryRun = body.dryRun === true;

  const cutoff =
    daysBack > 0 ? new Date(Date.now() - daysBack * 86_400_000) : null;

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  let totalPages = pages;

  for (let page = 1; page <= totalPages; page++) {
    const result = await fetchFixturePage(page, perPage, matchType);

    if (!result) {
      errors.push(`Page ${page}: fetch failed`);
      break;
    }

    if (page === 1) {
      totalPages = Math.min(pages, result.totalPages);
    }

    for (const fixture of result.data) {
      try {
        if (cutoff && fixture.starting_at && new Date(fixture.starting_at) < cutoff) {
          skipped++;
          continue;
        }

        const hydratedFixture = needsFixtureHydration(fixture)
          ? await fetchFixtureDetail(fixture.id)
          : fixture;

        if (!hydratedFixture) {
          errors.push(`Fixture ${fixture.id}: detail fetch failed`);
          skipped++;
          continue;
        }

        const bundle = buildHistoricalImportBundleFromSportMonks(hydratedFixture);
        if (!bundle) {
          skipped++;
          continue;
        }

        if (!dryRun) {
          await upsertBundle(bundle);
        }
        imported++;
      } catch (err) {
        errors.push(
          `Fixture ${fixture.id}: ${err instanceof Error ? err.message : String(err)}`
        );
        skipped++;
      }
    }

    // Small delay between pages
    if (page < totalPages) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  // Bust the warehouse status cache so the next fact-check reflects new data
  await getHistoricalWarehouseStatus(true);

  const status = await getHistoricalWarehouseStatus();

  return NextResponse.json({
    ok: true,
    dryRun,
    imported,
    skipped,
    errors: errors.slice(0, 20),
    warehouse: {
      matchesLoaded: status.matchesLoaded,
      battingRowsLoaded: status.battingRowsLoaded,
      bowlingRowsLoaded: status.bowlingRowsLoaded,
      aliasesLoaded: status.aliasesLoaded,
    },
  });
}

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getHistoricalWarehouseStatus(true);
  return NextResponse.json({ ok: true, warehouse: status });
}
