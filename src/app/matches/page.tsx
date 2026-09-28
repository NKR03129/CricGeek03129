import { getMatchHubMatchesWithSource } from "@/lib/cricket-api";
import MatchesClient from "./MatchesClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cricket Matches & Results | CricGeek",
  description: "Live cricket scores, upcoming fixtures, recent results, and full match centres for international and league matches.",
};

export const revalidate = 30;
export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  const { matches, source } = await getMatchHubMatchesWithSource();
  return <MatchesClient initialMatches={matches} source={source} />;
}
