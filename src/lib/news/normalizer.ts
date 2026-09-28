import { createHash } from "crypto";
import type { CricketNewsArticle } from "@/lib/news/types";

type GNewsArticleRaw = {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  publishedAt?: string;
  source?: {
    name?: string;
  };
};

type TheNewsApiArticleRaw = {
  uuid?: string;
  title?: string;
  description?: string;
  image_url?: string;
  source?: string;
  published_at?: string;
  url?: string;
};

function toIsoOrNow(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function makeArticleId(parts: string[]): string {
  const hash = createHash("sha1");
  hash.update(parts.join("|"));
  return hash.digest("hex");
}

export function normalizeGNewsArticle(article: GNewsArticleRaw): CricketNewsArticle | null {
  const title = (article.title || "").trim();
  const articleUrl = (article.url || "").trim();
  if (!title || !articleUrl) return null;

  return {
    id: makeArticleId([title, articleUrl, article.publishedAt || ""]),
    title,
    description: (article.description || "").trim(),
    imageUrl: (article.image || "").trim(),
    sourceName: (article.source?.name || "Unknown Source").trim(),
    publishedAt: toIsoOrNow(article.publishedAt),
    articleUrl,
    provider: "gnews",
  };
}

export function normalizeTheNewsApiArticle(article: TheNewsApiArticleRaw): CricketNewsArticle | null {
  const title = (article.title || "").trim();
  const articleUrl = (article.url || "").trim();
  if (!title || !articleUrl) return null;

  return {
    id: article.uuid?.trim() || makeArticleId([title, articleUrl, article.published_at || ""]),
    title,
    description: (article.description || "").trim(),
    imageUrl: (article.image_url || "").trim(),
    sourceName: (article.source || "Unknown Source").trim(),
    publishedAt: toIsoOrNow(article.published_at),
    articleUrl,
    provider: "thenewsapi",
  };
}
