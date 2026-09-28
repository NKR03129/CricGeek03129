import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { canManageCommentarySession } from "@/lib/commentary-permissions";
import { notFound } from "next/navigation";
import CommentarySessionClient from "./CommentarySessionClient";

interface Props {
  params: Promise<{ sessionId: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { sessionId } = await params;
  const session = await prisma.liveCommentarySession.findUnique({
    where: { id: sessionId },
    select: { matchName: true },
  });

  return {
    title: session ? `${session.matchName} - Live Commentary | CricGeek` : "Commentary | CricGeek",
    description: `Follow live ball-by-ball voice commentary for ${session?.matchName || "this match"} on CricGeek.`,
  };
}

export default async function CommentarySessionPage({ params }: Props) {
  const { sessionId } = await params;

  const commentarySession = await prisma.liveCommentarySession.findUnique({
    where: { id: sessionId },
    include: {
      moderator: { select: { id: true, name: true, avatar: true } },
      entries: { orderBy: { createdAt: "desc" }, take: 100 },
      _count: { select: { entries: true } },
    },
  });

  if (!commentarySession) {
    notFound();
  }

  const authSession = await auth();
  const user = authSession?.user as { id: string; role: string } | undefined;
  const isModerator = canManageCommentarySession(user, commentarySession.moderatorId);

  return (
    <CommentarySessionClient
      session={JSON.parse(JSON.stringify(commentarySession))}
      isModerator={!!isModerator}
    />
  );
}
