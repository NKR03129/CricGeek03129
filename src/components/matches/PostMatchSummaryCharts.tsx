"use client";

import { cn } from "@/lib/utils";
import type {
  PostMatchCollapsePeriod,
  PostMatchInningsAnalytics,
  PostMatchOverSummary,
  PostMatchPartnershipSummary,
  PostMatchSummaryAnalytics,
} from "@/types/eda";

type PostMatchSummaryChartsProps = {
  summaryAnalytics: PostMatchSummaryAnalytics;
};

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-6 text-sm text-gray-400">
      {message}
    </div>
  );
}

function SectionFrame({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-[24px] border border-white/10 bg-black/20 p-5 backdrop-blur", className)}>
      <h4 className="text-sm font-semibold uppercase tracking-[0.22em] text-white/50">{title}</h4>
      <p className="mt-2 text-sm leading-6 text-gray-400">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function buildPolyline(points: PostMatchOverSummary[], width: number, height: number, padding: number) {
  const maxRuns = Math.max(...points.map((point) => point.cumulativeRuns), 1);

  return points
    .map((point, index) => {
      const x = padding + (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
      const y = height - padding - (point.cumulativeRuns / maxRuns) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");
}

function cumulativePoint(point: PostMatchOverSummary, index: number, total: number, width: number, height: number, padding: number, maxRuns: number) {
  return {
    x: padding + (index / Math.max(total - 1, 1)) * (width - padding * 2),
    y: height - padding - (point.cumulativeRuns / Math.max(maxRuns, 1)) * (height - padding * 2),
  };
}

function MomentumMiniChart({ inning }: { inning: PostMatchInningsAnalytics }) {
  if (inning.overSummaries.length === 0) {
    return <EmptyState message="Over-by-over momentum could not be reconstructed for this innings." />;
  }

  const width = 520;
  const height = 220;
  const padding = 24;
  const maxRuns = Math.max(...inning.overSummaries.map((point) => point.cumulativeRuns), 1);
  const polyline = buildPolyline(inning.overSummaries, width, height, padding);

  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.05] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{inning.team}</p>
          <p className="mt-1 text-xs text-gray-400">{inning.inning}</p>
        </div>
        {inning.highestImpactOver ? (
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold text-gray-200">
            Impact over {inning.highestImpactOver.over + 1}
          </span>
        ) : null}
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 h-48 w-full overflow-visible rounded-2xl border border-white/8 bg-[#080b12]">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = height - padding - tick * (height - padding * 2);
          return (
            <line
              key={tick}
              x1={padding}
              y1={y}
              x2={width - padding}
              y2={y}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />
          );
        })}
        <polyline fill="none" stroke="url(#momentum-gradient)" strokeWidth="3" points={polyline} />
        <defs>
          <linearGradient id="momentum-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
        {inning.overSummaries.map((point, index) => {
          const { x, y } = cumulativePoint(point, index, inning.overSummaries.length, width, height, padding, maxRuns);
          const isImpact = inning.highestImpactOver?.id === point.id;
          return (
            <g key={point.id}>
              <circle
                cx={x}
                cy={y}
                r={isImpact ? 5 : point.wickets > 0 ? 4 : 2.8}
                fill={isImpact ? "#f97316" : point.wickets > 0 ? "#f43f5e" : "#38bdf8"}
                stroke={isImpact ? "#fff7ed" : "transparent"}
              />
              {point.wickets > 0 ? (
                <line x1={x} y1={y - 12} x2={x} y2={y + 12} stroke="rgba(244,63,94,0.6)" strokeWidth="1.5" />
              ) : null}
            </g>
          );
        })}
      </svg>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">Best phase</p>
          <p className="mt-1 text-sm font-semibold text-white">
            {inning.bestBattingPhase ? `${inning.bestBattingPhase.phase} · ${inning.bestBattingPhase.runRate} rpo` : "Waiting"}
          </p>
        </div>
        <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">Powerplay</p>
          <p className="mt-1 text-sm font-semibold text-white">
            {inning.powerplay ? `${inning.powerplay.runs}/${inning.powerplay.wickets}` : "Waiting"}
          </p>
        </div>
        <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">Death overs</p>
          <p className="mt-1 text-sm font-semibold text-white">
            {inning.deathOvers ? `${inning.deathOvers.runs}/${inning.deathOvers.wickets}` : "Waiting"}
          </p>
        </div>
      </div>
    </div>
  );
}

function PhaseBattle({ innings }: { innings: PostMatchInningsAnalytics[] }) {
  const rows = ["Powerplay", "Middle", "Death"].map((phase) => ({
    phase,
    entries: innings
      .map((inning) => inning.phaseStats.find((entry) => entry.phase === phase && entry.legalBalls > 0))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
  }));

  const maxRunRate = Math.max(
    1,
    ...rows.flatMap((row) => row.entries.map((entry) => entry.runRate))
  );

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.phase} className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">{row.phase}</p>
            <p className="text-xs text-gray-400">Phase run-rate comparison</p>
          </div>
          <div className="mt-4 space-y-3">
            {row.entries.length > 0 ? (
              row.entries.map((entry) => (
                <div key={`${row.phase}-${entry.inning}`} className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold text-gray-200">{entry.team}</span>
                    <span className="text-white">{entry.runRate} rpo</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-sky-500"
                      style={{ width: `${Math.min(100, (entry.runRate / maxRunRate) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400">{entry.runs} runs · {entry.wickets} wkts</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-400">No reconstructed overs for this phase.</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function InsightList<T extends { id: string; note: string }>(
  {
    items,
    emptyMessage,
    accentClass = "border-white/10 bg-white/[0.05]",
    valueRenderer,
  }: {
    items: T[];
    emptyMessage: string;
    accentClass?: string;
    valueRenderer?: (item: T) => React.ReactNode;
  }
) {
  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className={cn("rounded-2xl border px-4 py-3", accentClass)}>
          {valueRenderer ? <div className="mb-2 text-sm font-semibold text-white">{valueRenderer(item)}</div> : null}
          <p className="text-sm leading-6 text-gray-200">{item.note}</p>
        </div>
      ))}
    </div>
  );
}

function partnershipsValue(item: PostMatchPartnershipSummary) {
  return `${item.pair} · ${item.runs} runs`;
}

function collapseValue(item: PostMatchCollapsePeriod) {
  return `Overs ${item.startOver + 1}-${item.endOver + 1} · ${item.wickets} wickets`;
}

export default function PostMatchSummaryCharts({ summaryAnalytics }: PostMatchSummaryChartsProps) {
  return (
    <div className="space-y-5">
      <SectionFrame
        title="Momentum Timeline"
        subtitle="A dedicated retrospective innings curve, with wickets and impact overs embedded directly into the run story."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          {summaryAnalytics.innings.map((inning) => (
            <MomentumMiniChart key={inning.inning} inning={inning} />
          ))}
        </div>
      </SectionFrame>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionFrame
          title="Phase Battle"
          subtitle="Powerplay, middle, and death overs separated into a true post-match phase comparison."
        >
          <PhaseBattle innings={summaryAnalytics.innings} />
        </SectionFrame>

        <SectionFrame
          title="Prediction Review"
          subtitle="Pre-chase expectation versus the actual result, without borrowing the live win-probability module."
        >
          {summaryAnalytics.predictionReview ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Expected winner</p>
                <p className="mt-2 text-2xl font-black text-white">
                  {summaryAnalytics.predictionReview.expectedWinner}
                  {summaryAnalytics.predictionReview.expectedWinPct != null ? ` · ${summaryAnalytics.predictionReview.expectedWinPct}%` : ""}
                </p>
                <p className="mt-3 text-sm leading-6 text-gray-300">{summaryAnalytics.predictionReview.note}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Actual winner</p>
                <p className="mt-2 text-2xl font-black text-white">{summaryAnalytics.predictionReview.actualWinner ?? "Waiting"}</p>
                <p className="mt-3 text-sm leading-6 text-gray-300">
                  {summaryAnalytics.predictionReview.aligned ? "The pre-chase expectation aligned with the actual result." : "The result overturned the pre-chase expectation, which makes this a genuine tactical or execution upset."}
                </p>
              </div>
            </div>
          ) : (
            <EmptyState message="Prediction review is unavailable until both innings and the final result are fully settled." />
          )}
        </SectionFrame>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionFrame
          title="Key Partnerships"
          subtitle="The stands that stabilized, accelerated, or flipped the innings."
        >
          <InsightList
            items={summaryAnalytics.innings.flatMap((inning) => inning.topPartnerships).slice(0, 4)}
            emptyMessage="Partnerships could not be reconstructed from the available ball sequence."
            accentClass="border-emerald-400/15 bg-emerald-400/[0.08]"
            valueRenderer={partnershipsValue}
          />
        </SectionFrame>

        <SectionFrame
          title="Collapse Periods"
          subtitle="Where wickets arrived in clusters and changed the match narrative."
        >
          <InsightList
            items={summaryAnalytics.innings.flatMap((inning) => inning.collapsePeriods).slice(0, 4)}
            emptyMessage="No meaningful collapse spell was detected from the innings flow."
            accentClass="border-amber-400/15 bg-amber-400/[0.08]"
            valueRenderer={collapseValue}
          />
        </SectionFrame>
      </div>
    </div>
  );
}
