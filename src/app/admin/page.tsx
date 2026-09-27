"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Shield, FileText, Trophy, Star, Check, X, AlertTriangle, Plus,
  Brain, Activity, BarChart3, Zap, TrendingUp
} from "lucide-react";
import { cn } from "@/lib/utils";
import ScoreRing from "@/components/writer/ScoreRing";

type AdminTab = "blogs" | "contests" | "featured" | "scoring";

interface AdminBlog {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  author: { name: string; email: string };
  _count: { comments: number; reports: number };
}

interface ContestSubmissionAdmin {
  id: string;
  aiScoreSnapshot: number;
  finalScore: number;
  adminOverrideScore?: number | null;
  ranking?: number | null;
  winnerPosition?: number | null;
  awardedPrize?: string | null;
  author: { id: string; name: string };
  blog: { id: string; title: string; slug: string; status: string };
}

interface ContestAdmin {
  id: string;
  title: string;
  description: string;
  prize?: string | null;
  shortBlogMaxWords: number;
  status: string;
  startDate: string;
  endDate: string;
  announcementTitle?: string | null;
  announcementBody?: string | null;
  announcementPublishedAt?: string | null;
  submissions: ContestSubmissionAdmin[];
}

const DEMO_SCORED_BLOGS = [
  { id: "1", title: "Why Bumrah's Yorker is Literally Unplayable", author: "CricAnalyst Pro", bqs: 88, toxicity: 3, archetype: "analyst", status: "completed" },
  { id: "2", title: "IPL 2026 Auction Analysis", author: "TheCricStoryteller", bqs: 76, toxicity: 5, archetype: "storyteller", status: "completed" },
  { id: "3", title: "Kohli vs Root: The Definitive Comparison", author: "CricAnalyst Pro", bqs: 92, toxicity: 2, archetype: "debater", status: "completed" },
  { id: "4", title: "Spin Bowling in T20s: A Statistical Analysis", author: "SpinWizard", bqs: 72, toxicity: 8, archetype: "reporter", status: "completed" },
  { id: "5", title: "Why Indian Cricket is Going Downhill", author: "AngryFan99", bqs: 34, toxicity: 62, archetype: "critic", status: "flagged" },
];

const PIPELINE_MODELS = [
  { name: "Qwen 3.5 Unified Judge", host: "Ollama", status: "online", latency: "1.2s" },
  { name: "Contest Ranking Engine", host: "App Server", status: "online", latency: "45ms" },
  { name: "Calibration Runner", host: "App Server", status: "online", latency: "3.8s" },
];

