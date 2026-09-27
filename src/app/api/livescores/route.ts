/**
 * GET /api/livescores
 *
 * Server-side proxy that fetches live scores from SportMonks
 * and returns normalised Match objects as JSON.
 *
 * The browser polls this route every 30 s from the LiveScoresTicker
 * component — the API token is never exposed to the client.
 */
import { NextResponse } from "next/server";
import { getLiveMatchesWithSource } from "@/lib/cricket-api";

export const dynamic = "force-dynamic";   // Always fresh — never statically cached
export const runtime = "nodejs";
export const revalidate = 0;

export async function GET() {
  try {
    const { matches, source } = await getLiveMatchesWithSource();

    return NextResponse.json(
      {
        ok: true,
        source,
        count: matches.length,
        updatedAt: new Date().toISOString(),
        matches,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (err) {
    console.error("[/api/livescores]", err);
    return NextResponse.json(
      { ok: false, matches: [] },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }
}
