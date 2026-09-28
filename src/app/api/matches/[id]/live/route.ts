import { NextResponse } from "next/server";
import { getMatchDetailBundle } from "@/lib/cricket-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const bundle = await getMatchDetailBundle(id, { fresh: true });

  if (!bundle.match) {
    return NextResponse.json(
      { error: "Match not found" },
      {
        status: 404,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }

  return NextResponse.json(
    {
      ...bundle,
      fetchedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
