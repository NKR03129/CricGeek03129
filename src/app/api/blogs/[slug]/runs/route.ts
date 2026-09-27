import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateUserFeedPreferences } from "@/lib/personalization";

// POST /api/blogs/[slug]/runs — give a "run" (engagement upvote)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const blog = await prisma.blog.findUnique({
      where: { slug },
      select: {
        id: true,
        authorId: true,
        tags: true,
        mentionedPlayers: true,
        mentionedTeams: true,
      },
    });

    if (!blog) {
      return NextResponse.json({ error: "Blog not found" }, { status: 404 });
    }

    // Author cannot give themselves runs
    if (blog.authorId === (session.user as { id?: string }).id) {
      return NextResponse.json({ error: "You cannot give runs to your own blog" }, { status: 403 });
    }

    const userId = (session.user as { id?: string }).id;
    const existingReaction = await prisma.blogReaction.findUnique({
      where: {
        blogId_userId: {
          blogId: blog.id,
          userId: userId!,
        },
      },
    });

    if (existingReaction) {
      const currentBlog = await prisma.blog.findUnique({
        where: { id: blog.id },
        select: { runs: true },
      });

      return NextResponse.json({ runs: currentBlog?.runs ?? 0, reacted: true });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.blogReaction.create({
        data: {
          blogId: blog.id,
          userId: userId!,
          type: "cricket_ball",
        },
      });

      const updatedBlog = await tx.blog.update({
        where: { id: blog.id },
        data: { runs: { increment: 1 } },
        select: { runs: true },
      });

      await tx.writerProfile.upsert({
        where: { userId: blog.authorId },
        create: {
          userId: blog.authorId,
          totalRuns: 1,
        },
        update: { totalRuns: { increment: 1 } },
      });

      return updatedBlog;
    });

    void updateUserFeedPreferences(userId!, {
      tags: (blog.tags ?? "")
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
      teams: Array.isArray(blog.mentionedTeams)
        ? blog.mentionedTeams.filter((entry): entry is string => typeof entry === "string")
        : [],
      players: Array.isArray(blog.mentionedPlayers)
        ? blog.mentionedPlayers.filter((entry): entry is string => typeof entry === "string")
        : [],
      writers: [blog.authorId],
    }).catch((preferenceError) => {
      console.error("Feed preference update failed after reaction:", preferenceError);
    });

    return NextResponse.json({ runs: updated.runs, reacted: true });
  } catch (error) {
    console.error("Runs error:", error);
    return NextResponse.json({ error: "Failed to give run" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const blog = await prisma.blog.findUnique({
      where: { slug },
      select: { id: true, authorId: true },
    });

    if (!blog) {
      return NextResponse.json({ error: "Blog not found" }, { status: 404 });
    }

    const reaction = await prisma.blogReaction.findUnique({
      where: {
        blogId_userId: {
          blogId: blog.id,
          userId,
        },
      },
    });

    if (!reaction) {
      const currentBlog = await prisma.blog.findUnique({
        where: { id: blog.id },
        select: { runs: true },
      });

      return NextResponse.json({ runs: currentBlog?.runs ?? 0, reacted: false });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.blogReaction.delete({
        where: { id: reaction.id },
      });

      const updatedBlog = await tx.blog.update({
        where: { id: blog.id },
        data: { runs: { decrement: 1 } },
        select: { runs: true },
      });

      await tx.writerProfile.updateMany({
        where: { userId: blog.authorId, totalRuns: { gt: 0 } },
        data: { totalRuns: { decrement: 1 } },
      });

      return updatedBlog;
    });

    return NextResponse.json({ runs: updated.runs, reacted: false });
  } catch (error) {
    console.error("Runs remove error:", error);
    return NextResponse.json({ error: "Failed to remove run" }, { status: 500 });
  }
}

// GET /api/blogs/[slug]/runs — get current run count
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const blog = await prisma.blog.findUnique({
    where: { slug },
    select: {
      id: true,
      runs: true,
      reactions: userId
        ? {
            where: { userId },
            select: { id: true },
            take: 1,
          }
        : false,
    },
  });
  if (!blog) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    runs: blog.runs,
    reacted: Array.isArray(blog.reactions) ? blog.reactions.length > 0 : false,
  });
}
