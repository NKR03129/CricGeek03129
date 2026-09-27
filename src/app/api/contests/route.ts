import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveContestStatus } from "@/lib/contest";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get("active") === "true";

    const contests = await prisma.contest.findMany({
      orderBy: [{ startDate: "asc" }],
    });

    const enriched = contests.map((contest) => ({
      ...contest,
      status: resolveContestStatus(contest),
    }));

    return NextResponse.json({
      contests: activeOnly ? enriched.filter((contest) => contest.status === "active") : enriched,
    });
  } catch (error) {
    console.error("Contest list error:", error);
    return NextResponse.json(
      { error: "Failed to load contests" },
      { status: 500 }
    );
  }
}
