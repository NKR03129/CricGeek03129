"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BarChart3, ChevronRight, Sparkles, Target, Trophy, X, Zap } from "lucide-react";
import type {
  BattingRecommendation,
  BowlingRecommendation,
  LiveAdvisorResponse,
  LiveRecommendationEngineState,
  LiveRecommendationTriggerState,
} from "@/types/insights";
import { cn } from "@/lib/utils";

interface LiveSquadPayload {
  engine: LiveRecommendationEngineState;
  situation: {
    runs: number;
    wickets: number;
    overs: number;
    innings: number;
    completedOvers: number;
    battingTeam: string;
    bowlingTeam: string;
    lastWicketOver: number | null;
  } | null;
}

interface LiveRecommendationBubbleProps {
  matchId: string;
  matchType: string;
  enabled: boolean;
  className?: string;
}

type BattingPanelState = {
  triggerKey: string;
  triggerReason: string | null;
  picks: BattingRecommendation[];
  meta: LiveRecommendationTriggerState;
};

type BowlingPanelState = {
  triggerKey: string;
  triggerReason: string | null;
  picks: BowlingRecommendation[];
  meta: LiveRecommendationTriggerState;
};

const POLL_INTERVAL_MS = 30_000;
const T20_RE = /t20/i;

function confidenceTone(meta: LiveRecommendationTriggerState | null | undefined) {
  if (!meta?.squadConfirmed) return "text-amber-200";
  if (meta.candidateCount >= 5) return "text-emerald-200";
  return "text-amber-100";
}

function formatRuns(value: number) {
  return Number.isFinite(value) ? value.toFixed(1) : "—";
}

function SectionMeta({
  meta,
  triggerReason,
}: {
  meta: LiveRecommendationTriggerState;
  triggerReason: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-gray-400">
      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">
        {meta.currentEvidence}/{meta.requiredEvidence} {meta.evidenceUnit}
      </span>
      <span className={cn("rounded-full border px-2 py-1", meta.squadConfirmed ? "border-emerald-500/20 bg-emerald-500/10" : "border-amber-500/20 bg-amber-500/10")}>
        {meta.squadConfirmed ? "confirmed squad" : "fallback squad"}
      </span>
      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">
        {meta.candidateCount} eligible
      </span>
      {triggerReason ? (
        <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-violet-200 normal-case tracking-normal">
          {triggerReason}
        </span>
      ) : null}
    </div>
  );
}

