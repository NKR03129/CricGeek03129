import { getOllamaHeaders, getOllamaUrl } from "@/lib/ollama";
import {
  getHistoricalWarehouseStatus,
  isHistoricalIntentSupported,
  runHistoricalWarehouseCheck,
  type HistoricalQueryIntent,
  type HistoricalWarehouseClaim,
} from "@/lib/historical-warehouse";

const OLLAMA_URL = getOllamaUrl();
const OLLAMA_MODEL = process.env.OLLAMA_BQS_MODEL || process.env.OLLAMA_MODEL || "qwen3.5:latest";
const SEARCH_TIMEOUT_MS = 15_000;
const OLLAMA_TIMEOUT_MS = 90_000;
const MAX_RESULTS_PER_CLAIM = 5;
const MAX_WEB_CLAIMS = clampPositiveInt(process.env.FACT_CHECK_MAX_WEB_CLAIMS, 3, 1, 6);
const TAVILY_SEARCH_DEPTH = resolveSearchDepth(process.env.FACT_CHECK_SEARCH_DEPTH);
const DEFAULT_ALLOWED_DOMAINS = [
  "espncricinfo.com",
  "icc-cricket.com",
  "cricbuzz.com",
  "wisden.com",
  "sportstar.thehindu.com",
  "thehindu.com",
  "bbc.com",
  "reuters.com",
  "bcci.tv",
  "cricket.com.au",
  "ecb.co.uk",
  "pcb.com.pk",
];
const DEFAULT_EXCLUDED_DOMAINS = [
  "twitter.com",
  "x.com",
  "reddit.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
];

export type SearchBackend = "tavily" | "serper" | "none";
export type FactCheckVerdict = "supported" | "contradicted" | "inconclusive";
export type ClaimRoute = "historical_structured" | "web_search" | "unsupported";

export interface FactCheckSource {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  publishedDate?: string | null;
}

export interface FactCheckVerdictEntry {
  claim: string;
  query: string;
  category: string;
  route?: ClaimRoute;
  verdict: FactCheckVerdict;
  confidence: number;
  evidence: string;
  sources: FactCheckSource[];
  intent?: HistoricalQueryIntent | null;
}

export interface WebFactCheckReport {
  providerAvailable: boolean;
  historicalWarehouseAvailable?: boolean;
  historicalWarehouseError?: string | null;
  searchBackend: SearchBackend;
  searchError?: string | null;
  claimsDetected: number;
  claimsResearched: number;
  supported: number;
  contradicted: number;
  inconclusive: number;
  score: number;
  summary: string;
  claimRouting?: {
    historicalStructured: number;
    webSearch: number;
    unsupported: number;
    reroutedToWeb: number;
  };
  historicalClaims?: {
    claimsRouted: number;
    claimsResolved: number;
    supported: number;
    contradicted: number;
    inconclusive: number;
    score: number;
    summary: string;
    verdicts: FactCheckVerdictEntry[];
  };
  webClaims?: {
    claimsRouted: number;
    claimsResearched: number;
    supported: number;
    contradicted: number;
    inconclusive: number;
    score: number;
    summary: string;
    verdicts: FactCheckVerdictEntry[];
  };
  verdicts: FactCheckVerdictEntry[];
}

type ResearchClaim = {
  claim: string;
  query: string;
  category: string;
  route: ClaimRoute;
  intent?: HistoricalQueryIntent | null;
};

type ClaimExtractionPayload = {
  claims?: ResearchClaim[];
};

type VerdictPayload = {
  results?: Array<{
    claim_index?: number;
    verdict?: FactCheckVerdict;
    confidence?: number;
    evidence?: string;
    source_indices?: number[];
  }>;
};

type TavilySearchResponse = {
  answer?: string;
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    raw_content?: string | null;
    published_date?: string | null;
  }>;
};

type SerperSearchResponse = {
  answerBox?: {
    answer?: string;
    snippet?: string;
  };
  organic?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    date?: string;
  }>;
};

type SearchEvidence = {
  backend: SearchBackend;
  sources: FactCheckSource[];
  answer?: string;
  error?: string | null;
};

type ClaimWithSearch = {
  claim: ResearchClaim;
  evidence: SearchEvidence;
};

function looksLikeClaimHeavyContent(text: string): boolean {
  return (
    /\d/.test(text) ||
    /\b(record|records|highest|lowest|fastest|slowest|most|least|first|last|since|streak|average|averages|ranking|ranked|history|historic|centuries|century|fifties|wickets|economy|strike rate|head-to-head|injured|injury|ruled out|captain|debut)\b/i.test(
      text
    )
  );
}

function clampPositiveInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(value || "", 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function resolveSearchDepth(value: string | undefined): "advanced" | "basic" | "fast" | "ultra-fast" {
  if (value === "advanced" || value === "basic" || value === "fast" || value === "ultra-fast") {
    return value;
  }

  return "basic";
}

function clampUnit(value: unknown, fallback = 0.5): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function clampScore(value: unknown, fallback = 75): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function safeSnippet(value: unknown, limit = 260): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function extractJsonObjects(candidate: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(candidate.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function normaliseJsonCandidate(candidate: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (const char of candidate) {
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }

    if (char === "\"") {
      output += char;
      inString = !inString;
      continue;
    }

    if (inString) {
      if (char === "\n") {
        output += "\\n";
        continue;
      }

      if (char === "\r") {
        output += "\\r";
        continue;
      }

      if (char === "\t") {
        output += "\\t";
        continue;
      }
    }

    output += char;
  }

  return output.replace(/,\s*([}\]])/g, "$1").trim();
}

function parseJsonPayload<T>(
  rawPayload: unknown,
  validator: (value: unknown) => value is T
): T | null {
  if (!rawPayload || typeof rawPayload !== "object") return null;

  const payload = rawPayload as { response?: unknown; thinking?: unknown };
  const candidates = [payload.response, payload.thinking]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  for (const candidate of candidates) {
    const possibleObjects = [candidate, ...extractJsonObjects(candidate)];

    for (const possibleObject of possibleObjects) {
      try {
        const parsed = JSON.parse(normaliseJsonCandidate(possibleObject)) as unknown;
        if (validator(parsed)) return parsed;
      } catch {
        continue;
      }
    }
  }

  return null;
}

