import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Mic, PenSquare, Radio } from "lucide-react";
import EdaCards from "@/components/matches/EdaCards";
import EdaAskPanel from "@/components/matches/EdaAskPanel";
import { getMatchInfo, getMatchSquad } from "@/lib/cricket-api";
import { buildPreMatchEdaReport } from "@/lib/eda/pre-match";
import { getMatchCoverage } from "@/lib/match-coverage";

type PageProps = {
  params: Promise<{ id: string }>;
};

export const runtime = "nodejs";
export const revalidate = 60;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const match = await getMatchInfo(id);
  return {
    title: match ? `${match.name} Preview | CricGeek` : "Match Preview | CricGeek",
    description: match ? `Preview, talking points, and linked coverage for ${match.name}` : "Cricket match preview and tactical briefing",
  };
}

export default async function MatchPreviewPage({ params }: PageProps) {
  const { id } = await params;
  const [match, squads, coverage] = await Promise.all([
    getMatchInfo(id),
    getMatchSquad(id),
    getMatchCoverage(id, true),
  ]);

  if (!match) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-black text-white">Preview unavailable</h1>
        <p className="mt-2 text-sm text-gray-400">We could not load the match preview for this fixture.</p>
      </div>
    );
  }

  const report = await buildPreMatchEdaReport(match, squads);
  const { commentarySession, blogs, coverageAvailable } = coverage;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <Link href={`/matches/${match.id}`} className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
        <ArrowLeft size={14} />
        Back to Match Centre
      </Link>

      <div className="rounded-2xl border border-cg-green/20 bg-gradient-to-br from-cg-green/10 via-cg-dark-2 to-cg-dark p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cg-green">Match Preview</p>
        <h1 className="mt-3 text-3xl font-black text-white">{match.name} intelligence preview</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-gray-300">{report.summary}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={`/matches/${match.id}`} className="rounded-lg bg-white/5 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10">
            Match Centre
          </Link>
          <Link href={`/matches/${match.id}?tab=squads`} className="rounded-lg bg-white/5 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10">
            View Squads
          </Link>
          {commentarySession ? (
            <Link
              href={`/commentary/${commentarySession.id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-cg-green/10 px-3 py-2 text-sm font-semibold text-cg-green hover:bg-cg-green/20"
            >
              <Radio size={14} />
              {commentarySession.status === "scheduled" ? "Scheduled Commentary" : "Live Commentary"}
            </Link>
          ) : (
            <Link
              href={`/commentary?matchId=${encodeURIComponent(match.id)}&matchName=${encodeURIComponent(match.name)}&matchType=${encodeURIComponent(match.matchType)}&status=scheduled`}
              className="inline-flex items-center gap-2 rounded-lg bg-cg-green/10 px-3 py-2 text-sm font-semibold text-cg-green hover:bg-cg-green/20"
            >
              <Mic size={14} />
              Schedule Commentary
            </Link>
          )}
          <Link
            href={`/blog/write?matchId=${encodeURIComponent(match.id)}&matchName=${encodeURIComponent(match.name)}`}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-2 text-sm font-semibold text-blue-300 hover:bg-blue-500/20"
          >
            <PenSquare size={14} />
            Write Match Blog
          </Link>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-xs text-gray-400">
          <span className="rounded-full bg-white/5 px-3 py-1.5">
            Confidence {Math.round(report.confidence.score)}% · {report.confidence.label}
          </span>
          <span className="rounded-full bg-white/5 px-3 py-1.5">
            Generated {new Date(report.freshness.generatedAt).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Kolkata",
            })}
          </span>
          {report.freshness.newsUpdatedAt ? (
            <span className="rounded-full bg-white/5 px-3 py-1.5">
              News updated {new Date(report.freshness.newsUpdatedAt).toLocaleDateString("en-IN")}
            </span>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-cg-dark-2 p-5">
        <h2 className="text-lg font-bold text-white">Pre-Match Data Edge</h2>
        <p className="mt-1 text-sm text-gray-400">Historical form, venue context, and matchup signals generated from the unified EDA layer.</p>
        <div className="mt-5">
          <EdaCards cards={report.cards} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-gray-800 bg-cg-dark-2 p-5">
            <h2 className="text-lg font-bold text-white">Key Questions</h2>
            <ul className="mt-4 space-y-3 text-sm text-gray-300">
              {report.keyQuestions.map((item) => (
                <li key={item} className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3">
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-gray-800 bg-cg-dark-2 p-5">
            <h2 className="text-lg font-bold text-white">Tactical Angles</h2>
            <ul className="mt-4 space-y-3 text-sm text-gray-300">
              {report.tacticalAngles.map((item) => (
                <li key={item} className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3">
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-gray-800 bg-cg-dark-2 p-5">
            <h2 className="text-lg font-bold text-white">Recent Context</h2>
            <div className="mt-4 grid gap-3">
              {report.relatedNews.length > 0 ? report.relatedNews.map((article) => (
                <a
                  key={article.id}
                  href={article.articleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3 hover:border-cg-green/40"
                >
                  <p className="text-sm font-semibold text-white">{article.title}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {article.sourceName} · {new Date(article.publishedAt).toLocaleDateString("en-IN")}
                  </p>
                  <p className="mt-2 text-sm text-gray-400">{article.description}</p>
                </a>
              )) : (
                <p className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3 text-sm text-gray-400">
                  No recent cricket news was available for this fixture context.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-gray-800 bg-cg-dark-2 p-5">
            <h2 className="text-sm font-bold text-white">Pressure Forecast</h2>
            <p className="mt-2 text-2xl font-black text-cg-green">{report.predictedPressurePhase}</p>
            <p className="mt-2 text-sm text-gray-400">Likeliest phase where the tactical edge could decide the game.</p>
          </div>

          <div className="rounded-xl border border-gray-800 bg-cg-dark-2 p-5">
            <h2 className="text-sm font-bold text-white">Watch Players</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {report.watchPlayers.length > 0 ? report.watchPlayers.map((player) => (
                <span key={player} className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-white">
                  {player}
                </span>
              )) : <p className="text-sm text-gray-400">Squad-based player preview becomes richer once lineup data is available.</p>}
            </div>
          </div>

          <div className="rounded-xl border border-gray-800 bg-cg-dark-2 p-5">
            <h2 className="text-sm font-bold text-white">Warehouse Notes</h2>
            <div className="mt-3 space-y-3 text-sm text-gray-300">
              {report.historical.teamForms.map((item) => (
                <div key={item.team} className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3">
                  <p className="font-semibold text-white">{item.team}</p>
                  <p className="mt-1 text-gray-400">{item.summary}</p>
                </div>
              ))}
              <div className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3">
                <p className="font-semibold text-white">Head-to-head</p>
                <p className="mt-1 text-gray-400">{report.historical.headToHead.summary}</p>
              </div>
              <div className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3">
                <p className="font-semibold text-white">Venue</p>
                <p className="mt-1 text-gray-400">{report.historical.venue.summary}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-800 bg-cg-dark-2 p-5">
            <h2 className="text-sm font-bold text-white">Linked Coverage</h2>
            <div className="mt-3 space-y-2">
              {!coverageAvailable ? (
                <p className="text-sm text-gray-400">
                  Linked coverage is temporarily unavailable. Match preview insights are still live.
                </p>
              ) : blogs.length > 0 ? blogs.map((blog) => (
                <Link key={blog.id} href={`/blog/${blog.slug}`} className="block text-sm text-blue-300 hover:text-blue-200">
                  {blog.title}
                </Link>
              )) : <p className="text-sm text-gray-400">No linked blogs yet for this match.</p>}
            </div>
          </div>
        </div>
      </div>

      <EdaAskPanel
        matchId={match.id}
        suggestions={[
          ...report.keyQuestions,
          "Who has the venue edge in this matchup?",
          "What is the biggest tactical swing factor before the first ball?",
        ]}
      />
    </div>
  );
}
