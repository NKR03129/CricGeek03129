"use client";

import { Activity, Loader2, TriangleAlert } from "lucide-react";
import EdaCards from "@/components/matches/EdaCards";
import LiveEdaCharts from "@/components/matches/LiveEdaCharts";
import { useLiveEdaReport } from "@/hooks/useLiveEdaReport";
import { LIVE_EDA_POLL_INTERVAL_SECONDS } from "@/lib/eda/live";

type LiveEdaPanelProps = {
  matchId: string;
  enabled: boolean;
};

export default function LiveEdaPanel({ matchId, enabled }: LiveEdaPanelProps) {
  const { report, error, isLoading, isRefreshing } = useLiveEdaReport({
    matchId,
    enabled,
    pollIntervalSeconds: LIVE_EDA_POLL_INTERVAL_SECONDS,
  });

  if (!enabled) {
    return (
      <section className="rounded-xl border border-gray-800 bg-cg-dark-2 p-5">
        <h3 className="text-lg font-bold text-white">Live Intelligence</h3>
        <p className="mt-2 text-sm text-gray-400">
          Live EDA unlocks as soon as the match starts and score state begins flowing in from the provider.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-gray-800 bg-cg-dark-2 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-cg-green/20 bg-cg-green/10 text-cg-green">
              <Activity size={16} />
            </span>
            <h3 className="text-lg font-bold text-white">Live Intelligence</h3>
            <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-red-200">
              <span className="h-1.5 w-1.5 rounded-full bg-red-300 animate-pulse" />
              Live
            </span>
          </div>
          <p className="mt-2 text-sm text-gray-400">
            Real-time command-center analytics refreshed every 15 seconds from the latest live score state, commentary flow, and venue context.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          {isRefreshing ? <Loader2 size={14} className="animate-spin" /> : null}
          <span className="rounded-full bg-white/5 px-3 py-1.5">
            Auto-refresh every {report?.pollIntervalSeconds ?? LIVE_EDA_POLL_INTERVAL_SECONDS}s
          </span>
          {report ? (
            <span className="rounded-full bg-white/5 px-3 py-1.5">
              {report.ballsTracked} balls tracked
            </span>
          ) : null}
          {report ? (
            <span className="rounded-full bg-white/5 px-3 py-1.5">
              Confidence {Math.round(report.confidence.score)}% | {report.confidence.label}
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {error}
        </p>
      ) : null}

      {!report && !isLoading ? (
        <div className="mt-4 rounded-lg border border-gray-800 bg-cg-dark px-4 py-4 text-sm text-gray-400">
          Waiting for the current live state to generate the first EDA snapshot.
        </div>
      ) : null}

      {report ? (
        <div className="mt-5 space-y-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(270px,0.75fr)]">
            <div className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-4">
              <p className="text-sm leading-7 text-gray-200">{report.summary}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-400">
                <span className="rounded-full bg-white/5 px-3 py-1.5">
                  Phase {report.snapshot.phase}
                </span>
                <span className="rounded-full bg-white/5 px-3 py-1.5">
                  {report.snapshot.battingTeam} {report.snapshot.runs}/{report.snapshot.wickets}
                </span>
                <span className="rounded-full bg-white/5 px-3 py-1.5">
                  Generated {new Date(report.freshness.generatedAt).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Kolkata",
                  })}
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Current rate</p>
                <p className="mt-2 text-2xl font-black text-white">{report.snapshot.currentRunRate}</p>
                <p className="mt-2 text-xs text-gray-400">Scoring tempo right now</p>
              </div>
              <div className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Pressure</p>
                <p className="mt-2 text-2xl font-black text-white">{report.snapshot.pressureIndex}</p>
                <p className="mt-2 text-xs text-gray-400">Live scoreboard squeeze</p>
              </div>
              <div className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Required rate</p>
                <p className="mt-2 text-2xl font-black text-white">{report.snapshot.requiredRunRate ?? "NA"}</p>
                <p className="mt-2 text-xs text-gray-400">Only active in a chase</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-cg-green/20 bg-cg-green/[0.06] px-4 py-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-cg-green">
              <span className="rounded-full border border-cg-green/20 bg-black/20 px-3 py-1.5 font-semibold uppercase tracking-[0.18em]">
                Real-time mode
              </span>
              <span className="rounded-full bg-white/5 px-3 py-1.5">
                Updates every {report.pollIntervalSeconds}s
              </span>
              <span className="rounded-full bg-white/5 px-3 py-1.5">
                Recomputes cards, charts, and tactical context on each cycle
              </span>
            </div>
          </div>

          <EdaCards cards={report.cards} />
          <LiveEdaCharts
            analytics={report.analytics}
            ballsTracked={report.ballsTracked}
            completedOvers={Math.max(Math.floor(report.snapshot.overs), 0)}
          />

          {report.warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-4">
              <div className="flex items-center gap-2">
                <TriangleAlert size={16} className="text-amber-200" />
                <p className="text-sm font-semibold text-amber-100">Operational notes</p>
              </div>
              <div className="mt-3 space-y-2">
                {report.warnings.map((warning) => (
                  <p key={warning} className="text-sm text-amber-200">
                    {warning}
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-4">
            <h4 className="text-sm font-semibold text-white">Recommendation cadence</h4>
            <p className="mt-3 text-sm leading-7 text-gray-400">
              Live player recommendations are now shown in the dedicated trigger-aware panel above the commentary feed.
              Batting calls refresh only after wickets, while bowling calls refresh after completed overs once enough data
              exists. This keeps the advice stable between events instead of churning every polling cycle.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
