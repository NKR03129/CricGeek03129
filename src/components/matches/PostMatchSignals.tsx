import type { PostMatchSignal } from "@/types/cricket";
import { cn } from "@/lib/utils";

interface PostMatchSignalsProps {
  signals: PostMatchSignal[];
}

function confidenceClass(confidence?: string) {
  if (confidence === "high") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
  if (confidence === "medium") return "border-amber-400/25 bg-amber-400/10 text-amber-100";
  return "border-red-400/25 bg-red-400/10 text-red-100";
}

export default function PostMatchSignals({ signals }: PostMatchSignalsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {signals.map((signal) => (
        <div
          key={signal.id}
          className={cn(
            "rounded-xl border p-4",
            signal.tone === "good" && "border-cg-green/20 bg-cg-green/5",
            signal.tone === "warning" && "border-amber-500/20 bg-amber-500/5",
            (!signal.tone || signal.tone === "neutral") && "border-gray-800 bg-cg-dark-2",
            signal.quality?.suppressed && "opacity-70"
          )}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{signal.label}</p>
          <p className="mt-2 text-xl font-black text-white">{signal.value}</p>
          <p className="mt-2 text-sm text-gray-400">{signal.insight}</p>

          {signal.quality ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
                {signal.quality.sampleSize !== undefined && signal.quality.sampleSize !== null ? (
                  <span className="rounded-full border border-gray-700 bg-black/20 px-2 py-1 text-gray-300">
                    n={signal.quality.sampleSize}
                  </span>
                ) : null}
                {signal.quality.confidence ? (
                  <span className={cn("rounded-full border px-2 py-1", confidenceClass(signal.quality.confidence))}>
                    {signal.quality.confidence} confidence
                  </span>
                ) : null}
              </div>
              {signal.quality.warning ? (
                <p className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[11px] text-amber-100">
                  {signal.quality.warning}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
