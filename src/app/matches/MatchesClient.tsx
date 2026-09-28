"use client";

import { useState, useEffect, useCallback } from "react";
import { Zap, RefreshCw, Wifi } from "lucide-react";
import type { Match } from "@/types/cricket";
import LiveMatchCard from "@/components/matches/LiveMatchCard";
import FormatFilter from "@/components/matches/FormatFilter";
import AdSlot from "@/components/ads/AdSlot";
import LiveScoresTicker from "@/components/matches/LiveScoresTicker";

type Format = "All" | "T20" | "T20I" | "ODI" | "ODI-W" | "Test" | "FC";

interface MatchesClientProps {
  initialMatches: Match[];
  source: string;
}

export default function MatchesClient({ initialMatches, source }: MatchesClientProps) {
  const [matches, setMatches] = useState<Match[]>(initialMatches);
  const [format, setFormat] = useState<Format>("All");
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/matches", { cache: "no-store" });
      const json = await res.json();
      setMatches(Array.isArray(json.matches) ? json.matches : []);
      setLastUpdated(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }));
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Auto-refresh live matches every 30s
  useEffect(() => {
    const hasLive = matches.some((m) => m.matchStarted && !m.matchEnded);
    if (!hasLive) return;
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [matches, refresh]);

  const filtered = format === "All"
    ? matches
    : matches.filter((m) => m.matchType?.toUpperCase() === format.toUpperCase());

  const live = filtered.filter((m) => m.matchStarted && !m.matchEnded);
  const upcoming = filtered.filter((m) => !m.matchStarted);
  const completed = filtered.filter((m) => m.matchEnded);

  return (
    <>
      {/* Live Scores Ticker */}
      <LiveScoresTicker />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <h1 className="text-3xl font-black text-white flex items-center gap-3">
              <Zap className="text-cg-green" />
              Matches & Results
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              {source === "sportmonks"
                ? "Powered by SportMonks · Live, upcoming, and recent fixtures"
                : "Real-time scores and updates from around the cricket world"}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {lastUpdated && (
              <span className="text-xs text-gray-500 hidden sm:block">
                Updated {lastUpdated}
              </span>
            )}
            <button
              onClick={refresh}
              disabled={refreshing}
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-all disabled:opacity-50"
              title="Refresh scores"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Format Filter */}
        <div className="mb-6">
          <FormatFilter selected={format} onChange={setFormat} />
        </div>

        {/* Live Now */}
        {live.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <h2 className="text-lg font-bold text-white">Live Now</h2>
              <span className="text-gray-500 text-sm">({live.length})</span>
              <Wifi size={12} className="text-red-400 ml-1" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {live.map((m) => <LiveMatchCard key={m.id} match={m} />)}
            </div>
          </section>
        )}

        <AdSlot slot="matches-mid" format="horizontal" className="mb-8 max-w-3xl mx-auto" />

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-white mb-4">Upcoming</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {upcoming.map((m) => <LiveMatchCard key={m.id} match={m} />)}
            </div>
          </section>
        )}

        {/* Completed */}
        {completed.length > 0 && (
          <section>
            <h2 className="text-lg font-bold text-white mb-4">Recent Results</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {completed.map((m) => <LiveMatchCard key={m.id} match={m} />)}
            </div>
          </section>
        )}

        {/* Empty state */}
        {filtered.length === 0 && (
          <div className="text-center py-20">
            <Zap size={40} className="text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 text-lg font-medium">No {format !== "All" ? format : ""} matches right now</p>
            <p className="text-gray-600 text-sm mt-1">Check back soon or try a different format filter</p>
          </div>
        )}
      </div>
    </>
  );
}
