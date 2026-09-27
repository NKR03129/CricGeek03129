import { cn } from "@/lib/utils";
import type {
  LiveAnalyticsBundle,
  LiveBarDatum,
  LiveBoundaryPressureSummary,
  LiveHeatmapCell,
  LiveMatchupCell,
  LivePartnershipDatum,
  LiveScenarioDatum,
  LiveTimelinePoint,
} from "@/types/eda";

type LiveEdaChartsProps = {
  analytics: LiveAnalyticsBundle;
  ballsTracked: number;
  completedOvers: number;
};

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-6 text-sm text-gray-400">
      {message}
    </div>
  );
}

function ProgressChart({
  current,
  required,
  unit,
  message,
}: {
  current: number;
  required: number;
  unit: string;
  message: string;
}) {
  const progress = Math.min(100, (current / Math.max(required, 1)) * 100);
  return (
    <div className="space-y-3 rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-4 py-5">
      <div className="flex items-center justify-between gap-3 text-sm text-sky-100">
        <span>Collecting enough live data…</span>
        <span>
          {current}/{required} {unit}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-black/20">
        <div className="h-full rounded-full bg-sky-400 transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-sm text-sky-100/90">{message}</p>
    </div>
  );
}

function ChartFrame({
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
    <section className={cn("rounded-xl border border-gray-800 bg-cg-dark-2 p-5", className)}>
      <h4 className="text-base font-bold text-white">{title}</h4>
      <p className="mt-1 text-sm text-gray-400">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function samplePoints(points: LiveTimelinePoint[], maxPoints = 42) {
  if (points.length <= maxPoints) return points;
  const stride = (points.length - 1) / (maxPoints - 1);
  const sampled: LiveTimelinePoint[] = [];

  for (let index = 0; index < maxPoints; index += 1) {
    sampled.push(points[Math.round(index * stride)]);
  }

  return sampled;
}

function formatAxisValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function buildPolyline(points: LiveTimelinePoint[], minValue: number, maxValue: number, width: number, height: number, padding: number, accessor: (point: LiveTimelinePoint) => number | null | undefined) {
  const range = Math.max(maxValue - minValue, 1);
  return points
    .map((point, index) => {
      const rawValue = accessor(point);
      if (rawValue === null || rawValue === undefined) return null;
      const x = padding + (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
      const y = height - padding - ((rawValue - minValue) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .filter(Boolean)
    .join(" ");
}

function LineChart({
  points,
  color,
  secondaryColor,
  yLabel,
}: {
  points: LiveTimelinePoint[];
  color: string;
  secondaryColor?: string;
  yLabel: string;
}) {
  if (points.length === 0) {
    return <EmptyChart message="Waiting for enough tracked balls to draw this timeline." />;
  }

  const width = 680;
  const height = 220;
  const padding = 26;
  const sampled = samplePoints(points);
  const allValues = sampled.flatMap((point) => [
    point.value,
    point.secondaryValue ?? point.value,
  ]);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const primaryPath = buildPolyline(sampled, minValue, maxValue, width, height, padding, (point) => point.value);
  const secondaryPath =
    secondaryColor
      ? buildPolyline(sampled, minValue, maxValue, width, height, padding, (point) => point.secondaryValue)
      : "";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{yLabel}</span>
        <span>{sampled[0]?.label} to {sampled[sampled.length - 1]?.label}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full overflow-visible rounded-lg border border-gray-800 bg-cg-dark">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = height - padding - tick * (height - padding * 2);
          const value = minValue + (maxValue - minValue) * tick;
          return (
            <g key={tick}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
              <text x={6} y={y + 4} fill="rgba(255,255,255,0.45)" fontSize="10">
                {formatAxisValue(value)}
              </text>
            </g>
          );
        })}
        {secondaryPath ? (
          <polyline
            fill="none"
            stroke={secondaryColor}
            strokeWidth="2"
            strokeDasharray="5 5"
            points={secondaryPath}
          />
        ) : null}
        <polyline fill="none" stroke={color} strokeWidth="3" points={primaryPath} />
        {sampled.map((point, index) => {
          const x = padding + (index / Math.max(sampled.length - 1, 1)) * (width - padding * 2);
          const y =
            height - padding - ((point.value - minValue) / Math.max(maxValue - minValue, 1)) * (height - padding * 2);
          return (
            <circle
              key={point.id}
              cx={x}
              cy={y}
              r={point.isWicket ? 4.5 : 2.5}
              fill={point.isWicket ? "#ef4444" : color}
              stroke={point.isWicket ? "#7f1d1d" : "transparent"}
            />
          );
        })}
      </svg>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {sampled.slice(-3).map((point) => (
          <div key={point.id} className="rounded-lg border border-gray-800 bg-cg-dark px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{point.label}</p>
            <p className="mt-1 text-lg font-bold text-white">{formatAxisValue(point.value)}</p>
            <p className="mt-1 text-xs text-gray-400">{point.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DivergingBars({
  data,
  metricLabel,
  emptyMessage,
}: {
  data: Array<{ label: string; delta: number; note: string; actual?: number; expected?: number; sample?: number }>;
  metricLabel: string;
  emptyMessage: string;
}) {
  if (data.length === 0) {
    return <EmptyChart message={emptyMessage} />;
  }

  const maxMagnitude = Math.max(...data.map((entry) => Math.abs(entry.delta)), 1);

  return (
    <div className="space-y-3">
      {data.map((entry) => {
        const width = `${(Math.abs(entry.delta) / maxMagnitude) * 100}%`;
        return (
          <div key={entry.label} className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{entry.label}</p>
                <p className="mt-1 text-xs text-gray-500">{entry.note}</p>
              </div>
              <div className="text-right">
                <p className={cn("text-lg font-black", entry.delta >= 0 ? "text-cg-green" : "text-amber-300")}>
                  {entry.delta >= 0 ? "+" : ""}{entry.delta}
                </p>
                {entry.sample ? <p className="text-xs text-gray-500">{entry.sample} balls</p> : null}
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-white/5">
              <div
                className={cn("h-full rounded-full", entry.delta >= 0 ? "bg-cg-green" : "bg-amber-400")}
                style={{ width }}
              />
            </div>
            {(entry.actual !== undefined || entry.expected !== undefined) ? (
              <p className="mt-2 text-xs text-gray-400">
                {metricLabel}: actual {entry.actual ?? 0}, expected {entry.expected ?? 0}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function HorizontalBars({
  data,
  emptyMessage,
  colorClass = "bg-cg-green",
}: {
  data: LiveBarDatum[];
  emptyMessage: string;
  colorClass?: string;
}) {
  if (data.length === 0) {
    return <EmptyChart message={emptyMessage} />;
  }

  const maxValue = Math.max(...data.map((entry) => Math.abs(entry.value)), 1);

  return (
    <div className="space-y-3">
      {data.map((entry) => (
        <div key={entry.label} className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">{entry.label}</p>
            <p className="text-sm font-black text-white">{entry.value.toFixed(1)}</p>
          </div>
          <div className="mt-3 h-2 rounded-full bg-white/5">
            <div
              className={cn("h-full rounded-full", colorClass)}
              style={{ width: `${(Math.abs(entry.value) / maxValue) * 100}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-400">{entry.note}</p>
        </div>
      ))}
    </div>
  );
}

function PartnershipBars({ data }: { data: LivePartnershipDatum[] }) {
  if (data.length === 0) {
    return <EmptyChart message="Partnership influence becomes available once the batting order and ball sequence are stable enough to infer pair stints." />;
  }

  const maxValue = Math.max(...data.map((entry) => Math.abs(entry.influence)), 1);

  return (
    <div className="space-y-3">
      {data.map((entry) => (
        <div key={`${entry.label}-${entry.pair}`} className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">{entry.pair}</p>
              <p className="mt-1 text-xs text-gray-500">{entry.runs} runs from {entry.balls} balls</p>
            </div>
            <p className={cn("text-lg font-black", entry.influence >= 0 ? "text-cg-green" : "text-amber-300")}>
              {entry.influence >= 0 ? "+" : ""}{entry.influence}
            </p>
          </div>
          <div className="mt-3 h-2 rounded-full bg-white/5">
            <div
              className={cn("h-full rounded-full", entry.influence >= 0 ? "bg-cg-green" : "bg-amber-400")}
              style={{ width: `${(Math.abs(entry.influence) / maxValue) * 100}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-400">{entry.note}</p>
        </div>
      ))}
    </div>
  );
}

function ScenarioBars({ data }: { data: LiveScenarioDatum[] }) {
  if (data.length === 0) {
    return <EmptyChart message="Counterfactual scenarios unlock once there is enough live state to project alternate paths." />;
  }

  const maxProjected = Math.max(...data.map((entry) => entry.projectedTotal), 1);

  return (
    <div className="space-y-3">
      {data.map((entry) => (
        <div key={entry.label} className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">{entry.label}</p>
              <p className="mt-1 text-xs text-gray-500">{entry.note}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-black text-white">{Math.round(entry.projectedTotal)}</p>
              <p className="text-xs text-cg-green">WP {Math.round(entry.winProbability)}%</p>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-white/5">
            <div className="h-full rounded-full bg-blue-400" style={{ width: `${(entry.projectedTotal / maxProjected) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Heatmap({ cells }: { cells: LiveHeatmapCell[] }) {
  if (cells.length === 0) {
    return <EmptyChart message="The pressure heatmap appears once tracked ball events start streaming in." />;
  }

  const overs = [...new Set(cells.map((cell) => cell.over))].sort((left, right) => left - right);
  const cellMap = new Map(cells.map((cell) => [`${cell.over}-${cell.ball}`, cell]));

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[420px] space-y-2">
        {overs.map((over) => (
          <div key={over} className="grid grid-cols-[70px_repeat(6,minmax(0,1fr))] gap-2">
            <div className="rounded-lg border border-gray-800 bg-cg-dark px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
              Over {over}
            </div>
            {[1, 2, 3, 4, 5, 6].map((ball) => {
              const cell = cellMap.get(`${over}-${ball}`);
              const pressure = cell?.pressure ?? 0;
              const opacity = Math.max(0.12, Math.min(0.9, pressure / 100));

              return (
                <div
                  key={`${over}-${ball}`}
                  className={cn(
                    "rounded-lg border px-2 py-3 text-center text-xs font-semibold",
                    cell?.isWicket
                      ? "border-red-500/30 bg-red-500/15 text-red-100"
                      : cell?.isDot
                        ? "border-amber-500/25 text-amber-100"
                        : "border-gray-800 text-white"
                  )}
                  style={
                    cell && !cell.isWicket && !cell.isDot
                      ? { backgroundColor: `rgba(59,130,246,${opacity})` }
                      : undefined
                  }
                  title={cell?.label || `Over ${over}, ball ${ball}`}
                >
                  {cell ? (cell.isWicket ? "W" : cell.runs) : "-"}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchupMatrix({ data }: { data: LiveMatchupCell[] }) {
  if (data.length === 0) {
    return <EmptyChart message="Matchup matrix unlocks once enough batter-versus-bowler balls have been tracked." />;
  }

  const batters = [...new Set(data.map((entry) => entry.batter))];
  const bowlers = [...new Set(data.map((entry) => entry.bowler))];
  const cellMap = new Map(data.map((entry) => [`${entry.batter}::${entry.bowler}`, entry]));
  const maxThreat = Math.max(...data.map((entry) => Math.abs(entry.threat)), 1);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[720px] w-full border-separate border-spacing-2">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left text-xs uppercase tracking-[0.18em] text-gray-500">Batter</th>
            {bowlers.map((bowler) => (
              <th key={bowler} className="px-3 py-2 text-left text-xs uppercase tracking-[0.18em] text-gray-500">
                {bowler}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {batters.map((batter) => (
            <tr key={batter}>
              <td className="rounded-lg border border-gray-800 bg-cg-dark px-3 py-3 text-sm font-semibold text-white">
                {batter}
              </td>
              {bowlers.map((bowler) => {
                const cell = cellMap.get(`${batter}::${bowler}`);
                const opacity = cell ? Math.max(0.12, Math.min(0.85, Math.abs(cell.threat) / maxThreat)) : 0;
                return (
                  <td
                    key={`${batter}-${bowler}`}
                    className="rounded-lg border border-gray-800 px-3 py-3 align-top"
                    style={cell ? { backgroundColor: `rgba(34,197,94,${opacity})` } : undefined}
                  >
                    {cell ? (
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-white">{cell.runs}/{cell.balls}</p>
                        <p className="text-xs text-gray-100">SR {cell.strikeRate}</p>
                        <p className="text-xs text-gray-200">
                          Dot {cell.dotPct}%{cell.dismissals > 0 ? ` | ${cell.dismissals} wicket` : ""}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500">No tracked balls</p>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoundaryPressurePanel({ summary }: { summary: LiveBoundaryPressureSummary | null }) {
  if (!summary) {
    return <EmptyChart message="Boundary pressure will appear once the live feed has enough tracked balls." />;
  }

  const rateMax = Math.max(summary.recentBoundaryRate, summary.forecastBoundaryRate, summary.expectedBoundaryRate, 0.1);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-500">{summary.recentOversLabel}</p>
          <p className="mt-1 text-lg font-black text-white">{summary.recentBoundaryBalls} boundaries</p>
          <p className="mt-1 text-xs text-gray-400">{summary.recentFours}x4, {summary.recentSixes}x6</p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Measured rate</p>
          <p className="mt-1 text-lg font-black text-white">{summary.recentBoundaryRate}/over</p>
          <p className="mt-1 text-xs text-gray-400">Innings rate {summary.inningsBoundaryRate}/over</p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Forecast rate</p>
          <p className="mt-1 text-lg font-black text-white">{summary.forecastBoundaryRate}/over</p>
          <p className="mt-1 text-xs text-gray-400">Phase baseline {summary.expectedBoundaryRate}/over</p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Boundary share</p>
          <p className="mt-1 text-lg font-black text-white">{summary.recentBoundaryRunShare}%</p>
          <p className="mt-1 text-xs text-gray-400">Pressure index {summary.pressureIndex}</p>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-gray-800 bg-cg-dark px-4 py-4">
        {[
          { label: "Measured", value: summary.recentBoundaryRate, colorClass: "bg-cg-green" },
          { label: "Forecast", value: summary.forecastBoundaryRate, colorClass: "bg-blue-400" },
          { label: "Baseline", value: summary.expectedBoundaryRate, colorClass: "bg-amber-400" },
        ].map((entry) => (
          <div key={entry.label}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">{entry.label}</p>
              <p className="text-sm font-black text-white">{entry.value}/over</p>
            </div>
            <div className="mt-2 h-2 rounded-full bg-white/5">
              <div
                className={cn("h-full rounded-full", entry.colorClass)}
                style={{ width: `${(entry.value / rateMax) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="text-sm text-gray-400">{summary.note}</p>
    </div>
  );
}

export default function LiveEdaCharts({ analytics, ballsTracked, completedOvers }: LiveEdaChartsProps) {
  const chartReady = (requiredBalls: number, fallbackOvers = 0) => {
    return ballsTracked >= requiredBalls && completedOvers >= fallbackOvers;
  };

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ChartFrame
        title="Ball-by-ball win probability chart"
        subtitle="Live win-probability path recalculated on every tracked ball."
      >
        {chartReady(6) ? (
          <LineChart points={analytics.ballWinProbability} color="#22c55e" yLabel="Win probability %" />
        ) : (
          <ProgressChart current={ballsTracked} required={6} unit="balls" message="Win-probability movement needs a few tracked balls before the curve is meaningful." />
        )}
      </ChartFrame>

      <ChartFrame
        title="Match control swing chart"
        subtitle="Positive values mean the batting side has the live control edge."
      >
        {chartReady(6) ? (
          <LineChart points={analytics.matchControlSwing} color="#60a5fa" yLabel="Control swing" />
        ) : (
          <ProgressChart current={ballsTracked} required={6} unit="balls" message="Control swing needs a short run of tracked state changes before it stabilizes." />
        )}
      </ChartFrame>

      <ChartFrame
        title="Pressure index timeline"
        subtitle="A running read of scoreboard pressure through the current innings."
      >
        {chartReady(8) ? (
          <LineChart points={analytics.pressureTimeline} color="#f59e0b" yLabel="Pressure index" />
        ) : (
          <ProgressChart current={ballsTracked} required={8} unit="balls" message="Pressure sequencing is held back until the innings has at least 8 tracked balls." />
        )}
      </ChartFrame>

      <ChartFrame
        title="Required vs actual rate with wickets marked"
        subtitle="Actual rate is compared against chase requirement or venue par rate."
      >
        {chartReady(8) ? (
          <LineChart points={analytics.requiredVsActualRate} color="#38bdf8" secondaryColor="#94a3b8" yLabel="Runs per over" />
        ) : (
          <ProgressChart current={ballsTracked} required={8} unit="balls" message="Rate comparison unlocks once a few overs of scoring shape have formed." />
        )}
      </ChartFrame>

      <ChartFrame
        title="Top turning-point ball bar chart"
        subtitle="Largest ball-level state changes in the live model."
      >
        {chartReady(8) ? (
          <HorizontalBars
            data={analytics.topTurningBalls}
            emptyMessage="Turning-point balls appear once enough tracked events have changed the state materially."
          />
        ) : (
          <ProgressChart current={ballsTracked} required={8} unit="balls" message="Turning-point balls need a minimum event window before any swing is trustworthy." />
        )}
      </ChartFrame>

      <ChartFrame
        title="Top turning-point over bar chart"
        subtitle="Overs with the biggest combined impact on the live state."
      >
        {chartReady(12, 2) ? (
          <HorizontalBars
            data={analytics.topTurningOvers}
            emptyMessage="Turning-point overs appear after the innings has enough event density."
            colorClass="bg-blue-400"
          />
        ) : (
          <ProgressChart current={ballsTracked} required={12} unit="balls" message="Over-level swing waits for at least two overs of tracked pressure movement." />
        )}
      </ChartFrame>

      <ChartFrame
        title="Context-adjusted batter impact chart"
        subtitle="Actual output versus live context expectation for tracked batters."
      >
        {chartReady(8) ? (
          <DivergingBars
            data={analytics.batterImpact}
            metricLabel="Runs"
            emptyMessage="Batter impact appears once tracked balls can be attributed to individual batters."
          />
        ) : (
          <ProgressChart current={ballsTracked} required={8} unit="balls" message="Batter impact needs enough attributed deliveries to separate noise from role." />
        )}
      </ChartFrame>

      <ChartFrame
        title="Context-adjusted bowler impact chart"
        subtitle="Bowler influence adjusted for expected scoring context and wicket value."
      >
        {chartReady(6, 1) ? (
          <DivergingBars
            data={analytics.bowlerImpact}
            metricLabel="Runs conceded"
            emptyMessage="Bowler impact appears once the live feed can attribute enough tracked balls to bowlers."
          />
        ) : (
          <ProgressChart current={ballsTracked} required={6} unit="balls" message="Bowler impact needs at least one over's worth of tracked deliveries." />
        )}
      </ChartFrame>

      <ChartFrame
        title="Runs saved vs expected for bowlers"
        subtitle="Pure run suppression versus the live phase baseline."
      >
        {chartReady(6, 1) ? (
          <DivergingBars
            data={analytics.bowlerRunsSaved}
            metricLabel="Runs conceded"
            emptyMessage="Runs-saved view appears once bowler-level tracked balls are available."
          />
        ) : (
          <ProgressChart current={ballsTracked} required={6} unit="balls" message="Runs-saved needs a full over of tracked bowling before it becomes useful." />
        )}
      </ChartFrame>

      <ChartFrame
        title="Partnership influence chart"
        subtitle="Best-effort partnership stints inferred from batting order and ball sequence."
      >
        {chartReady(12, 2) ? (
          <PartnershipBars data={analytics.partnershipInfluence} />
        ) : (
          <ProgressChart current={ballsTracked} required={12} unit="balls" message="Partnership influence waits for enough sequence data to identify a real stand." />
        )}
      </ChartFrame>

      <ChartFrame
        title="Counterfactual scenario comparison chart"
        subtitle="Quick scenario tests around the current trend, surge, squeeze, and venue-par finish."
      >
        {chartReady(12, 2) ? (
          <ScenarioBars data={analytics.counterfactuals} />
        ) : (
          <ProgressChart current={ballsTracked} required={12} unit="balls" message="Scenario comparisons unlock once the innings state is dense enough to project alternatives." />
        )}
      </ChartFrame>

      <ChartFrame
        title="Boundary pressure pulse"
        subtitle="Recent fours and sixes with measured versus forecast boundary frequency."
      >
        {chartReady(8) ? (
          <BoundaryPressurePanel summary={analytics.boundaryPressure} />
        ) : (
          <ProgressChart current={ballsTracked} required={8} unit="balls" message="Boundary pressure needs a meaningful sample of recent scoring events." />
        )}
      </ChartFrame>

      <ChartFrame
        title="Dot-ball pressure heatmap"
        subtitle="Recent over-by-over pressure window with dots and wickets highlighted."
      >
        {chartReady(6, 1) ? (
          <Heatmap cells={analytics.dotBallHeatmap} />
        ) : (
          <ProgressChart current={ballsTracked} required={6} unit="balls" message="The heatmap appears after the innings has at least one over of tracked deliveries." />
        )}
      </ChartFrame>

      <ChartFrame
        title="Batter vs bowler matchup matrix"
        subtitle="Tracked pair-level outcomes from the current innings."
        className="xl:col-span-2"
      >
        {chartReady(8) ? (
          <MatchupMatrix data={analytics.matchupMatrix} />
        ) : (
          <ProgressChart current={ballsTracked} required={8} unit="balls" message="The matchup matrix waits until enough batter-vs-bowler balls have been tracked." />
        )}
      </ChartFrame>
    </div>
  );
}
