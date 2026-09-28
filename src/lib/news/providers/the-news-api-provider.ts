import { normalizeTheNewsApiArticle } from "@/lib/news/normalizer";
import type { CricketNewsArticle } from "@/lib/news/types";
import type { NewsProvider, ProviderFetchParams } from "@/lib/news/providers/provider";

type TheNewsApiResponse = {
  data?: Array<{
    uuid?: string;
    title?: string;
    description?: string;
    image_url?: string;
    source?: string;
    published_at?: string;
    url?: string;
  }>;
};

const THENEWSAPI_BASE_URL = process.env.THENEWSAPI_BASE_URL || "https://api.thenewsapi.com/v1/news/all";
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.CRICKET_NEWS_PROVIDER_TIMEOUT_MS || "8000", 10);

export class TheNewsApiProvider implements NewsProvider {
  name = "thenewsapi" as const;

  isConfigured(): boolean {
    return Boolean(process.env.THENEWSAPI_API_KEY);
  }

  async fetchCricketNews(params: ProviderFetchParams): Promise<CricketNewsArticle[]> {
    const apiKey = process.env.THENEWSAPI_API_KEY;
    if (!apiKey) {
      throw new Error("TheNewsAPI key is missing");
    }

    const url = new URL(THENEWSAPI_BASE_URL);
    url.searchParams.set("api_token", apiKey);
    url.searchParams.set("search", params.query);
    url.searchParams.set("language", "en");
    url.searchParams.set("limit", String(Math.min(params.limit, 10)));

    const response = await fetch(url.toString(), {
      next: { revalidate: 60 * 60 },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`TheNewsAPI request failed with ${response.status}`);
    }

    const payload = (await response.json()) as TheNewsApiResponse;
    const items = Array.isArray(payload.data) ? payload.data : [];

    return items
      .map((article) => normalizeTheNewsApiArticle(article))
      .filter((article): article is CricketNewsArticle => Boolean(article));
  }
}
