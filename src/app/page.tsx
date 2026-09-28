import Link from "next/link";
import { Zap, Calendar, PenSquare, TrendingUp, ArrowRight, Trophy, BrainCircuit } from "lucide-react";
import LiveMatchCard from "@/components/matches/LiveMatchCard";
import AdSlot from "@/components/ads/AdSlot";
import { getMatchHubMatches } from "@/lib/cricket-api";

export const revalidate = 30;

export default async function HomePage() {
  const matches = await getMatchHubMatches();
  const liveMatches = matches.filter((m) => m.matchStarted && !m.matchEnded);
  const recentMatches = matches.filter((m) => m.matchEnded).slice(0, 2);
  const upcomingMatches = matches.filter((m) => !m.matchStarted).slice(0, 2);

  return (
    <div>
      {/* Hero */}
      <section className="relative bg-gradient-to-b from-cg-dark via-green-950/30 to-cg-dark overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(34,197,94,0.08),transparent_50%)]" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 relative">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 mb-4">
              <span className="bg-cg-green/10 text-cg-green text-xs font-bold px-3 py-1 rounded-full border border-cg-green/20">
                🏏 LIVE NOW
              </span>
              {liveMatches.length > 0 && (
                <span className="text-gray-400 text-xs">
                  {liveMatches.length} match{liveMatches.length > 1 ? "es" : ""} in progress
                </span>
              )}
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white leading-tight">
              Cricket.{" "}
              <span className="text-cg-green">Live.</span>
              <br />
              Analysed. Discussed.
            </h1>
            <p className="text-gray-400 text-lg mt-4 max-w-xl">
              Real-time scores, expert analysis, and community-driven discussion.
              Your ultimate cricket companion for World Cup, IPL, and every international match.
            </p>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link
                href="/matches"
                className="bg-cg-green text-black px-6 py-3 rounded-xl font-bold text-sm hover:bg-cg-green-dark transition-all inline-flex items-center gap-2"
              >
                <Zap size={18} />
                Live Scores
                <ArrowRight size={16} />
              </Link>
              <Link
                href="/calendar"
                className="bg-white/5 text-white px-6 py-3 rounded-xl font-medium text-sm hover:bg-white/10 transition-all border border-gray-700 inline-flex items-center gap-2"
              >
                <Calendar size={18} />
                Match Calendar
              </Link>
              <Link
                href="/blog"
                className="bg-white/5 text-white px-6 py-3 rounded-xl font-medium text-sm hover:bg-white/10 transition-all border border-gray-700 inline-flex items-center gap-2"
              >
                <PenSquare size={18} />
                Express Yourself
              </Link>
              <Link
                href="/insights"
                className="bg-white/5 text-white px-6 py-3 rounded-xl font-medium text-sm hover:bg-white/10 transition-all border border-gray-700 inline-flex items-center gap-2"
              >
                <BrainCircuit size={18} />
                AI Insights
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Live Matches */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Zap size={20} className="text-cg-green" />
            <h2 className="text-xl font-bold text-white">Live Matches</h2>
            {liveMatches.length > 0 && (
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            )}
          </div>
          <Link
            href="/matches"
            className="text-cg-green text-sm font-medium hover:underline flex items-center gap-1"
          >
            View All <ArrowRight size={14} />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(liveMatches.length > 0 ? liveMatches : matches.slice(0, 3)).map(
            (match) => (
              <LiveMatchCard key={match.id} match={match} />
            )
          )}
        </div>
      </section>

      {/* Ad placement */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <AdSlot slot="home-top" format="horizontal" className="max-w-3xl mx-auto" />
      </div>

      {/* Recent & Upcoming */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Trophy size={18} className="text-cg-green" />
              <h2 className="text-lg font-bold text-white">Recent Results</h2>
            </div>
            <div className="space-y-3">
              {recentMatches.map((match) => (
                <LiveMatchCard key={match.id} match={match} />
              ))}
              {recentMatches.length === 0 && (
                <p className="text-gray-500 text-sm">No recent results</p>
              )}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Calendar size={18} className="text-cg-green" />
              <h2 className="text-lg font-bold text-white">Upcoming</h2>
            </div>
            <div className="space-y-3">
              {upcomingMatches.map((match) => (
                <LiveMatchCard key={match.id} match={match} />
              ))}
              {upcomingMatches.length === 0 && (
                <p className="text-gray-500 text-sm">No upcoming matches</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="text-2xl font-bold text-white text-center mb-8">
          Everything Cricket. One Platform.
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: Zap, title: "Live Scores", desc: "Ball-by-ball updates with full scorecards and commentary" },
            { icon: TrendingUp, title: "Expert Analysis", desc: "Pre-match and post-match analysis from cricket experts" },
            { icon: PenSquare, title: "Community Expressions", desc: "Share your cricket views and engage with fellow fans" },
            { icon: Calendar, title: "Match Calendar", desc: "Never miss a match with our complete cricket calendar" },
            { icon: BrainCircuit, title: "AI Insights", desc: "Integrated T20 decision support, evaluation, and player explorer tools" },
          ].map((feature) => (
            <div key={feature.title} className="bg-cg-dark-2 border border-gray-800 rounded-xl p-5 hover:border-cg-green/30 transition-all">
              <feature.icon size={24} className="text-cg-green mb-3" />
              <h3 className="text-white font-semibold mb-1">{feature.title}</h3>
              <p className="text-gray-400 text-sm">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom Ad */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <AdSlot slot="home-bottom" format="horizontal" className="max-w-3xl mx-auto" />
      </div>
    </div>
  );
}
