import { NextRequest, NextResponse } from "next/server";
import { getCricketNews } from "@/lib/news/cricket-news-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit");
    const team = searchParams.get("team");
    const tournament = searchParams.get("tournament");

    const result = await getCricketNews({
      limit,
      team,
      tournament,
    });

    return NextResponse.json(
      {
        ok: result.articles.length > 0,
        provider: result.provider,
        count: result.articles.length,
        cache: {
          hit: result.cacheHit,
          stale: result.stale,
        },
        updatedAt: result.updatedAt ?? new Date().toISOString(),
        error: result.error,
        articles: result.articles,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    console.error("[/api/cricket-news]", error);
    return NextResponse.json(
      {
        ok: false,
        provider: "none",
        count: 0,
        cache: {
          hit: false,
          stale: false,
        },
        articles: [],
        error: "Unable to fetch cricket news right now.",
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }
}
