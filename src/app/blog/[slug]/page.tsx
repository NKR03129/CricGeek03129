"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  Eye,
  MessageSquare,
  Flag,
  Share2,
  ChevronDown,
  ChevronUp,
  BarChart3,
} from "lucide-react";
import CricketBallReactionButton from "@/components/blog/CricketBallReactionButton";
import SaveBlogButton from "@/components/blog/SaveBlogButton";
import FollowWriterButton from "@/components/writer/FollowWriterButton";
import ScoreRing from "@/components/writer/ScoreRing";
import WriterProfileCard from "@/components/writer/WriterProfileCard";
import BlogDiscussion from "@/components/blog/BlogDiscussion";
import { ARCHETYPE_META } from "@/lib/scoring";
import { use } from "react";

interface BlogData {
  id: string;
  title: string;
  content: string;
  slug: string;
  tags: string;
  views: number;
  runs: number;
  createdAt: string;
  mentionedPlayers?: string[] | null;
  mentionedTeams?: string[] | null;
  author: {
    id: string;
    name: string;
    avatar: string | null;
    role?: string;
    _count?: { followers: number };
  };
  _count: { comments: number; reactions?: number; saves?: number };
  reactionCount?: number;
  saveCount?: number;
  viewerState?: {
    reacted: boolean;
    saved: boolean;
    followsAuthor: boolean;
  };
  score: {
    bqs: number;
    processingStatus?: "processing" | "completed" | "failed";
    toneScore: number;
    negativityScore: number;
    toxicityScore: number;
    originalityScore: number;
    coherenceScore: number;
    archetypeLabel: string;
    archetypeConfidence: number;
    constructiveness: number;
    evidencePresence: number;
    positionClarity: number;
    infoDensity: number;
    argumentLogic: number;
    entitiesFound: number;
    statsFound: number;
    statsVerified: number;
    statAccuracy: number;
    paragraphScores?: {
      paragraphIndex: number;
      excerpt: string;
      overall: number;
      constructiveness: number;
      negativity: number;
      toxicity: number;
      evidence: number;
      coherence: number;
      note: string;
    }[] | null;
    explanationJson?: {
      summary?: string;
      strengths?: string[];
      concerns?: string[];
      negativityVsToxicity?: string;
      penaltyDecision?: string;
      userVisibleBreakdown?: string[];
    } | null;
    factCheckJson?: {
      overallScore: number;
      summary?: string;
      searchBackend?: string;
      providerAvailable?: boolean;
      historicalWarehouseAvailable?: boolean;
      historicalWarehouseError?: string | null;
      searchError?: string | null;
      claimRouting?: {
        historicalStructured?: number;
        webSearch?: number;
        unsupported?: number;
        reroutedToWeb?: number;
      } | null;
      directStats?: {
        source?: "live" | "fallback";
        claimsFound?: number;
        claimsVerified?: number;
        accuracy?: number;
      } | null;
      historicalClaims?: {
        claimsRouted?: number;
        claimsResolved?: number;
        supported?: number;
        contradicted?: number;
        inconclusive?: number;
        score?: number;
        summary?: string;
        verdicts?: Array<{
          claim: string;
          query: string;
          category: string;
          route?: "historical_structured" | "web_search" | "unsupported";
          verdict: "supported" | "contradicted" | "inconclusive";
          confidence: number;
          evidence: string;
          intent?: {
            subjectType?: string;
            subject?: string;
            metric?: string;
            comparison?: string | null;
            expectedValue?: number | null;
            matchType?: string | null;
            competition?: string | null;
            opponent?: string | null;
            venue?: string | null;
          } | null;
          sources: Array<{
            title: string;
            url: string;
            snippet: string;
            domain: string;
            publishedDate?: string | null;
          }>;
        }>;
      } | null;
      webClaims?: {
        claimsRouted?: number;
        claimsResearched?: number;
        supported?: number;
        contradicted?: number;
        inconclusive?: number;
        score?: number;
        summary?: string;
        verdicts?: Array<{
          claim: string;
          query: string;
          category: string;
          verdict: "supported" | "contradicted" | "inconclusive";
          confidence: number;
          evidence: string;
          sources: Array<{
            title: string;
            url: string;
            snippet: string;
            domain: string;
            publishedDate?: string | null;
          }>;
        }>;
      } | null;
    } | null;
    toxicityPenaltyApplied?: boolean;
    toxicityPenaltyOverride?: boolean;
    scoreVersion?: string;
    wordCount: number;
    processingTimeMs: number;
  } | null;
  authorProfile?: {
    averageBQS: number;
    totalBlogs: number;
    archetype: string;
    level: number;
    xp: number;
    bcs: number;
    writerTitle: string;
    statAccuracy: number;
  };
}

