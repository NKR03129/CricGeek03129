import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { canCreateCommentarySession } from "@/lib/commentary-permissions";
import CommentaryListClient from "./CommentaryListClient";

export const metadata = {
  title: "Live Commentary | CricGeek",
  description: "Real-time ball-by-ball voice commentary from CricGeek moderators on live cricket matches.",
};

export default async function CommentaryPage() {
  const session = await auth();
  const user = session?.user as { id: string; role: string; name: string } | undefined;
  const canStartCommentary = canCreateCommentarySession(user);

  const sessions = await prisma.liveCommentarySession.findMany({
    include: {
      moderator: { select: { id: true, name: true, avatar: true } },
      _count: { select: { entries: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const userLiveSession = user
    ? await prisma.liveCommentarySession.findFirst({
        where: {
          moderatorId: user.id,
          status: {
            in: ["scheduled", "live", "paused"],
          },
        },
        include: {
          moderator: { select: { id: true, name: true, avatar: true } },
          _count: { select: { entries: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    : null;

  return (
    <CommentaryListClient
      sessions={JSON.parse(JSON.stringify(sessions))}
      canStartCommentary={canStartCommentary}
      userName={user?.name}
      userLiveSession={userLiveSession ? JSON.parse(JSON.stringify(userLiveSession)) : null}
    />
  );
}
