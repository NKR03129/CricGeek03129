"use client";

import { useState, useEffect, useRef } from "react";
import { Wifi, WifiOff, ChevronUp, Clock3 } from "lucide-react";
import {
  formatCommentaryTimestamp,
  getOverGroupLabel,
  inferCommentaryBadge,
  inferRunContribution,
  renderCommentaryText,
} from "@/components/commentary/commentary-rich-text";

interface Entry {
  id: string;
  text: string;
  overText: string | null;
  source: string;
  createdAt: string;
}

interface LiveCommentaryFeedProps {
  sessionId: string;
  initialEntries: Entry[];
  sessionStatus: string;
  matchName?: string;
}

function deriveLiveSummary(entries: Entry[]) {
  const latestWithOver = entries.find((entry) => entry.overText);
  const overGroup = getOverGroupLabel(latestWithOver?.overText ?? null);
  const inCurrentOver = overGroup
    ? entries.filter((entry) => getOverGroupLabel(entry.overText) === overGroup)
    : [];
  const overRuns = inCurrentOver.reduce((sum, entry) => sum + inferRunContribution(entry.text), 0);
  const wickets = inCurrentOver.filter((entry) => /\bwicket\b|bowled|caught|lbw|run out\b/i.test(entry.text)).length;

  return {
    overGroup,
    inCurrentOver,
    overRuns,
    wickets,
    latestEntry: entries[0] ?? null,
  };
}

