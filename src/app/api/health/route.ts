import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getHistoricalWarehouseStatus } from "@/lib/historical-warehouse";
import { getOllamaUrl } from "@/lib/ollama";

export async function GET() {
  const ollamaUrl = process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL;
  const authUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  const newsConfigured =
    Boolean(process.env.GNEWS_API_KEY || process.env.THENEWSAPI_API_KEY) ||
    process.env.CRICKET_NEWS_ENABLE_MOCK === "true";
  const ragConfigured = Boolean(
    process.env.RAG_SERVICE_URL || (process.env.NODE_ENV !== "production" && "http://127.0.0.1:8020")
  );
  const insightsServiceUrl =
    process.env.INSIGHTS_URL ||
    process.env.T20_INSIGHTS_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}/_insights` : null) ||
    process.env.AI_SERVICE_URL ||
    null;
  const trustHost =
    process.env.AUTH_TRUST_HOST === "true" ||
    process.env.TRUST_HOST === "true" ||
    process.env.NODE_ENV !== "production";
  const matchDataConfigured =
    Boolean(process.env.SPORTMONKS_API_TOKEN) ||
    process.env.ALLOW_MOCK_MATCH_DATA === "true";

  const checks = {
    database: false,
    googleAuthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    credentialsAuthConfigured: Boolean(authSecret && (authUrl || trustHost)),
    nextAuthConfigured: Boolean(authSecret),
    authUrlConfigured: Boolean(authUrl || trustHost),
    sportMonksConfigured: Boolean(process.env.SPORTMONKS_API_TOKEN),
    matchDataConfigured,
    deepgramConfigured: Boolean(process.env.DEEPGRAM_API_KEY),
    transcriptionProvider: process.env.DEEPGRAM_API_KEY
      ? "deepgram"
      : process.env.AI_SERVICE_URL
        ? "legacy"
        : "none",
    insightsConfigured: Boolean(insightsServiceUrl),
    insightsProvider: process.env.INSIGHTS_URL
      ? "vercel-service"
      : process.env.T20_INSIGHTS_URL
        ? "custom-insights"
        : process.env.VERCEL_URL
          ? "same-project-service"
        : process.env.AI_SERVICE_URL
          ? "legacy-ai-service"
          : "none",
    insightsServiceUrl,
    searchConfigured: Boolean(process.env.TAVILY_API_KEY || process.env.SERPER_API_KEY),
    searchProvider: process.env.SERPER_API_KEY ? "serper" : process.env.TAVILY_API_KEY ? "tavily" : "none",
    cricketNewsConfigured: newsConfigured,
    ragConfigured,
    ollamaConfigured: Boolean(ollamaUrl),
    ollamaUrl: ollamaUrl || getOllamaUrl(),
    ollamaSharedSecretConfigured: Boolean(process.env.OLLAMA_SHARED_SECRET),
    ollamaModel: process.env.OLLAMA_BQS_MODEL || process.env.OLLAMA_MODEL || "qwen3.5:latest",
    historicalWarehouseEnabled: process.env.FACT_CHECK_HISTORICAL_ENABLED !== "false",
    historicalWarehouseAvailable: false,
    historicalWarehouseMatchesLoaded: 0,
    historicalWarehouseError: null as string | null,
    edaStructuredReady: false,
    edaLiveReady: false,
    edaAskReady: false,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch (error) {
    console.error("Health check database error:", error);
  }

  try {
    const warehouse = await getHistoricalWarehouseStatus(true);
    checks.historicalWarehouseAvailable = warehouse.available;
    checks.historicalWarehouseMatchesLoaded = warehouse.matchesLoaded;
    checks.historicalWarehouseError = warehouse.error ?? null;
  } catch (error) {
    checks.historicalWarehouseError =
      error instanceof Error ? error.message : "Historical warehouse status could not be determined.";
  }

  checks.edaStructuredReady =
    checks.matchDataConfigured &&
    checks.database &&
    checks.historicalWarehouseAvailable;
  checks.edaLiveReady =
    checks.matchDataConfigured &&
    (checks.insightsConfigured || checks.historicalWarehouseAvailable);
  checks.edaAskReady =
    checks.matchDataConfigured &&
    (checks.cricketNewsConfigured || checks.ragConfigured || checks.ollamaConfigured);

  const ok =
    checks.database &&
    checks.credentialsAuthConfigured &&
    checks.matchDataConfigured;

  return NextResponse.json(
    {
      ok,
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
