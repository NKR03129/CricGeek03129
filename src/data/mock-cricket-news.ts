import type { CricketNewsArticle } from "@/lib/news/types";

export const MOCK_CRICKET_NEWS: CricketNewsArticle[] = [
  {
    id: "mock-news-1",
    title: "RCB powerplay shift gives middle order a cleaner launchpad",
    description: "Analysts note how aggressive first-six-over intent is reducing pressure in overs 10-14 for Bengaluru this season.",
    imageUrl: "",
    sourceName: "CricGeek Wire",
    publishedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    articleUrl: "https://example.com/cricket-news/rcb-powerplay-shift",
    provider: "mock",
  },
  {
    id: "mock-news-2",
    title: "CSK death-over blueprint improves after role clarity in bowling unit",
    description: "A tighter yorker mix and slower-ball discipline has improved Chennai's run suppression in the final four overs.",
    imageUrl: "",
    sourceName: "CricGeek Wire",
    publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    articleUrl: "https://example.com/cricket-news/csk-death-over-blueprint",
    provider: "mock",
  },
  {
    id: "mock-news-3",
    title: "IPL venue trend: high-scoring nights still hinge on two-over spin squeeze",
    description: "Recent match data suggests the best defending sides are stealing momentum with spin in overs 7-10.",
    imageUrl: "",
    sourceName: "CricGeek Wire",
    publishedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    articleUrl: "https://example.com/cricket-news/ipl-venue-spin-squeeze",
    provider: "mock",
  },
];