export default function LiveCommentaryFeed({
  sessionId,
  initialEntries,
  sessionStatus,
  matchName,
}: LiveCommentaryFeedProps) {
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  // SSE connection
  useEffect(() => {
    if (sessionStatus === "ended") return;
    const es = new EventSource(`/api/commentary/${sessionId}/stream`);
    es.addEventListener("connected", () => setConnected(true));
    es.addEventListener("entry", (e) => {
      const entry: Entry = JSON.parse(e.data);
      setEntries((prev) => {
        if (prev.some((p) => p.id === entry.id)) return prev;
        return [entry, ...prev];
      });
      if (!autoScroll) setNewCount((c) => c + 1);
    });
    es.onerror = () => setConnected(false);
    return () => { es.close(); setConnected(false); };
  }, [sessionId, sessionStatus, autoScroll]);

  useEffect(() => {
    if (autoScroll && feedRef.current) feedRef.current.scrollTop = 0;
  }, [entries, autoScroll]);

  const handleScroll = () => {
    if (!feedRef.current) return;
    const atTop = feedRef.current.scrollTop < 10;
    setAutoScroll(atTop);
    if (atTop) setNewCount(0);
  };

  const scrollToTop = () => {
    if (feedRef.current) { feedRef.current.scrollTop = 0; setAutoScroll(true); setNewCount(0); }
  };

  const summary = deriveLiveSummary(entries);

  return (
    <div className="bg-[#11161b] border border-slate-800 rounded-[22px] overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.28)]">
      {/* Header */}
      <div className="px-5 py-4 bg-[#0f1419] border-b border-slate-800 flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold text-base tracking-wide">Live Commentary</h3>
          <p className="mt-1 text-xs text-slate-400">
            {matchName ? `${matchName} · ` : ""}{entries.length} {entries.length === 1 ? "entry" : "entries"}
          </p>
        </div>
        {sessionStatus !== "ended" && (
          <div
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium
              ${connected ? "bg-cg-green/10 text-cg-green" : "bg-red-500/10 text-red-400"}`}
          >
            {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {connected ? "Live" : "Reconnecting…"}
          </div>
        )}
        {sessionStatus === "ended" && (
          <span className="text-xs px-2 py-1 rounded-full bg-gray-800 text-gray-400 font-medium">
            Ended
          </span>
        )}
      </div>

      {entries.length > 0 && (
        <div className="grid gap-px border-b border-slate-800 bg-slate-800 md:grid-cols-[120px,1fr,220px]">
          <div className="bg-[#173243] px-5 py-4">
            <p className="text-[11px] font-semibold tracking-[0.22em] text-slate-300">OVER</p>
            <p className="mt-1 text-3xl font-black text-white">{summary.overGroup ?? "LIVE"}</p>
          </div>
          <div className="bg-[#173243] px-5 py-4">
            <p className="text-2xl font-bold text-white">
              {summary.overRuns > 0 ? `${summary.overRuns} runs` : `${summary.inCurrentOver.length || entries.length} updates`}
            </p>
            <p className="mt-1 text-sm text-slate-200">
              {summary.overGroup
                ? `${summary.inCurrentOver.length} updates in this over${summary.wickets ? ` · ${summary.wickets} wicket${summary.wickets > 1 ? "s" : ""}` : ""}`
                : `Latest update ${summary.latestEntry ? formatCommentaryTimestamp(summary.latestEntry.createdAt) : ""}`}
            </p>
          </div>
          <div className="bg-[#173243] px-5 py-4 text-left md:text-right">
            <p className="text-2xl font-bold text-white">{sessionStatus === "live" ? "Live" : sessionStatus}</p>
            <p className="mt-1 text-sm text-slate-200">
              {summary.latestEntry ? `Updated ${formatCommentaryTimestamp(summary.latestEntry.createdAt)}` : "Awaiting first entry"}
            </p>
          </div>
        </div>
      )}

      {/* Feed */}
      <div
        ref={feedRef}
        onScroll={handleScroll}
        className="max-h-[760px] overflow-y-auto relative divide-y divide-slate-800/80"
      >
        {entries.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-gray-500 text-sm font-medium">No commentary yet</p>
            <p className="text-gray-600 text-xs mt-1">Entries will appear here in real-time</p>
          </div>
        ) : (
          entries.map((entry, idx) => {
            const badge = inferCommentaryBadge(entry.text);
            return (
              <div
                key={entry.id}
                className={`flex gap-0 px-2 hover:bg-white/[0.02] transition-colors
                  ${idx === 0 ? "animate-[fadeSlideIn_0.3s_ease-out]" : ""}`}
              >
                {/* Over / time column */}
                <div className="w-20 shrink-0 flex flex-col items-center justify-start pt-5 pb-5 gap-2">
                  {entry.overText ? (
                    <span className="text-lg font-semibold text-slate-300 leading-none">
                      {entry.overText}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">{formatCommentaryTimestamp(entry.createdAt)}</span>
                  )}
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                    <Clock3 size={10} />
                    {formatCommentaryTimestamp(entry.createdAt)}
                  </span>
                </div>

                {/* Badge column */}
                <div className="w-14 shrink-0 flex items-start justify-center pt-5 pb-5">
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

                {/* Content */}
                <div className="flex-1 py-5 pr-5 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <p className="text-[11px] font-semibold tracking-[0.22em] text-slate-400 uppercase">
                      {entry.source === "voice" ? "Voice Commentary" : "Live Update"}
                      {badge ? `, ${badge.label === "W" ? "Wicket" : `${badge.label} Runs`}` : ""}
                    </p>
                    <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-300">
                      {entry.overText ? `Over ${entry.overText}` : formatCommentaryTimestamp(entry.createdAt, true)}
                    </span>
                  </div>
                  <p className="text-[18px] text-slate-100 leading-9">
                    {renderCommentaryText(entry.text)}
                    {entry.overText && (
                      <span className="ml-2 align-middle text-sm text-slate-500">
                        · Logged at {formatCommentaryTimestamp(entry.createdAt)}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* New entries pill */}
      {newCount > 0 && (
        <div className="relative">
          <button
            onClick={scrollToTop}
            className="absolute -top-10 left-1/2 -translate-x-1/2 flex items-center gap-1.5
              px-4 py-2 rounded-full bg-cg-green text-black text-sm font-bold
              shadow-lg shadow-cg-green/20 hover:bg-cg-green-dark transition z-10"
          >
            <ChevronUp size={14} />
            {newCount} new {newCount === 1 ? "entry" : "entries"}
          </button>
        </div>
      )}
    </div>
  );
}