function parseDelimitedEnv(value: string | undefined, fallback: string[]): string[] {
  const parsed = (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : fallback;
}

function normaliseDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function dedupeSources(sources: FactCheckSource[]): FactCheckSource[] {
  const seen = new Set<string>();
  const deduped: FactCheckSource[] = [];

  for (const source of sources) {
    const key = source.url || `${source.domain}:${source.title}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(source);
  }

  return deduped;
}

function dedupeClaims(claims: ResearchClaim[]): ResearchClaim[] {
  const seen = new Set<string>();
  const deduped: ResearchClaim[] = [];

  for (const claim of claims) {
    const key = `${claim.claim.toLowerCase()}::${claim.query.toLowerCase()}::${claim.route}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(claim);
  }

  return deduped;
}

function isTimeSensitiveQuery(query: string): boolean {
  return /\b(today|yesterday|latest|recent|currently|now|this season|this year|this month|202\d)\b/i.test(query);
}

function validateResearchClaims(value: unknown): value is ClaimExtractionPayload {
  return typeof value === "object" && value !== null && "claims" in value;
}

function validateVerdictPayload(value: unknown): value is VerdictPayload {
  return typeof value === "object" && value !== null && "results" in value;
}

async function extractResearchClaimsWithOllama(input: {
  title?: string;
  content: string;
}): Promise<ResearchClaim[]> {
  const prompt = `You are extracting cricket claims that require external fact-checking.
Return strict JSON only in this shape:
{
  "claims": [
    {
      "claim": "",
      "query": "",
      "category": "historical|record|career|context|news",
      "route": "historical_structured|web_search|unsupported",
      "intent": {
        "subjectType": "player|team|venue",
        "subject": "",
        "metric": "matches|runs|wickets|batting_average|strike_rate|economy|centuries|fifties|four_wicket_hauls|five_wicket_hauls|head_to_head_wins|wins_at_venue",
        "comparison": "eq|gte|lte|gt|lt",
        "expectedValue": 0,
        "matchType": "Test|ODI|T20|IT20|IPL|all",
        "competition": "",
        "opponent": "",
        "venue": "",
        "team": "",
        "since": "YYYY-MM-DD",
        "until": "YYYY-MM-DD"
      }
    }
  ]
}

Rules:
- Extract only concrete, checkable factual claims.
- Exclude opinions, predictions, sentiment, and writing quality statements.
- Exclude direct single-match player scorecard claims like "Rohit scored 52" because another checker handles those.
- Use route "historical_structured" only when the claim can be checked via a structured cricket-history warehouse with the supported metrics above.
- Use route "web_search" for rankings, awards, streaks that need prose context, injury/selection/news, quotes, current status, and any historical claim that does not fit the supported metrics cleanly.
- Use route "unsupported" for vague or uncheckable claims.
- If route is "historical_structured", fill the intent carefully and only when subject, metric, comparison, and expectedValue are concrete.
- Keep the query short and search-friendly.
- Keep at most ${MAX_WEB_CLAIMS} claims.

Title: ${input.title || "Untitled"}
Content:
${input.content}`;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: getOllamaHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        format: "json",
        think: false,
        stream: false,
        options: {
          temperature: 0,
          num_predict: 500,
        },
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn("[fact-check] Claim extraction failed:", await res.text());
      return [];
    }

    const raw = (await res.json()) as unknown;
    const parsed = parseJsonPayload<ClaimExtractionPayload>(raw, validateResearchClaims);
    if (!parsed?.claims || !Array.isArray(parsed.claims)) return [];

    return dedupeClaims(
      parsed.claims
        .filter((claim): claim is ResearchClaim =>
          Boolean(claim) &&
          typeof claim.claim === "string" &&
          claim.claim.trim().length > 10 &&
          typeof claim.query === "string" &&
          claim.query.trim().length > 3 &&
          typeof claim.category === "string"
        )
        .map((claim) => ({
          claim: claim.claim.trim().slice(0, 220),
          query: claim.query.trim().slice(0, 160),
          category: claim.category.trim().slice(0, 40).toLowerCase(),
          route:
            claim.route === "historical_structured" || claim.route === "web_search" || claim.route === "unsupported"
              ? claim.route
              : "web_search",
          intent:
            claim.route === "historical_structured" &&
            isHistoricalIntentSupported(claim.intent as HistoricalQueryIntent | null | undefined) &&
            typeof claim.intent?.comparison === "string" &&
            typeof claim.intent?.expectedValue === "number"
              ? {
                  ...claim.intent,
                  subject: String(claim.intent.subject).trim().slice(0, 120),
                  matchType: typeof claim.intent.matchType === "string" ? claim.intent.matchType.trim().slice(0, 30) : null,
                  competition:
                    typeof claim.intent.competition === "string" ? claim.intent.competition.trim().slice(0, 120) : null,
                  opponent: typeof claim.intent.opponent === "string" ? claim.intent.opponent.trim().slice(0, 120) : null,
                  venue: typeof claim.intent.venue === "string" ? claim.intent.venue.trim().slice(0, 160) : null,
                  team: typeof claim.intent.team === "string" ? claim.intent.team.trim().slice(0, 120) : null,
                  since: typeof claim.intent.since === "string" ? claim.intent.since.trim().slice(0, 20) : null,
                  until: typeof claim.intent.until === "string" ? claim.intent.until.trim().slice(0, 20) : null,
                }
              : null,
        }))
        .map((claim) =>
          claim.route === "historical_structured" && !claim.intent
            ? { ...claim, route: "web_search" as const }
            : claim
        )
    ).slice(0, MAX_WEB_CLAIMS);
  } catch (error) {
    console.warn("[fact-check] Claim extraction unavailable:", error);
    return [];
  }
}

