import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateUserFeedPreferences } from "@/lib/personalization";

export async function POST(
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

    await prisma.savedBlog.upsert({
      where: {
        blogId_userId: {
          blogId: blog.id,
          userId,
        },
      },
      create: {
        blogId: blog.id,
        userId,
      },
      update: {},
    });

    void updateUserFeedPreferences(userId, {
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
      console.error("Feed preference update failed after save:", preferenceError);
    });

    const saveCount = await prisma.savedBlog.count({
      where: { blogId: blog.id },
    });

    return NextResponse.json({ saved: true, saveCount });
  } catch (error) {
    console.error("Save blog error:", error);
    return NextResponse.json({ error: "Failed to save blog" }, { status: 500 });
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
      select: { id: true },
    });

    if (!blog) {
      return NextResponse.json({ error: "Blog not found" }, { status: 404 });
    }

    await prisma.savedBlog.deleteMany({
      where: {
        blogId: blog.id,
        userId,
      },
    });

    const saveCount = await prisma.savedBlog.count({
      where: { blogId: blog.id },
    });

    return NextResponse.json({ saved: false, saveCount });
  } catch (error) {
    console.error("Unsave blog error:", error);
    return NextResponse.json({ error: "Failed to unsave blog" }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;

    const blog = await prisma.blog.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!blog) {
      return NextResponse.json({ error: "Blog not found" }, { status: 404 });
    }

    const [saveCount, saved] = await Promise.all([
      prisma.savedBlog.count({ where: { blogId: blog.id } }),
      userId
        ? prisma.savedBlog.findUnique({
            where: { blogId_userId: { blogId: blog.id, userId } },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    return NextResponse.json({ saveCount, saved: Boolean(saved) });
  } catch (error) {
    console.error("Fetch saved blog state error:", error);
    return NextResponse.json({ error: "Failed to fetch saved state" }, { status: 500 });
  }
}
