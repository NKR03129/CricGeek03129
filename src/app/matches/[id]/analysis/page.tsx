import {
  generateMatchAnalysisMetadata,
  MatchAnalysisPageContent,
  type MatchAnalysisPageProps,
} from "@/components/matches/MatchAnalysisPageContent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(props: MatchAnalysisPageProps) {
  return generateMatchAnalysisMetadata(props);
}

export default MatchAnalysisPageContent;