async function searchWithTavily(claim: ResearchClaim): Promise<SearchEvidence | null> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return null;

  const includeDomains = parseDelimitedEnv(process.env.FACT_CHECK_ALLOWED_DOMAINS, DEFAULT_ALLOWED_DOMAINS);
  const excludeDomains = parseDelimitedEnv(process.env.FACT_CHECK_EXCLUDED_DOMAINS, DEFAULT_EXCLUDED_DOMAINS);
  const topic = isTimeSensitiveQuery(claim.query) ? "news" : "general";

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `cricket ${claim.query}`,
        search_depth: TAVILY_SEARCH_DEPTH,
        topic,
        max_results: MAX_RESULTS_PER_CLAIM,
        include_answer: "basic",
        include_raw_content: false,
        include_domains: includeDomains,
        exclude_domains: excludeDomains,
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text();
      console.warn("[fact-check] Tavily search failed:", res.status, body);
      return {
        backend: "tavily",
        sources: [],
        error: `Tavily request failed with HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as TavilySearchResponse;
    const sources = dedupeSources(
      (data.results || [])
        .map((result) => ({
          title: safeSnippet(result.title, 120),
          url: typeof result.url === "string" ? result.url : "",
          snippet: safeSnippet(result.content || result.raw_content, 280),
          domain: typeof result.url === "string" ? normaliseDomain(result.url) : "",
          publishedDate: typeof result.published_date === "string" ? result.published_date : null,
        }))
        .filter((source) => source.url && source.snippet)
    ).slice(0, MAX_RESULTS_PER_CLAIM);

    return {
      backend: "tavily",
      sources,
      answer: safeSnippet(data.answer, 280),
      error: null,
    };
  } catch (error) {
    console.warn("[fact-check] Tavily request error:", error);
    return {
      backend: "tavily",
      sources: [],
      error: "Tavily request failed before a response was returned.",
    };
  }
}

async function searchWithSerper(claim: ResearchClaim): Promise<SearchEvidence | null> {
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: `cricket ${claim.query}`,
        num: MAX_RESULTS_PER_CLAIM,
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text();
      console.warn("[fact-check] Serper search failed:", res.status, body);
      return {
        backend: "serper",
        sources: [],
        error: `Serper request failed with HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as SerperSearchResponse;
    const sources = dedupeSources(
      (data.organic || [])
        .map((result) => ({
          title: safeSnippet(result.title, 120),
          url: typeof result.link === "string" ? result.link : "",
          snippet: safeSnippet(result.snippet, 280),
          domain: typeof result.link === "string" ? normaliseDomain(result.link) : "",
          publishedDate: typeof result.date === "string" ? result.date : null,
        }))
        .filter((source) => source.url && source.snippet)
    ).slice(0, MAX_RESULTS_PER_CLAIM);

    const answerBox = data.answerBox?.snippet || data.answerBox?.answer || "";

    return {
      backend: "serper",
      sources,
      answer: safeSnippet(answerBox, 280),
      error: null,
    };
  } catch (error) {
    console.warn("[fact-check] Serper request error:", error);
    return {
      backend: "serper",
      sources: [],
      error: "Serper request failed before a response was returned.",
    };
  }
}

async function searchEvidenceForClaim(claim: ResearchClaim): Promise<SearchEvidence> {
  if (process.env.SERPER_API_KEY?.trim()) {
    return (await searchWithSerper(claim)) ?? { backend: "none", sources: [] };
  }

  const tavily = await searchWithTavily(claim);
  if (tavily) return tavily;

  return {
    backend: "none",
    sources: [],
  };
}

