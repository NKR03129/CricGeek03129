"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Gauge,
  Landmark,
  Medal,
  PenSquare,
  Radio,
  Shield,
  Sparkles,
  Swords,
  Target,
  Trophy,
  Waves,
  Zap,
  type LucideIcon,
} from "lucide-react";
import EdaAskPanel from "@/components/matches/EdaAskPanel";
import EdaCards from "@/components/matches/EdaCards";
import PostMatchSummaryCharts from "@/components/matches/PostMatchSummaryCharts";
import PostMatchSignals from "@/components/matches/PostMatchSignals";
import { cn, formatDate } from "@/lib/utils";
import type { MatchCoverageSummary } from "@/lib/match-coverage";
import type {
  Match,
  PostMatchInningsSummary,
} from "@/types/cricket";
import type { PostMatchEdaReport } from "@/types/eda";

type PostMatchInsightsStoryProps = {
  match: Match;
  report: PostMatchEdaReport;
  coverage: MatchCoverageSummary;
};

type StorySlide = {
  id: string;
  title: string;
  shortLabel: string;
  eyebrow: string;
  summary: string;
  metric: string;
  icon: LucideIcon;
  ringClass: string;
  glowClass: string;
  panelClass: string;
  main: ReactNode;
  aside: ReactNode;
};

