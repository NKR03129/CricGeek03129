"use client";

import { useState } from "react";
import Link from "next/link";
import { Trophy, Medal, TrendingUp, Star, Award, Crown, Flame, Target, Users } from "lucide-react";
import WriterProfileCard from "@/components/writer/WriterProfileCard";
import ScoreRing from "@/components/writer/ScoreRing";
import { BADGE_DEFINITIONS, ACHIEVEMENT_DEFINITIONS } from "@/lib/scoring";
import { cn } from "@/lib/utils";

type LeaderboardTab = "rankings" | "badges" | "achievements";

// Demo data — replaced by API when DB has real data
const DEMO_WRITERS = [
  { id: "1", name: "CricAnalyst Pro", avatar: null, archetype: "analyst", level: 8, xp: 780, averageBQS: 88.5, totalBlogs: 34, totalViews: 12400, streak: 6 },
  { id: "2", name: "TheCricStoryteller", avatar: null, archetype: "storyteller", level: 6, xp: 590, averageBQS: 82.3, totalBlogs: 22, totalViews: 8900, streak: 4 },
  { id: "3", name: "PaceAttack99", avatar: null, archetype: "debater", level: 5, xp: 480, averageBQS: 79.1, totalBlogs: 18, totalViews: 6200, streak: 2 },
  { id: "4", name: "SpinWizard", avatar: null, archetype: "reporter", level: 4, xp: 350, averageBQS: 76.8, totalBlogs: 15, totalViews: 5100, streak: 3 },
  { id: "5", name: "CricGeek Writer", avatar: null, archetype: "analyst", level: 5, xp: 480, averageBQS: 74.5, totalBlogs: 12, totalViews: 3420, streak: 3 },
  { id: "6", name: "BoundaryKing", avatar: null, archetype: "critic", level: 3, xp: 270, averageBQS: 71.2, totalBlogs: 10, totalViews: 2800, streak: 1 },
  { id: "7", name: "TestMatchFan", avatar: null, archetype: "storyteller", level: 3, xp: 220, averageBQS: 68.9, totalBlogs: 8, totalViews: 2100, streak: 0 },
  { id: "8", name: "IPLInsider", avatar: null, archetype: "reporter", level: 2, xp: 180, averageBQS: 65.4, totalBlogs: 6, totalViews: 1500, streak: 1 },
];

const DEMO_TOP_BLOG = {
  title: "Why Bumrah's Yorker is Literally Unplayable — A Data Analysis",
  slug: "bumrah-yorker-analysis",
  author: "CricAnalyst Pro",
  bqs: 94,
};

const RANK_ICONS = [
  <Crown key={0} size={20} className="text-yellow-400" />,
  <Medal key={1} size={20} className="text-gray-300" />,
  <Medal key={2} size={20} className="text-amber-600" />,
];

