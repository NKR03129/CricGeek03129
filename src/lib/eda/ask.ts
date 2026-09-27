import { prisma } from "@/lib/db";
import { getMatchInfo, getMatchScorecard, getMatchSquad } from "@/lib/cricket-api";
import { getCricketNews } from "@/lib/news/cricket-news-service";
import { buildFreshness, buildConfidence, dedupeSources, deriveCompetitionLabel } from "@/lib/eda/common";
import { buildPreMatchEdaReport } from "@/lib/eda/pre-match";
import { buildLiveEdaReport } from "@/lib/eda/live";
import { buildPostMatchEdaReport } from "@/lib/eda/post-match";
import { generateStructuredJson } from "@/lib/eda/llm";
import { queryInternalRag } from "@/lib/eda/rag";
import type { EdaAskRequest, EdaAskResponse, EdaSourceReference } from "@/types/eda";

function compact(text: string, limit = 280) {
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
}

type LlmAnswerPayload = {
  answer?: string;
  contextPreview?: string[];
};

export async function buildEdaAskResponse(input: EdaAskRequest): Promise<EdaAskResponse> {
  const question = input.question.trim();
  if (!question) {
    throw new Error("question is required");
  }

  const match = input.matchId ? await getMatchInfo(input.matchId, { fresh: true }) : null;
  const [scorecards, squads] = match
    ? await Promise.all([
        getMatchScorecard(match.id, { fresh: true }),
        getMatchSquad(match.id, { fresh: true }),
      ])
    : [null, null];

  const [blogs, ragResult] = await Promise.all([
    prisma.blog.findMany({
      where: match
        ? { matchTag: match.id, status: "approved" }
        : input.team
          ? {
              status: "approved",
              OR: [
                { title: { contains: input.team } },
                { content: { contains: input.team } },
              ],
            }
          : undefined,
      orderBy: { createdAt: "desc" },
      take: 3,
      select: {
        title: true,
        slug: true,
        content: true,
        createdAt: true,
      },
    }),
    queryInternalRag(question),
  ]);

  let route: EdaAskResponse["route"] = "structured_only";
  const contextBlocks: string[] = [];
  const citations: EdaSourceReference[] = [];
  let hasStructuredContext = false;

  if (match) {
    hasStructuredContext = true;
    if (match.matchEnded) {
      const report = await buildPostMatchEdaReport(match, scorecards);
      contextBlocks.push(
        `Structured post-match summary: ${report.intel.summary}`,
        ...report.benchmarkCards.map((card) => `${card.label}: ${card.value}. ${card.insight}`),
        ...report.intel.turningPoints.map((point) => `Turning point: ${point}`),
      );
      citations.push(...report.sources);
    } else if (match.matchStarted) {
      const report = await buildLiveEdaReport(match);
      contextBlocks.push(
        `Structured live summary: ${report.summary}`,
        ...report.cards.map((card) => `${card.label}: ${card.value}. ${card.insight}`),
      );
      citations.push(...report.sources);
    } else {
      const report = await buildPreMatchEdaReport(match, squads);
      contextBlocks.push(
        `Structured pre-match summary: ${report.summary}`,
        ...report.cards.map((card) => `${card.label}: ${card.value}. ${card.insight}`),
        ...report.keyQuestions.map((item) => `Question: ${item}`),
      );
      citations.push(...report.sources);
    }
  }

  if (blogs.length > 0) {
    contextBlocks.push(
      ...blogs.map((blog) => `Linked blog "${blog.title}" (${blog.slug}) summary: ${compact(blog.content, 240)}`)
    );
    citations.push(
      ...blogs.map((blog, index) => ({
        id: `blog-${index}-${blog.slug}`,
        type: "blog" as const,
        title: blog.title,
        note: `Approved CricGeek blog linked to the current context.`,
        url: `/blog/${blog.slug}`,
        updatedAt: blog.createdAt.toISOString(),
      }))
    );
  }

  const newsResult = await getCricketNews({
    team: input.team || match?.teams.join(" ") || null,
    tournament: input.tournament || deriveCompetitionLabel(match ?? {
      id: "",
      name: "",
      matchType: "",
      status: "",
      venue: "",
      date: "",
      dateTimeGMT: "",
      teams: [],
      teamInfo: [],
      score: [],
      matchStarted: false,
      matchEnded: false,
    }) || null,
    limit: 4,
  });

  const hasNewsContext = newsResult.articles.length > 0;
  if (newsResult.articles.length > 0) {
    contextBlocks.push(
      ...newsResult.articles.map(
        (article) =>
          `Recent cricket news: ${article.title}. ${compact(article.description || article.sourceName, 180)}`
      )
    );
    citations.push(
      ...newsResult.articles.map((article) => ({
        id: article.id,
        type: "news" as const,
        title: article.title,
        note: article.description || article.sourceName,
        url: article.articleUrl,
        updatedAt: article.publishedAt,
      }))
    );
  }

  const hasRagContext = Boolean(ragResult);
  if (ragResult) {
    contextBlocks.push(
      `Internal retrieval answer: ${compact(ragResult.answer, 220)}`,
      ...ragResult.contexts.map((context) => `Internal retrieval context: ${compact(context, 220)}`)
    );
    citations.push({
      id: "rag-context",
      type: "rag",
      title: "Internal retrieval context",
      note: "Context retrieved from the optional internal RAG service.",
    });
  }

  if (hasNewsContext && hasRagContext) {
    route = "hybrid";
  } else if (hasNewsContext) {
    route = hasStructuredContext ? "structured_plus_news" : "news_only";
  } else if (hasRagContext) {
    route = hasStructuredContext ? "structured_plus_rag" : "rag_only";
  }

  const fallbackAnswer =
    contextBlocks.length > 0
      ? `Answer built from ${match ? "match" : "available"} context: ${contextBlocks.slice(0, 3).join(" ")}`
      : "I do not have enough structured or retrieved context to answer that confidently yet.";

  const llm = await generateStructuredJson<LlmAnswerPayload>(
    `You are CricGeek's cricket intelligence explainer. Return strict JSON with keys answer and contextPreview.
Question: ${question}
Use only the provided context. Be explicit about uncertainty. Keep the answer concise and practical.
Context:
${contextBlocks.slice(0, 12).map((block, index) => `[${index + 1}] ${block}`).join("\n")}`
  );

  const dedupedCitations = dedupeSources(citations).slice(0, 8);
  const preview = (llm?.contextPreview ?? contextBlocks).slice(0, 5).map((item) => compact(item, 220));
  const reasons = [
    contextBlocks.length > 0
      ? "Structured or retrieved cricket context was available for the answer."
      : "Very little structured context was available for the answer.",
    hasNewsContext
      ? "Recent online cricket coverage was available."
      : "No recent online cricket coverage was available.",
    hasRagContext ? "Internal retrieval context was available." : "Internal retrieval context was unavailable.",
  ];

  return {
    answer: llm?.answer?.trim() || fallbackAnswer,
    route,
    confidence: buildConfidence(
      45 + Math.min(contextBlocks.length * 4, 25) + (hasNewsContext ? 10 : 0) + (hasRagContext ? 10 : 0),
      reasons
    ),
    freshness: buildFreshness({
      match: match ?? {
        id: input.matchId || "",
        name: input.team || input.tournament || "EDA Ask",
        matchType: "",
        status: "",
        venue: "",
        date: "",
        dateTimeGMT: "",
        teams: input.team ? [input.team] : [],
        teamInfo: [],
        score: [],
        matchStarted: false,
        matchEnded: false,
      },
      historicalAvailable: contextBlocks.some((block) => block.includes("warehouse")),
      newsUpdatedAt: newsResult.articles[0]?.publishedAt ?? newsResult.updatedAt ?? null,
      notes: [
        "Answers use structured context first, then linked CricGeek content, then recent news, then optional internal retrieval.",
      ],
    }),
    citations: dedupedCitations,
    contextPreview: preview,
  };
}
