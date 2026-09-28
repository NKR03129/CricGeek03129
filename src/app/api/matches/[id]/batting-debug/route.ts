import { NextResponse } from "next/server";

const BASE_URL =
  process.env.SPORTMONKS_BASE_URL ?? "https://cricket.sportmonks.com/api/v2.0";
const API_TOKEN = process.env.SPORTMONKS_API_TOKEN ?? "";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!API_TOKEN) {
    return NextResponse.json({ error: "SPORTMONKS_API_TOKEN not set" }, { status: 500 });
  }

  const url = new URL(`${BASE_URL}/fixtures/${id}`);
  url.searchParams.set("api_token", API_TOKEN);
  url.searchParams.set("include", "batting,lineup");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    return NextResponse.json({ error: `SportMonks ${res.status}` }, { status: res.status });
  }

  const json = await res.json() as { data: Record<string, unknown> };
  const fixture = json.data;
  const batting = Array.isArray(fixture.batting) ? fixture.batting : [];
  const lineup  = Array.isArray(fixture.lineup)  ? fixture.lineup  : [];

  return NextResponse.json({
    battingSample: batting.slice(0, 5),
    lineupSample:  lineup.slice(0, 5),
    totalBattingRows: batting.length,
    totalLineupRows:  lineup.length,
  });
}
