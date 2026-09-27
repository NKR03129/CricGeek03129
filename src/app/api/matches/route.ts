import { NextResponse } from "next/server";
import { getMatchHubMatchesWithSource } from "@/lib/cricket-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const { matches, source } = await getMatchHubMatchesWithSource();

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
  } catch (error) {
    console.error("[/api/matches]", error);

    return NextResponse.json(
      {
        ok: false,
        source: "none",
        count: 0,
        matches: [],
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }
}