function extractMargin(status: string) {
  const match = status.match(/won by (.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function inferWinner(match: Match) {
  const normalizedStatus = match.status.toLowerCase();

  for (const team of match.teams) {
    if (normalizedStatus.includes(team.toLowerCase())) {
      return team;
    }
  }

  for (const team of match.teamInfo) {
    if (normalizedStatus.includes(team.shortname.toLowerCase())) {
      return team.name;
    }
  }

  return null;
}

function teamInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatScoreline(summary: PostMatchInningsSummary) {
  const overs = Number.isFinite(summary.totalOvers) ? summary.totalOvers.toFixed(summary.totalOvers % 1 === 0 ? 0 : 1) : "0";
  return `${summary.totalRuns}/${summary.totalWickets} (${overs} ov)`;
}

function formatMatchScore(score: Match["score"][number]) {
  const overs = Number.isFinite(score.o) ? score.o.toFixed(score.o % 1 === 0 ? 0 : 1) : "0";
  return `${score.r}/${score.w} (${overs} ov)`;
}

function truncateText(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatGeneratedAt(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function SpotlightMetric({
  label,
  value,
  note,
  className,
}: {
  label: string;
  value: string;
  note: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[26px] border border-white/10 bg-white/[0.04] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur",
        className
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">{label}</p>
      <p className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">{value}</p>
      <p className="mt-3 text-sm leading-7 text-gray-300">{note}</p>
    </div>
  );
}

function GlassPanel({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-[24px] border border-white/10 bg-black/20 p-5 backdrop-blur", className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-white/50">{title}</h3>
          {subtitle ? <p className="mt-2 text-sm leading-6 text-gray-400">{subtitle}</p> : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InsightList({
  items,
  tone = "neutral",
}: {
  items: string[];
  tone?: "neutral" | "good" | "warning";
}) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-400">No additional insight is available for this view yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {items.map((item, index) => (
        <li
          key={`${item}-${index}`}
          className={cn(
            "rounded-2xl border px-4 py-3 text-sm leading-6 text-gray-200",
            tone === "good" && "border-emerald-400/20 bg-emerald-400/[0.08]",
            tone === "warning" && "border-amber-400/20 bg-amber-400/[0.08]",
            tone === "neutral" && "border-white/8 bg-white/[0.04]"
          )}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function ScoreRibbon({ match }: { match: Match }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {match.score.map((entry) => (
        <div key={entry.inning} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">{entry.inning}</p>
          <p className="mt-2 text-lg font-black text-white">{formatMatchScore(entry)}</p>
        </div>
      ))}
    </div>
  );
}

function TeamBadge({ name }: { name: string }) {
  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400/25 via-sky-400/20 to-violet-400/25 text-sm font-black text-white">
        {teamInitials(name)}
      </span>
      <span className="text-sm font-semibold text-white">{name}</span>
    </div>
  );
}

function StoryBubble({
  active,
  buttonRef,
  tabId,
  panelId,
  icon: Icon,
  label,
  metric,
  ringClass,
  glowClass,
  onClick,
}: {
  active: boolean;
  buttonRef?: (node: HTMLButtonElement | null) => void;
  tabId: string;
  panelId: string;
  icon: LucideIcon;
  label: string;
  metric: string;
  ringClass: string;
  glowClass: string;
  onClick: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      className="group flex w-[102px] shrink-0 snap-start flex-col items-center text-center outline-none"
      id={tabId}
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
    >
      <span
        className={cn(
          "inline-flex h-24 w-24 items-center justify-center rounded-full p-[3px] transition duration-300",
          active
            ? `bg-gradient-to-br ${ringClass} shadow-[0_18px_45px_rgba(8,12,24,0.4)]`
            : "bg-gradient-to-br from-white/30 via-white/10 to-white/20 opacity-80 group-hover:opacity-100"
        )}
      >
        <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[#06101b]">
          <span className={cn("absolute inset-0 bg-gradient-to-br opacity-80", glowClass)} />
          <span className="absolute inset-[6px] rounded-full border border-white/10" />
          <Icon className={cn("relative z-10 h-8 w-8", active ? "text-white" : "text-white/80")} strokeWidth={2.1} />
        </span>
      </span>
      <span className={cn("mt-3 line-clamp-2 text-xs font-semibold transition-colors", active ? "text-white" : "text-gray-300")}>
        {label}
      </span>
      <span className="mt-1 text-[11px] text-white/45">{metric}</span>
    </button>
  );
}

function PerformerFeature({
  label,
  name,
  statLine,
  note,
  metricPills,
}: {
  label: string;
  name: string;
  statLine: string;
  note: string;
  metricPills: string[];
}) {
  return (
    <GlassPanel title={label} subtitle={note} className="h-full">
      <div className="rounded-[22px] border border-white/10 bg-white/[0.05] p-5">
        <p className="text-2xl font-black text-white">{name}</p>
        <p className="mt-2 text-base font-semibold text-emerald-200">{statLine}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {metricPills.map((pill) => (
            <span key={pill} className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-gray-200">
              {pill}
            </span>
          ))}
        </div>
      </div>
    </GlassPanel>
  );
}

function CompactLeaderboard({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ label: string; value: string; note: string }>;
}) {
  return (
    <GlassPanel title={title} subtitle={subtitle}>
      {rows.length > 0 ? (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={`${row.label}-${row.value}`} className="flex items-start justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-white">{row.label}</p>
                <p className="mt-1 text-xs text-gray-400">{row.note}</p>
              </div>
              <p className="text-sm font-black text-emerald-200">{row.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">The full leaderboard appears as soon as the scorecard has enough completed entries.</p>
      )}
    </GlassPanel>
  );
}

function InningsCard({ summary }: { summary: PostMatchInningsSummary }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.05] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{summary.inning}</p>
          <p className="mt-2 text-2xl font-black text-white">{formatScoreline(summary)}</p>
        </div>
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold text-gray-200">
          RR {summary.runRate.toFixed(2)}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-gray-300">
        <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">Top scorer</p>
          <p className="mt-1 font-semibold text-white">
            {summary.topScorerName} · {summary.topScorerRuns}
          </p>
        </div>
        <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">Boundary share</p>
          <p className="mt-1 font-semibold text-white">{summary.boundaryPct.toFixed(1)}%</p>
        </div>
      </div>
    </div>
  );
}

function CoverageDock({
  match,
  report,
  coverage,
}: {
  match: Match;
  report: PostMatchEdaReport;
  coverage: MatchCoverageSummary;
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(13,18,30,0.98),rgba(8,10,18,0.98))] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cg-green">Keep Exploring</p>
          <h2 className="mt-3 text-2xl font-black text-white">Continue the match story</h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-gray-400">
            Jump into commentary, linked blogs, and the report provenance behind every story slide.
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-gray-200">
          Generated {formatGeneratedAt(report.freshness.generatedAt)}
        </span>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          {coverage.coverageAvailable && coverage.commentarySession ? (
            <Link
              href={`/commentary/${coverage.commentarySession.id}`}
              className="flex items-center justify-between gap-4 rounded-[22px] border border-emerald-400/20 bg-emerald-400/[0.08] px-5 py-4 text-left transition hover:bg-emerald-400/[0.12]"
            >
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Radio size={16} className="text-emerald-300" />
                  Open linked commentary
                </p>
                <p className="mt-2 text-sm text-emerald-100/80">
                  Continue with the archived match feed and compare live calls with the final story deck.
                </p>
              </div>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold text-white">
                {coverage.commentarySession.status}
              </span>
            </Link>
          ) : (
            <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-gray-400">
              Linked commentary is not available for this match yet.
            </div>
          )}

          {coverage.coverageAvailable && coverage.blogs.length > 0 ? (
            <div className="space-y-3">
              {coverage.blogs.map((blog) => (
                <Link
                  key={blog.id}
                  href={`/blog/${blog.slug}`}
                  className="block rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3 transition hover:bg-white/[0.07]"
                >
                  <p className="text-sm font-semibold text-white">{blog.title}</p>
                  <p className="mt-1 text-xs text-gray-400">Read the connected match coverage</p>
                </Link>
              ))}
            </div>
          ) : (
            <Link
              href={`/blog/write?matchId=${encodeURIComponent(match.id)}&matchName=${encodeURIComponent(match.name)}`}
              className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/[0.08] px-4 py-2.5 text-sm font-semibold text-sky-200 transition hover:bg-sky-400/[0.12]"
            >
              <PenSquare size={15} />
              Write the first linked match blog
            </Link>
          )}
        </div>

        <div className="space-y-4">
          <GlassPanel title="Report Provenance" subtitle="The story deck is still grounded in the same verified sources and confidence system.">
            <div className="flex flex-wrap gap-2">
              {report.sources.slice(0, 6).map((source) => (
                <span
                  key={`${source.type}-${source.id}`}
                  className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-gray-200"
                >
                  {source.title}
                </span>
              ))}
            </div>
          </GlassPanel>

          <GlassPanel title="Freshness Notes" subtitle="Context users should know before sharing the takeaways.">
            <InsightList items={report.freshness.notes.length > 0 ? report.freshness.notes : ["All insights are grounded in the latest fetched scorecard, historical warehouse, and retrospective innings reconstruction."]} />
          </GlassPanel>
        </div>
      </div>
    </section>
  );
}

export default function PostMatchInsightsStory({
  match,
  report,
  coverage,
}: PostMatchInsightsStoryProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const bubbleRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const winner = inferWinner(match);
  const margin = extractMargin(match.status);
  const topBatter = report.intel.battingLeaders[0] ?? null;
  const topBowler = report.intel.bowlingLeaders[0] ?? null;
  const summaryAnalytics = report.retrospective.summaryAnalytics;
  const hiddenContributor = summaryAnalytics?.hiddenContributors[0] ?? null;
  const predictionReview = summaryAnalytics?.predictionReview ?? null;

  const slides: StorySlide[] = [
    {
      id: "summary",
      title: "Match Summary",
      shortLabel: "Match Summary",
      eyebrow: "Result story",
      summary: report.retrospective.summary,
      metric: winner ? `${winner}${margin ? ` · ${margin}` : ""}` : match.status,
      icon: Trophy,
      ringClass: "from-emerald-300 via-cyan-300 to-sky-500",
      glowClass: "from-emerald-400/30 via-cyan-400/16 to-sky-500/18",
      panelClass: "bg-[linear-gradient(180deg,rgba(6,18,28,0.98),rgba(7,9,18,0.98))]",
      main: (
        <div className="space-y-5">
          <SpotlightMetric
            label={winner ? "Winning moment" : "Match status"}
            value={winner ? `${winner}${margin ? ` won by ${margin}` : ""}` : match.status}
            note={report.intel.summary}
            className="border-emerald-400/15 bg-emerald-400/[0.06]"
          />
          <GlassPanel title="Executive Summary Cards" subtitle="The highest-signal reads from the final scorecard and the retrospective innings report.">
            <EdaCards cards={report.retrospective.matchSummaryCards} />
          </GlassPanel>
        </div>
      ),
      aside: (
        <div className="space-y-4">
          <GlassPanel title="Match Frame" subtitle={`${match.matchType} · ${formatDate(match.dateTimeGMT || match.date)}`}>
            <div className="flex flex-wrap gap-3">
              {match.teams.map((team) => (
                <TeamBadge key={team} name={team} />
              ))}
            </div>
            <div className="mt-4">
              <ScoreRibbon match={match} />
            </div>
          </GlassPanel>
          <GlassPanel title="Trust Layer" subtitle="Confidence and operational context behind the report.">
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Confidence</p>
                <p className="mt-2 text-lg font-black text-white">
                  {Math.round(report.confidence.score)}% · {report.confidence.label}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Venue</p>
                <p className="mt-2 text-sm leading-6 text-gray-300">{match.venue}</p>
              </div>
              {report.retrospective.warnings.length > 0 ? (
                <InsightList items={report.retrospective.warnings} tone="warning" />
              ) : null}
            </div>
          </GlassPanel>
        </div>
      ),
    },
    {
      id: "batting",
      title: "Batting Momentum",
      shortLabel: "Batting Momentum",
      eyebrow: "Run-shaping story",
      summary: "Tempo, support, and scoring profile broken down into digestible batting reads instead of a flat scorecard table.",
      metric: topBatter ? `${topBatter.runs} from ${topBatter.balls}` : "Awaiting batting leader",
      icon: Waves,
      ringClass: "from-amber-300 via-orange-300 to-rose-400",
      glowClass: "from-amber-400/30 via-orange-400/18 to-rose-500/18",
      panelClass: "bg-[linear-gradient(180deg,rgba(24,14,10,0.98),rgba(10,10,17,0.98))]",
      main: (
        <div className="space-y-5">
          <GlassPanel title="Batting Reads" subtitle="Acceleration, anchor contribution, and pressure conversion from the decisive innings.">
            <EdaCards cards={report.retrospective.battingCards} />
          </GlassPanel>
          <GlassPanel title="Innings Fingerprints" subtitle="Each innings condensed into its scoring DNA.">
            <div className="grid gap-3 md:grid-cols-2">
              {report.intel.inningsSummaries.map((summary) => (
                <InningsCard key={summary.inning} summary={summary} />
              ))}
            </div>
          </GlassPanel>
        </div>
      ),
      aside: (
        <div className="space-y-4">
          <PerformerFeature
            label="Top Batter"
            name={topBatter?.name ?? "Not available"}
            statLine={
              topBatter
                ? `${topBatter.runs} off ${topBatter.balls} · SR ${Math.round(topBatter.strikeRate)}`
                : "Waiting for complete scorecard"
            }
            note="The strongest batting performance in the completed scorecard."
            metricPills={
              topBatter
                ? [`${topBatter.fours}x4`, `${topBatter.sixes}x6`, `${Math.round(topBatter.sharePct)}% innings share`]
                : ["No scoring split yet"]
            }
          />
          <CompactLeaderboard
            title="Batting Podium"
            subtitle="Top run contributions with speed as the separator."
            rows={report.intel.battingLeaders.slice(0, 4).map((leader) => ({
              label: leader.name,
              value: `${leader.runs} (${leader.balls})`,
              note: `${leader.inning} · SR ${Math.round(leader.strikeRate)} · ${leader.fours}x4 ${leader.sixes}x6`,
            }))}
          />
        </div>
      ),
    },
    {
      id: "bowling",
      title: "Bowling Impact",
      shortLabel: "Bowling Impact",
      eyebrow: "Control story",
      summary: "Where the innings was squeezed, where wickets clustered, and which spells actually changed the match shape.",
      metric: topBowler ? `${topBowler.wickets}/${topBowler.runsConceded}` : "Awaiting bowling leader",
      icon: Shield,
      ringClass: "from-sky-300 via-cyan-300 to-blue-500",
      glowClass: "from-sky-400/30 via-cyan-400/18 to-blue-500/18",
      panelClass: "bg-[linear-gradient(180deg,rgba(7,18,28,0.98),rgba(7,10,18,0.98))]",
      main: (
        <div className="space-y-5">
          <GlassPanel title="Bowling Reads" subtitle="Control overs, wicket pressure, and where the bowling group leaked too much.">
            <EdaCards cards={report.retrospective.bowlingCards} />
          </GlassPanel>
          <GlassPanel title="Match Signals" subtitle="Tempo and control signals pulled straight from the final innings shapes.">
            <PostMatchSignals signals={report.intel.matchSignals} />
          </GlassPanel>
        </div>
      ),
      aside: (
        <div className="space-y-4">
          <PerformerFeature
            label="Best Spell"
            name={topBowler?.name ?? "Not available"}
            statLine={
              topBowler
                ? `${topBowler.wickets}/${topBowler.runsConceded} in ${topBowler.overs.toFixed(topBowler.overs % 1 === 0 ? 0 : 1)} overs`
                : "Waiting for complete scorecard"
            }
            note="The standout wicket-taking spell from the scorecard."
            metricPills={
              topBowler
                ? [`Econ ${topBowler.economy.toFixed(2)}`, `${topBowler.maidens} maidens`, topBowler.ballsPerWicket ? `${topBowler.ballsPerWicket} balls/wkt` : "No balls/wkt"]
                : ["No bowling split yet"]
            }
          />
          <CompactLeaderboard
            title="Bowling Podium"
            subtitle="Best spells ranked by wickets, then economy."
            rows={report.intel.bowlingLeaders.slice(0, 4).map((leader) => ({
              label: leader.name,
              value: `${leader.wickets}/${leader.runsConceded}`,
              note: `${leader.inning} · ${leader.overs.toFixed(leader.overs % 1 === 0 ? 0 : 1)} ov · Econ ${leader.economy.toFixed(2)}`,
            }))}
          />
        </div>
      ),
    },
    {
      id: "turning-point",
      title: "Key Turning Point",
      shortLabel: "Key Turning Point",
      eyebrow: "Swing story",
      summary: "The inflection points that mattered most, separated from the noise of every over and every card.",
      metric: `${report.intel.turningPoints.length} swing calls`,
      icon: Target,
      ringClass: "from-rose-300 via-fuchsia-300 to-violet-500",
      glowClass: "from-rose-400/30 via-fuchsia-400/18 to-violet-500/18",
      panelClass: "bg-[linear-gradient(180deg,rgba(21,8,18,0.98),rgba(10,10,18,0.98))]",
      main: (
        <div className="space-y-5">
          <SpotlightMetric
            label="Sharpest swing"
            value={truncateText(report.retrospective.biggestSwings[0] ?? report.intel.turningPoints[0] ?? "Retrospective model still building", 110)}
            note="This is the clearest turning passage highlighted by the retrospective innings model and the scorecard read."
            className="border-fuchsia-400/15 bg-fuchsia-400/[0.06]"
          />
          <GlassPanel title="Turning Points" subtitle="Chronological swing moments called out by the post-match engine.">
            <InsightList items={report.intel.turningPoints} />
          </GlassPanel>
        </div>
      ),
      aside: (
        <div className="space-y-4">
          <GlassPanel title="Retrospective Swings" subtitle="Biggest movement reconstructed from innings-level over, phase, and partnership analysis.">
            <InsightList items={report.retrospective.biggestSwings} tone="warning" />
          </GlassPanel>
          <GlassPanel title="Context" subtitle="What the engine wants users to remember while interpreting the swing calls.">
            <InsightList items={report.intel.reportNotes.slice(0, 4)} />
          </GlassPanel>
        </div>
      ),
    },
    {
      id: "best-batter",
      title: "Best Batter",
      shortLabel: "Best Batter",
      eyebrow: "Player spotlight",
      summary: "A dedicated player card for the innings-defining batting performance, with the rest of the order compressed into a clean podium.",
      metric: topBatter ? `${topBatter.runs} runs` : "No batting leader",
      icon: Medal,
      ringClass: "from-yellow-200 via-amber-300 to-orange-400",
      glowClass: "from-yellow-300/30 via-amber-400/18 to-orange-500/18",
      panelClass: "bg-[linear-gradient(180deg,rgba(28,19,7,0.98),rgba(10,10,18,0.98))]",
      main: (
        <div className="space-y-5">
          <PerformerFeature
            label="Hero Batter"
            name={topBatter?.name ?? "Not available"}
            statLine={
              topBatter
                ? `${topBatter.runs} off ${topBatter.balls} · ${topBatter.inning}`
                : "Waiting for a complete scorecard"
            }
            note="The page no longer buries the best batting performance under generic cards."
            metricPills={
              topBatter
                ? [
                    `SR ${Math.round(topBatter.strikeRate)}`,
                    `${Math.round(topBatter.boundaryPct)}% boundary share`,
                    `${Math.round(topBatter.sharePct)}% innings share`,
                  ]
                : ["Leader not available"]
            }
          />
          <CompactLeaderboard
            title="Next Best Support"
            subtitle="The supporting cast that mattered after the headline knock."
            rows={report.intel.battingLeaders.slice(1, 5).map((leader) => ({
              label: leader.name,
              value: `${leader.runs}`,
              note: `${leader.balls} balls · ${leader.inning} · SR ${Math.round(leader.strikeRate)}`,
            }))}
          />
        </div>
      ),
      aside: (
        <div className="space-y-4">
          <GlassPanel title="Batting Storyline" subtitle="What this knock meant in the broader match narrative.">
            <InsightList items={report.intel.standoutPerformers.slice(0, 3)} tone="good" />
          </GlassPanel>
          <GlassPanel title="Supporting Analytics" subtitle="Use the full batting read if you want the underlying why behind the spotlight.">
            <EdaCards cards={report.retrospective.battingCards.slice(0, 3)} />
          </GlassPanel>
        </div>
      ),
    },
    {
      id: "best-bowler",
      title: "Best Bowler",
      shortLabel: "Best Bowler",
      eyebrow: "Spell spotlight",
      summary: "The wicket-taking story is isolated into one premium spell card, then expanded into the rest of the bowling unit underneath.",
      metric: topBowler ? `${topBowler.wickets} wkts` : "No bowling leader",
      icon: Swords,
      ringClass: "from-cyan-200 via-sky-300 to-indigo-400",
      glowClass: "from-cyan-300/30 via-sky-400/18 to-indigo-500/18",
      panelClass: "bg-[linear-gradient(180deg,rgba(8,18,27,0.98),rgba(9,11,18,0.98))]",
      main: (
        <div className="space-y-5">
          <PerformerFeature
            label="Hero Bowler"
            name={topBowler?.name ?? "Not available"}
            statLine={
              topBowler
                ? `${topBowler.wickets}/${topBowler.runsConceded} · ${topBowler.inning}`
                : "Waiting for a complete scorecard"
            }
            note="The spell that most clearly bent the innings in its favor."
            metricPills={
              topBowler
                ? [
                    `${topBowler.overs.toFixed(topBowler.overs % 1 === 0 ? 0 : 1)} overs`,
                    `Econ ${topBowler.economy.toFixed(2)}`,
                    topBowler.ballsPerWicket ? `${topBowler.ballsPerWicket} balls/wkt` : "No balls/wkt",
                  ]
                : ["Leader not available"]
            }
          />
          <CompactLeaderboard
            title="Bowling Unit"
            subtitle="Who followed the headline spell and how cleanly they operated."
            rows={report.intel.bowlingLeaders.slice(1, 5).map((leader) => ({
              label: leader.name,
              value: `${leader.wickets}/${leader.runsConceded}`,
              note: `${leader.overs.toFixed(leader.overs % 1 === 0 ? 0 : 1)} ov · Econ ${leader.economy.toFixed(2)}`,
            }))}
          />
        </div>
      ),
      aside: (
        <div className="space-y-4">
          <GlassPanel title="Bowling Storyline" subtitle="The standout spell only matters because of how it changed the innings shape.">
            <InsightList items={report.intel.standoutPerformers.slice(3, 6)} tone="good" />
          </GlassPanel>
          <GlassPanel title="Supporting Analytics" subtitle="The most relevant bowling cards, trimmed for story mode.">
            <EdaCards cards={report.retrospective.bowlingCards.slice(0, 3)} />
          </GlassPanel>
        </div>
      ),
    },
    {
      id: "tactical",
      title: "Tactical Errors",
      shortLabel: "Tactical Errors",
      eyebrow: "Decision story",
      summary: "Advanced cards and tactical notes pulled into one place, so users can read the errors and edges without wading through the entire dashboard.",
      metric: `${report.retrospective.advancedCards.length} advanced reads`,
      icon: Zap,
      ringClass: "from-fuchsia-200 via-purple-300 to-violet-500",
      glowClass: "from-fuchsia-300/30 via-purple-400/18 to-violet-500/18",
      panelClass: "bg-[linear-gradient(180deg,rgba(18,8,27,0.98),rgba(8,9,17,0.98))]",
      main: (
        <div className="space-y-5">
          <GlassPanel title="Advanced Tactical Cards" subtitle="Clutch performers, expectation gaps, and matchup wins or losses.">
            <EdaCards cards={report.retrospective.advancedCards} />
          </GlassPanel>
          <GlassPanel title="Tactical Takeaways" subtitle="The post-match engine's cleanest coaching notes.">
            <InsightList items={report.intel.tacticalTakeaways} tone="warning" />
          </GlassPanel>
        </div>
      ),
      aside: (
        <div className="space-y-4">
          <GlassPanel title="Reporting Notes" subtitle="Context that keeps the tactical take honest instead of overfit.">
            <InsightList items={report.intel.reportNotes.slice(0, 4)} />
          </GlassPanel>
          {report.retrospective.warnings.length > 0 ? (
            <GlassPanel title="Data Warnings" subtitle="Visible caveats whenever the evidence base is thinner than usual.">
              <InsightList items={report.retrospective.warnings} tone="warning" />
            </GlassPanel>
          ) : null}
        </div>
      ),
    },
    {
      id: "win-review",
      title: "Win Predictor Review",
      shortLabel: "Win Predictor Review",
      eyebrow: "Retrospective model",
      summary: "A dedicated post-match review of innings momentum, phase battles, partnerships, collapses, and pre-chase expectation.",
      metric: summaryAnalytics ? `${summaryAnalytics.innings.length} innings modeled` : "Summary model unavailable",
      icon: Gauge,
      ringClass: "from-emerald-200 via-teal-300 to-cyan-400",
      glowClass: "from-emerald-300/30 via-teal-400/18 to-cyan-500/18",
      panelClass: "bg-[linear-gradient(180deg,rgba(7,23,24,0.98),rgba(7,11,18,0.98))]",
      main: summaryAnalytics ? (
        <PostMatchSummaryCharts summaryAnalytics={summaryAnalytics} />
      ) : (
        <SpotlightMetric
          label="Summary model unavailable"
          value="Innings evidence incomplete"
          note="This match does not have enough reconstructed innings evidence to build the dedicated post-match summary model."
          className="border-sky-400/15 bg-sky-400/[0.06]"
        />
      ),
      aside: (
        <div className="space-y-4">
          <GlassPanel title="Narrative Highlights" subtitle="The most decision-useful retrospective reads in plain English.">
            <InsightList items={report.retrospective.biggestSwings} tone="good" />
          </GlassPanel>
          <GlassPanel title="Model Notes" subtitle="Why this slide is a post-match summary system instead of a copied live dashboard.">
            <InsightList
              items={[
                summaryAnalytics
                  ? `The summary model used ${report.retrospective.ballsTracked} tracked balls plus the final scorecards to rebuild innings phases, impact overs, partnerships, and collapses.`
                  : "The retrospective model is suppressed whenever the innings evidence is too thin to tell the story honestly.",
                predictionReview
                  ? `Pre-chase expectation leaned ${predictionReview.expectedWinner}${predictionReview.expectedWinPct != null ? ` at ${predictionReview.expectedWinPct}%` : ""}, then the final result was checked against that expectation.`
                  : "Prediction review is omitted unless both innings and the final result support a stable retrospective read.",
              ]}
            />
          </GlassPanel>
        </div>
      ),
    },
    {
      id: "surprise",
      title: "Surprise Performer",
      shortLabel: "Surprise Performer",
      eyebrow: "Unexpected story",
      summary: "Standout performers and match signals combined into one high-signal slide for the people who outplayed expectation.",
      metric: report.intel.standoutPerformers[0] ? truncateText(report.intel.standoutPerformers[0], 22) : "No standout call",
      icon: Sparkles,
      ringClass: "from-pink-200 via-rose-300 to-orange-400",
      glowClass: "from-pink-300/30 via-rose-400/18 to-orange-500/18",
      panelClass: "bg-[linear-gradient(180deg,rgba(25,11,15,0.98),rgba(9,9,17,0.98))]",
      main: (
        <div className="space-y-5">
          <GlassPanel title="Standout Performers" subtitle="The names that bent the expected script the hardest.">
            <InsightList items={report.intel.standoutPerformers} tone="good" />
          </GlassPanel>
          {summaryAnalytics?.hiddenContributors.length ? (
            <GlassPanel title="Hidden Contributors" subtitle="Useful contributions that mattered without becoming the headline.">
              <InsightList
                items={summaryAnalytics.hiddenContributors.map((contributor) => `${contributor.name}: ${contributor.note}`)}
                tone="neutral"
              />
            </GlassPanel>
          ) : null}
          <GlassPanel title="Match Signals" subtitle="Deterministic signal cards that explain why those surprises mattered.">
            <PostMatchSignals signals={report.intel.matchSignals} />
          </GlassPanel>
        </div>
      ),
      aside: (
        <div className="space-y-4">
          <GlassPanel title="Clutch Reads" subtitle="Compact context around the unexpected contributors.">
            <EdaCards cards={report.retrospective.advancedCards.slice(0, 3)} />
          </GlassPanel>
          {hiddenContributor ? (
            <GlassPanel title="Most Underrated Shift" subtitle="The cleanest hidden-value call from the retrospective model.">
              <InsightList items={[hiddenContributor.note]} tone="good" />
            </GlassPanel>
          ) : null}
        </div>
      ),
    },
    {
      id: "recommendations",
      title: "AI Recommendations vs Reality",
      shortLabel: "AI vs Reality",
      eyebrow: "Decision review",
      summary: "Recommendation calibration and trust notes, rewritten as a clean review slide rather than another stacked block.",
      metric:
        report.retrospective.recommendationReviewCards[0]?.value ??
        `${Math.round(report.confidence.score)}% confidence`,
      icon: BrainCircuit,
      ringClass: "from-violet-200 via-indigo-300 to-sky-400",
      glowClass: "from-violet-300/30 via-indigo-400/18 to-sky-500/18",
      panelClass: "bg-[linear-gradient(180deg,rgba(13,10,31,0.98),rgba(8,10,18,0.98))]",
      main: (
        <div className="space-y-5">
          <GlassPanel title="Recommendation Review Cards" subtitle="How the production recommendation engine graded out against actual outcomes.">
            <EdaCards cards={report.retrospective.recommendationReviewCards} />
          </GlassPanel>
          <GlassPanel title="Review Notes" subtitle="Short, decision-ready interpretation of where the engine aligned or drifted.">
            <InsightList items={report.retrospective.recommendationReviewNotes} />
          </GlassPanel>
        </div>
      ),
      aside: (
        <div className="space-y-4">
          <GlassPanel title="Final Ratings" subtitle="Topline post-match ratings across batting, bowling, and tactics.">
            <div className="space-y-3">
              {report.retrospective.ratings.map((rating) => (
                <div key={rating.label} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">{rating.label}</p>
                    <p className="text-lg font-black text-emerald-200">{Math.round(rating.score)}</p>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-sky-500" style={{ width: `${Math.min(100, rating.score)}%` }} />
                  </div>
                  <p className="mt-2 text-xs leading-6 text-gray-400">{rating.insight}</p>
                </div>
              ))}
            </div>
          </GlassPanel>
        </div>
      ),
    },
    {
      id: "historical",
      title: "Historical Context",
      shortLabel: "Historical Context",
      eyebrow: "Benchmark story",
      summary: "The result compared against venue and rivalry baselines, so the story sits inside real context instead of floating alone.",
      metric: `${Math.round(report.confidence.score)}% trust`,
      icon: Landmark,
      ringClass: "from-lime-200 via-emerald-300 to-teal-400",
      glowClass: "from-lime-300/30 via-emerald-400/18 to-teal-500/18",
      panelClass: "bg-[linear-gradient(180deg,rgba(11,22,14,0.98),rgba(8,10,18,0.98))]",
      main: (
        <div className="space-y-5">
          <GlassPanel title="Benchmark Cards" subtitle="Venue par gap, recent form, and blended matchup reads from the warehouse.">
            <EdaCards cards={report.benchmarkCards} />
          </GlassPanel>
        </div>
      ),
      aside: (
        <div className="space-y-4">
          <GlassPanel title="Venue" subtitle="How this ground usually behaves in the warehouse sample.">
            <InsightList items={[report.historical.venue.summary]} />
          </GlassPanel>
          <GlassPanel title="Head-to-head" subtitle="Thin samples are still visible here through confidence and warning labels.">
            <InsightList items={[report.historical.headToHead.summary]} />
          </GlassPanel>
          {report.historical.winnerForm ? (
            <GlassPanel title="Winner Form" subtitle="Recent warehouse form for the winning side.">
              <InsightList items={[report.historical.winnerForm.summary]} tone="good" />
            </GlassPanel>
          ) : null}
        </div>
      ),
    },
  ];

  useEffect(() => {
    bubbleRefs.current[currentIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [currentIndex]);

  function jumpToSlide(index: number) {
    setCurrentIndex(index);
    stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function goToPrevious() {
    setCurrentIndex((value) => Math.max(0, value - 1));
  }

  function goToNext() {
    setCurrentIndex((value) => Math.min(slides.length - 1, value + 1));
  }

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    touchStartX.current = event.changedTouches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const startX = touchStartX.current;
    const endX = event.changedTouches[0]?.clientX ?? null;

    touchStartX.current = null;

    if (startX === null || endX === null) return;

    const delta = endX - startX;
    if (Math.abs(delta) < 48) return;

    if (delta < 0) {
      goToNext();
      return;
    }

    goToPrevious();
  }

  return (
    <div className="mx-auto max-w-[92rem] space-y-8 px-4 py-8 sm:px-6">
      <Link href={`/matches/${match.id}`} className="inline-flex items-center gap-2 text-sm text-gray-400 transition hover:text-white">
        <ArrowLeft size={14} />
        Back to Match Centre
      </Link>

      <section className="relative overflow-hidden rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.18),transparent_32%),linear-gradient(180deg,#07111f_0%,#05070d_100%)] p-6 shadow-[0_35px_90px_rgba(0,0,0,0.45)] sm:p-8">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.05),transparent_30%,transparent_70%,rgba(255,255,255,0.04))]" />
        <div className="relative space-y-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cg-green">Post-Match Story Mode</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-5xl">{report.intel.headline}</h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-gray-300 sm:text-base">{report.intel.summary}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[22px] border border-white/10 bg-white/[0.05] px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Match status</p>
                <p className="mt-2 text-lg font-black text-white">{match.status}</p>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/[0.05] px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Confidence</p>
                <p className="mt-2 text-lg font-black text-white">
                  {Math.round(report.confidence.score)}% · {report.confidence.label}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-1.5 text-emerald-100">
              {match.matchEnded ? "Completed match" : "Live or partial analysis"}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-gray-200">
              {match.matchType}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-gray-200">
              {formatDate(match.dateTimeGMT || match.date)}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-gray-200">
              {match.venue}
            </span>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-white/55">Insight bubbles</h2>
                <p className="mt-1 text-sm text-gray-400">Tap a bubble, then swipe or use arrows to move through one insight at a time.</p>
              </div>
              <div className="hidden items-center gap-2 text-xs text-gray-500 sm:flex">
                <Clock3 size={14} />
                Story-friendly, mobile-first, full report underneath
              </div>
            </div>

            <div
              role="tablist"
              aria-label="Post-match insight bubbles"
              className="flex snap-x gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {slides.map((slide, index) => (
                <StoryBubble
                  key={slide.id}
                  active={index === currentIndex}
                  buttonRef={(node) => {
                    bubbleRefs.current[index] = node;
                  }}
                  tabId={`post-match-tab-${slide.id}`}
                  panelId={`post-match-panel-${slide.id}`}
                  icon={slide.icon}
                  label={slide.shortLabel}
                  metric={truncateText(slide.metric, 20)}
                  ringClass={slide.ringClass}
                  glowClass={slide.glowClass}
                  onClick={() => jumpToSlide(index)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section ref={stageRef} className="space-y-4">
        <div className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,16,28,0.98),rgba(8,10,18,0.98))] px-5 py-4 shadow-[0_25px_70px_rgba(0,0,0,0.35)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/80">
              {String(currentIndex + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
            </span>
            <div>
              <p className="text-sm font-semibold text-white">{slides[currentIndex].title}</p>
              <p className="text-xs text-gray-400">{slides[currentIndex].eyebrow}</p>
            </div>
          </div>

          <div className="flex flex-1 items-center gap-2">
            {slides.map((slide, index) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => jumpToSlide(index)}
                className="group flex-1 rounded-full bg-white/10 p-[2px] transition hover:bg-white/20"
                aria-label={`Go to ${slide.title}`}
              >
                <span className="block h-1.5 rounded-full bg-black/30">
                  <span
                    className={cn(
                      "block h-full rounded-full transition-all duration-500",
                      index < currentIndex && "w-full bg-white/80",
                      index === currentIndex && `w-full bg-gradient-to-r ${slide.ringClass}`,
                      index > currentIndex && "w-0 bg-transparent"
                    )}
                  />
                </span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goToPrevious}
              disabled={currentIndex === 0}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous insight"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={goToNext}
              disabled={currentIndex === slides.length - 1}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next insight"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        <div
          role="region"
          aria-label="Post-match insights carousel"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") goToPrevious();
            if (event.key === "ArrowRight") goToNext();
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="overflow-hidden rounded-[34px] outline-none"
        >
          <div
            className="flex transition-transform duration-500 ease-out"
            style={{ transform: `translateX(-${currentIndex * 100}%)` }}
          >
            {slides.map((slide, index) => {
              const Icon = slide.icon;
              return (
                <article
                  key={slide.id}
                  id={`post-match-panel-${slide.id}`}
                  role="tabpanel"
                  aria-labelledby={`post-match-tab-${slide.id}`}
                  aria-hidden={index !== currentIndex}
                  className="min-w-full px-1"
                >
                  <div className={cn("relative overflow-hidden rounded-[34px] border border-white/10 p-6 shadow-[0_35px_90px_rgba(0,0,0,0.45)] sm:p-8", slide.panelClass)}>
                    <div className={cn("absolute inset-0 bg-gradient-to-br opacity-85", slide.glowClass)} />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent_35%,transparent_70%,rgba(255,255,255,0.04))]" />
                    <div className="relative flex flex-col gap-6">
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="max-w-3xl">
                          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2">
                            <span className={cn("inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br text-white", slide.glowClass)}>
                              <Icon size={18} />
                            </span>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">{slide.eyebrow}</p>
                              <p className="text-sm font-semibold text-white">{slide.title}</p>
                            </div>
                          </div>
                          <h2 className="mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl">{slide.title}</h2>
                          <p className="mt-4 max-w-3xl text-sm leading-7 text-gray-200 sm:text-base">{slide.summary}</p>
                        </div>

                        <div className="max-w-sm rounded-[24px] border border-white/10 bg-white/[0.05] px-5 py-4 backdrop-blur">
                          <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">Slide headline metric</p>
                          <p className="mt-2 text-2xl font-black text-white">{slide.metric}</p>
                          <p className="mt-3 text-sm leading-6 text-gray-300">
                            {index === currentIndex ? "Swipe left or right, or use the arrows, to move through the match like a premium story deck." : ""}
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.85fr)]">
                        <div className="space-y-5">{slide.main}</div>
                        <div className="space-y-5">{slide.aside}</div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <CoverageDock match={match} report={report} coverage={coverage} />
        <EdaAskPanel
          matchId={match.id}
          title="Ask The Analyst"
          description="Use the same post-match scorecards, retrospective innings summaries, linked coverage, and warehouse benchmarks to ask follow-up questions."
          suggestions={[
            "What decided this match more than the raw margin suggests?",
            ...report.intel.turningPoints.slice(0, 2),
            "How did the result compare with venue and rivalry history?",
          ]}
          className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,16,28,0.98),rgba(8,10,18,0.98))] shadow-[0_25px_70px_rgba(0,0,0,0.35)]"
        />
      </div>
    </div>
  );
}
