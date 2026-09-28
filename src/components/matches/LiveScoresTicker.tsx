"use client";

/**
 * LiveScoresTicker
 *
 * Horizontally scrolling marquee of live scores on the matches page.
 * Polls /api/livescores every 30 seconds client-side.
 * Shows only live matches: team codes + score in a compact pill.
 */

import { useEffect, useEffectEvent, useState } from "react";
import type { Match } from "@/types/cricket";

interface TickerItem {
  id: string;
  label: string;
  isLive: boolean;
}

function buildLabel(match: Match): string {
  const t = match.teamInfo ?? [];
  const t0 = t[0]?.shortname ?? match.teams?.[0]?.slice(0, 3) ?? "—";
  const t1 = t[1]?.shortname ?? match.teams?.[1]?.slice(0, 3) ?? "—";
  const s0 = match.score?.[0];
  const s1 = match.score?.[1];

  const fmt = (s: typeof s0) =>
    s ? `${s.r}/${s.w} (${Number(s.o).toFixed(1)})` : "";

  if (s0 && s1) return `${t0} ${fmt(s0)} | ${t1} ${fmt(s1)}`;
  if (s0) return `${t0} ${fmt(s0)} vs ${t1}`;
  return `${t0} vs ${t1}`;
}

export default function LiveScoresTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [source, setSource] = useState<string>("");

  const fetchScores = useEffectEvent(async () => {
    try {
      const res = await fetch("/api/livescores", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const matches: Match[] = json.matches ?? [];

      const tickerItems = matches
        .filter((m) => m.matchStarted && !m.matchEnded)
        .map((m) => ({
          id: m.id,
          label: buildLabel(m),
          isLive: true,
        }));

      setItems(tickerItems);
      setLastUpdated(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }));
      setSource(json.source ?? "");
    } catch {
      // silently fail — don't break the page
    }
  });

  useEffect(() => {
    void fetchScores();
    const interval = setInterval(() => {
      void fetchScores();
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="bg-cg-dark-2 border-y border-gray-800 overflow-hidden">
      <div className="flex items-center">
        {/* LIVE label */}
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-red-500/10 border-r border-gray-800 h-full">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-red-400 text-xs font-bold tracking-widest">LIVE</span>
        </div>

        {/* Scrolling ticker */}
        <div className="relative flex-1 overflow-hidden">
          <div
            className="flex gap-8 whitespace-nowrap py-2 px-4"
            style={{ animation: `ticker ${Math.max(items.length * 8, 20)}s linear infinite` }}
          >
            {/* Duplicate items for seamless loop */}
            {[...items, ...items].map((item, i) => (
              <span
                key={`${item.id}-${i}`}
                className="inline-flex items-center gap-2 text-xs text-gray-300 font-mono"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cg-green" />
                {item.label}
              </span>
            ))}
          </div>
        </div>

        {/* Updated time */}
        {lastUpdated && (
          <div className="flex-shrink-0 px-3 py-2 text-[10px] text-gray-600 border-l border-gray-800 hidden sm:block">
            {source === "sportmonks" ? "SportMonks" : "Live"}{" "}
            · {lastUpdated}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