function getBQSColor(bqs: number): string {
  if (bqs >= 80) return "text-green-400";
  if (bqs >= 60) return "text-yellow-400";
  if (bqs >= 40) return "text-orange-400";
  return "text-red-400";
}

function getBarColor(val: number): string {
  if (val >= 80) return "bg-green-500";
  if (val >= 60) return "bg-yellow-500";
  if (val >= 40) return "bg-orange-500";
  return "bg-red-500";
}

function getFactVerdictMeta(verdict: string): { label: string; className: string } {
  if (verdict === "supported") {
    return {
      label: "Supported",
      className: "border-cg-green/30 bg-cg-green/10 text-cg-green",
    };
  }

  if (verdict === "contradicted") {
    return {
      label: "Contradicted",
      className: "border-red-500/30 bg-red-500/10 text-red-300",
    };
  }

  return {
    label: "Inconclusive",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  };
}

// BCS tier display
function getBadgeTier(bcs: number): { label: string; icon: string; color: string } {
  if (bcs >= 93) return { label: "CricGeek Verified", icon: "✒️", color: "text-indigo-300" };
  if (bcs >= 81) return { label: "Diamond Expert",    icon: "💎", color: "text-cyan-300" };
  if (bcs >= 66) return { label: "Gold Correspondent",icon: "🥇", color: "text-yellow-400" };
  if (bcs >= 41) return { label: "Silver Analyst",    icon: "🥈", color: "text-gray-300" };
  return { label: "Bronze Scribe", icon: "🥉", color: "text-amber-600" };
}