export default function LeaderboardPage() {
  const [activeTab, setActiveTab] = useState<LeaderboardTab>("rankings");
  const [sortBy, setSortBy] = useState<"bqs" | "blogs" | "views">("bqs");

  const sortedWriters = [...DEMO_WRITERS].sort((a, b) => {
    if (sortBy === "bqs") return b.averageBQS - a.averageBQS;
    if (sortBy === "blogs") return b.totalBlogs - a.totalBlogs;
    return b.totalViews - a.totalViews;
  });

  const tabs = [
    { id: "rankings" as const, label: "Rankings", icon: Trophy },
    { id: "badges" as const, label: "Badges", icon: Award },
    { id: "achievements" as const, label: "Achievements", icon: Star },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-black text-white flex items-center justify-center gap-3">
          <Trophy className="text-cg-green" />
          Leaderboard
        </h1>
        <p className="text-gray-400 text-sm mt-2">
          Top cricket writers ranked by AI-powered Expression Quality Score
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-cg-dark-2 border border-gray-800 rounded-xl p-1 overflow-x-auto max-w-lg mx-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex items-center justify-center gap-2",
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

      {/* Rankings Tab */}
      {activeTab === "rankings" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Rankings */}
          <div className="lg:col-span-2">
            {/* Sort controls */}
            <div className="flex gap-2 mb-4">
              {[
                { key: "bqs" as const, label: "EQS Score", icon: Target },
                { key: "blogs" as const, label: "Expression Count", icon: Users },
                { key: "views" as const, label: "Total Views", icon: TrendingUp },
              ].map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSortBy(s.key)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5",
                    sortBy === s.key
                      ? "bg-cg-green text-black"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  )}
                >
                  <s.icon size={12} />
                  {s.label}
                </button>
              ))}
            </div>

            {/* Top 3 Podium */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {sortedWriters.slice(0, 3).map((writer, i) => (
                <Link key={writer.id} href={`/writer/${writer.id}`} className="block group">
                  <div className={cn(
                    "bg-cg-dark-2 border rounded-xl p-4 text-center transition-all hover:border-cg-green/30",
                    i === 0 ? "border-yellow-500/30 bg-gradient-to-b from-yellow-500/5 to-transparent" :
                    i === 1 ? "border-gray-400/20" : "border-amber-700/20"
                  )}>
                    <div className="flex justify-center mb-2">{RANK_ICONS[i]}</div>
                    <div className="w-12 h-12 rounded-full bg-cg-dark-3 flex items-center justify-center text-lg font-bold text-cg-green border border-gray-700 mx-auto mb-2">
                      {writer.name.charAt(0)}
                    </div>
                    <h3 className="text-sm font-bold text-white truncate group-hover:text-cg-green transition-colors">
                      {writer.name}
                    </h3>
                    <div className="mt-2">
                      <ScoreRing score={writer.averageBQS} size={56} strokeWidth={4} showLabel={false} />
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">{writer.totalBlogs} expressions · {writer.totalViews.toLocaleString()} views</p>
                  </div>
                </Link>
              ))}
            </div>

            {/* Rest of rankings */}
            <div className="space-y-2">
              {sortedWriters.slice(3).map((writer, i) => (
                <div key={writer.id} className="flex items-center gap-3 bg-cg-dark-2 border border-gray-800 rounded-xl p-3 hover:border-cg-green/20 transition-all">
                  <span className="text-gray-600 font-bold text-sm w-6 text-center">{i + 4}</span>
                  <WriterProfileCard
                    id={writer.id}
                    name={writer.name}
                    avatar={writer.avatar}
                    archetype={writer.archetype}
                    level={writer.level}
                    xp={writer.xp}
                    averageBQS={writer.averageBQS}
                    totalBlogs={writer.totalBlogs}
                    compact
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Expression of the Week */}
            <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-5">
              <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <Flame size={16} className="text-orange-400" />
                Expression of the Week
              </h3>
              <Link href={`/blog/${DEMO_TOP_BLOG.slug}`} className="block group">
                <div className="bg-gradient-to-br from-cg-green/5 to-transparent border border-cg-green/20 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <ScoreRing score={DEMO_TOP_BLOG.bqs} size={40} strokeWidth={3} showLabel={false} />
                    <span className="text-cg-green text-xs font-bold">EQS {DEMO_TOP_BLOG.bqs}</span>
                  </div>
                  <h4 className="text-sm font-medium text-white group-hover:text-cg-green transition-colors leading-snug">
                    {DEMO_TOP_BLOG.title}
                  </h4>
                  <p className="text-[10px] text-gray-500 mt-1">by {DEMO_TOP_BLOG.author}</p>
                </div>
              </Link>
            </div>

            {/* Rising Stars */}
            <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-5">
              <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <Star size={16} className="text-yellow-400" />
                Rising Stars
              </h3>
              <div className="space-y-3">
                {DEMO_WRITERS.slice(5, 8).map((writer) => (
                  <WriterProfileCard
                    key={writer.id}
                    id={writer.id}
                    name={writer.name}
                    avatar={writer.avatar}
                    archetype={writer.archetype}
                    level={writer.level}
                    xp={writer.xp}
                    averageBQS={writer.averageBQS}
                    totalBlogs={writer.totalBlogs}
                    compact
                  />
                ))}
              </div>
            </div>

            {/* Hot Streaks */}
            <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-5">
              <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                🔥 Hot Streaks
              </h3>
              <div className="space-y-2">
                {DEMO_WRITERS.filter(w => w.streak > 0).sort((a, b) => b.streak - a.streak).slice(0, 5).map((writer) => (
                  <Link key={writer.id} href={`/writer/${writer.id}`} className="flex items-center justify-between text-sm group">
                    <span className="text-gray-300 group-hover:text-cg-green transition-colors truncate">{writer.name}</span>
                    <span className="text-orange-400 font-bold text-xs shrink-0">
                      🔥 {writer.streak}w
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Badges Tab */}
      {activeTab === "badges" && (
        <div>
          <p className="text-gray-400 text-sm mb-6 text-center">
            Earn badges by hitting milestones and maintaining quality expression
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {BADGE_DEFINITIONS.map((badge) => (
              <div
                key={badge.id}
                className="bg-cg-dark-2 border border-gray-800 rounded-xl p-5 hover:border-cg-green/20 transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className={cn(
                    "w-14 h-14 rounded-xl flex items-center justify-center text-2xl shrink-0 border",
                    badge.tier === "gold" ? "bg-yellow-500/10 border-yellow-500/30" :
                    badge.tier === "silver" ? "bg-gray-400/10 border-gray-400/30" :
                    badge.tier === "platinum" ? "bg-indigo-400/10 border-indigo-400/30" :
                    "bg-amber-700/10 border-amber-700/30"
                  )}>
                    {badge.icon}
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-sm">{badge.title}</h3>
                    <p className="text-gray-400 text-xs mt-0.5">{badge.description}</p>
                    <span className={cn(
                      "inline-block text-[10px] font-bold mt-2 px-2 py-0.5 rounded-full capitalize",
                      badge.tier === "gold" ? "bg-yellow-500/10 text-yellow-400" :
                      badge.tier === "silver" ? "bg-gray-400/10 text-gray-300" :
                      badge.tier === "platinum" ? "bg-indigo-400/10 text-indigo-300" :
                      "bg-amber-700/10 text-amber-400"
                    )}>
                      {badge.tier}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Achievements Tab */}
      {activeTab === "achievements" && (
        <div>
          <p className="text-gray-400 text-sm mb-6 text-center">
            Progress through milestone achievements as you grow your cricket writing career
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl mx-auto">
            {ACHIEVEMENT_DEFINITIONS.map((ach, i) => (
              <div
                key={ach.id}
                className="bg-cg-dark-2 border border-gray-800 rounded-xl p-4 flex items-center gap-4 hover:border-cg-green/20 transition-all"
              >
                <div className="w-10 h-10 rounded-full bg-cg-green/10 flex items-center justify-center text-cg-green font-bold text-sm shrink-0">
                  {i + 1}
                </div>
                <div>
                  <h3 className="text-white font-bold text-sm">{ach.title}</h3>
                  <p className="text-gray-500 text-xs">{ach.description}</p>
                </div>
                <div className="ml-auto shrink-0">
                  <span className="text-gray-600 text-xs font-mono">{ach.milestone}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
