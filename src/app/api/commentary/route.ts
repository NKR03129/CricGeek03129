import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { canCreateCommentarySession } from "@/lib/commentary-permissions";
import { getMatchInfo } from "@/lib/cricket-api";
import { extractTeamHintsFromTitle, formatCommentaryTitleFromCodes } from "@/lib/commentary-team-lookup";

// GET /api/commentary — list sessions (optionally filter by status and/or matchId)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status"); // "live" | "ended" | null (all)
  const matchId = searchParams.get("matchId"); // filter to sessions for a specific match

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (matchId) where.matchId = matchId;

  const sessions = await prisma.liveCommentarySession.findMany({
    where,
    include: {
      moderator: { select: { id: true, name: true, avatar: true } },
      _count: { select: { entries: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ sessions });
}

// POST /api/commentary — create a new session (moderator/admin only)
export async function POST(request: Request) {
  const session = await auth();
  const user = session?.user as { id: string; role: string } | undefined;

  if (!canCreateCommentarySession(user)) {
    return NextResponse.json(
      { error: "Sign in to start a commentary session" },
      { status: 401 }
    );
  }

  if (!user?.id) {
    return NextResponse.json(
      { error: "Sign in to start a commentary session" },
      { status: 401 }
    );
  }

  const userId = user.id;

  try {
    const body = await request.json();
    const matchId = typeof body.matchId === "string" ? body.matchId.trim() : "";
    const matchName = typeof body.matchName === "string" ? body.matchName.trim() : "";
    const matchType = typeof body.matchType === "string" ? body.matchType.trim() : "T20";
    const requestedStatus = body.status === "scheduled" ? "scheduled" : "live";

    if (!matchId || !matchName) {
      return NextResponse.json(
        { error: "matchId and matchName are required" },
        { status: 400 }
      );
    }

    if (matchId.length > 100 || matchName.length > 200 || matchType.length > 30) {
      return NextResponse.json(
        { error: "One or more fields are too long" },
        { status: 400 }
      );
    }

    let canonicalMatchName = matchName;
    const liveMatch = await getMatchInfo(matchId, { fresh: true });
    const liveCodes = liveMatch?.teamInfo
      ?.map((team) => team.shortname?.trim().toUpperCase())
      .filter((code): code is string => Boolean(code));

    if (liveCodes && liveCodes.length >= 2) {
      canonicalMatchName = formatCommentaryTitleFromCodes(liveCodes[0], liveCodes[1]);
    } else {
      const titleCodes = extractTeamHintsFromTitle(matchName).map((code) => code.toUpperCase());
      if (titleCodes.length >= 2) {
        canonicalMatchName = formatCommentaryTitleFromCodes(titleCodes[0], titleCodes[1]);
      }
    }

    const existingLiveSession = await prisma.liveCommentarySession.findFirst({
      where: {
        matchId,
        status: {
          in: ["scheduled", "live", "paused"],
        },
      },
      select: {
        id: true,
        moderator: {
          select: { name: true },
        },
      },
    });

    if (existingLiveSession) {
      return NextResponse.json(
        {
          error: `A commentary session already exists for this match by ${existingLiveSession.moderator.name}.`,
          sessionId: existingLiveSession.id,
        },
        { status: 409 }
      );
    }

    const commentarySession = await prisma.liveCommentarySession.create({
      data: {
        matchId,
        matchName: canonicalMatchName,
        matchType: matchType || "T20",
        moderatorId: userId,
        status: requestedStatus,
      },
      include: {
        moderator: { select: { id: true, name: true, avatar: true } },
      },
    });

    return NextResponse.json({ session: commentarySession }, { status: 201 });
  } catch (error) {
    console.error("Failed to create commentary session:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}
