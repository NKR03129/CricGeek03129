import { prisma } from "@/lib/db";
import { getCalendarMatchesWithSource } from "@/lib/cricket-api";
import CalendarClient from "./CalendarClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cricket Calendar | CricGeek",
  description: "Complete cricket match calendar with upcoming fixtures, live games, and recent results across World Cup, IPL, and international cricket.",
};

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const { matches, source } = await getCalendarMatchesWithSource();
  const matchIds = matches.map((match) => match.id).filter(Boolean);

  const [commentarySessions, blogs] = await Promise.all([
    matchIds.length > 0
      ? prisma.liveCommentarySession.findMany({
          where: {
            matchId: { in: matchIds },
            status: { in: ["scheduled", "live", "paused", "ended"] },
          },
          select: {
            id: true,
            matchId: true,
            matchName: true,
            matchType: true,
            status: true,
            createdAt: true,
            moderator: { select: { id: true, name: true } },
            _count: { select: { entries: true } },
          },
          orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        })
      : Promise.resolve([]),
    matchIds.length > 0
      ? prisma.blog.findMany({
          where: {
            status: "approved",
            matchTag: { in: matchIds },
          },
          select: {
            id: true,
            title: true,
            slug: true,
            createdAt: true,
            matchTag: true,
            author: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const sessionsByMatchId = new Map<string, typeof commentarySessions>();
  commentarySessions.forEach((session) => {
    const existing = sessionsByMatchId.get(session.matchId) ?? [];
    existing.push(session);
    sessionsByMatchId.set(session.matchId, existing);
  });

  const blogsByMatchId = new Map<string, typeof blogs>();
  blogs.forEach((blog) => {
    if (!blog.matchTag) return;
    const existing = blogsByMatchId.get(blog.matchTag) ?? [];
    existing.push(blog);
    blogsByMatchId.set(blog.matchTag, existing);
  });

  const enrichedMatches = matches.map((match) => ({
    ...match,
    commentarySessions: sessionsByMatchId.get(match.id) ?? [],
    blogs: blogsByMatchId.get(match.id) ?? [],
  }));

  return <CalendarClient matches={JSON.parse(JSON.stringify(enrichedMatches))} source={source} />;
}
