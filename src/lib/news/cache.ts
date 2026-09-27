import type { CricketNewsArticle, NewsProviderName } from "@/lib/news/types";

type CacheEntry = {
  articles: CricketNewsArticle[];
  provider: NewsProviderName;
  updatedAt: string;
  expiresAt: number;
};

type CacheStore = Map<string, CacheEntry>;

declare global {
  var __cricketNewsCacheStore: CacheStore | undefined;
}

function getStore(): CacheStore {
  if (!globalThis.__cricketNewsCacheStore) {
    globalThis.__cricketNewsCacheStore = new Map<string, CacheEntry>();
  }
  return globalThis.__cricketNewsCacheStore;
}

export function getCachedNews(cacheKey: string): (CacheEntry & { fresh: boolean }) | null {
  const entry = getStore().get(cacheKey);
  if (!entry) return null;

  return {
    ...entry,
    fresh: entry.expiresAt > Date.now(),
  };
}

export function setCachedNews(
  cacheKey: string,
  payload: { articles: CricketNewsArticle[]; provider: NewsProviderName; ttlSeconds: number }
): CacheEntry {
  const updatedAt = new Date().toISOString();
  const next: CacheEntry = {
    articles: payload.articles,
    provider: payload.provider,
    updatedAt,
    expiresAt: Date.now() + payload.ttlSeconds * 1000,
  };

  getStore().set(cacheKey, next);
  return next;
}
