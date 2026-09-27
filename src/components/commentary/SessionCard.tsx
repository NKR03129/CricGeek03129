import Link from "next/link";
import { Mic, Clock, MessageSquare } from "lucide-react";

interface SessionCardProps {
  session: {
    id: string;
    matchId: string;
    matchName: string;
    matchType: string;
    status: string;
    moderator: {
      id: string;
      name: string;
      avatar: string | null;
    };
    createdAt: string;
    endedAt: string | null;
    _count: { entries: number };
  };
}

export default function SessionCard({ session }: SessionCardProps) {
  const isLive = session.status === "live";
  const isPaused = session.status === "paused";
  const isScheduled = session.status === "scheduled";

  return (
    <Link href={`/commentary/${session.id}`}>
      <div className="group bg-cg-dark-2 border border-gray-800 rounded-xl p-5 hover:border-cg-green/30 hover:bg-cg-dark-3 transition-all duration-200 cursor-pointer">
        {/* Status badge */}
        <div className="flex items-center justify-between mb-3">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
            isLive
              ? "bg-red-500/15 text-red-400"
              : isPaused
              ? "bg-yellow-500/15 text-yellow-400"
              : isScheduled
              ? "bg-cg-green/15 text-cg-green"
              : "bg-gray-700/50 text-gray-400"
          }`}>
            {isLive && <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />}
            {isLive ? "LIVE" : isPaused ? "PAUSED" : isScheduled ? "SCHEDULED" : "ENDED"}
          </span>
          <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 font-medium">
            {session.matchType}
          </span>
        </div>

        {/* Match name */}
        <h3 className="text-white font-bold text-base mb-2 group-hover:text-cg-green transition-colors line-clamp-2">
          {session.matchName}
        </h3>

        {/* Commentator */}
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cg-green to-cg-green-dark flex items-center justify-center text-black text-xs font-bold">
            {session.moderator.name.charAt(0).toUpperCase()}
          </div>
          <span className="text-gray-400 text-sm">{session.moderator.name}</span>
          <Mic size={12} className="text-gray-500" />
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-gray-500 text-xs">
          <div className="flex items-center gap-1">
            <MessageSquare size={12} />
            <span>{session._count.entries} entries</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock size={12} />
            <span>
              {new Date(session.createdAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