export default function AdminPage() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<AdminTab>("blogs");
  const [blogs, setBlogs] = useState<AdminBlog[]>([]);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [authState, setAuthState] = useState<"loading" | "admin" | "user" | "guest">("loading");
  const [contests, setContests] = useState<ContestAdmin[]>([]);
  const [contestLoading, setContestLoading] = useState(false);
  const [contestForm, setContestForm] = useState({
    title: "",
    description: "",
    prize: "",
    shortBlogMaxWords: 250,
    startDate: "",
    endDate: "",
  });
  const [contestMessage, setContestMessage] = useState("");
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, string>>({});
  const [announcementDrafts, setAnnouncementDrafts] = useState<Record<string, { title: string; body: string }>>({});

  useEffect(() => {
    if (status === "loading") {
      setAuthState("loading");
      return;
    }

    if (!session?.user) {
      setAuthState("guest");
      return;
    }

    setAuthState((session.user as { role?: string }).role === "admin" ? "admin" : "user");
  }, [session, status]);

  const fetchBlogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/blogs?status=${statusFilter}`);
      const data = await res.json();
      setBlogs(data.blogs || []);
    } catch {
      setBlogs([
        { id: "1", title: "Why India Will Win the World Cup 2026", status: "pending", createdAt: new Date().toISOString(), author: { name: "CricketFan99", email: "fan@example.com" }, _count: { comments: 0, reports: 0 } },
        { id: "2", title: "IPL Auction Strategy Deep Dive", status: "pending", createdAt: new Date().toISOString(), author: { name: "AnalystPro", email: "analyst@example.com" }, _count: { comments: 0, reports: 1 } },
      ]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (authState !== "admin") {
      return;
    }
    void fetchBlogs();
  }, [statusFilter, authState, fetchBlogs]);

  const fetchContests = useCallback(async () => {
    setContestLoading(true);
    try {
      const res = await fetch("/api/admin/contests");
      const data = await res.json();
      setContests(data.contests || []);
    } catch {
      setContests([]);
    } finally {
      setContestLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authState === "admin" && activeTab === "contests") {
      void fetchContests();
    }
  }, [activeTab, authState, fetchContests]);

  const updateBlogStatus = async (blogId: string, status: string) => {
    try {
      await fetch("/api/admin/blogs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blogId, status }),
      });
      setBlogs((prev) => prev.map((b) => (b.id === blogId ? { ...b, status } : b)));
    } catch {
      console.error("Failed to update blog");
    }
  };

  const createContest = async () => {
    setContestMessage("");
    try {
      const res = await fetch("/api/admin/contests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...contestForm,
          shortBlogMaxWords: Number(contestForm.shortBlogMaxWords),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setContestMessage(data.error || "Could not create contest.");
        return;
      }
      setContestForm({
        title: "",
        description: "",
        prize: "",
        shortBlogMaxWords: 250,
        startDate: "",
        endDate: "",
      });
      setContestMessage("Contest created.");
      await fetchContests();
    } catch {
      setContestMessage("Could not create contest.");
    }
  };

  const refreshStandings = async (contestId: string) => {
    await fetch("/api/admin/contests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh-standings", contestId }),
    });
    await fetchContests();
  };

  const saveOverride = async (submissionId: string, contestId: string) => {
    const value = Number(overrideDrafts[submissionId]);
    if (Number.isNaN(value)) return;

    await fetch("/api/admin/contests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "override-score",
        submissionId,
        adminOverrideScore: value,
      }),
    });
    await fetchContests();
  };

  const publishAnnouncement = async (contestId: string) => {
    const draft = announcementDrafts[contestId];
    if (!draft?.title || !draft?.body) return;

    await fetch("/api/admin/contests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "publish-announcement",
        contestId,
        announcementTitle: draft.title,
        announcementBody: draft.body,
      }),
    });
    await fetchContests();
  };

  const tabs = [
    { id: "blogs" as const, label: "Blog Moderation", icon: FileText },
    { id: "scoring" as const, label: "AI Scoring", icon: Brain },
    { id: "contests" as const, label: "Contests", icon: Trophy },
    { id: "featured" as const, label: "Featured Content", icon: Star },
  ];

  if (authState === "loading") {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
        <div className="bg-cg-dark-2 border border-gray-800 rounded-2xl p-8 text-center">
          <p className="text-white font-semibold">Checking admin access...</p>
        </div>
      </div>
    );
  }

  if (authState === "guest") {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
        <div className="bg-cg-dark-2 border border-gray-800 rounded-2xl p-8 text-center">
          <Shield className="text-cg-green mx-auto mb-4" size={32} />
          <h1 className="text-2xl font-black text-white mb-2">Admin Sign-In Required</h1>
          <p className="text-gray-400 mb-6">Only administrators can access this dashboard.</p>
          <a
            href="/auth/login?next=/admin"
            className="inline-flex items-center justify-center rounded-xl bg-cg-green px-5 py-3 text-sm font-bold text-black hover:bg-cg-green-dark transition-all"
          >
            Sign In
          </a>
        </div>
      </div>
    );
  }

  if (authState === "user") {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
        <div className="bg-cg-dark-2 border border-red-500/20 rounded-2xl p-8 text-center">
          <Shield className="text-red-400 mx-auto mb-4" size={32} />
          <h1 className="text-2xl font-black text-white mb-2">Access Restricted</h1>
          <p className="text-gray-400">This view is only available to admin accounts.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-black text-white flex items-center gap-3 mb-2">
        <Shield className="text-cg-green" />
        Admin Panel
      </h1>
      <p className="text-gray-400 text-sm mb-8">
        Manage blogs, AI scoring pipeline, contests, and featured content
      </p>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-cg-dark-2 border border-gray-800 rounded-xl p-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex items-center gap-2",
              activeTab === tab.id
                ? "bg-cg-green text-black"
                : "text-gray-400 hover:text-white hover:bg-gray-800"
            )}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Blog Moderation */}
      {activeTab === "blogs" && (
        <div>
          <div className="flex gap-2 mb-4 overflow-x-auto">
            {["pending", "approved", "rejected", "featured", "all"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all",
                  statusFilter === s ? "bg-cg-green text-black" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                )}
              >
                {s}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-cg-dark-2 border border-gray-800 rounded-xl p-4 animate-pulse">
                  <div className="h-4 bg-gray-800 rounded w-2/3 mb-2" />
                  <div className="h-3 bg-gray-800 rounded w-1/3" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {blogs.map((blog) => (
                <div key={blog.id} className="bg-cg-dark-2 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-white font-medium truncate">{blog.title}</h3>
                      <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-500">
                        <span>by {blog.author.name}</span>
                        <span>{new Date(blog.createdAt).toLocaleDateString()}</span>
                        <span className={cn(
                          "px-2 py-0.5 rounded-full font-medium capitalize",
                          blog.status === "approved" ? "bg-green-500/10 text-green-400" :
                          blog.status === "rejected" ? "bg-red-500/10 text-red-400" :
                          blog.status === "featured" ? "bg-amber-500/10 text-amber-400" :
                          "bg-yellow-500/10 text-yellow-400"
                        )}>
                          {blog.status}
                        </span>
                        {blog._count.reports > 0 && (
                          <span className="flex items-center gap-1 text-red-400">
                            <AlertTriangle size={12} /> {blog._count.reports} reports
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {blog.status !== "approved" && (
                        <button onClick={() => updateBlogStatus(blog.id, "approved")} className="p-2 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-all" title="Approve">
                          <Check size={16} />
                        </button>
                      )}
                      {blog.status !== "rejected" && (
                        <button onClick={() => updateBlogStatus(blog.id, "rejected")} className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all" title="Reject">
                          <X size={16} />
                        </button>
                      )}
                      {blog.status === "approved" && (
                        <button onClick={() => updateBlogStatus(blog.id, "featured")} className="p-2 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-all" title="Feature">
                          <Star size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {blogs.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-8">No blogs in this category</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* AI Scoring Dashboard */}
      {activeTab === "scoring" && (
        <div className="space-y-6">
          {/* Pipeline Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity size={16} className="text-cg-green" />
                <span className="text-xs text-gray-500">Pipeline Status</span>
              </div>
              <p className="text-2xl font-black text-cg-green">Online</p>
              <p className="text-[10px] text-gray-500 mt-1">All 6 models running</p>
              <p className="text-[10px] text-gray-500 mt-1">Qwen 3.5 drives unified scoring + moderation</p>
            </div>
            <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 size={16} className="text-blue-400" />
                <span className="text-xs text-gray-500">Avg EQS</span>
              </div>
              <p className="text-2xl font-black text-white">72.4</p>
              <p className="text-[10px] text-cg-green mt-1">↑ 3.2 from last week</p>
            </div>
            <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap size={16} className="text-yellow-400" />
                <span className="text-xs text-gray-500">Expressions Scored</span>
              </div>
              <p className="text-2xl font-black text-white">47</p>
              <p className="text-[10px] text-gray-500 mt-1">This week</p>
            </div>
            <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={16} className="text-red-400" />
                <span className="text-xs text-gray-500">Flagged</span>
              </div>
              <p className="text-2xl font-black text-red-400">1</p>
              <p className="text-[10px] text-gray-500 mt-1">High toxicity detected</p>
            </div>
          </div>

          {/* Model Health */}
          <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Brain size={16} className="text-cg-green" />
              Model Health
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {PIPELINE_MODELS.map((model) => (
                <div key={model.name} className="flex items-center gap-3 bg-cg-dark-3/50 rounded-lg p-3">
                  <div className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    model.status === "online" ? "bg-cg-green pulse-green" : "bg-red-500"
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">{model.name}</p>
                    <p className="text-[10px] text-gray-500">{model.host}</p>
                  </div>
                  <span className="text-[10px] text-gray-400 font-mono">{model.latency}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recently Scored Blogs */}
          <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <TrendingUp size={16} className="text-cg-green" />
              Recent Scores
            </h3>
            <div className="space-y-2">
              {DEMO_SCORED_BLOGS.map((blog) => (
                <div
                  key={blog.id}
                  className={cn(
                    "flex items-center gap-4 p-3 rounded-lg",
                    blog.status === "flagged" ? "bg-red-500/5 border border-red-500/20" : "bg-cg-dark-3/30"
                  )}
                >
                  <ScoreRing score={blog.bqs} size={44} strokeWidth={3} showLabel={false} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{blog.title}</p>
                    <div className="flex items-center gap-3 text-[10px] text-gray-500 mt-0.5">
                      <span>{blog.author}</span>
                      <span className="capitalize bg-gray-800 px-1.5 py-0.5 rounded">{blog.archetype}</span>
                      {blog.toxicity > 50 && (
                        <span className="text-red-400 flex items-center gap-1">
                          <AlertTriangle size={10} /> Toxicity: {blog.toxicity}%
                        </span>
                      )}
                    </div>
                  </div>
                  {blog.status === "flagged" && (
                    <span className="bg-red-500/10 text-red-400 text-[10px] font-bold px-2 py-1 rounded-full">
                      FLAGGED
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Contests */}
      {activeTab === "contests" && (
        <div className="space-y-6">
          <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Plus size={16} className="text-cg-green" />
              <h3 className="text-sm font-bold text-white">Create Short Blog Contest</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                value={contestForm.title}
                onChange={(event) => setContestForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Contest title"
                className="rounded-lg border border-gray-800 bg-cg-dark px-3 py-2 text-sm text-white"
              />
              <input
                value={contestForm.prize}
                onChange={(event) => setContestForm((prev) => ({ ...prev, prize: event.target.value }))}
                placeholder="Prize"
                className="rounded-lg border border-gray-800 bg-cg-dark px-3 py-2 text-sm text-white"
              />
              <input
                type="datetime-local"
                value={contestForm.startDate}
                onChange={(event) => setContestForm((prev) => ({ ...prev, startDate: event.target.value }))}
                className="rounded-lg border border-gray-800 bg-cg-dark px-3 py-2 text-sm text-white"
              />
              <input
                type="datetime-local"
                value={contestForm.endDate}
                onChange={(event) => setContestForm((prev) => ({ ...prev, endDate: event.target.value }))}
                className="rounded-lg border border-gray-800 bg-cg-dark px-3 py-2 text-sm text-white"
              />
              <input
                type="number"
                value={contestForm.shortBlogMaxWords}
                onChange={(event) => setContestForm((prev) => ({ ...prev, shortBlogMaxWords: Number(event.target.value) }))}
                placeholder="Word cap"
                className="rounded-lg border border-gray-800 bg-cg-dark px-3 py-2 text-sm text-white"
              />
            </div>
            <textarea
              value={contestForm.description}
              onChange={(event) => setContestForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Contest description"
              className="mt-3 min-h-28 w-full rounded-lg border border-gray-800 bg-cg-dark px-3 py-2 text-sm text-white"
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={createContest}
                className="rounded-lg bg-cg-green px-4 py-2 text-sm font-bold text-black hover:bg-cg-green-dark"
              >
                Create Contest
              </button>
              {contestMessage && <p className="text-xs text-gray-400">{contestMessage}</p>}
            </div>
          </div>

          <div className="space-y-4">
            {contestLoading ? (
              <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-8 text-center text-gray-400">
                Loading contests...
              </div>
            ) : contests.length === 0 ? (
              <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-8 text-center">
                <Trophy size={48} className="text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400">No contests yet. Create one to open short-blog submissions.</p>
              </div>
            ) : (
              contests.map((contest) => (
                <div key={contest.id} className="bg-cg-dark-2 border border-gray-800 rounded-xl p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold text-white">{contest.title}</h3>
                      <p className="mt-1 text-sm text-gray-400">{contest.description}</p>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                        <span className="capitalize rounded-full bg-white/5 px-2 py-1 text-white">{contest.status}</span>
                        <span>Prize: {contest.prize || "TBD"}</span>
                        <span>Word cap: {contest.shortBlogMaxWords}</span>
                        <span>{new Date(contest.startDate).toLocaleString()} → {new Date(contest.endDate).toLocaleString()}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => refreshStandings(contest.id)}
                      className="rounded-lg border border-gray-700 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10"
                    >
                      Refresh Top 3
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    {[1, 2, 3].map((position) => {
                      const winner = contest.submissions.find((submission) => submission.winnerPosition === position);
                      return (
                        <div key={position} className="rounded-lg border border-gray-800 bg-cg-dark p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Winner #{position}</p>
                          {winner ? (
                            <div className="mt-2 space-y-1">
                              <p className="text-sm font-semibold text-white">{winner.blog.title}</p>
                              <p className="text-xs text-gray-400">{winner.author.name}</p>
                              <p className="text-xs text-cg-green">Final score {winner.finalScore.toFixed(1)}</p>
                            </div>
                          ) : (
                            <p className="mt-2 text-xs text-gray-500">No winner selected yet.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                          <th className="py-2 pr-4">Rank</th>
                          <th className="py-2 pr-4">Blog</th>
                          <th className="py-2 pr-4">Writer</th>
                          <th className="py-2 pr-4">AI</th>
                          <th className="py-2 pr-4">Final</th>
                          <th className="py-2 pr-4">Override</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contest.submissions.map((submission) => (
                          <tr key={submission.id} className="border-t border-gray-800">
                            <td className="py-3 pr-4 text-white">{submission.ranking ?? "-"}</td>
                            <td className="py-3 pr-4">
                              <Link href={`/blog/${submission.blog.slug}`} className="text-white hover:text-cg-green">
                                {submission.blog.title}
                              </Link>
                            </td>
                            <td className="py-3 pr-4 text-gray-400">{submission.author.name}</td>
                            <td className="py-3 pr-4 text-gray-300">{submission.aiScoreSnapshot.toFixed(1)}</td>
                            <td className="py-3 pr-4 text-cg-green">{submission.finalScore.toFixed(1)}</td>
                            <td className="py-3 pr-4">
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={0.1}
                                  value={overrideDrafts[submission.id] ?? submission.adminOverrideScore ?? ""}
                                  onChange={(event) => setOverrideDrafts((prev) => ({ ...prev, [submission.id]: event.target.value }))}
                                  className="w-24 rounded-lg border border-gray-800 bg-cg-dark px-2 py-1 text-xs text-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => saveOverride(submission.id, contest.id)}
                                  className="rounded-lg bg-white/5 px-2 py-1 text-xs font-semibold text-white hover:bg-white/10"
                                >
                                  Save
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-cg-dark p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Prize Announcement</p>
                    <input
                      value={announcementDrafts[contest.id]?.title ?? contest.announcementTitle ?? ""}
                      onChange={(event) =>
                        setAnnouncementDrafts((prev) => ({
                          ...prev,
                          [contest.id]: {
                            title: event.target.value,
                            body: prev[contest.id]?.body ?? contest.announcementBody ?? "",
                          },
                        }))
                      }
                      placeholder="Announcement title"
                      className="mt-3 w-full rounded-lg border border-gray-800 bg-cg-dark-2 px-3 py-2 text-sm text-white"
                    />
                    <textarea
                      value={announcementDrafts[contest.id]?.body ?? contest.announcementBody ?? ""}
                      onChange={(event) =>
                        setAnnouncementDrafts((prev) => ({
                          ...prev,
                          [contest.id]: {
                            title: prev[contest.id]?.title ?? contest.announcementTitle ?? "",
                            body: event.target.value,
                          },
                        }))
                      }
                      placeholder="Winner announcement copy"
                      className="mt-3 min-h-24 w-full rounded-lg border border-gray-800 bg-cg-dark-2 px-3 py-2 text-sm text-white"
                    />
                    <button
                      type="button"
                      onClick={() => publishAnnouncement(contest.id)}
                      className="mt-3 rounded-lg bg-cg-green px-3 py-2 text-xs font-bold text-black hover:bg-cg-green-dark"
                    >
                      Publish Announcement
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Featured Content */}
      {activeTab === "featured" && (
        <div>
          <button className="bg-cg-green text-black px-4 py-2 rounded-lg font-bold text-sm hover:bg-cg-green-dark transition-all flex items-center gap-2 mb-6">
            <Plus size={16} />
            Add Featured Content
          </button>
          <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-8 text-center">
            <Star size={48} className="text-gray-700 mx-auto mb-4" />
            <p className="text-gray-400">
              Select and manage featured matches, blogs, and analysis that appear on the homepage.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
