import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { recomputeContestLeaderboard, resolveContestStatus, syncContestStatus } from "@/lib/contest";

async function requireAdmin() {
  const session = await auth();
  const user = session?.user as { role?: string } | undefined;

  return user?.role === "admin";
}

// GET all contests
export async function GET() {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const contests = await prisma.contest.findMany({
      orderBy: { startDate: "desc" },
      include: {
        submissions: {
          include: {
            author: { select: { id: true, name: true } },
            blog: { select: { id: true, title: true, slug: true, status: true } },
          },
          orderBy: [{ ranking: "asc" }, { finalScore: "desc" }, { createdAt: "asc" }],
        },
      },
    });
    return NextResponse.json({
      contests: contests.map((contest) => ({
        ...contest,
        status: resolveContestStatus(contest),
      })),
    });
  } catch (error) {
    console.error("Contest fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch contests" },
      { status: 500 }
    );
  }
}

// POST new contest
export async function POST(req: NextRequest) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const { title, description, rules, startDate, endDate, prize, shortBlogMaxWords } =
      await req.json();

    if (!title || !description || !startDate || !endDate) {
      return NextResponse.json(
        { error: "Title, description, startDate, and endDate are required" },
        { status: 400 }
      );
    }

    const contest = await prisma.contest.create({
      data: {
        title,
        description,
        rules: rules || null,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        prize: prize || null,
        shortBlogMaxWords:
          typeof shortBlogMaxWords === "number" && shortBlogMaxWords >= 50
            ? Math.round(shortBlogMaxWords)
            : 350,
      },
    });

    return NextResponse.json(
      { message: "Contest created", contest },
      { status: 201 }
    );
  } catch (error) {
    console.error("Contest creation error:", error);
    return NextResponse.json(
      { error: "Failed to create contest" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const body = await req.json();
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "override-score") {
      const submissionId = typeof body.submissionId === "string" ? body.submissionId : "";
      const overrideScore =
        typeof body.adminOverrideScore === "number" ? Math.max(0, Math.min(100, body.adminOverrideScore)) : null;

      if (!submissionId || overrideScore === null) {
        return NextResponse.json({ error: "submissionId and adminOverrideScore are required" }, { status: 400 });
      }

      const submission = await prisma.contestSubmission.update({
        where: { id: submissionId },
        data: {
          adminOverrideScore: overrideScore,
          finalScore: overrideScore,
        },
        select: { contestId: true },
      });

      const standings = await recomputeContestLeaderboard(submission.contestId);
      return NextResponse.json({ message: "Override saved", standings });
    }

    if (action === "publish-announcement") {
      const contestId = typeof body.contestId === "string" ? body.contestId : "";
      const announcementTitle =
        typeof body.announcementTitle === "string" ? body.announcementTitle.trim() : "";
      const announcementBody =
        typeof body.announcementBody === "string" ? body.announcementBody.trim() : "";

      if (!contestId || !announcementTitle || !announcementBody) {
        return NextResponse.json(
          { error: "contestId, announcementTitle, and announcementBody are required" },
          { status: 400 }
        );
      }

      const contest = await prisma.contest.update({
        where: { id: contestId },
        data: {
          announcementTitle,
          announcementBody,
          announcementPublishedAt: new Date(),
          status: "completed",
        },
      });

      return NextResponse.json({ message: "Announcement published", contest });
    }

    if (action === "refresh-standings") {
      const contestId = typeof body.contestId === "string" ? body.contestId : "";
      if (!contestId) {
        return NextResponse.json({ error: "contestId is required" }, { status: 400 });
      }

      await syncContestStatus(contestId);
      const standings = await recomputeContestLeaderboard(contestId);
      return NextResponse.json({ message: "Standings refreshed", standings });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    console.error("Contest update error:", error);
    return NextResponse.json(
      { error: "Failed to update contest" },
      { status: 500 }
    );
  }
}
