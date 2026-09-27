"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Radio, Mic, ArrowRight, Loader2, Clock3 } from "lucide-react";
import {
  formatCommentaryTimestamp,
  inferCommentaryBadge,
  renderCommentaryText,
} from "@/components/commentary/commentary-rich-text";

// ─── Types ───────────────────────────────────────────────────────────────────

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

interface Entry {
  id: string;
  text: string;
  overText: string | null;
  source: string;
  createdAt: string;
}

interface MatchLiveCommentaryProps {
  matchId: string;
  matchName: string;
  matchType: string;
  isLive: boolean;
  /** Whether the viewing user can start a new commentary session */
  canStartSession: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 8_000;
const MAX_ENTRIES_SHOWN = 6;

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MatchLiveCommentary({
  matchId,
  matchName,
  matchType,
  isLive,
  canStartSession,
}: MatchLiveCommentaryProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch the active session + its recent entries for this match
  const fetchSession = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(
        `/api/commentary?matchId=${encodeURIComponent(matchId)}&status=live`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("Failed to fetch sessions");
      const data = await res.json() as { sessions: Session[] };

      // Prefer live, then paused, then scheduled
      const sorted = (data.sessions ?? []).sort((a, b) => {
        const order = (s: Session) =>
          s.status === "live" ? 0 : s.status === "paused" ? 1 : 2;
        return order(a) - order(b);
      });
      const active = sorted[0] ?? null;
      setSession(active);

      if (active) {
        const eRes = await fetch(
          `/api/commentary/${active.id}/entries?limit=${MAX_ENTRIES_SHOWN}`,
          { cache: "no-store" }
        );
        if (eRes.ok) {
          const eData = await eRes.json() as { entries: Entry[] };
          setEntries(eData.entries ?? []);
        }
      }
    } catch {
      // silent on poll — don't flash errors to reader
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  // Initial load
  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  // Auto-poll while the match is live
  useEffect(() => {
    if (!isLive) return;
    pollInterval.current = setInterval(() => void fetchSession(true), POLL_INTERVAL_MS);
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, [isLive, fetchSession]);

  // Create a new session on behalf of the user, then redirect to it
  const handleGoLive = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/commentary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, matchName, matchType }),
      });
      const data = await res.json() as { session?: Session; sessionId?: string; error?: string };

      if (!res.ok) {
        if (res.status === 409 && (data.sessionId || data.session?.id)) {
          // Session already exists — redirect to it
          const sid = data.sessionId ?? data.session?.id;
          window.location.href = `/commentary/${sid}`;
          return;
        }
        throw new Error(data.error ?? "Failed to create session");
      }

      if (data.session?.id) {
        window.location.href = `/commentary/${data.session.id}`;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
    } finally {
      setCreating(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const isSessionLive = session?.status === "live";
  const isSessionPaused = session?.status === "paused";

  return (
    <div className="bg-cg-dark-2 border border-gray-800 rounded-xl overflow-hidden mb-6">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 bg-cg-dark border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Radio size={15} className={isSessionLive ? "text-red-400 animate-pulse" : "text-gray-500"} />
          <span className="text-sm font-semibold text-white">Live Text Commentary</span>
          {isSessionLive && (
            <span className="flex items-center gap-1 text-xs font-medium text-red-400 ml-1">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              LIVE
            </span>
          )}
          {isSessionPaused && (
            <span className="text-xs font-medium text-yellow-400 ml-1">PAUSED</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {session && (
            <Link
              href={`/commentary/${session.id}`}
              className="flex items-center gap-1 text-xs text-cg-green hover:text-cg-green-dark transition font-medium"
            >
              Full Session <ArrowRight size={12} />
            </Link>
          )}
          {canStartSession && !session && !loading && (
            <button
              onClick={handleGoLive}
              disabled={creating}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-cg-green text-black hover:bg-cg-green-dark transition disabled:opacity-50"
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />}
              {creating ? "Starting…" : "Go Live"}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-gray-500 text-sm">
            <Loader2 size={14} className="animate-spin" />
            Loading commentary…
          </div>
        ) : error ? (
          <p className="text-red-400 text-xs py-3">{error}</p>
        ) : !session ? (
          /* No active session — Option A: always show placeholder */
          <div className="py-4 text-center">
            <Radio size={28} className="text-gray-700 mx-auto mb-2" />
            <p className="text-gray-500 text-sm font-medium">
              No live text commentary yet for this match
            </p>
            {canStartSession ? (
              <p className="text-gray-600 text-xs mt-1">
                You can start a session using the{" "}
                <button
                  onClick={handleGoLive}
                  className="text-cg-green underline underline-offset-2 hover:no-underline"
                >
                  Go Live
                </button>{" "}
                button above.
              </p>
            ) : (
              <p className="text-gray-600 text-xs mt-1">
                Check back when a commentator goes live.
              </p>
            )}
          </div>
        ) : entries.length === 0 ? (
          /* Session exists but no entries yet */
          <div className="py-4 text-center">
            <p className="text-gray-500 text-sm">
              {session.moderator.name} is live — first entry coming soon…
            </p>
          </div>
        ) : (
          /* Entry feed — Cricbuzz style */
          <div className="divide-y divide-gray-800/60">
            {entries.slice(0, MAX_ENTRIES_SHOWN).map((entry) => {
              const badge = inferCommentaryBadge(entry.text);
              return (
                <div key={entry.id} className="flex gap-0 hover:bg-white/[0.02] transition-colors">
                  {/* Over / time */}
                  <div className="w-20 shrink-0 flex flex-col items-center justify-start pt-4 pb-4 gap-2">
                    <span className="text-lg font-semibold text-slate-300 leading-none">
                      {entry.overText ?? "Live"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      <Clock3 size={10} />
                      {formatCommentaryTimestamp(entry.createdAt)}
                    </span>
                  </div>
                  {/* Badge */}
                  <div className="w-14 shrink-0 flex items-start justify-center pt-4 pb-4">
                    {badge ? (
                      <div
                        className={`min-w-9 h-9 rounded-md flex items-center justify-center px-2 text-sm font-bold
                          ${badge.bgClass} ${badge.textClass}`}
                      >
                        {badge.label}
                      </div>
                    ) : (
                      <div className="w-9 h-9 rounded-md border border-slate-800 bg-slate-950/50 flex items-center justify-center">
                        <span className="text-slate-500 text-base leading-none">•</span>
                      </div>
                    )}
                  </div>
                  {/* Text */}
                  <div className="flex-1 py-4 pr-4 min-w-0">
                    <p className="text-[10px] font-semibold tracking-[0.22em] text-slate-400 uppercase mb-2">
                      {entry.source === "voice" ? "Voice Commentary" : "Live Update"}
                      {entry.overText && (
                        <span className="ml-2 text-slate-500 normal-case tracking-normal font-normal">· Over {entry.overText}</span>
                      )}
                    </p>
                    <p className="text-[17px] text-slate-100 leading-8">
                      {renderCommentaryText(entry.text)}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Logged {timeAgo(entry.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer — moderator credit + link */}
      {session && (
        <div className="px-4 py-2.5 bg-cg-dark border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
          <span>
            Commentated by{" "}
            <span className="text-gray-300 font-medium">{session.moderator.name}</span>
            {" · "}{session._count.entries} entr{session._count.entries === 1 ? "y" : "ies"}
          </span>
          <Link
            href={`/commentary/${session.id}`}
            className="text-cg-green hover:text-cg-green-dark transition font-medium"
          >
            View all →
          </Link>
        </div>
      )}
    </div>
  );
}
