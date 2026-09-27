import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { canManageCommentarySession } from "@/lib/commentary-permissions";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// GET /api/commentary/[sessionId] — fetch a session with entries
export async function GET(_request: Request, { params }: RouteParams) {
  const { sessionId } = await params;

  const session = await prisma.liveCommentarySession.findUnique({
    where: { id: sessionId },
    include: {
      moderator: { select: { id: true, name: true, avatar: true } },
      entries: { orderBy: { createdAt: "desc" }, take: 100 },
      _count: { select: { entries: true } },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({ session });
}

// PATCH /api/commentary/[sessionId] — update session status
export async function PATCH(request: Request, { params }: RouteParams) {
  const { sessionId } = await params;
  const authSession = await auth();
  const user = authSession?.user as { id: string; role: string } | undefined;

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.liveCommentarySession.findUnique({
    where: { id: sessionId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Only the session moderator or admins can update
  if (!canManageCommentarySession(user, existing.moderatorId)) {
    return NextResponse.json({ error: "Not your session" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { status } = body;

    if (!["live", "paused", "ended"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status. Must be: live, paused, ended" },
        { status: 400 }
      );
    }

    const updated = await prisma.liveCommentarySession.update({
      where: { id: sessionId },
      data: {
        status,
        endedAt: status === "ended" ? new Date() : undefined,
      },
    });

    return NextResponse.json({ session: updated });
  } catch (error) {
    console.error("Failed to update session:", error);
    return NextResponse.json(
      { error: "Failed to update session" },
      { status: 500 }
    );
  }
}

// DELETE /api/commentary/[sessionId] — delete session (admin only)
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { sessionId } = await params;
  const authSession = await auth();
  const user = authSession?.user as { id: string; role: string } | undefined;

  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  try {
    await prisma.liveCommentarySession.delete({ where: { id: sessionId } });
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to delete session" },
      { status: 500 }
    );
  }
}
