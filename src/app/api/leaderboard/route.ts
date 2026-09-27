import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sort = searchParams.get("sort") || "bqs";
    const limit = parseInt(searchParams.get("limit") || "20");

    const orderBy: Record<string, string> = {};
    if (sort === "bqs") orderBy.averageBQS = "desc";
    else if (sort === "blogs") orderBy.totalBlogs = "desc";
    else if (sort === "views") orderBy.totalViews = "desc";
    else orderBy.averageBQS = "desc";

    const profiles = await prisma.writerProfile.findMany({
      include: {
        user: {
          select: { id: true, name: true, avatar: true },
        },
      },
      orderBy,
      take: limit,
    });

    // Also get top blog this week
    const oneWeekAgo = new Date(Date.now() - 7 * 86400000);
    const topBlogThisWeek = await prisma.blogScore.findFirst({
      where: {
        processingStatus: "completed",
        createdAt: { gte: oneWeekAgo },
      },
      orderBy: { bqs: "desc" },
      include: {
        blog: {
          select: { id: true, title: true, slug: true, author: { select: { name: true } } },
        },
      },
    });

    return NextResponse.json({ profiles, topBlogThisWeek });
  } catch (error) {
    console.error("Leaderboard fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch leaderboard" }, { status: 500 });
  }
}
