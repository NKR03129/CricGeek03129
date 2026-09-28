import { getCachedNews, setCachedNews } from "@/lib/news/cache";
import type { NewsProvider } from "@/lib/news/providers/provider";
import { GNewsProvider } from "@/lib/news/providers/gnews-provider";
import { TheNewsApiProvider } from "@/lib/news/providers/the-news-api-provider";
import { MOCK_CRICKET_NEWS } from "@/data/mock-cricket-news";
import type {
  CricketNewsQuery,
  CricketNewsResult,
  ResolvedCricketNewsQuery,
} from "@/lib/news/types";

const DEFAULT_NEWS_LIMIT = Number.parseInt(process.env.CRICKET_NEWS_DEFAULT_LIMIT || "6", 10);
const DEFAULT_CACHE_TTL_SECONDS = Number.parseInt(process.env.CRICKET_NEWS_CACHE_TTL_SECONDS || "10800", 10);
const BASE_KEYWORDS = [
  "cricket",
  "IPL",
  "ICC",
  "BCCI",
  '"Royal Challengers Bengaluru"',
  '"Chennai Super Kings"',
];

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return Math.min(Math.max(DEFAULT_NEWS_LIMIT, 1), 10);
  return Math.min(Math.max(Math.round(value), 1), 10);
}

function sanitizeKeyword(value?: string | null): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/[^a-zA-Z0-9 .&'\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return undefined;
  return cleaned.slice(0, 80);
}

function getTtlSeconds(): number {
  const parsed = Number.parseInt(process.env.CRICKET_NEWS_CACHE_TTL_SECONDS || `${DEFAULT_CACHE_TTL_SECONDS}`, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CACHE_TTL_SECONDS;
  return parsed;
}

function wrapPhrase(value: string): string {
  return value.includes(" ") ? `"${value}"` : value;
}

export function resolveCricketNewsQuery(query: CricketNewsQuery): ResolvedCricketNewsQuery {
  const team = sanitizeKeyword(query.team);
  const tournament = sanitizeKeyword(query.tournament);
  const requestedLimit =
    typeof query.limit === "string" ? Number.parseInt(query.limit, 10) : Number(query.limit ?? DEFAULT_NEWS_LIMIT);

  const limit = clampLimit(requestedLimit);
  const terms = [...BASE_KEYWORDS];

  if (team) {
    terms.push(wrapPhrase(team));
  }
  if (tournament) {
    terms.push(wrapPhrase(tournament));
  }

  return {
    limit,
    team,
    tournament,
    query: terms.join(" OR "),
    ttlSeconds: getTtlSeconds(),
  };
}

function cacheKeyForQuery(query: ResolvedCricketNewsQuery): string {
  return [
    `limit:${query.limit}`,
    `team:${query.team?.toLowerCase() || ""}`,
    `tournament:${query.tournament?.toLowerCase() || ""}`,
  ].join("|");
}

function getProviderChain(): NewsProvider[] {
  return [new GNewsProvider(), new TheNewsApiProvider()];
}

export async function getCricketNews(query: CricketNewsQuery): Promise<CricketNewsResult> {
  const resolved = resolveCricketNewsQuery(query);
  const cacheKey = cacheKeyForQuery(resolved);
  const cached = getCachedNews(cacheKey);

  if (cached?.fresh) {
    return {
      articles: cached.articles.slice(0, resolved.limit),
      provider: cached.provider,
      cacheHit: true,
      stale: false,
      updatedAt: cached.updatedAt,
    };
  }

  const providerErrors: string[] = [];
  for (const provider of getProviderChain()) {
    if (!provider.isConfigured()) continue;

    try {
      const articles = await provider.fetchCricketNews({
        query: resolved.query,
        limit: resolved.limit,
      });

      const next = setCachedNews(cacheKey, {
        articles,
        provider: provider.name,
        ttlSeconds: resolved.ttlSeconds,
      });

      return {
        articles,
        provider: provider.name,
        cacheHit: false,
        stale: false,
        updatedAt: next.updatedAt,
      };
    } catch (error) {
      providerErrors.push(error instanceof Error ? error.message : "Provider request failed");
    }
  }

  if (cached) {
    return {
      articles: cached.articles.slice(0, resolved.limit),
      provider: cached.provider,
      cacheHit: true,
      stale: true,
      updatedAt: cached.updatedAt,
      error: "Showing last available cricket news while providers recover.",
    };
  }

  if (process.env.CRICKET_NEWS_ENABLE_MOCK === "true") {
    return {
      articles: MOCK_CRICKET_NEWS.slice(0, resolved.limit),
      provider: "mock",
      cacheHit: false,
      stale: false,
      updatedAt: new Date().toISOString(),
      error: "Showing mock cricket news because no provider is configured.",
    };
  }

  return {
    articles: [],
    provider: "none",
    cacheHit: false,
    stale: false,
    error:
      providerErrors.length > 0
        ? "Cricket news is temporarily unavailable. Please try again later."
        : "Cricket news provider is not configured yet.",
  };
}
