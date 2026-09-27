import { prisma } from "@/lib/db";

export type ContestStatus = "upcoming" | "active" | "completed";

export function resolveContestStatus(contest: { startDate: Date; endDate: Date }): ContestStatus {
  const now = Date.now();
  if (now < new Date(contest.startDate).getTime()) return "upcoming";
  if (now > new Date(contest.endDate).getTime()) return "completed";
  return "active";
}

export async function syncContestStatus(contestId: string) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { id: true, startDate: true, endDate: true, status: true },
  });

  if (!contest) return null;

  const nextStatus = resolveContestStatus(contest);
  if (contest.status !== nextStatus) {
    return prisma.contest.update({
      where: { id: contestId },
      data: { status: nextStatus },
    });
  }

  return contest;
}

export async function recomputeContestLeaderboard(contestId: string) {
  const submissions = await prisma.contestSubmission.findMany({
    where: { contestId },
    include: {
      blog: {
        select: {
          id: true,
          status: true,
          score: {
            select: {
              bqs: true,
            },
          },
        },
      },
      contest: {
        select: {
          prize: true,
        },
      },
    },
    orderBy: [{ finalScore: "desc" }, { createdAt: "asc" }],
  });

  const eligible = submissions
    .filter((submission) => submission.blog.status === "approved" && submission.blog.score)
    .map((submission) => {
      const aiScoreSnapshot = submission.blog.score?.bqs ?? submission.aiScoreSnapshot ?? 0;
      const finalScore = submission.adminOverrideScore ?? aiScoreSnapshot;

      return {
        ...submission,
        aiScoreSnapshot,
        finalScore,
      };
    })
    .sort((left, right) => {
      if (right.finalScore !== left.finalScore) return right.finalScore - left.finalScore;
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });

  await prisma.$transaction(
    submissions.map((submission) => {
      const eligibleIndex = eligible.findIndex((item) => item.id === submission.id);
      const ranking = eligibleIndex >= 0 ? eligibleIndex + 1 : null;
      const winnerPosition = ranking && ranking <= 3 ? ranking : null;

      return prisma.contestSubmission.update({
        where: { id: submission.id },
        data: {
          aiScoreSnapshot: eligibleIndex >= 0 ? eligible[eligibleIndex].aiScoreSnapshot : submission.aiScoreSnapshot,
          finalScore: eligibleIndex >= 0 ? eligible[eligibleIndex].finalScore : submission.finalScore,
          ranking,
          winnerPosition,
          awardedPrize:
            winnerPosition === 1
              ? submission.contest.prize ?? "Winner"
              : winnerPosition === 2
                ? "Runner-up"
                : winnerPosition === 3
                  ? "Second runner-up"
                  : null,
        },
      });
    })
  );

  return prisma.contestSubmission.findMany({
    where: { contestId },
    include: {
      author: {
        select: {
          id: true,
          name: true,
        },
      },
      blog: {
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
        },
      },
    },
    orderBy: [{ ranking: "asc" }, { finalScore: "desc" }, { createdAt: "asc" }],
  });
}
