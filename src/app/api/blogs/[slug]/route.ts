import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth();
    const viewerId = (session?.user as { id?: string } | undefined)?.id;
    const { slug } = await params;

    const blog = await prisma.blog.findUnique({
      where: { slug },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            avatar: true,
            role: true,
            _count: {
              select: {
                followers: true,
              },
            },
            followers: viewerId
              ? {
                  where: { followerId: viewerId },
                  select: { id: true },
                  take: 1,
                }
              : false,
          },
        },
        _count: {
          select: { comments: true, reactions: true, saves: true },
        },
        score: true,
        contestSubmissions: {
          include: {
            contest: {
              select: {
                id: true,
                title: true,
                prize: true,
                announcementTitle: true,
              },
            },
          },
          take: 1,
        },
        reactions: viewerId
          ? {
              where: { userId: viewerId },
              select: { id: true },
              take: 1,
            }
          : false,
        saves: viewerId
          ? {
              where: { userId: viewerId },
              select: { id: true },
              take: 1,
            }
          : false,
      },
    });

    if (!blog) {
      return NextResponse.json({ error: "Blog not found" }, { status: 404 });
    }

    // Also fetch author profile separately (due to schema structure)
    const authorProfile = await prisma.writerProfile.findUnique({
      where: { userId: blog.authorId },
    });

    return NextResponse.json({
      ...blog,
      reactionCount: blog._count.reactions,
      saveCount: blog._count.saves,
      viewerState: {
        reacted: Array.isArray(blog.reactions) ? blog.reactions.length > 0 : false,
        saved: Array.isArray(blog.saves) ? blog.saves.length > 0 : false,
        followsAuthor:
          Array.isArray(blog.author.followers) ? blog.author.followers.length > 0 : false,
      },
      authorProfile,
    });
  } catch (error) {
    console.error("Failed to fetch blog:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
