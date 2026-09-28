import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateUserFeedPreferences } from "@/lib/personalization";
import { isWriterRole } from "@/lib/roles";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (userId === id) {
      return NextResponse.json({ error: "You cannot follow yourself" }, { status: 400 });
    }

    const writer = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });

    if (!writer || !isWriterRole(writer.role)) {
      return NextResponse.json({ error: "Writer not found" }, { status: 404 });
    }

    await prisma.writerFollow.upsert({
      where: {
        followerId_writerId: {
          followerId: userId,
          writerId: id,
        },
      },
      create: {
        followerId: userId,
        writerId: id,
      },
      update: {},
    });

    void updateUserFeedPreferences(userId, {
      writers: [id],
    }).catch((preferenceError) => {
      console.error("Feed preference update failed after follow:", preferenceError);
    });

    const followerCount = await prisma.writerFollow.count({
      where: { writerId: id },
    });

    return NextResponse.json({ following: true, followerCount });
  } catch (error) {
    console.error("Follow writer error:", error);
    return NextResponse.json({ error: "Failed to follow writer" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    await prisma.writerFollow.deleteMany({
      where: {
        followerId: userId,
        writerId: id,
      },
    });

    const followerCount = await prisma.writerFollow.count({
      where: { writerId: id },
    });

    return NextResponse.json({ following: false, followerCount });
  } catch (error) {
    console.error("Unfollow writer error:", error);
    return NextResponse.json({ error: "Failed to unfollow writer" }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;

    const [followerCount, follow] = await Promise.all([
      prisma.writerFollow.count({ where: { writerId: id } }),
      userId
        ? prisma.writerFollow.findUnique({
            where: {
              followerId_writerId: {
                followerId: userId,
                writerId: id,
              },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    return NextResponse.json({ followerCount, following: Boolean(follow) });
  } catch (error) {
    console.error("Fetch follow state error:", error);
    return NextResponse.json({ error: "Failed to fetch follow state" }, { status: 500 });
  }
}