async function evaluateClaimsWithOllama(claims: ClaimWithSearch[]): Promise<FactCheckVerdictEntry[]> {
  if (claims.length === 0) return [];

  const prompt = `You are CricGeek's cricket fact-checking judge.
Review each claim against the source snippets and return strict JSON only:
{
  "results": [
    {
      "claim_index": 0,
      "verdict": "supported|contradicted|inconclusive",
      "confidence": 0.0,
      "evidence": "",
      "source_indices": [0]
    }
  ]
}

Decision rules:
- supported: reliable sources clearly back the claim.
- contradicted: reliable sources clearly conflict with the claim.
- inconclusive: evidence is partial, mixed, indirect, outdated, or missing.
- Be conservative. If you are not sure, use inconclusive.
- evidence must be a single short sentence.
- Use at most 2 source indices per claim.

Claims and sources:
${claims
  .map(({ claim, evidence }, claimIndex) => {
    const sourceBlock = evidence.sources.length
      ? evidence.sources
          .map(
            (source, sourceIndex) =>
              `  (${sourceIndex}) ${source.domain} | ${source.title}\n      URL: ${source.url}\n      Snippet: ${source.snippet}`
          )
          .join("\n")
      : "  (no usable sources returned)";

    return `[${claimIndex}] Claim: ${claim.claim}
Category: ${claim.category}
Query: ${claim.query}
Search answer: ${evidence.answer || "none"}
Sources:
${sourceBlock}`;
  })
  .join("\n\n")}`;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: getOllamaHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        format: "json",
        think: false,
        stream: false,
        options: {
          temperature: 0.05,
          top_p: 0.85,
          num_predict: 900,
        },
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn("[fact-check] Verdict synthesis failed:", await res.text());
      return buildFallbackVerdicts(claims);
    }

    const raw = (await res.json()) as unknown;
    const parsed = parseJsonPayload<VerdictPayload>(raw, validateVerdictPayload);
    if (!parsed?.results || !Array.isArray(parsed.results)) {
      return buildFallbackVerdicts(claims);
    }

    const verdictByIndex = new Map<number, FactCheckVerdictEntry>();

    for (const item of parsed.results) {
      if (!item || typeof item.claim_index !== "number") continue;
      const target = claims[item.claim_index];
      if (!target) continue;

      const verdict =
        item.verdict === "supported" || item.verdict === "contradicted" || item.verdict === "inconclusive"
          ? item.verdict
          : "inconclusive";
      const sourceIndices = Array.isArray(item.source_indices)
        ? item.source_indices.filter((value): value is number => Number.isInteger(value)).slice(0, 2)
        : [];

      verdictByIndex.set(item.claim_index, {
        claim: target.claim.claim,
        query: target.claim.query,
        category: target.claim.category,
        route: "web_search",
        verdict,
        confidence: clampUnit(item.confidence, verdict === "inconclusive" ? 0.35 : 0.6),
        evidence: safeSnippet(item.evidence, 220) || fallbackEvidence(verdict),
        sources: sourceIndices
          .map((index) => target.evidence.sources[index])
          .filter((source): source is FactCheckSource => Boolean(source)),
      });
    }

    return claims.map((claim, index) => {
      const fromModel = verdictByIndex.get(index);
      if (fromModel) {
        return {
          ...fromModel,
          sources: fromModel.sources.length > 0 ? fromModel.sources : claim.evidence.sources.slice(0, 2),
        };
      }

      return {
        claim: claim.claim.claim,
        query: claim.claim.query,
        category: claim.claim.category,
        route: "web_search",
        verdict: claim.evidence.sources.length > 0 ? "inconclusive" : "inconclusive",
        confidence: 0.35,
        evidence: claim.evidence.sources.length > 0
          ? "Available snippets were not strong enough for a confident verdict."
          : "Search did not return enough trusted evidence.",
        sources: claim.evidence.sources.slice(0, 2),
      };
    });
  } catch (error) {
    console.warn("[fact-check] Verdict synthesis unavailable:", error);
    return buildFallbackVerdicts(claims);
  }
}

function fallbackEvidence(verdict: FactCheckVerdict): string {
  if (verdict === "supported") return "Reliable snippets line up with the claim.";
  if (verdict === "contradicted") return "Reliable snippets conflict with the claim.";
  return "The evidence was mixed or incomplete.";
}

function buildFallbackVerdicts(claims: ClaimWithSearch[]): FactCheckVerdictEntry[] {
  return claims.map(({ claim, evidence }) => ({
    claim: claim.claim,
    query: claim.query,
    category: claim.category,
    route: "web_search" as const,
    verdict: "inconclusive" as const,
    confidence: 0.25,
    evidence: evidence.sources.length > 0
      ? "Trusted sources were found, but the verdict model was unavailable."
      : "Search did not return enough trusted evidence.",
    sources: evidence.sources.slice(0, 2),
  }));
}

function computeFactCheckScore(
  supported: number,
  contradicted: number,
  inconclusive: number
): number {
  const total = supported + contradicted + inconclusive;
  if (total === 0) return 75;

  const checkable = supported + contradicted;
  if (checkable === 0) return 75;

  const accuracy = supported / checkable;
  const baseScore = accuracy * 100;
  const contradictionPenalty = (contradicted / total) * 30;
  const effortBonus = (checkable / total) * 10;

  return clampScore(baseScore - contradictionPenalty + effortBonus, 75);
}

function buildSummary(report: {
  backend: SearchBackend;
  searchError?: string | null;
  claimsDetected: number;
  claimsResearched: number;
  supported: number;
  contradicted: number;
  inconclusive: number;
  providerAvailable: boolean;
}): string {
  if (!report.providerAvailable && report.claimsDetected > 0) {
    return `${report.claimsDetected} broader claims were detected, but web fact-checking is disabled because no search API key is configured.`;
  }

  if (report.searchError) {
    return `${report.claimsDetected} broader claims were detected, but web fact-checking via ${report.backend} failed. ${report.searchError}.`;
  }

  if (report.claimsDetected > 0 && report.claimsResearched === 0) {
    return `${report.claimsDetected} broader claims were detected, but search did not return enough trusted evidence to verify them.`;
  }

  if (report.claimsResearched === 0) {
    return report.providerAvailable
      ? "No broader factual claims needed web verification."
      : "Web fact-checking is disabled because no search API key is configured.";
  }

  const parts = [`${report.claimsResearched} broader claims checked`];

  if (report.supported > 0) parts.push(`${report.supported} supported`);
  if (report.contradicted > 0) parts.push(`${report.contradicted} contradicted`);
  if (report.inconclusive > 0) parts.push(`${report.inconclusive} inconclusive`);

  const backendText = report.backend === "none" ? "without a search backend" : `via ${report.backend}`;
  return `${parts.join(", ")} ${backendText}.`;
}

