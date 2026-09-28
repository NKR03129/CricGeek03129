"use client";

import { useState } from "react";
import { ArrowLeft, Mic, Radio, Users } from "lucide-react";
import Link from "next/link";
import ModeratorDashboard from "@/components/commentary/ModeratorDashboard";
import LiveCommentaryFeed from "@/components/commentary/LiveCommentaryFeed";

interface Entry {
  id: string;
  text: string;
  overText: string | null;
  source: string;
  createdAt: string;
}

interface Session {
  id: string;
  matchId: string;
  matchName: string;
  matchType: string;
  status: string;
  moderator: { id: string; name: string; avatar: string | null };
  createdAt: string;
  endedAt: string | null;
  entries: Entry[];
  _count: { entries: number };
}

interface Props {
  session: Session;
  isModerator: boolean;
}

export default function CommentarySessionClient({ session, isModerator }: Props) {
  const [status, setStatus] = useState(session.status);
  const [entries, setEntries] = useState<Entry[]>(session.entries);

  const handleEntryPosted = (entry: Entry) => {
    setEntries((prev) => {
      if (prev.some((p) => p.id === entry.id)) return prev;
      return [entry, ...prev];
    });
  };

  const isLive = status === "live";
  const isPaused = status === "paused";
  const isScheduled = status === "scheduled";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <Link
        href="/commentary"
        className="inline-flex items-center gap-1.5 text-gray-400 hover:text-cg-green text-sm mb-6 transition"
      >
        <ArrowLeft size={14} />
        All Commentary Sessions
      </Link>

      {/* Match header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
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
          </div>
          <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 font-medium">
            {session.matchType}
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-3">
          <Radio className="text-cg-green shrink-0" />
          {session.matchName}
        </h1>

        <div className="flex items-center gap-4 mt-3 text-sm text-gray-400">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cg-green to-cg-green-dark flex items-center justify-center text-black text-xs font-bold">
              {session.moderator.name.charAt(0).toUpperCase()}
            </div>
            <span className="flex items-center gap-1">
              <Mic size={12} /> {session.moderator.name}
            </span>
          </div>
          <span className="flex items-center gap-1">
            <Users size={12} /> {entries.length} entries
          </span>
          <span className="rounded-full border border-gray-700 bg-gray-800/70 px-2 py-0.5 text-xs text-gray-300">
            Live text for everyone watching
          </span>
          <span>
            Started {new Date(session.createdAt).toLocaleString("en-IN", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className={`grid gap-6 ${isModerator ? "lg:grid-cols-2" : "grid-cols-1 max-w-3xl"}`}>
        {/* Moderator controls */}
        {isModerator && (
          <div>
            <ModeratorDashboard
              sessionId={session.id}
              sessionStatus={status}
              onStatusChange={setStatus}
              onEntryPosted={handleEntryPosted}
            />
          </div>
        )}

        {/* Live feed */}
        <div>
          <LiveCommentaryFeed
            sessionId={session.id}
            initialEntries={entries}
            sessionStatus={status}
            matchName={session.matchName}
          />
        </div>
      </div>
    </div>
  );
}
