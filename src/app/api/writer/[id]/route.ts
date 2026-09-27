import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDemoWriter } from "@/lib/demo-data";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const viewerId = (session?.user as { id?: string } | undefined)?.id;
    const { id } = await params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        avatar: true,
        bio: true,
        role: true,
        createdAt: true,
        writerProfile: true,
        writerDNA: true,
        _count: {
          select: {
            followers: true,
            blogs: true,
          },
        },
        followers: viewerId
          ? {
              where: { followerId: viewerId },
              select: { id: true },
              take: 1,
            }
          : false,
        badges: {
          orderBy: { earnedAt: "desc" },
        },
        achievements: {
          orderBy: { earnedAt: "desc" },
        },
        blogs: {
          where: { status: "approved" },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            title: true,
            slug: true,
            views: true,
            runs: true,
            createdAt: true,
            score: {
              select: { bqs: true, processingStatus: true, archetypeLabel: true },
            },
          },
        },
      },
    });

    if (!user) {
      const demoWriter = getDemoWriter(id);
      if (demoWriter) {
        return NextResponse.json(demoWriter);
      }

      return NextResponse.json({ error: "Writer not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      bio: user.bio,
      role: user.role,
      createdAt: user.createdAt,
      stats: {
        followerCount: user._count.followers,
        blogCount: user._count.blogs,
      },
      viewerState: {
        followsWriter: Array.isArray(user.followers) ? user.followers.length > 0 : false,
      },
      profile: user.writerProfile ?? {
        averageBQS: 0,
        totalBlogs: 0,
        totalViews: 0,
        totalRuns: 0,
        archetype: "fan",
        writerTitle: "",
        level: 1,
        xp: 0,
        bestBQS: 0,
        featuredCount: 0,
        streak: 0,
        bcs: 0,
        statAccuracy: 0,
      },
      dna: user.writerDNA ?? {
        analyst: 25,
        fan: 25,
        storyteller: 25,
        debater: 25,
      },
      badges: user.badges,
      achievements: user.achievements,
      recentBlogs: user.blogs,
    });
  } catch {
    const demoWriter = getDemoWriter((await params).id);
    if (demoWriter) {
      return NextResponse.json(demoWriter);
    }

    return NextResponse.json({ error: "Failed to fetch writer" }, { status: 500 });
  }
}
