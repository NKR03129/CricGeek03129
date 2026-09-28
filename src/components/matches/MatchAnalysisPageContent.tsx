import type { Metadata } from "next";
import PostMatchInsightsStory from "@/components/matches/PostMatchInsightsStory";
import { getMatchInfo, getMatchScorecard } from "@/lib/cricket-api";
import { buildPostMatchEdaReport } from "@/lib/eda/post-match";
import { getMatchCoverage } from "@/lib/match-coverage";

export type MatchAnalysisPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMatchAnalysisMetadata({
  params,
}: MatchAnalysisPageProps): Promise<Metadata> {
  const { id } = await params;
  const match = await getMatchInfo(id);
  return {
    title: match ? `${match.name} Analysis | CricGeek` : "Post-Match Analysis | CricGeek",
    description: match
      ? `Post-match EDA report, scorecard analytics, and linked coverage for ${match.name}`
      : "Cricket post-match analysis",
  };
}

export async function MatchAnalysisPageContent({ params }: MatchAnalysisPageProps) {
  const { id } = await params;
  const [match, scorecards, coverage] = await Promise.all([
    getMatchInfo(id),
    getMatchScorecard(id),
    getMatchCoverage(id),
  ]);

  if (!match) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-20 text-center">
        <h1 className="text-2xl font-black text-white">Analysis unavailable</h1>
        <p className="mt-2 text-sm text-gray-400">We could not load the analysis for this match.</p>
      </div>
    );
  }

  const report = await buildPostMatchEdaReport(match, scorecards);

  return <PostMatchInsightsStory match={match} report={report} coverage={coverage} />;
}