function BattingSection({ panel }: { panel: BattingPanelState }) {
  return (
    <div className="space-y-3 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-300">Next batter</p>
          <p className={cn("mt-1 text-xs", confidenceTone(panel.meta))}>
            Updates only on wickets so the batting call does not churn ball-to-ball.
          </p>
        </div>
        <Target size={16} className="text-violet-300" />
      </div>

      <SectionMeta meta={panel.meta} triggerReason={panel.triggerReason} />

      {panel.picks.length > 0 ? (
        <div className="space-y-2">
          {panel.picks.slice(0, 3).map((pick, index) => (
            <div
              key={`${panel.triggerKey}-${pick.player}`}
              className="rounded-xl border border-white/[0.08] bg-black/15 px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {index + 1}. {pick.player}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">{pick.team}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-amber-300">{formatRuns(pick.expRuns)} xR</p>
                  <p className="mt-1 text-[11px] text-gray-400">
                    Fit {Math.round(pick.situationSuitability)}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-xs leading-6 text-gray-300">{pick.reasons[0]}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-3 text-xs leading-6 text-amber-100">
          {panel.meta.warning || "No eligible incoming batter cleared the current squad and dismissal filters."}
        </p>
      )}
    </div>
  );
}

function BowlingSection({ panel }: { panel: BowlingPanelState }) {
  return (
    <div className="space-y-3 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Next bowler</p>
          <p className={cn("mt-1 text-xs", confidenceTone(panel.meta))}>
            Updates after completed overs, with quota and last-over restrictions enforced.
          </p>
        </div>
        <Trophy size={16} className="text-cyan-300" />
      </div>

      <SectionMeta meta={panel.meta} triggerReason={panel.triggerReason} />

      {panel.picks.length > 0 ? (
        <div className="space-y-2">
          {panel.picks.slice(0, 3).map((pick, index) => (
            <div
              key={`${panel.triggerKey}-${pick.player}`}
              className="rounded-xl border border-white/[0.08] bg-black/15 px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {index + 1}. {pick.player}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">{pick.team}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-cyan-300">{pick.utilityScore.toFixed(2)}</p>
                  <p className="mt-1 text-[11px] text-gray-400">
                    xW {pick.expectedWickets.toFixed(2)} | xR {pick.expectedRunsConceded.toFixed(1)}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-xs leading-6 text-gray-300">{pick.reasons[0]}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-3 text-xs leading-6 text-amber-100">
          {panel.meta.warning || "No eligible bowler cleared the squad, fatigue, and quota filters."}
        </p>
      )}
    </div>
  );
}

export default function LiveRecommendationBubble({
  matchId,
  matchType,
  enabled,
  className,
}: LiveRecommendationBubbleProps) {
  const isT20 = T20_RE.test(matchType);
  const lastBattingTriggerRef = useRef<string | null>(null);
  const lastBowlingTriggerRef = useRef<string | null>(null);
  const lastInningsRef = useRef<number | null>(null);

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [engine, setEngine] = useState<LiveRecommendationEngineState | null>(null);
  const [battingPanel, setBattingPanel] = useState<BattingPanelState | null>(null);
  const [bowlingPanel, setBowlingPanel] = useState<BowlingPanelState | null>(null);

  const fetchAdvisor = useCallback(async () => {
    const params = new URLSearchParams({
      matchId,
      strategy: "balanced",
      topN: "5",
    });
    const response = await fetch(`/api/insights/live?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as LiveAdvisorResponse;
    return payload;
  }, [matchId]);

  useEffect(() => {
    if (!enabled || !isT20) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const params = new URLSearchParams({
          matchId,
          lastBattingTriggerKey: lastBattingTriggerRef.current ?? "",
          lastBowlingTriggerKey: lastBowlingTriggerRef.current ?? "",
        });

        const response = await fetch(`/api/insights/live-squad?${params.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;

        const payload = (await response.json()) as LiveSquadPayload;
        setEngine(payload.engine);

        const innings = payload.situation?.innings ?? null;
        if (innings !== null && lastInningsRef.current !== null && innings !== lastInningsRef.current) {
          lastBattingTriggerRef.current = null;
          lastBowlingTriggerRef.current = null;
          setBattingPanel(null);
          setBowlingPanel(null);
          setDismissed(new Set());
        }
        if (innings !== null) {
          lastInningsRef.current = innings;
        }

        const shouldRefreshBatting =
          payload.engine.batting.shouldRefresh &&
          payload.engine.batting.triggerKey !== null &&
          !dismissed.has(payload.engine.batting.triggerKey);
        const shouldRefreshBowling =
          payload.engine.bowling.shouldRefresh &&
          payload.engine.bowling.triggerKey !== null &&
          !dismissed.has(payload.engine.bowling.triggerKey);

        if (!shouldRefreshBatting && !shouldRefreshBowling) return;

        setLoading(true);
        const advisor = await fetchAdvisor();
        if (!advisor || cancelled) return;

        setEngine(advisor.engine);

        if (shouldRefreshBatting && advisor.engine.batting.triggerKey) {
          lastBattingTriggerRef.current = advisor.engine.batting.triggerKey;
          setBattingPanel({
            triggerKey: advisor.engine.batting.triggerKey,
            triggerReason: advisor.engine.batting.triggerReason,
            picks: advisor.battingRecommendations,
            meta: advisor.engine.batting,
          });
        }

        if (shouldRefreshBowling && advisor.engine.bowling.triggerKey) {
          lastBowlingTriggerRef.current = advisor.engine.bowling.triggerKey;
          setBowlingPanel({
            triggerKey: advisor.engine.bowling.triggerKey,
            triggerReason: advisor.engine.bowling.triggerReason,
            picks: advisor.bowlingRecommendations,
            meta: advisor.engine.bowling,
          });
        }
      } catch {
        // Keep the widget quiet on transient polling failures.
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [dismissed, enabled, fetchAdvisor, isT20, matchId]);

  const visibleBatting = Boolean(
    battingPanel && battingPanel.triggerKey && !dismissed.has(battingPanel.triggerKey)
  );
  const visibleBowling = Boolean(
    bowlingPanel && bowlingPanel.triggerKey && !dismissed.has(bowlingPanel.triggerKey)
  );
  const visible = enabled && isT20 && (loading || visibleBatting || visibleBowling);

  if (!visible) return null;

  const dismiss = () => {
    setDismissed((current) => {
      const next = new Set(current);
      if (battingPanel?.triggerKey) next.add(battingPanel.triggerKey);
      if (bowlingPanel?.triggerKey) next.add(bowlingPanel.triggerKey);
      return next;
    });
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-violet-500/25 bg-gradient-to-br from-[#17112d] via-[#120f24] to-[#0e0a1f]",
        "shadow-[0_0_40px_rgba(139,92,246,0.12)]",
        className
      )}
    >
      <button
        onClick={dismiss}
        className="absolute right-3 top-3 z-10 rounded-full p-1 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
        aria-label="Dismiss recommendations"
      >
        <X size={14} />
      </button>

      <div
        className="flex cursor-pointer items-start gap-3 px-4 py-3"
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/15">
          <Sparkles size={15} className="text-violet-300" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-300">
            Live recommendation engine
          </p>
          <p className="mt-1 text-[11px] leading-5 text-gray-400">
            Batters refresh only on wickets. Bowlers refresh after completed overs once the innings is at least 4 overs old.
          </p>
          {engine?.squadWarning ? (
            <p className="mt-1 flex items-start gap-1 text-[11px] leading-5 text-amber-200">
              <Zap size={11} className="mt-0.5 flex-shrink-0 text-amber-300" />
              <span>{engine.squadWarning}</span>
            </p>
          ) : null}
        </div>

        <ChevronRight
          size={14}
          className={cn("mt-1 flex-shrink-0 text-gray-500 transition-transform", expanded && "rotate-90")}
        />
      </div>

      <div
        className={cn(
          "overflow-hidden transition-all duration-300",
          expanded ? "max-h-[900px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="space-y-4 px-4 pb-4">
          {loading ? (
            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3 text-xs text-gray-400">
              Refreshing trigger-aware recommendations…
            </div>
          ) : null}

          {visibleBatting && battingPanel ? <BattingSection panel={battingPanel} /> : null}
          {visibleBowling && bowlingPanel ? <BowlingSection panel={bowlingPanel} /> : null}

          {!visibleBatting && !visibleBowling && engine ? (
            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3 text-xs text-gray-400">
              {engine.batting.holdReason} {engine.bowling.holdReason}
            </div>
          ) : null}

          <Link
            href={`/insights?matchId=${encodeURIComponent(matchId)}`}
            className={cn(
              "flex w-full items-center justify-between rounded-xl border border-violet-500/30 bg-violet-600/15 px-3 py-2",
              "text-xs font-medium text-violet-200 transition-colors hover:bg-violet-600/25"
            )}
          >
            <span className="flex items-center gap-1.5">
              <BarChart3 size={11} />
              Open AI Insights
            </span>
            <ChevronRight size={11} />
          </Link>

          {engine ? (
            <p className="text-center text-[10px] text-gray-500">
              Squads: {engine.battingSquadSize} batting candidates loaded, {engine.bowlingSquadSize} bowling candidates loaded.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