export async function runWebFactCheck(input: {
  title?: string;
  content: string;
}): Promise<WebFactCheckReport> {
  const providerAvailable = Boolean(process.env.TAVILY_API_KEY || process.env.SERPER_API_KEY);

  if (!looksLikeClaimHeavyContent(input.content)) {
    const warehouseStatus = await getHistoricalWarehouseStatus();

    return {
      providerAvailable,
      historicalWarehouseAvailable: warehouseStatus.available,
      historicalWarehouseError: warehouseStatus.error ?? null,
      searchBackend: "none",
      searchError: null,
      claimsDetected: 0,
      claimsResearched: 0,
      supported: 0,
      contradicted: 0,
      inconclusive: 0,
      score: 75,
      summary: "No broader factual claims needed external verification.",
      claimRouting: {
        historicalStructured: 0,
        webSearch: 0,
        unsupported: 0,
        reroutedToWeb: 0,
      },
      historicalClaims: {
        claimsRouted: 0,
        claimsResolved: 0,
        supported: 0,
        contradicted: 0,
        inconclusive: 0,
        score: 75,
        summary: "No structured historical claims were routed to the warehouse.",
        verdicts: [],
      },
      webClaims: {
        claimsRouted: 0,
        claimsResearched: 0,
        supported: 0,
        contradicted: 0,
        inconclusive: 0,
        score: 75,
        summary: providerAvailable
          ? "No web-search claims were routed for verification."
          : "Web fact-checking is disabled because no search API key is configured.",
        verdicts: [],
      },
      verdicts: [],
    };
  }

  const claims = await extractResearchClaimsWithOllama(input);
  const historicalStructuredClaims = claims.filter(
    (claim): claim is ResearchClaim & { intent: HistoricalQueryIntent } =>
      claim.route === "historical_structured" && isHistoricalIntentSupported(claim.intent)
  );
  const explicitWebClaims = claims.filter((claim) => claim.route === "web_search");
  const unsupportedCount = claims.filter((claim) => claim.route === "unsupported").length;
  const historicalInput: HistoricalWarehouseClaim[] = historicalStructuredClaims.map((claim) => ({
    claim: claim.claim,
    query: claim.query,
    category: claim.category,
    intent: claim.intent,
  }));

  const historicalReport = await runHistoricalWarehouseCheck(historicalInput);
  const reroutedToWeb = historicalReport.fallbackClaims.length;
  const webClaims = [...explicitWebClaims, ...historicalReport.fallbackClaims.map((claim) => ({
    ...claim,
    route: "web_search" as const,
    intent: claim.intent,
  }))];

  if (claims.length === 0) {
    return {
      providerAvailable,
      historicalWarehouseAvailable: historicalReport.warehouseAvailable,
      historicalWarehouseError: historicalReport.warehouseError ?? null,
      searchBackend: "none",
      searchError: null,
      claimsDetected: 0,
      claimsResearched: 0,
      supported: 0,
      contradicted: 0,
      inconclusive: 0,
      score: 75,
      summary: providerAvailable
        ? "No broader factual claims needed external verification."
        : "No broader factual claims needed verification, and no search backend is configured.",
      claimRouting: {
        historicalStructured: 0,
        webSearch: 0,
        unsupported: 0,
        reroutedToWeb: 0,
      },
      historicalClaims: {
        claimsRouted: 0,
        claimsResolved: 0,
        supported: 0,
        contradicted: 0,
        inconclusive: 0,
        score: 75,
        summary: "No structured historical claims were routed to the warehouse.",
        verdicts: [],
      },
      webClaims: {
        claimsRouted: 0,
        claimsResearched: 0,
        supported: 0,
        contradicted: 0,
        inconclusive: 0,
        score: 75,
        summary: providerAvailable
          ? "No web-search claims were routed for verification."
          : "Web fact-checking is disabled because no search API key is configured.",
        verdicts: [],
      },
      verdicts: [],
    };
  }

  let backend: SearchBackend = "none";
  let searchError: string | null = null;
  let webVerdicts: FactCheckVerdictEntry[] = [];

  if (webClaims.length > 0 && providerAvailable) {
    const withSearch = await Promise.all(
      webClaims.map(async (claim) => ({
        claim,
        evidence: await searchEvidenceForClaim(claim),
      }))
    );

    backend = withSearch.find((item) => item.evidence.backend !== "none")?.evidence.backend ?? "none";
    searchError = withSearch.find((item) => item.evidence.error)?.evidence.error ?? null;

    const searchableClaims = withSearch.filter((item) => item.evidence.sources.length > 0);
    if (searchableClaims.length > 0) {
      webVerdicts = await evaluateClaimsWithOllama(searchableClaims);
    }
  } else if (webClaims.length > 0 && !providerAvailable) {
    searchError = "No search API key is configured for web fact-checking.";
  }

  const webSupported = webVerdicts.filter((item) => item.verdict === "supported").length;
  const webContradicted = webVerdicts.filter((item) => item.verdict === "contradicted").length;
  const webInconclusive = webVerdicts.filter((item) => item.verdict === "inconclusive").length;
  const webScore = computeFactCheckScore(webSupported, webContradicted, webInconclusive);
  const webSummary = buildSummary({
    backend,
    searchError,
    claimsDetected: webClaims.length,
    claimsResearched: webVerdicts.length,
    supported: webSupported,
    contradicted: webContradicted,
    inconclusive: webInconclusive,
    providerAvailable,
  });

  const historicalResolved = historicalReport.claimsResolved;
  const totalResearched = historicalResolved + webVerdicts.length;
  const totalSupported = historicalReport.supported + webSupported;
  const totalContradicted = historicalReport.contradicted + webContradicted;
  const totalInconclusive = historicalReport.inconclusive + webInconclusive;

  let overallScore = 75;
  if (historicalResolved > 0 && webVerdicts.length > 0) {
    overallScore =
      (historicalReport.score * historicalResolved + webScore * webVerdicts.length) /
      (historicalResolved + webVerdicts.length);
  } else if (historicalResolved > 0) {
    overallScore = historicalReport.score;
  } else if (webVerdicts.length > 0) {
    overallScore = webScore;
  }

  const summaryParts = [
    historicalReport.summary,
    webSummary,
  ].filter(Boolean);

  return {
    providerAvailable,
    historicalWarehouseAvailable: historicalReport.warehouseAvailable,
    historicalWarehouseError: historicalReport.warehouseError ?? null,
    searchBackend: backend,
    searchError,
    claimsDetected: claims.length,
    claimsResearched: totalResearched,
    supported: totalSupported,
    contradicted: totalContradicted,
    inconclusive: totalInconclusive,
    score: clampScore(overallScore, 75),
    summary: summaryParts.join(" "),
    claimRouting: {
      historicalStructured: historicalStructuredClaims.length,
      webSearch: explicitWebClaims.length,
      unsupported: unsupportedCount,
      reroutedToWeb,
    },
    historicalClaims: {
      claimsRouted: historicalReport.claimsRouted,
      claimsResolved: historicalReport.claimsResolved,
      supported: historicalReport.supported,
      contradicted: historicalReport.contradicted,
      inconclusive: historicalReport.inconclusive,
      score: historicalReport.score,
      summary: historicalReport.summary,
      verdicts: historicalReport.verdicts.map((verdict) => ({
        claim: verdict.claim,
        query: verdict.query,
        category: verdict.category,
        route: "historical_structured" as const,
        verdict: verdict.verdict,
        confidence: verdict.confidence,
        evidence: verdict.evidence,
        sources: verdict.sources,
        intent: verdict.intent,
      })),
    },
    webClaims: {
      claimsRouted: webClaims.length,
      claimsResearched: webVerdicts.length,
      supported: webSupported,
      contradicted: webContradicted,
      inconclusive: webInconclusive,
      score: webScore,
      summary: webSummary,
      verdicts: webVerdicts,
    },
    verdicts: [
      ...historicalReport.verdicts.map((verdict) => ({
        claim: verdict.claim,
        query: verdict.query,
        category: verdict.category,
        route: "historical_structured" as const,
        verdict: verdict.verdict,
        confidence: verdict.confidence,
        evidence: verdict.evidence,
        sources: verdict.sources,
        intent: verdict.intent,
      })),
      ...webVerdicts,
    ],
  };
}
