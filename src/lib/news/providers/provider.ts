import type { CricketNewsArticle, NewsProviderName } from "@/lib/news/types";

export interface ProviderFetchParams {
  query: string;
  limit: number;
}

export interface NewsProvider {
  name: Exclude<NewsProviderName, "mock">;
  isConfigured(): boolean;
  fetchCricketNews(params: ProviderFetchParams): Promise<CricketNewsArticle[]>;
}
