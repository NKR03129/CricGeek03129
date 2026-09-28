import { normalizeGNewsArticle } from "@/lib/news/normalizer";
import type { CricketNewsArticle } from "@/lib/news/types";
import type { NewsProvider, ProviderFetchParams } from "@/lib/news/providers/provider";

type GNewsResponse = {
  articles?: Array<{
    title?: string;
    description?: string;
    image?: string;
    url?: string;
    publishedAt?: string;
    source?: {
      name?: string;
    };
  }>;
};

const GNEWS_BASE_URL = process.env.GNEWS_BASE_URL || "https://gnews.io/api/v4/search";
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.CRICKET_NEWS_PROVIDER_TIMEOUT_MS || "8000", 10);

export class GNewsProvider implements NewsProvider {
  name = "gnews" as const;

  isConfigured(): boolean {
    return Boolean(process.env.GNEWS_API_KEY);
  }

  async fetchCricketNews(params: ProviderFetchParams): Promise<CricketNewsArticle[]> {
    const apiKey = process.env.GNEWS_API_KEY;
    if (!apiKey) {
      throw new Error("GNews API key is missing");
    }

    const url = new URL(GNEWS_BASE_URL);
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("q", params.query);
    url.searchParams.set("lang", "en");
    url.searchParams.set("max", String(Math.min(params.limit, 10)));
    url.searchParams.set("sortby", "publishedAt");

    const response = await fetch(url.toString(), {
      next: { revalidate: 60 * 60 },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`GNews request failed with ${response.status}`);
    }

    const payload = (await response.json()) as GNewsResponse;
    const items = Array.isArray(payload.articles) ? payload.articles : [];

    return items
      .map((article) => normalizeGNewsArticle(article))
      .filter((article): article is CricketNewsArticle => Boolean(article));
  }
}
