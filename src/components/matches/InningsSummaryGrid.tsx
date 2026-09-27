import type { PostMatchInningsSummary } from "@/types/cricket";
import { cn } from "@/lib/utils";

interface InningsSummaryGridProps {
  summaries: PostMatchInningsSummary[];
}

const metricRows = [
  { key: "boundaryPct", label: "Boundary reliance" },
  { key: "supportPct", label: "Support share" },
  { key: "lowerOrderPct", label: "Lower-order share" },
  { key: "extrasPct", label: "Extras share" },
] as const;

export default function InningsSummaryGrid({ summaries }: InningsSummaryGridProps) {
  if (summaries.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-cg-dark-2 p-5 text-sm text-gray-400">
        Innings fingerprints will appear once scorecard data is available.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {summaries.map((summary) => (
        <div key={summary.inning} className="rounded-xl border border-gray-800 bg-cg-dark-2 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Innings fingerprint</p>
              <h3 className="mt-2 text-lg font-bold text-white">{summary.inning}</h3>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black text-white">
                {summary.totalRuns}/{summary.totalWickets}
              </p>
              <p className="text-xs text-gray-400">{summary.totalOvers} overs · {summary.runRate} rpo</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-800 bg-cg-dark p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Top scorer load</p>
              <p className="mt-1 text-sm font-semibold text-white">{summary.topScorerName}</p>
              <p className="text-xs text-gray-400">
                {summary.topScorerRuns} runs · {summary.topScorerStrikeRate} SR · {summary.topScorerPct}% share
              </p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-cg-dark p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Shape</p>
              <p className="mt-1 text-sm font-semibold text-white">{summary.supportRuns} support runs</p>
              <p className="text-xs text-gray-400">
                {summary.lowerOrderRuns} lower-order runs · {summary.extras} extras
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {metricRows.map((metric) => {
              const value = summary[metric.key];
              const width = Math.max(6, Math.min(100, value));

              return (
                <div key={metric.key}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-gray-400">{metric.label}</span>
                    <span className="font-semibold text-white">{value}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-800">
                    <div
                      className={cn(
                        "h-2 rounded-full",
                        metric.key === "extrasPct"
                          ? value >= 8
                            ? "bg-amber-400"
                            : "bg-cg-green"
                          : "bg-cg-green"
                      )}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
