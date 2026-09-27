import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(_req: NextRequest) {
  try {
    const session = await auth();
    const currentUser = session?.user as { id?: string; role?: string } | undefined;
    const userId = currentUser?.id;
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        role: currentUser?.role === "admin" ? "admin" : "writer",
        writerProfile: {
          upsert: {
            create: {
              averageBQS: 0,
              totalBlogs: 0,
              totalViews: 0,
              totalRuns: 0,
              archetype: "fan",
              level: 1,
              xp: 0,
            },
            update: {},
          },
        },
        writerDNA: {
          upsert: {
            create: {
              analyst: 25,
              fan: 25,
              storyteller: 25,
              debater: 25,
            },
            update: {},
          },
        },
        feedPreferences: {
          upsert: {
            create: {},
            update: {},
          },
        },
      },
      select: {
        id: true,
        role: true,
      },
    });

    return NextResponse.json({
      message: "Writer profile activated",
      user,
    });
  } catch (error) {
    console.error("Writer upgrade error:", error);
    return NextResponse.json({ error: "Failed to activate writer profile" }, { status: 500 });
  }
}