export default function BlogSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const resolvedParams = use(params);
  const [blog, setBlog] = useState<BlogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
  const [runs, setRuns] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [milestone, setMilestone] = useState<string | null>(null);
  const viewCounted = useRef(false);
  const startTime = useRef(Date.now());
  const scrolledEnough = useRef(false);
  const scoreStatus = blog?.score?.processingStatus;
  const scoreIsPending = scoreStatus === "processing";

  const countView = useCallback(async (slug: string) => {
    if (viewCounted.current) return;
    const timeOnPage = (Date.now() - startTime.current) / 1000;
    if (!scrolledEnough.current || timeOnPage < 10) return;
    viewCounted.current = true;
    try {
      const res = await fetch(`/api/blogs/${slug}/views`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scrolled: true, timeOnPage }),
      });
      const data = await res.json();
      if (data.milestone) {
        const msgs: Record<number, string> = {
          100:   "🎉 Century! 100 readers",
          1000:  "🏏 Your blog hit 1,000 views!",
          10000: "💎 VIRAL — 10,000 readers!",
        };
        setMilestone(msgs[data.milestone] ?? null);
        setTimeout(() => setMilestone(null), 5000);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    async function fetchBlog() {
      try {
        const res = await fetch(`/api/blogs/${resolvedParams.slug}`);
        if (res.ok) {
          const data = await res.json();
          setBlog(data);
          setRuns(data.reactionCount ?? data.runs ?? 0);
          setCommentCount(data._count?.comments ?? 0);
        } else {
          const data = await res.json().catch(() => null);
          setError(data?.error || "This blog could not be loaded.");
          setBlog(null);
        }
      } catch {
        setError("This blog could not be loaded.");
        setBlog(null);
      } finally {
        setLoading(false);
      }
    }
    fetchBlog();
  }, [resolvedParams.slug]);

  useEffect(() => {
    if (scoreStatus !== "processing") return;

    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/blogs/${resolvedParams.slug}`);
        if (!res.ok) return;
        const data = await res.json();
        setBlog(data);
      } catch {
        // keep polling until the score is ready
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [scoreStatus, resolvedParams.slug]);

  // Smart view counting: track scroll depth
  useEffect(() => {
    const handleScroll = () => {
      const scrollPct = window.scrollY / (document.body.scrollHeight - window.innerHeight);
      if (scrollPct >= 0.20) {
        scrolledEnough.current = true;
        if (blog) countView(resolvedParams.slug);
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [blog, resolvedParams.slug, countView]);

  // Also try counting view after 10s even without scroll
  useEffect(() => {
    if (!blog) return;
    const timer = setTimeout(() => {
      if (scrolledEnough.current) countView(resolvedParams.slug);
    }, 11000);
    return () => clearTimeout(timer);
  }, [blog, resolvedParams.slug, countView]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-3/4 mb-4" />
        <div className="h-4 bg-gray-800 rounded w-1/3 mb-8" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-4 bg-gray-800 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!blog) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center">
        <h1 className="text-2xl font-black text-white">Expression unavailable</h1>
        <p className="mt-2 text-sm text-gray-400">{error || "We could not load this expression right now."}</p>
        <Link
          href="/blog"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-cg-green px-4 py-2 text-sm font-bold text-black hover:bg-cg-green-dark"
        >
          <ArrowLeft size={14} />
          Back to Expressions
        </Link>
      </div>
    );
  }

  const archMeta = blog.score && !scoreIsPending
    ? (ARCHETYPE_META[blog.score.archetypeLabel] ?? ARCHETYPE_META.analyst)
    : ARCHETYPE_META.fan;

  const badgeTier = blog.authorProfile
    ? getBadgeTier(blog.authorProfile.bcs)
    : { label: "Bronze Scribe", icon: "🥉", color: "text-amber-600" };

  if (scoreIsPending) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <Link
          href="/blog"
          className="text-gray-400 hover:text-white text-sm flex items-center gap-1 mb-6"
        >
          <ArrowLeft size={14} /> Back to Expressions
        </Link>

        <div className="rounded-2xl border border-gray-800 bg-cg-dark-2 p-8 sm:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-amber-300">
                Scoring in progress
              </span>
              <h1 className="mt-4 text-3xl font-black text-white">{blog.title}</h1>
              <p className="mt-3 text-sm leading-7 text-gray-300">
                EQS is still compiling your post. We keep this page in a waiting state so the finished post and score appear together, not in pieces.
              </p>
              <p className="mt-3 text-sm leading-7 text-gray-400">
                Check your writer profile for a pending badge, or come back here once the compile is complete.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href={`/writer/${blog.author.id}`}
                  className="inline-flex items-center gap-2 rounded-lg bg-cg-green px-4 py-2 text-sm font-bold text-black hover:bg-cg-green-dark"
                >
                  Open My Expressions
                </Link>
                <Link
                  href="/blog/write"
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:border-gray-500 hover:text-white"
                >
                  Write another expression
                </Link>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-black/35 px-6 py-5 text-center shadow-[0_20px_50px_rgba(0,0,0,0.25)] backdrop-blur-sm">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-cg-green/20 bg-black/20 text-4xl">
                🏏
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.24em] text-cg-green">EQS innings live</p>
              <p className="mt-2 text-sm text-gray-400">The result will replace this waiting screen once scoring completes.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const scoreBreakdownItems = blog.score && !scoreIsPending
    ? [
        { label: "Originality",     value: blog.score.originalityScore,  icon: "💡" },
        { label: "Coherence",       value: blog.score.coherenceScore,     icon: "🔗" },
        { label: "Constructive",    value: blog.score.constructiveness,   icon: "🏗️" },
        { label: "Evidence",        value: blog.score.evidencePresence,   icon: "📊" },
        { label: "Negativity",      value: 100 - blog.score.negativityScore, icon: "🌧️" },
        { label: "Argument Logic",  value: blog.score.argumentLogic ?? 0, icon: "⚖️" },
        { label: "Info Density",    value: blog.score.infoDensity,        icon: "📈" },
        { label: "Fact Accuracy",   value: blog.score.statAccuracy,       icon: "✅" },
        { label: "Toxicity Free",   value: 100 - blog.score.toxicityScore,icon: "🧤" },
      ]
    : [];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Milestone Toast */}
      {milestone && (
        <div className="fixed top-4 right-4 z-50 bg-cg-green text-black px-5 py-3 rounded-xl font-bold shadow-xl animate-bounce">
          {milestone}
        </div>
      )}

      <Link
        href="/blog"
        className="text-gray-400 hover:text-white text-sm flex items-center gap-1 mb-6"
      >
        <ArrowLeft size={14} /> Back to Expressions
      </Link>

      {/* ── Section 1: Stadium Header ─────────────────────────────── */}
      <div
        className="relative rounded-2xl overflow-hidden mb-6"
        style={{
          background: "linear-gradient(135deg, #052e16 0%, #0f172a 50%, #1e1b4b 100%)",
        }}
      >
        {/* Green pitch overlay */}
        <div className="absolute inset-0 opacity-5"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, #22c55e 0px, #22c55e 1px, transparent 1px, transparent 40px)" }} />
        <div className="relative px-6 sm:px-10 py-8 sm:py-10">
          {/* Archetype badge */}
          <div className="flex items-center gap-3 mb-4">
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full ${archMeta.bgColor} ${archMeta.color} border border-current/30`}
            >
              {archMeta.icon} {archMeta.label}
            </span>
            {blog.score && (
              <span className="text-xs text-gray-400">
                {Math.round(blog.score.archetypeConfidence * 100)}% match
              </span>
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white leading-tight mb-5">
            {blog.title}
          </h1>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-300">
            <Link
              href={`/writer/${blog.author.id}`}
              className="font-semibold text-white hover:text-cg-green transition-colors"
            >
              {blog.author.name}
            </Link>
            {blog.authorProfile && (
              <span className={`text-xs font-bold ${badgeTier.color}`}>
                {badgeTier.icon} {badgeTier.label}
              </span>
            )}
            <span className="flex items-center gap-1 text-gray-400">
              <Clock size={12} /> {new Date(blog.createdAt).toLocaleDateString()}
            </span>
            <span className="flex items-center gap-1 text-gray-400">
              <Eye size={12} /> {blog.views.toLocaleString()} views
            </span>
            <span className="flex items-center gap-1 text-orange-400 font-medium">
              🏏 {runs.toLocaleString()} runs
            </span>
            <span className="flex items-center gap-1 text-gray-400">
              <MessageSquare size={12} /> {commentCount}
            </span>
          </div>
        </div>

        {/* EQS ring overlay (top right) */}
        {blog.score && !scoreIsPending && (
          <div className="absolute top-6 right-6 sm:top-8 sm:right-10">
            <ScoreRing score={blog.score.bqs} size={80} label="EQS" />
          </div>
        )}
        {scoreIsPending && (
          <div className="absolute top-6 right-6 sm:top-8 sm:right-10 flex h-20 w-20 items-center justify-center rounded-full border border-cg-green/30 bg-black/35 backdrop-blur-sm">
            <div className="text-center">
              <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-cg-green/30 border-t-cg-green" />
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cg-green">Scoring</p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* ── Main Content Column ─────────────────────────────────── */}
        <article className="lg:col-span-3 space-y-4">
          {/* ── Section 2: Writer Identity Strip ──────────────────── */}
          {blog.authorProfile && (
            <div className="bg-cg-dark-2 border border-gray-800 rounded-xl px-5 py-4 flex flex-wrap items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cg-green/30 to-cg-dark-3 flex items-center justify-center text-cg-green font-black shrink-0 border border-cg-green/30">
                {blog.author.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <Link
                  href={`/writer/${blog.author.id}`}
                  className="text-sm font-bold text-white hover:text-cg-green transition-colors"
                >
                  {blog.author.name}
                </Link>
                {blog.authorProfile.writerTitle && (
                  <p className="text-[10px] text-gray-500 font-mono tracking-widest">
                    {blog.authorProfile.writerTitle}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
                <div className="text-center">
                  <p className={`font-bold text-sm ${getBQSColor(blog.authorProfile.averageBQS)}`}>
                    {blog.authorProfile.averageBQS.toFixed(1)}
                  </p>
                  <p className="text-[10px]">Avg EQS</p>
                </div>
                <div className="text-center">
                  <p className="font-bold text-sm text-white">{blog.authorProfile.totalBlogs}</p>
                  <p className="text-[10px]">Expressions</p>
                </div>
                <div className="text-center">
                  <p className="font-bold text-sm text-white">
                    {Math.round(blog.authorProfile.statAccuracy ?? 0)}%
                  </p>
                  <p className="text-[10px]">Fact Acc.</p>
                </div>
                <Link
                  href={`/writer/${blog.author.id}`}
                  className="text-cg-green text-xs font-medium hover:underline ml-2"
                >
                  View Profile →
                </Link>
                <FollowWriterButton
                  writerId={blog.author.id}
                  initialFollowing={Boolean(blog.viewerState?.followsAuthor)}
                  initialFollowerCount={blog.author._count?.followers ?? 0}
                  compact
                />
              </div>
            </div>
          )}

          {/* ── Section 3: EQS Strip (collapsible) ────────────────── */}
          {blog.score && !scoreIsPending && (
            <div className="bg-cg-dark-2 border border-gray-800 rounded-xl overflow-hidden">
              <button
                onClick={() => setShowScoreBreakdown(!showScoreBreakdown)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-cg-dark-3/50 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <BarChart3 size={14} className="text-cg-green" />
                  <span className="text-xs font-bold text-white">
                    Expression Quality Score
                  </span>
                  <span className={`text-sm font-black ${getBQSColor(blog.score.bqs)}`}>
                    {blog.score.bqs}/100
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full ${archMeta.bgColor} ${archMeta.color}`}
                  >
                    {archMeta.icon} {archMeta.label} Archetype
                  </span>
                </div>
                {showScoreBreakdown ? (
                  <ChevronUp size={14} className="text-gray-400" />
                ) : (
                  <ChevronDown size={14} className="text-gray-400" />
                )}
              </button>

              {showScoreBreakdown && (
                <div className="px-5 pb-4 grid grid-cols-2 gap-x-6 gap-y-2">
                  {scoreBreakdownItems.map((item) => (
                    <div key={item.label} className="flex items-center gap-2">
                      <span className="text-sm w-4 shrink-0">{item.icon}</span>
                      <span className="text-[11px] text-gray-400 flex-1 truncate">{item.label}</span>
                      <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden shrink-0">
                        <div
                          className={`h-full rounded-full transition-all ${getBarColor(item.value)}`}
                          style={{ width: `${item.value}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-mono text-gray-400 w-6 text-right shrink-0">
                        {Math.round(item.value)}
                      </span>
                    </div>
                  ))}
                  <div className="col-span-2 mt-2 pt-2 border-t border-gray-800 flex items-center gap-4 text-[10px] text-gray-500">
                    <span>⚡ Processed in {blog.score.processingTimeMs}ms</span>
                    <span>📝 {blog.score.wordCount} words</span>
                    {blog.score.scoreVersion && <span>🧠 {blog.score.scoreVersion}</span>}
                    <span>
                      ✅ {blog.score.statsVerified}/{blog.score.statsFound} direct stat checks passed
                    </span>
                    {blog.score.factCheckJson?.historicalClaims?.claimsResolved ? (
                      <span>
                        🗂️ {blog.score.factCheckJson.historicalClaims.claimsResolved} historical claims checked
                      </span>
                    ) : null}
                    {blog.score.factCheckJson?.webClaims?.claimsResearched ? (
                      <span>
                        🌐 {blog.score.factCheckJson.webClaims.claimsResearched} web claims checked
                      </span>
                    ) : null}
                    {blog.score.toxicityPenaltyOverride && <span>🛡️ Toxicity override reduced</span>}
                  </div>
                </div>
              )}
            </div>
          )}

          {scoreIsPending && (
            <div className="rounded-xl border border-cg-green/20 bg-cg-green/5 px-5 py-4 text-sm text-gray-300">
              <p className="font-semibold text-cg-green">EQS is still being calculated</p>
              <p className="mt-1 text-gray-400">
                The post is live, but the quality score is still processing in the background. This page will refresh itself when the score is ready.
              </p>
            </div>
          )}

          {blog.score?.explanationJson && !scoreIsPending && (
            <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white">Why This EQS Was Given</h3>
                <p className="mt-2 text-sm leading-7 text-gray-300">
                  {blog.score.explanationJson.summary}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-cg-green/20 bg-cg-green/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-cg-green">Strengths</p>
                  <ul className="mt-3 space-y-2 text-sm text-gray-300">
                    {(blog.score.explanationJson.strengths ?? []).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">Watchouts</p>
                  <ul className="mt-3 space-y-2 text-sm text-gray-300">
                    {(blog.score.explanationJson.concerns ?? []).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-gray-800 bg-cg-dark p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Negativity vs Toxicity</p>
                  <p className="mt-2 text-sm leading-7 text-gray-300">
                    {blog.score.explanationJson.negativityVsToxicity}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-800 bg-cg-dark p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Penalty Decision</p>
                  <p className="mt-2 text-sm leading-7 text-gray-300">
                    {blog.score.explanationJson.penaltyDecision}
                  </p>
                </div>
              </div>
            </div>
          )}

          {blog.score?.factCheckJson && !scoreIsPending && (
            <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white">Source-Backed Fact Check</h3>
                  <p className="mt-2 text-sm leading-7 text-gray-300">
                    {blog.score.factCheckJson.summary || "Source-backed claim verification is available for this article."}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-800 bg-cg-dark px-3 py-2 text-right">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">Fact Accuracy</p>
                  <p className={`text-lg font-black ${getBQSColor(blog.score.factCheckJson.overallScore)}`}>
                    {Math.round(blog.score.factCheckJson.overallScore)}%
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-gray-800 bg-cg-dark p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Direct Match Stats</p>
                  <p className="mt-2 text-lg font-black text-white">
                    {blog.score.factCheckJson.directStats?.claimsVerified ?? 0}/{blog.score.factCheckJson.directStats?.claimsFound ?? 0}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    {blog.score.factCheckJson.directStats?.source === "fallback"
                      ? "Heuristic fallback"
                      : "Scorecard verified"}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-800 bg-cg-dark p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Historical Warehouse</p>
                  <p className="mt-2 text-lg font-black text-white">
                    {blog.score.factCheckJson.historicalClaims?.claimsResolved ?? 0}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    {blog.score.factCheckJson.historicalWarehouseAvailable
                      ? "Structured history checked"
                      : "Warehouse unavailable"}
                  </p>
                  {blog.score.factCheckJson.historicalWarehouseError ? (
                    <p className="mt-2 text-xs text-red-400">
                      {blog.score.factCheckJson.historicalWarehouseError}
                    </p>
                  ) : null}
                </div>
                <div className="rounded-lg border border-gray-800 bg-cg-dark p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Web Claim Checks</p>
                  <p className="mt-2 text-lg font-black text-white">
                    {blog.score.factCheckJson.webClaims?.claimsResearched ?? 0}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    Checked via {blog.score.factCheckJson.searchBackend || "no backend"}
                  </p>
                  {blog.score.factCheckJson.searchError ? (
                    <p className="mt-2 text-xs text-red-400">
                      {blog.score.factCheckJson.searchError}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-gray-800 bg-cg-dark p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Historical Verdict Split</p>
                  <p className="mt-2 text-sm text-gray-300">
                    ✅ {blog.score.factCheckJson.historicalClaims?.supported ?? 0} supported
                  </p>
                  <p className="mt-1 text-sm text-gray-300">
                    ❌ {blog.score.factCheckJson.historicalClaims?.contradicted ?? 0} contradicted
                  </p>
                  <p className="mt-1 text-sm text-gray-300">
                    ⚪ {blog.score.factCheckJson.historicalClaims?.inconclusive ?? 0} inconclusive
                  </p>
                </div>
                <div className="rounded-lg border border-gray-800 bg-cg-dark p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Web Verdict Split</p>
                  <p className="mt-2 text-sm text-gray-300">
                    ✅ {blog.score.factCheckJson.webClaims?.supported ?? 0} supported
                  </p>
                  <p className="mt-1 text-sm text-gray-300">
                    ❌ {blog.score.factCheckJson.webClaims?.contradicted ?? 0} contradicted
                  </p>
                  <p className="mt-1 text-sm text-gray-300">
                    ⚪ {blog.score.factCheckJson.webClaims?.inconclusive ?? 0} inconclusive
                  </p>
                </div>
                <div className="rounded-lg border border-gray-800 bg-cg-dark p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Claim Routing</p>
                  <p className="mt-2 text-sm text-gray-300">
                    🗂️ {blog.score.factCheckJson.claimRouting?.historicalStructured ?? 0} historical
                  </p>
                  <p className="mt-1 text-sm text-gray-300">
                    🌐 {blog.score.factCheckJson.claimRouting?.webSearch ?? 0} web
                  </p>
                  <p className="mt-1 text-sm text-gray-300">
                    ↪️ {blog.score.factCheckJson.claimRouting?.reroutedToWeb ?? 0} rerouted
                  </p>
                </div>
              </div>

              {blog.score.factCheckJson.historicalClaims?.verdicts && blog.score.factCheckJson.historicalClaims.verdicts.length > 0 ? (
                <div className="space-y-3">
                  {blog.score.factCheckJson.historicalClaims.verdicts.map((verdict) => {
                    const verdictMeta = getFactVerdictMeta(verdict.verdict);

                    return (
                      <div key={`${verdict.claim}:${verdict.query}:historical`} className="rounded-xl border border-gray-800 bg-cg-dark p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${verdictMeta.className}`}>
                            {verdictMeta.label}
                          </span>
                          <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-gray-300">
                            {Math.round(verdict.confidence * 100)}% confidence
                          </span>
                          <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-gray-500">
                            structured historical check
                          </span>
                        </div>
                        <p className="mt-3 text-sm font-semibold text-white">{verdict.claim}</p>
                        <p className="mt-2 text-sm text-gray-300">{verdict.evidence}</p>
                        {verdict.intent ? (
                          <p className="mt-3 text-xs text-gray-500">
                            Routed as {verdict.intent.subjectType || "historical"} / {(verdict.intent.metric || "structured_check").replace(/_/g, " ")}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {blog.score.factCheckJson.webClaims?.verdicts && blog.score.factCheckJson.webClaims.verdicts.length > 0 ? (
                <div className="space-y-3">
                  {blog.score.factCheckJson.webClaims.verdicts.map((verdict) => {
                    const verdictMeta = getFactVerdictMeta(verdict.verdict);

                    return (
                      <div key={`${verdict.claim}:${verdict.query}`} className="rounded-xl border border-gray-800 bg-cg-dark p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${verdictMeta.className}`}>
                            {verdictMeta.label}
                          </span>
                          <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-gray-300">
                            {Math.round(verdict.confidence * 100)}% confidence
                          </span>
                          <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-gray-500">
                            {verdict.category}
                          </span>
                        </div>
                        <p className="mt-3 text-sm font-semibold text-white">{verdict.claim}</p>
                        <p className="mt-2 text-sm text-gray-300">{verdict.evidence}</p>

                        {verdict.sources.length > 0 ? (
                          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                            {verdict.sources.map((source) => (
                              <a
                                key={`${verdict.claim}:${source.url}`}
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg border border-gray-800 bg-cg-dark-2 p-3 transition-colors hover:border-cg-green/40"
                              >
                                <p className="text-xs font-semibold text-white">{source.title || source.domain}</p>
                                <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-500">{source.domain}</p>
                                <p className="mt-2 text-xs leading-6 text-gray-400">{source.snippet}</p>
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          )}

          {/* ── Section 5: Expression Content ──────────────────────── */}
          <div className="bg-cg-dark-2 border border-gray-800 rounded-2xl p-6 sm:p-8">
            {/* Stats verified banner */}
            {blog.score && !scoreIsPending && blog.score.statsFound > 0 && (
              <div className="bg-cg-green/5 border border-cg-green/20 rounded-lg px-4 py-2 mb-6 flex items-center gap-2 text-sm">
                <span className="text-cg-green">✅</span>
                <span className="text-gray-300">
                  {blog.score.factCheckJson?.directStats?.source === "fallback"
                    ? `${blog.score.statsVerified}/${blog.score.statsFound} direct stat references checked via heuristic fallback`
                    : `${blog.score.statsVerified}/${blog.score.statsFound} direct match stats verified from the scorecard`}
                </span>
              </div>
            )}

            <div className="space-y-5">
              {blog.content.split("\n\n").map((paragraph, i) => (
                <p
                  key={i}
                  className="text-gray-300 leading-[1.9] text-[15.5px] tracking-[0.01em]"
                >
                  {paragraph}
                </p>
              ))}
            </div>

            {blog.score?.paragraphScores && !scoreIsPending && blog.score.paragraphScores.length > 0 && (
              <div className="mt-8 border-t border-gray-800 pt-6">
                <h3 className="text-sm font-bold text-white">Paragraph-Level Scoring</h3>
                <div className="mt-4 space-y-3">
                  {blog.score.paragraphScores.map((paragraph) => (
                    <div key={paragraph.paragraphIndex} className="rounded-xl border border-gray-800 bg-cg-dark p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-gray-300">
                          Paragraph {paragraph.paragraphIndex + 1}
                        </span>
                        <span className="text-sm font-bold text-white">Overall {Math.round(paragraph.overall)}</span>
                        <span className="text-xs text-gray-500">Constructive {Math.round(paragraph.constructiveness)}</span>
                        <span className="text-xs text-gray-500">Negativity {Math.round(paragraph.negativity)}</span>
                        <span className="text-xs text-gray-500">Toxicity {Math.round(paragraph.toxicity)}</span>
                      </div>
                      <p className="mt-3 text-sm text-gray-300">{paragraph.excerpt}</p>
                      <p className="mt-2 text-xs text-gray-500">{paragraph.note}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {(blog.tags || blog.mentionedPlayers?.length || blog.mentionedTeams?.length) && (
              <div className="mt-8 border-t border-gray-800 pt-6">
                {blog.tags && (
                  <div className="flex flex-wrap gap-1.5">
                    {blog.tags.split(",").map((tag) => (
                      <span
                        key={tag}
                        className="bg-gray-800 text-gray-400 text-[11px] px-3 py-1 rounded-full hover:bg-cg-green/20 hover:text-cg-green transition-all cursor-pointer"
                      >
                        #{tag.trim()}
                      </span>
                    ))}
                  </div>
                )}
                {(blog.mentionedPlayers?.length || blog.mentionedTeams?.length) && (
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {blog.mentionedPlayers?.length ? (
                      <div className="rounded-lg border border-gray-800 bg-cg-dark px-3 py-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Mentioned Players</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {blog.mentionedPlayers.map((player) => (
                            <span key={player} className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-white">
                              {player}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {blog.mentionedTeams?.length ? (
                      <div className="rounded-lg border border-gray-800 bg-cg-dark px-3 py-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Mentioned Teams</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {blog.mentionedTeams.map((team) => (
                            <span key={team} className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-white">
                              {team}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}

            {/* Action bar */}
            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-800 pt-5">
              <CricketBallReactionButton
                slug={blog.slug}
                initialCount={runs}
                initialReacted={Boolean(blog.viewerState?.reacted)}
                loginHref={`/auth/login?redirect=/blog/${blog.slug}`}
                onUpdate={(next) => setRuns(next.count)}
              />
              <SaveBlogButton
                slug={blog.slug}
                initialSaved={Boolean(blog.viewerState?.saved)}
                initialCount={blog.saveCount ?? 0}
                loginHref={`/auth/login?redirect=/blog/${blog.slug}`}
              />
              <FollowWriterButton
                writerId={blog.author.id}
                initialFollowing={Boolean(blog.viewerState?.followsAuthor)}
                initialFollowerCount={blog.author._count?.followers ?? 0}
              />
              <button
                className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
                title="Share"
              >
                <Share2 size={16} />
              </button>
              <button
                className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-400/10 transition-all"
                title="Report"
              >
                <Flag size={16} />
              </button>
            </div>
          </div>

          <BlogDiscussion
            blogSlug={blog.slug}
            initialCount={commentCount}
            onCountChange={setCommentCount}
          />

          {/* ── Section 11: End of Expression Card ───────────────── */}
          <div
            className="rounded-2xl p-6 sm:p-8 text-center"
            style={{
              background: "linear-gradient(135deg, #052e16 0%, #0f172a 100%)",
              border: "1px solid rgba(34,197,94,0.2)",
            }}
          >
            <p className="text-xl font-black text-white mb-1">🏏 INNINGS COMPLETE!</p>
            {blog.score && (
              <p className="text-sm text-gray-400 mb-4">
                You just read a{" "}
                <span className={`font-bold ${badgeTier.color}`}>{badgeTier.label}</span> analysis
              </p>
            )}

            <div className="mb-5 flex items-center justify-center">
              <CricketBallReactionButton
                slug={blog.slug}
                initialCount={runs}
                initialReacted={Boolean(blog.viewerState?.reacted)}
                loginHref={`/auth/login?redirect=/blog/${blog.slug}`}
                onUpdate={(next) => setRuns(next.count)}
              />
            </div>

            {/* Expression stats */}
            <div className="grid grid-cols-4 gap-3 mb-6 max-w-sm mx-auto">
                {[
                  { label: "Runs", value: `🏏 ${runs.toLocaleString()}` },
                  { label: "Views", value: `👁️ ${blog.views.toLocaleString()}` },
                { label: "Comments", value: `💬 ${commentCount}` },
                
                {
                  label: "Stats",
                  value: `⚽ ${blog.score?.statsVerified ?? 0}`,
                },
              ].map((s) => (
                <div key={s.label} className="bg-white/5 rounded-lg py-2 px-1">
                  <p className="text-sm font-bold text-white">{s.value}</p>
                  <p className="text-[10px] text-gray-500">{s.label}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-3 justify-center">
              <Link
                href={`/blog/${blog.slug}#comments`}
                className="bg-white/10 hover:bg-white/20 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-all flex items-center gap-2"
              >
                💬 Join Discussion
              </Link>
              <Link
                href="/blog/write"
                className="bg-cg-green hover:bg-cg-green-dark text-black text-sm font-bold px-5 py-2.5 rounded-lg transition-all flex items-center gap-2"
              >
                🏏 Write Your Take
              </Link>
            </div>
          </div>
        </article>

        {/* ── Sidebar ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* EQS compact sidebar */}
          {blog.score && (
            <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-4 sticky top-20">
              <h3 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
                🏏 AI Quality Score
              </h3>
              <div className="flex justify-center mb-4">
                <ScoreRing score={blog.score.bqs} size={90} label="EQS" />
              </div>
              <div className="space-y-2">
                {scoreBreakdownItems.slice(0, 4).map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <span className="text-xs w-3 shrink-0">{item.icon}</span>
                    <span className="text-[10px] text-gray-500 flex-1 truncate">{item.label}</span>
                    <div className="w-12 h-1 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${getBarColor(item.value)}`}
                        style={{ width: `${item.value}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-500 w-5 text-right">
                      {Math.round(item.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Author card */}
          <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-4">
            <h3 className="text-xs font-bold text-white mb-3">About the Author</h3>
            <WriterProfileCard
              id={blog.author.id}
              name={blog.author.name}
              avatar={blog.author.avatar}
              archetype={blog.score?.archetypeLabel ?? "fan"}
              level={blog.authorProfile?.level ?? 1}
              xp={blog.authorProfile?.xp ?? 0}
              averageBQS={blog.authorProfile?.averageBQS ?? 0}
              totalBlogs={blog.authorProfile?.totalBlogs ?? 0}
              compact
            />
            <div className="mt-3">
              <FollowWriterButton
                writerId={blog.author.id}
                initialFollowing={Boolean(blog.viewerState?.followsAuthor)}
                initialFollowerCount={blog.author._count?.followers ?? 0}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
