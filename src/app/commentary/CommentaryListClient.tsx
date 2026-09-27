"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Mic, Radio, Plus, Loader2, X, ArrowRight, LogIn } from "lucide-react";
import SessionCard from "@/components/commentary/SessionCard";

interface Session {
  id: string;
  matchId: string;
  matchName: string;
  matchType: string;
  status: string;
  moderator: { id: string; name: string; avatar: string | null };
  createdAt: string;
  endedAt: string | null;
  _count: { entries: number };
}

interface Props {
  sessions: Session[];
  canStartCommentary: boolean;
  userName?: string;
  userLiveSession?: Session | null;
}

export default function CommentaryListClient({
  sessions,
  canStartCommentary,
  userName,
  userLiveSession,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchId, setMatchId] = useState("");
  const [matchName, setMatchName] = useState("");
  const [matchType, setMatchType] = useState("T20");
  const [sessionMode, setSessionMode] = useState<"live" | "scheduled">("live");
  const [filter, setFilter] = useState<"all" | "live" | "scheduled" | "ended">("all");

  const liveSessions = sessions.filter((s) => s.status === "live" || s.status === "paused");
  const scheduledSessions = sessions.filter((s) => s.status === "scheduled");
  const endedSessions = sessions.filter((s) => s.status === "ended");
  const filtered =
    filter === "all"
      ? sessions
      : filter === "live"
      ? liveSessions
      : filter === "scheduled"
      ? scheduledSessions
      : endedSessions;

  useEffect(() => {
    const nextMatchId = searchParams.get("matchId")?.trim() || "";
    const nextMatchName = searchParams.get("matchName")?.trim() || "";
    const nextMatchType = searchParams.get("matchType")?.trim() || "T20";
    const nextStatus = searchParams.get("status") === "scheduled" ? "scheduled" : "live";

    if (!nextMatchId && !nextMatchName) return;

    setMatchId(nextMatchId);
    setMatchName(nextMatchName);
    setMatchType(nextMatchType);
    setSessionMode(nextStatus);
    setShowCreate(true);
  }, [searchParams]);

  const createSession = async () => {
    if (!matchId.trim() || !matchName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/commentary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: matchId.trim(),
          matchName: matchName.trim(),
          matchType,
          status: sessionMode,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/commentary/${data.session.id}`);
        return;
      }

      setError(data.error || "Failed to start commentary session");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-3">
            <Radio className="text-cg-green" />
            Live Commentary
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Start live voice-to-text commentary and let everyone follow the match through real-time text
          </p>
        </div>
        {canStartCommentary && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cg-green text-black font-bold text-sm hover:bg-cg-green-dark transition shrink-0"
          >
            <Plus size={16} />
            Start Commentary
          </button>
        )}
      </div>

      {canStartCommentary ? (
        <div className="bg-gradient-to-br from-cg-green/10 via-cg-dark-2 to-cg-dark-3 border border-cg-green/20 rounded-2xl p-5 mb-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <p className="text-white font-bold text-lg">
                {userLiveSession ? "You already have a live commentary session" : `Commentary is ready for ${userName || "you"}`}
              </p>
              <p className="text-gray-400 text-sm mt-1">
                {userLiveSession
                  ? "Jump back in to keep posting voice-to-text updates for everyone following along."
                  : "Create a session, speak into your microphone, review the transcription, and publish live text updates instantly."}
              </p>
            </div>
            {userLiveSession ? (
              <Link
                href={`/commentary/${userLiveSession.id}`}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cg-green text-black font-bold text-sm hover:bg-cg-green-dark transition shrink-0"
              >
                Resume Session
                <ArrowRight size={16} />
              </Link>
            ) : (
              <button
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cg-green text-black font-bold text-sm hover:bg-cg-green-dark transition shrink-0"
              >
                Go Live Now
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-cg-dark-2 border border-gray-800 rounded-2xl p-5 mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-white font-bold text-lg">Sign in to start commentary</p>
            <p className="text-gray-400 text-sm mt-1">
              Anyone with an account can start a commentary session and share live text updates from voice-to-text.
            </p>
          </div>
          <Link
            href="/auth/login?next=/commentary"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cg-green text-black font-bold text-sm hover:bg-cg-green-dark transition shrink-0"
          >
            <LogIn size={16} />
            Sign In
          </Link>
        </div>
      )}

      {/* Create session form */}
      {showCreate && canStartCommentary && !userLiveSession && (
        <div className="bg-cg-dark-2 border border-cg-green/20 rounded-2xl p-6 mb-8 animate-[fadeSlideIn_0.3s_ease-out]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-bold text-lg flex items-center gap-2">
              <Mic size={18} className="text-cg-green" />
              {sessionMode === "scheduled" ? "Schedule Commentary Session" : "New Commentary Session"}
            </h2>
            <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-white">
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-gray-400 text-xs font-medium mb-1.5">Match ID</label>
              <input
                type="text"
                placeholder="e.g. sm-12345"
                value={matchId}
                onChange={(e) => setMatchId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:border-cg-green focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-xs font-medium mb-1.5">Match Name</label>
              <input
                type="text"
                placeholder="e.g. KKR vs MI"
                value={matchName}
                onChange={(e) => setMatchName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:border-cg-green focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-gray-500">Use strict team-code titles like `KKR vs MI` for roster lookup.</p>
            </div>
            <div>
              <label className="block text-gray-400 text-xs font-medium mb-1.5">Format</label>
              <select
                value={matchType}
                onChange={(e) => setMatchType(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:border-cg-green focus:outline-none"
              >
                <option value="T20">T20</option>
                <option value="T20I">T20I</option>
                <option value="ODI">ODI</option>
                <option value="Test">Test</option>
                <option value="FC">FC</option>
              </select>
            </div>
          </div>
          <div className="mb-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSessionMode("live")}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition ${
                sessionMode === "live"
                  ? "bg-cg-green/15 text-cg-green border border-cg-green/30"
                  : "bg-gray-800 text-gray-400 border border-gray-700 hover:text-white"
              }`}
            >
              Go Live
            </button>
            <button
              type="button"
              onClick={() => setSessionMode("scheduled")}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition ${
                sessionMode === "scheduled"
                  ? "bg-cg-green/15 text-cg-green border border-cg-green/30"
                  : "bg-gray-800 text-gray-400 border border-gray-700 hover:text-white"
              }`}
            >
              Schedule
            </button>
          </div>
          {error && (
            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
          <button
            onClick={createSession}
            disabled={creating || !matchId.trim() || !matchName.trim()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cg-green text-black font-bold text-sm hover:bg-cg-green-dark transition disabled:opacity-50"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Radio size={16} />}
            {creating ? "Saving..." : sessionMode === "scheduled" ? "Schedule Session" : "Go Live"}
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-6">
        {(["all", "live", "scheduled", "ended"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              filter === f
                ? "bg-cg-green/15 text-cg-green border border-cg-green/30"
                : "bg-gray-800 text-gray-400 border border-gray-700 hover:text-white"
            }`}
          >
            {f === "all"
              ? "All"
              : f === "live"
              ? `Live (${liveSessions.length})`
              : f === "scheduled"
              ? `Scheduled (${scheduledSessions.length})`
              : `Ended (${endedSessions.length})`}
          </button>
        ))}
      </div>

      {/* Sessions grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <Radio size={40} className="text-gray-700 mx-auto mb-4" />
          <p className="text-gray-500 text-lg font-medium">No commentary sessions yet</p>
          <p className="text-gray-600 text-sm mt-1">
            {canStartCommentary ? "Start a new commentary session above!" : "Check back when a match is live"}
          </p>
        </div>
      )}
    </div>
  );
}
