import type { Metadata } from "next";
import { Suspense } from "react";
import { getLiveMatches } from "@/lib/cricket-api";
import InsightsClient from "./InsightsClient";

export const metadata: Metadata = {
  title: "AI Insights | CricGeek",
  description:
    "Integrated T20 decision support for live match situations, batting and bowling recommendations, model evaluation, and player exploration.",
};

export const runtime = "nodejs";
export const revalidate = 60;

function InsightsPageFallback() {
  return (
    <div className="bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.08),transparent_40%),linear-gradient(180deg,#060606,#0a0a0a)]">
      <section className="border-b border-gray-900">
        <div className="max-w-7xl mx-auto px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
          <div className="max-w-3xl rounded-3xl border border-gray-800 bg-white/[0.03] p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-cg-green">
              Integrated T20 Decision Support
            </p>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">
              Loading AI insights...
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-400 sm:text-base">
              Preparing the live advisor, evaluation metrics, and player explorer.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default async function InsightsPage() {
  const matches = await getLiveMatches();
  const t20Matches = matches.filter((match) => /t20/i.test(match.matchType) && match.matchStarted);

  return (
    <Suspense fallback={<InsightsPageFallback />}>
      <InsightsClient initialMatches={t20Matches} />
    </Suspense>
  );
}
