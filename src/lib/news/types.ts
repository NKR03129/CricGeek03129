export type NewsProviderName = "gnews" | "thenewsapi" | "mock";

export interface CricketNewsArticle {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  sourceName: string;
  publishedAt: string;
  articleUrl: string;
  provider: NewsProviderName;
}

export interface CricketNewsQuery {
  limit?: number | string | null;
  team?: string | null;
  tournament?: string | null;
}

export interface ResolvedCricketNewsQuery {
  limit: number;
  team?: string;
  tournament?: string;
  query: string;
  ttlSeconds: number;
}

export interface CricketNewsResult {
  articles: CricketNewsArticle[];
  provider: NewsProviderName | "none";
  cacheHit: boolean;
  stale: boolean;
  updatedAt?: string;
  error?: string;
}
