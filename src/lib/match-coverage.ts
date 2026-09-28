import { prisma } from "@/lib/db";

export interface MatchCoverageSummary {
  commentarySession: {
    id: string;
    status: string;
  } | null;
  blogs: Array<{
    id: string;
    title: string;
    slug: string;
  }>;
  coverageAvailable: boolean;
}

export async function getMatchCoverage(matchId: string, liveOnly = false): Promise<MatchCoverageSummary> {
  try {
    const [commentarySession, blogs] = await Promise.all([
      prisma.liveCommentarySession.findFirst({
        where: liveOnly
          ? { matchId, status: { in: ["scheduled", "live", "paused"] } }
          : { matchId },
        orderBy: { updatedAt: "desc" },
        select: { id: true, status: true },
      }),
      prisma.blog.findMany({
        where: { matchTag: matchId, status: "approved" },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, title: true, slug: true },
      }),
    ]);

    return {
      commentarySession,
      blogs,
      coverageAvailable: true,
    };
  } catch (error) {
    console.error(`[match-coverage] Failed to load linked coverage for ${matchId}:`, error);

    return {
      commentarySession: null,
      blogs: [],
      coverageAvailable: false,
    };
  }
}
