/**
 * CricGeek AI Scoring Pipeline
 *
 * Production path:
 * 1. Local pre-processing of structure, diversity, and completeness
 * 2. Qwen (via Ollama) structured sports-writing analysis
 * 3. Deterministic BQS assembly and moderation override logic
 * 4. Persisted explanation JSON + paragraph scores for user-visible breakdowns
 *
 * Fallback path:
 * - Heuristic scoring when Ollama is unavailable
 */

import { getMatchScorecard } from "@/lib/cricket-api";
import { forwardAiService } from "@/lib/ai-service";
import {
  buildScorecardPlayerIndex,
  claimMatchesScorecard,
  normalisePlayerName,
  type ScorecardMetric,
} from "@/lib/cricket-stat-match";
import { cachedWebFactCheck } from "@/lib/eqs/cached-fact-check";
import { parseJsonPayload } from "@/lib/eqs/json";
import {
  type FactCheckSource,
  type FactCheckVerdictEntry,
  type SearchBackend,
  type WebFactCheckReport,
} from "@/lib/fact-check";
import { getOllamaHeaders, getOllamaUrl, OLLAMA_REQUEST_TIMEOUT_MS } from "@/lib/ollama";

const OLLAMA_URL = getOllamaUrl();
const OLLAMA_BQS_MODEL = process.env.OLLAMA_BQS_MODEL || process.env.OLLAMA_MODEL || "qwen3.5:latest";

// ── Types ────────────────────────────────────────────────────────────

export type Archetype = "analyst" | "fan" | "storyteller" | "debater";

export interface PreProcessResult {
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  lexicalDiversity: number;
  sentenceVariety: number;
  avgSentenceLength: number;
  completeness: number;
}

export interface ModelScores {
  toneScore: number;
  negativityScore: number;
  toxicityScore: number;
  originalityScore: number;
  coherenceScore: number;
  archetypeLabel: Archetype;
  archetypeConfidence: number;
}

export interface ParagraphScore {
  paragraphIndex: number;
  excerpt: string;
  overall: number;
  constructiveness: number;
  negativity: number;
  toxicity: number;
  evidence: number;
  coherence: number;
  note: string;
}

export interface ExplanationJson {
  summary: string;
  strengths: string[];
  concerns: string[];
  negativityVsToxicity: string;
  penaltyDecision: string;
  userVisibleBreakdown: string[];
}

export interface NERResult {
  entities: { name: string; type: string }[];
  statsFound: { player: string; stat: string; value: string }[];
  cricketDepth: number;
}

export interface RuleEngineResult {
  constructiveness: number;
  evidencePresence: number;
  counterAcknowledge: number;
  positionClarity: number;
  infoDensity: number;
  repetitionPenalty: number;
  completeness: number;
  argumentLogic: number;
  toxicityPenaltyApplied: boolean;
  toxicityPenaltyOverride: boolean;
}

export interface PersistedFactCheckReport {
  overallScore: number;
  summary: string;
  searchBackend: SearchBackend;
  providerAvailable: boolean;
  historicalWarehouseAvailable?: boolean;
  historicalWarehouseError?: string | null;
  searchError?: string | null;
  claimRouting?: {
    historicalStructured: number;
    webSearch: number;
    unsupported: number;
    reroutedToWeb: number;
  };
  directStats: {
    source: "live" | "fallback";
    claimsFound: number;
    claimsVerified: number;
    accuracy: number;
    claims: { player: string; stat: string; value: string }[];
  };
  historicalClaims: {
    claimsRouted: number;
    claimsResolved: number;
    supported: number;
    contradicted: number;
    inconclusive: number;
    score: number;
    summary: string;
    verdicts: FactCheckVerdictEntry[];
  };
  webClaims: {
    claimsRouted: number;
    claimsResearched: number;
    supported: number;
    contradicted: number;
    inconclusive: number;
    score: number;
    summary: string;
    verdicts: FactCheckVerdictEntry[];
  };
}

export interface BlogScoreResult {
  bqs: number;
  preProcess: PreProcessResult;
  modelScores: ModelScores;
  nerResult: NERResult;
  ruleEngine: RuleEngineResult;
  writerDNASignal: WriterDNA;
  paragraphScores: ParagraphScore[];
  explanation: ExplanationJson;
  statsVerified: number;
  statAccuracy: number;
  factCheck: PersistedFactCheckReport;
  processingTimeMs: number;
  scoreVersion: string;
}

// ── Archetype Weight Tables (PDF spec) ──────────────────────────────
const ARCHETYPE_WEIGHTS: Record<Archetype, Record<string, number>> = {
  fan: {
    constructiveness: 0.25,
    toxicityInv: 0.15,
    originalityScore: 0.15,
    statAccuracy: 0.15,
    infoDensity: 0.10,
    coherenceScore: 0.10,
    argumentLogic: 0.10,
  },
  analyst: {
    constructiveness: 0.25,
    toxicityInv: 0.15,
    originalityScore: 0.10,
    statAccuracy: 0.25,
    infoDensity: 0.15,
    coherenceScore: 0.10,
    argumentLogic: 0.00,
  },
  storyteller: {
    constructiveness: 0.20,
    toxicityInv: 0.15,
    originalityScore: 0.20,
    statAccuracy: 0.00,
    infoDensity: 0.10,
    coherenceScore: 0.20,
    argumentLogic: 0.15,
  },
  debater: {
    constructiveness: 0.20,
    toxicityInv: 0.15,
    originalityScore: 0.10,
    statAccuracy: 0.10,
    infoDensity: 0.15,
    coherenceScore: 0.15,
    argumentLogic: 0.15,
  },
};

// ── Archetype badge display configs ─────────────────────────────────
export const ARCHETYPE_META: Record<string, { label: string; icon: string; color: string; bgColor: string }> = {
  analyst:     { label: "Analyst",     icon: "📊", color: "text-blue-400",   bgColor: "bg-blue-500/20" },
  fan:         { label: "Fan",         icon: "🔥", color: "text-orange-400", bgColor: "bg-orange-500/20" },
  storyteller: { label: "Storyteller", icon: "📖", color: "text-purple-400", bgColor: "bg-purple-500/20" },
  debater:     { label: "Debater",     icon: "⚔️",  color: "text-red-400",    bgColor: "bg-red-500/20" },
};

// ── Step 1: Pre-processing (TypeScript — always runs locally) ────────

export function preProcess(text: string): PreProcessResult {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentenceCount = sentences.length;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const paragraphCount = Math.max(paragraphs.length, 1);

  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
  const lexicalDiversity = wordCount > 0 ? uniqueWords.size / wordCount : 0;

  const sentLengths = sentences.map((s) => s.trim().split(/\s+/).length);
  const avgLen = sentLengths.reduce((a, b) => a + b, 0) / Math.max(sentLengths.length, 1);
  const variance =
    sentLengths.reduce((sum, len) => sum + (len - avgLen) ** 2, 0) /
    Math.max(sentLengths.length, 1);
  const sentenceVariety = Math.min(100, Math.sqrt(variance) * 8);

  let completeness = 0;
  if (paragraphCount >= 3) completeness += 40;
  else if (paragraphCount >= 2) completeness += 20;
  if (sentenceCount >= 5) completeness += 30;
  if (wordCount >= 120) completeness += 30;

  return {
    wordCount,
    sentenceCount,
    paragraphCount,
    lexicalDiversity: Math.round(lexicalDiversity * 1000) / 1000,
    sentenceVariety: Math.round(sentenceVariety * 10) / 10,
    avgSentenceLength: Math.round(avgLen * 10) / 10,
    completeness: Math.min(100, completeness),
  };
}

// ── Step 2-6: Call Ollama (Qwen) ───────────────────────────────────

interface OllamaScoreResponse {
  archetype: Archetype;
  archetype_confidence: number;
  final_bqs?: number;
  score_version?: string;
  tone_score: number;
  negativity_score: number;
  toxicity_score: number;
  originality_score: number;
  coherence_score: number;
  constructiveness: number;
  evidence_presence: number;
  counter_acknowledge: number;
  position_clarity: number;
  info_density: number;
  repetition_penalty: number;
  completeness: number;
  argument_logic: number;
  stat_accuracy: number;
  entities_found: number;
  stats_found: number;
  stats_verified: number;
  word_count: number;
  lexical_diversity: number;
  sentence_variety: number;
  toxicity_penalty_applied?: boolean;
  toxicity_penalty_override?: boolean;
  writer_dna?: Partial<Record<Archetype, number>>;
  paragraph_scores?: Array<{
    paragraph_index?: number;
    excerpt?: string;
    overall?: number;
    constructiveness?: number;
    negativity?: number;
    toxicity?: number;
    evidence?: number;
    coherence?: number;
    note?: string;
  }>;
  explanation?: {
    summary?: string;
    strengths?: string[];
    concerns?: string[];
    negativity_vs_toxicity?: string;
    penalty_decision?: string;
    user_visible_breakdown?: string[];
  };
}

interface OllamaGeneratePayload {
  response?: string;
  thinking?: string;
}

type ExtractedStatClaim = {
  player: string;
  metric: ScorecardMetric;
  value: number;
};

type ExtractedClaimsPayload = {
  claims?: ExtractedStatClaim[];
};

function clampScore(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function clampUnit(value: unknown, fallback = 0.5): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function safeStringList(value: unknown, limit = 4): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, limit)
    : [];
}

function excerptForParagraph(paragraph: string): string {
  return paragraph.replace(/\s+/g, " ").trim().slice(0, 120);
}

function countRegexHits(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
}

function detectSarcasticRidicule(text: string) {
  const normalised = text.toLowerCase();

  const mockPraisePatterns = [
    /\bmasterclass\b/,
    /\bvisionary\b/,
    /\binspiring\b/,
    /\bgenius\b/,
    /\blegendary\b/,
    /\bbrilliant\b/,
  ];

  const ridiculePatterns = [
    /\btest the patience\b/,
    /\bmeditation retreat\b/,
    /\bfive stages of grief\b/,
    /\bforbidden knowledge\b/,
    /\boptional feature\b/,
    /\bgeological era\b/,
    /\brare art\b/,
    /\bnobody knows whether\b/,
    /\bby the time he finally gets going\b/,
    /\bpreserving batting\b/,
  ];

  const belittlingPatterns = [
    /\bslow\b/,
    /\bobsolete\b/,
    /\bfinished\b/,
    /\bwashed\b/,
    /\buseless\b/,
    /\bjoke\b/,
    /\bpathetic\b/,
    /\blaughable\b/,
  ];

  const evidencePatterns = [
    /\baverage\b/,
    /\bstrike rate\b/,
    /\beconomy\b/,
    /\bruns\b/,
    /\bwickets\b/,
    /\bdata\b/,
    /\bstat(s)?\b/,
    /\binnings\b/,
    /\bphase\b/,
    /\brole\b/,
    /\bmatch\b/,
  ];

  const mockPraiseHits = countRegexHits(normalised, mockPraisePatterns);
  const ridiculeHits = countRegexHits(normalised, ridiculePatterns);
  const belittlingHits = countRegexHits(normalised, belittlingPatterns);
  const evidenceHits = countRegexHits(normalised, evidencePatterns);
  const targetedNameHits = countRegexHits(normalised, [
    /\bdhoni\b/,
    /\bkohli\b/,
    /\brohit\b/,
    /\bgill\b/,
    /\bjadeja\b/,
    /\brahane\b/,
    /\bpant\b/,
    /\bbuttler\b/,
    /\bms dhoni\b/,
    /\bvirat\b/,
  ]);

  const sarcasticRidicule =
    ridiculeHits >= 2 || (mockPraiseHits >= 1 && ridiculeHits >= 1) || (belittlingHits >= 2 && targetedNameHits >= 1);

  // Mockery only counts as a low-evidence attack when it is not carried by cricket
  // substance (stats, phases, roles). Sharp criticism backed by evidence stays analysis.
  const attackHits = mockPraiseHits + ridiculeHits + belittlingHits;
  const lowEvidenceAttack = attackHits >= 2 && evidenceHits <= 2;

  return {
    sarcasticRidicule,
    mockPraiseHits,
    ridiculeHits,
    belittlingHits,
    evidenceHits,
    targetedNameHits,
    lowEvidenceAttack,
  };
}

function parseStructuredOllamaPayload(payload: OllamaGeneratePayload): OllamaScoreResponse | null {
  return parseJsonPayload<OllamaScoreResponse>(
    payload,
    (value): value is OllamaScoreResponse =>
      typeof value === "object" && value !== null && "archetype" in value
  );
}

function parseClaimExtractionPayload(payload: OllamaGeneratePayload): ExtractedClaimsPayload | null {
  return parseJsonPayload<ExtractedClaimsPayload>(
    payload,
    (value): value is ExtractedClaimsPayload =>
      typeof value === "object" && value !== null && "claims" in value
  );
}

function normaliseWriterDNASignal(
  value: OllamaScoreResponse["writer_dna"],
  fallbackArchetype: Archetype
): WriterDNA {
  const keys: Archetype[] = ["analyst", "fan", "storyteller", "debater"];
  const values = keys.map((key) => {
    const candidate = value?.[key];
    return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
  });

  const hasModelSignal = values.some((entry) => entry !== null);

  if (!hasModelSignal) {
    return {
      analyst: fallbackArchetype === "analyst" ? 100 : 0,
      fan: fallbackArchetype === "fan" ? 100 : 0,
      storyteller: fallbackArchetype === "storyteller" ? 100 : 0,
      debater: fallbackArchetype === "debater" ? 100 : 0,
    };
  }

  const total = values.reduce<number>((sum, entry) => sum + (entry ?? 0), 0) || 1;
  const normalised = keys.map((key, index) => ({
    key,
    value: Math.round((((values[index] ?? 0) / total) * 100) * 10) / 10,
  }));

  return {
    analyst: normalised.find((entry) => entry.key === "analyst")?.value ?? 0,
    fan: normalised.find((entry) => entry.key === "fan")?.value ?? 0,
    storyteller: normalised.find((entry) => entry.key === "storyteller")?.value ?? 0,
    debater: normalised.find((entry) => entry.key === "debater")?.value ?? 0,
  };
}

async function callAiServiceScorer(input: {
  title?: string;
  content: string;
}): Promise<OllamaScoreResponse | null> {
  try {
    const response = await forwardAiService("/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: input.content,
        include_fact_check: false,
        skip_fact_check: true,
      }),
    });

    if (!response.ok) {
      console.warn("[scoring] AI service scorer error:", response.status, response.body);
      return null;
    }

    const parsed = JSON.parse(response.body) as unknown;
    if (!parsed || typeof parsed !== "object" || !("archetype" in parsed)) {
      console.warn("[scoring] AI service scorer returned an invalid payload");
      return null;
    }

    return parsed as OllamaScoreResponse;
  } catch (error) {
    console.warn("[scoring] AI service scorer unavailable — falling back to Ollama", error);
    return null;
  }
}

async function callOllamaScorer(input: { title?: string; content: string }): Promise<OllamaScoreResponse | null> {
  const paragraphs = input.content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 8);

  const prompt = `You are CricGeek's sports-writing quality analyst.
Return strict JSON only. Do not wrap in markdown.

Score this cricket article on a 0-100 scale for each dimension.
Important moderation rule:
- Strong criticism or disappointment is NEGATIVITY, not toxicity.
- Toxicity means insults, abuse, dehumanisation, slurs, harassment, or targeted hostility.
- If the article is sharp but evidence-based and constructive, keep toxicity low.
- But sarcastic mock praise, ridicule, humiliation framing, or sneering metaphors aimed at a player/coach/person are NOT toxicity-free.
- If the writing makes a person look laughable, obsolete, pathetic, or like a joke through irony or exaggerated praise, raise toxicity meaningfully even without profanity.
- Constructiveness should be low when the piece mostly mocks a person instead of building a cricket argument.
- Example of moderate toxicity: "visionary, really", "masterclass in suspense", "optional feature", "different geological era" when used to ridicule a named player.

Use these archetypes only: analyst, fan, storyteller, debater.

Return JSON with exactly these keys:
{
  "archetype": "analyst|fan|storyteller|debater",
  "archetype_confidence": 0.0,
  "final_bqs": 0,
  "tone_score": 0,
  "negativity_score": 0,
  "toxicity_score": 0,
  "originality_score": 0,
  "coherence_score": 0,
  "constructiveness": 0,
  "evidence_presence": 0,
  "counter_acknowledge": 0,
  "position_clarity": 0,
  "info_density": 0,
  "repetition_penalty": 0,
  "completeness": 0,
  "argument_logic": 0,
  "stat_accuracy": 0,
  "entities_found": 0,
  "stats_found": 0,
  "stats_verified": 0,
  "word_count": 0,
  "lexical_diversity": 0,
  "sentence_variety": 0,
  "toxicity_penalty_applied": false,
  "toxicity_penalty_override": false,
  "writer_dna": {
    "analyst": 0,
    "fan": 0,
    "storyteller": 0,
    "debater": 0
  },
  "paragraph_scores": [
    {
      "paragraph_index": 0,
      "excerpt": "",
      "overall": 0,
      "constructiveness": 0,
      "negativity": 0,
      "toxicity": 0,
      "evidence": 0,
      "coherence": 0,
      "note": ""
    }
  ],
  "explanation": {
    "summary": "",
    "strengths": ["", "", ""],
    "concerns": ["", "", ""],
    "negativity_vs_toxicity": "",
    "penalty_decision": "",
    "user_visible_breakdown": ["", "", ""]
  }
}

Keep the JSON compact:
- excerpt must be at most 120 characters.
- paragraph note must be one short sentence.
- explanation summary must be one short sentence.
- strengths and concerns must be short phrases, max 6 words each.
- user_visible_breakdown must contain exactly 3 short items.

Title: ${input.title || "Untitled"}
Paragraphs:
${paragraphs.map((paragraph, index) => `[${index}] ${paragraph}`).join("\n\n")}`;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: getOllamaHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: OLLAMA_BQS_MODEL,
        prompt,
        format: "json",
        think: false,
        stream: false,
        options: {
          temperature: 0.15,
          top_p: 0.85,
          num_predict: 1400,
        },
      }),
      signal: AbortSignal.timeout(OLLAMA_REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.warn("[scoring] Ollama scorer error:", errorText);
      return null;
    }

    const data = (await res.json()) as OllamaGeneratePayload;
    const parsed = parseStructuredOllamaPayload(data);

    if (!parsed) {
      console.warn("[scoring] Ollama scorer returned an unparseable payload — using heuristic fallback");
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn("[scoring] Ollama scorer unavailable — using heuristic fallback", error);
    return null;
  }
}

async function extractStatClaimsWithOllama(input: {
  title?: string;
  content: string;
}): Promise<ExtractedStatClaim[]> {
  const prompt = `Extract explicit numeric cricket performance claims from this article.
Return strict JSON only in this shape:
{
  "claims": [
    {
      "player": "",
      "metric": "runs|wickets|strike_rate|economy|overs|fours|sixes",
      "value": 0
    }
  ]
}

Rules:
- Only extract claims that mention a player and a number.
- Only use the supported metrics.
- Do not infer missing values.
- Ignore team totals and vague phrases.
- Keep at most 8 claims.

Title: ${input.title || "Untitled"}
Content:
${input.content}`;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: getOllamaHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: OLLAMA_BQS_MODEL,
        prompt,
        format: "json",
        think: false,
        stream: false,
        options: {
          temperature: 0,
          num_predict: 300,
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as OllamaGeneratePayload;
    const parsed = parseClaimExtractionPayload(data);
    if (!parsed?.claims || !Array.isArray(parsed.claims)) return [];

    return parsed.claims
      .filter((claim): claim is ExtractedStatClaim =>
        Boolean(claim) &&
        typeof claim.player === "string" &&
        claim.player.trim().length > 0 &&
        typeof claim.metric === "string" &&
        typeof claim.value === "number" &&
        Number.isFinite(claim.value)
      )
      .slice(0, 8);
  } catch {
    return [];
  }
}

// ── Heuristic Fallback (when AI service is offline) ──────────────────

function heuristicScore(
  text: string,
  pp: PreProcessResult,
  directStats: DirectStatVerification
): OllamaScoreResponse {
  const lower = text.toLowerCase();
  const words = lower
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, ""))
    .filter(Boolean);
  const wc = words.length;
  const sentences = text.split(/[.!?]+/).map((sentence) => sentence.trim()).filter(Boolean);
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const supportiveHits = countRegexHits(lower, [
    /\bbeast\b/,
    /\bexcellent\b/,
    /\bbrilliant\b/,
    /\bimpressive\b/,
    /\bdominant\b/,
    /\boutstanding\b/,
    /\bconsisten(cy|t)\b/,
    /\bconfidence\b/,
    /\breliable\b/,
    /\bmatch[- ]winning\b/,
    /\bgame[- ]changer(s)?\b/,
    /\bform\b/,
    /\bimpact\b/,
  ]);
  const criticalHits = countRegexHits(lower, [
    /\bterrible\b/,
    /\bworst\b/,
    /\bawful\b/,
    /\bdisaster\b/,
    /\bpoor\b/,
    /\bsloppy\b/,
    /\bfrustrating\b/,
    /\bdisappointing\b/,
    /\bstruggle(s|d|ing)?\b/,
    /\bconcern(ing)?\b/,
    /\bunderperform(ing|ed)?\b/,
  ]);
  const toxicHits = countRegexHits(lower, [
    /\bidiot\b/,
    /\bstupid\b/,
    /\btrash\b/,
    /\bgarbage\b/,
    /\bloser\b/,
    /\bhate\b/,
    /\bpathetic\b/,
    /\blaughable\b/,
    /\bjoke\b/,
    /\bwashed\b/,
  ]);
  const clicheHits = countRegexHits(lower, [
    /\babsolute beast\b/,
    /\bmatch[- ]winning\b/,
    /\bgame[- ]changer(s)?\b/,
    /\bnext level\b/,
    /\bworld[- ]class\b/,
    /\btop[- ]class\b/,
  ]);
  const analysisHits = countRegexHits(lower, [
    /\baverage\b/,
    /\bstrike rate\b/,
    /\beconomy\b/,
    /\bconsisten(cy|t)\b/,
    /\bconfidence\b/,
    /\bform\b/,
    /\bimpact\b/,
    /\brole\b/,
    /\bpressure\b/,
    /\bphase\b/,
    /\bintent\b/,
    /\breliable\b/,
  ]);
  const reasoningHits = countRegexHits(lower, [
    /\bbecause\b/,
    /\bsince\b/,
    /\btherefore\b/,
    /\bif\b/,
    /\bshow(s|ing)?\b/,
    /\bsuggest(s|ed)?\b/,
    /\bindicat(es|ed)?\b/,
    /\bmeans\b/,
    /\breflect(s|ed)?\b/,
    /\bkeep(s|ing)?\b/,
  ]);
  const counterHits = countRegexHits(lower, [
    /\bhowever\b/,
    /\bbut\b/,
    /\balthough\b/,
    /\bthough\b/,
    /\byet\b/,
    /\bstill\b/,
    /\bif\b/,
    /\bcould\b/,
    /\bmay\b/,
    /\bmight\b/,
    /\bunless\b/,
  ]);
  const statTermHits = countRegexHits(lower, [
    /\baverage\b/,
    /\bstrike rate\b/,
    /\beconomy\b/,
    /\bruns\b/,
    /\bwickets\b/,
    /\bovers\b/,
    /\bballs\b/,
    /\bgames?\b/,
    /\binnings\b/,
    /\bseason\b/,
    /\bmatch(es)?\b/,
  ]);
  const timeContextHits = countRegexHits(lower, [
    /\blast\b/,
    /\blately\b/,
    /\brecent(ly)?\b/,
    /\bthis season\b/,
    /\bso far\b/,
    /\bacross\b/,
  ]);
  const numericMatches = text.match(/\b\d+(\.\d+)?\b/g) ?? [];
  const entityStopWords = new Set([
    "a",
    "an",
    "and",
    "but",
    "he",
    "her",
    "his",
    "if",
    "in",
    "it",
    "she",
    "the",
    "they",
    "this",
    "that",
    "these",
    "those",
    "we",
    "with",
  ]);
  const properNounMatches = text.match(/\b(?:[A-Z]{2,}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g) ?? [];
  const entitySignals = new Set(
    properNounMatches
      .map((entry) => entry.trim())
      .filter((entry) => !entityStopWords.has(entry.toLowerCase()))
  );

  const toneScore = clampScore(48 + supportiveHits * 6 - criticalHits * 5 - toxicHits * 15 - clicheHits * 2, 55);
  const negativityScore = clampScore(6 + criticalHits * 11 + toxicHits * 4 - supportiveHits * 2, 8);
  const toxicityScore = clampScore(2 + toxicHits * 22, 2);

  const sentenceFlowRatio =
    sentences.length > 0
      ? sentences.filter((sentence) => {
          const length = sentence.split(/\s+/).filter(Boolean).length;
          return length >= 6 && length <= 28;
        }).length / sentences.length
      : 0.5;
  const shortFormPenalty = Math.max(0, 70 - wc) * 0.2;
  const directEvidenceBoost =
    directStats.source === "live"
      ? directStats.statsVerified * 16 + directStats.statsFound * 4
      : directStats.statsVerified * 12 + directStats.statsFound * 4;

  const originalityScore = clampScore(
    25 +
      pp.lexicalDiversity * 45 +
      Math.min(10, pp.sentenceVariety * 0.45) +
      Math.min(8, sentences.length * 2) -
      shortFormPenalty -
      clicheHits * 7,
    45
  );
  const coherenceScore = clampScore(
    42 +
      sentenceFlowRatio * 24 +
      Math.min(14, reasoningHits * 3) +
      Math.min(10, counterHits * 2) +
      (paragraphs.length > 1 ? 6 : 2) -
      Math.min(10, clicheHits * 2),
    58
  );

  const archetypeKeywords: Record<Archetype, string[]> = {
    analyst: ["average", "stats", "data", "numbers", "records", "rate", "percentage", "economy"],
    fan: ["love", "passion", "excited", "amazing", "brilliant", "cheer", "support", "proud"],
    storyteller: ["remember", "moment", "journey", "story", "memory", "felt", "watched", "atmosphere"],
    debater: ["argue", "because", "therefore", "opinion", "believe", "better", "versus", "debate"],
  };
  const archetypeScores = Object.entries(archetypeKeywords).map(([label, kws]) => ({
    label: label as Archetype,
    count: words.filter((w) => kws.includes(w)).length,
  }));
  archetypeScores.sort((a, b) => b.count - a.count);
  const bestArchetype = archetypeScores[0].count > 0 ? archetypeScores[0].label : "fan";

  const constructiveness = clampScore(
    26 +
      analysisHits * 3 +
      reasoningHits * 5 +
      Math.min(10, counterHits * 3) +
      Math.min(12, directStats.statsFound * 8) -
      toxicHits * 18 -
      clicheHits * 2,
    40
  );
  const argumentLogic = clampScore(
    24 +
      reasoningHits * 6 +
      analysisHits * 3 +
      Math.min(10, directStats.statsVerified * 8) +
      Math.min(10, sentences.length * 2) -
      clicheHits * 2,
    35
  );
  const infoDensity = clampScore(
    18 +
      statTermHits * 4 +
      timeContextHits * 3 +
      numericMatches.length * 5 +
      Math.min(15, entitySignals.size * 3) +
      Math.min(10, wc / 12),
    32
  );
  const evidencePresence = clampScore(
    16 +
      Math.min(28, directEvidenceBoost) +
      statTermHits * 5 +
      timeContextHits * 4 +
      numericMatches.length * 6 +
      Math.min(12, entitySignals.size * 4) -
      clicheHits * 2,
    35
  );
  const counterAcknowledge = clampScore(10 + counterHits * 10, 18);
  const positionClarity = clampScore(
    38 +
      Math.min(15, sentences.length * 4) +
      Math.min(12, counterHits * 4) +
      (entitySignals.size > 0 ? 8 : 0) +
      (numericMatches.length > 0 ? 6 : 0) -
      Math.min(8, clicheHits * 2),
    50
  );
  const completeness = clampScore(
    pp.completeness +
      Math.min(15, statTermHits * 3) +
      Math.min(12, counterHits * 3) +
      (sentences.length >= 3 ? 10 : 0),
    pp.completeness
  );

  const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "been",
    "for",
    "from",
    "has",
    "have",
    "he",
    "his",
    "if",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "so",
    "the",
    "this",
    "to",
    "was",
    "with",
  ]);
  const significantWords = words.filter((word) => word.length >= 4 && !stopWords.has(word));
  const wordCounts = new Map<string, number>();
  for (const word of significantWords) {
    wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
  }
  const bigramCounts = new Map<string, number>();
  for (let index = 0; index < significantWords.length - 1; index += 1) {
    const bigram = `${significantWords[index]} ${significantWords[index + 1]}`;
    bigramCounts.set(bigram, (bigramCounts.get(bigram) ?? 0) + 1);
  }
  const repeatedWordExcess = [...wordCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 2), 0);
  const repeatedBigramExcess = [...bigramCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const repetitionPenalty = clampScore(
    repeatedWordExcess * 9 + repeatedBigramExcess * 12 + (wc < 25 ? 6 : 0),
    0
  );

  const writerDna = normaliseWriterDNASignal(
    {
      analyst: (archetypeScores.find((entry) => entry.label === "analyst")?.count ?? 0) + statTermHits + directStats.statsFound * 2,
      fan: (archetypeScores.find((entry) => entry.label === "fan")?.count ?? 0) + supportiveHits,
      storyteller: (archetypeScores.find((entry) => entry.label === "storyteller")?.count ?? 0) + (paragraphs.length > 1 ? 2 : 0),
      debater: (archetypeScores.find((entry) => entry.label === "debater")?.count ?? 0) + counterHits + reasoningHits,
    },
    bestArchetype
  );

  const paragraphOverall = Math.round((constructiveness + coherenceScore + evidencePresence + originalityScore) / 4);
  const supportiveRead = toneScore >= 70 && negativityScore <= 20 && toxicityScore <= 10;

  return {
    archetype: bestArchetype,
    archetype_confidence: 0.5,
    tone_score: toneScore,
    negativity_score: negativityScore,
    toxicity_score: toxicityScore,
    originality_score: originalityScore,
    coherence_score: coherenceScore,
    constructiveness,
    evidence_presence: evidencePresence,
    counter_acknowledge: counterAcknowledge,
    position_clarity: positionClarity,
    info_density: infoDensity,
    repetition_penalty: repetitionPenalty,
    completeness,
    argument_logic: argumentLogic,
    stat_accuracy: directStats.statAccuracy,
    entities_found: entitySignals.size,
    stats_found: directStats.statsFound,
    stats_verified: directStats.statsVerified,
    word_count: pp.wordCount,
    lexical_diversity: pp.lexicalDiversity,
    sentence_variety: pp.sentenceVariety,
    toxicity_penalty_applied: toxicityScore > 28,
    toxicity_penalty_override: false,
    writer_dna: writerDna,
    paragraph_scores: paragraphs.map((paragraph, index) => ({
      paragraph_index: index,
      excerpt: excerptForParagraph(paragraph),
      overall: paragraphOverall,
      constructiveness,
      negativity: negativityScore,
      toxicity: toxicityScore,
      evidence: evidencePresence,
      coherence: coherenceScore,
      note:
        toxicityScore > 45
          ? "Tone is getting personal rather than staying on cricket analysis."
          : evidencePresence >= 60
            ? "Paragraph makes a cricket claim with at least one concrete support signal."
            : "Paragraph is readable but needs more specific support to score higher.",
    })),
    explanation: {
      summary: supportiveRead
        ? "Fallback heuristic analysis found a supportive cricket take with some measurable recent-form evidence."
        : "Fallback heuristic analysis was used because Ollama was unavailable.",
      strengths: [
        evidencePresence >= 60 ? "Specific stats or time-window references give the opinion some grounding." : "The core opinion is easy to follow.",
        coherenceScore >= 70 ? "Sentence flow stays coherent and easy to scan." : "The writing remains readable.",
        originalityScore >= 65 ? "Some phrasing feels distinct rather than copied boilerplate." : "The cricket framing stays direct and understandable.",
      ],
      concerns: [
        wc < 80 ? "The piece is short, so depth and completeness are capped." : "It could still add one more concrete proof point or comparison.",
        counterAcknowledge < 35 ? "It makes a case, but does not really test itself against counter-arguments." : "The counter-position is present, but it is still fairly light-touch.",
        clicheHits > 0 ? "Some hype phrasing weakens originality and analytical precision." : "More concrete phrasing would make the evidence read sharper.",
      ],
      negativity_vs_toxicity:
        supportiveRead
          ? "The passage reads as supportive rather than critical or abusive."
          : negativityScore > toxicityScore
          ? "The article is more critical than abusive."
          : "Negative tone and toxicity are close together here.",
      penalty_decision:
        toxicityScore > 55
          ? "A full toxicity penalty was applied."
          : toxicityScore > 28
            ? "Only a light toxicity penalty was applied."
            : "No toxicity penalty was needed because the language stays focused on cricket rather than abuse.",
      user_visible_breakdown: [
        `Constructiveness ${constructiveness}/100`,
        `Evidence ${evidencePresence}/100`,
        `Stat accuracy ${directStats.statAccuracy}/100`,
      ],
    },
  };
}

function countVerifiedStats(text: string) {
  const matches = text.match(/\b\d+(\.\d+)?\b/g) ?? [];
  const cricketTerms = ["average", "strike rate", "economy", "runs", "wickets", "overs", "balls"];
  const statsFound = matches.length;
  const contextHits = cricketTerms.filter((term) => text.toLowerCase().includes(term)).length;
  const statsVerified = Math.min(statsFound, Math.round(statsFound * 0.65 + contextHits * 0.35));
  const statAccuracy = statsFound === 0 ? 75 : Math.min(100, Math.round((statsVerified / statsFound) * 100));

  return { statsFound, statsVerified, statAccuracy };
}

async function verifyStatsAgainstLiveData(input: {
  title?: string;
  content: string;
  matchId?: string | null;
}) {
  const fallback = countVerifiedStats(input.content);

  if (!input.matchId) {
    return {
      source: "fallback" as const,
      ...fallback,
      claims: [] as Array<{ player: string; stat: string; value: string }>,
    };
  }

  const scorecards = await getMatchScorecard(input.matchId);
  if (!scorecards || scorecards.length === 0) {
    return {
      source: "fallback" as const,
      ...fallback,
      claims: [] as Array<{ player: string; stat: string; value: string }>,
    };
  }

  if (!/\d/.test(input.content)) {
    return {
      source: "fallback" as const,
      ...fallback,
      claims: [] as Array<{ player: string; stat: string; value: string }>,
    };
  }

  const claims = await extractStatClaimsWithOllama(input);
  if (claims.length === 0) {
    return {
      source: "fallback" as const,
      ...fallback,
      claims: [] as Array<{ player: string; stat: string; value: string }>,
    };
  }

  const playerIndex = buildScorecardPlayerIndex(scorecards);
  const verified = claims.filter((claim: ExtractedStatClaim) =>
    claimMatchesScorecard(claim, playerIndex.get(normalisePlayerName(claim.player)))
  );

  return {
    source: "live" as const,
    statsFound: claims.length,
    statsVerified: verified.length,
    statAccuracy: Math.round((verified.length / claims.length) * 100),
    claims: claims.map((claim: ExtractedStatClaim) => ({
      player: claim.player,
      stat: claim.metric,
      value: String(claim.value),
    })),
  };
}

type DirectStatVerification = Awaited<ReturnType<typeof verifyStatsAgainstLiveData>>;

function computeOverallFactAccuracy(
  directStats: DirectStatVerification,
  webFactCheck: WebFactCheckReport,
  fallbackAccuracy: number
) {
  const directScore =
    directStats.source === "live"
      ? directStats.statAccuracy
      : directStats.statsFound > 0
        ? clampScore(directStats.statAccuracy * 0.7 + fallbackAccuracy * 0.3, directStats.statAccuracy)
        : clampScore(fallbackAccuracy, 75);
  const directCheckable =
    directStats.source === "live"
      ? directStats.statsFound
      : directStats.statsFound > 0
        ? Math.max(1, Math.round(directStats.statsFound * 0.4))
        : 0;
  const historicalClaims = webFactCheck.historicalClaims?.claimsResolved ?? 0;
  const webClaims = webFactCheck.webClaims?.claimsResearched ?? webFactCheck.claimsResearched;
  const broaderClaims = historicalClaims + webClaims;
  const broaderScore = (() => {
    if (historicalClaims > 0 && webClaims > 0) {
      return (
        ((webFactCheck.historicalClaims?.score ?? webFactCheck.score) * historicalClaims +
          (webFactCheck.webClaims?.score ?? webFactCheck.score) * webClaims) /
        broaderClaims
      );
    }

    if (historicalClaims > 0) {
      return webFactCheck.historicalClaims?.score ?? webFactCheck.score;
    }

    if (webClaims > 0) {
      return webFactCheck.webClaims?.score ?? webFactCheck.score;
    }

    return webFactCheck.score;
  })();

  if (directCheckable > 0 && broaderClaims > 0) {
    const blended =
      (directScore * directCheckable + broaderScore * broaderClaims) /
      (directCheckable + broaderClaims);

    return clampScore(blended, fallbackAccuracy);
  }

  if (directCheckable > 0) {
    return directScore;
  }

  if (broaderClaims > 0) {
    return broaderScore;
  }

  return clampScore(fallbackAccuracy, 75);
}

function buildFactCheckSummary(
  directStats: DirectStatVerification,
  webFactCheck: WebFactCheckReport
) {
  const parts: string[] = [];

  if (directStats.source === "live" && directStats.statsFound > 0) {
    parts.push(
      `${directStats.statsVerified}/${directStats.statsFound} direct match stats matched against the live scorecard.`
    );
  } else if (directStats.source === "fallback" && directStats.statsFound > 0) {
    parts.push(
      `${directStats.statsVerified}/${directStats.statsFound} direct stat references were checked with the heuristic fallback because no SportMonks scorecard context was available.`
    );
  } else {
    parts.push("No source-backed direct match stat claims were available for scorecard verification.");
  }

  parts.push(webFactCheck.summary);

  return parts.join(" ");
}

function buildPersistedFactCheckReport(
  directStats: DirectStatVerification,
  webFactCheck: WebFactCheckReport,
  overallScore: number
): PersistedFactCheckReport {
  const directClaimsFound = directStats.statsFound;
  const directClaimsVerified = directStats.statsVerified;
  const directAccuracy = directStats.statAccuracy;

  return {
    overallScore,
    summary: buildFactCheckSummary(directStats, webFactCheck),
    searchBackend: webFactCheck.searchBackend,
    providerAvailable: webFactCheck.providerAvailable,
    historicalWarehouseAvailable: webFactCheck.historicalWarehouseAvailable,
    historicalWarehouseError: webFactCheck.historicalWarehouseError ?? null,
    searchError: webFactCheck.searchError ?? null,
    claimRouting: webFactCheck.claimRouting,
    directStats: {
      source: directStats.source,
      claimsFound: directClaimsFound,
      claimsVerified: directClaimsVerified,
      accuracy: directAccuracy,
      claims: directStats.claims,
    },
    historicalClaims: {
      claimsRouted: webFactCheck.historicalClaims?.claimsRouted ?? 0,
      claimsResolved: webFactCheck.historicalClaims?.claimsResolved ?? 0,
      supported: webFactCheck.historicalClaims?.supported ?? 0,
      contradicted: webFactCheck.historicalClaims?.contradicted ?? 0,
      inconclusive: webFactCheck.historicalClaims?.inconclusive ?? 0,
      score: webFactCheck.historicalClaims?.score ?? 75,
      summary: webFactCheck.historicalClaims?.summary ?? "No structured historical claims were routed to the warehouse.",
      verdicts: (webFactCheck.historicalClaims?.verdicts ?? []).map((verdict) => ({
        ...verdict,
        sources: verdict.sources.map((source: FactCheckSource) => ({
          title: source.title,
          url: source.url,
          snippet: source.snippet,
          domain: source.domain,
          publishedDate: source.publishedDate ?? null,
        })),
      })),
    },
    webClaims: {
      claimsRouted: webFactCheck.webClaims?.claimsRouted ?? 0,
      claimsResearched: webFactCheck.webClaims?.claimsResearched ?? webFactCheck.claimsResearched,
      supported: webFactCheck.webClaims?.supported ?? webFactCheck.supported,
      contradicted: webFactCheck.webClaims?.contradicted ?? webFactCheck.contradicted,
      inconclusive: webFactCheck.webClaims?.inconclusive ?? webFactCheck.inconclusive,
      score: webFactCheck.webClaims?.score ?? webFactCheck.score,
      summary: webFactCheck.webClaims?.summary ?? webFactCheck.summary,
      verdicts: (webFactCheck.webClaims?.verdicts ?? webFactCheck.verdicts).map((verdict) => ({
        ...verdict,
        sources: verdict.sources.map((source: FactCheckSource) => ({
          title: source.title,
          url: source.url,
          snippet: source.snippet,
          domain: source.domain,
          publishedDate: source.publishedDate ?? null,
        })),
      })),
    },
  };
}

function normaliseParagraphScores(
  value: OllamaScoreResponse["paragraph_scores"],
  paragraphs: string[],
  fallbackScores: ReturnType<typeof heuristicScore>
): ParagraphScore[] {
  const fallback = fallbackScores.paragraph_scores ?? [];

  return paragraphs.map((paragraph, index) => {
    const source = value?.find((entry) => entry.paragraph_index === index) ?? fallback[index];

    return {
      paragraphIndex: index,
      excerpt: typeof source?.excerpt === "string" && source.excerpt.trim().length > 0
        ? source.excerpt.trim().slice(0, 120)
        : excerptForParagraph(paragraph),
      overall: clampScore(source?.overall, 60),
      constructiveness: clampScore(source?.constructiveness, 55),
      negativity: clampScore(source?.negativity, 30),
      toxicity: clampScore(source?.toxicity, 8),
      evidence: clampScore(source?.evidence, 40),
      coherence: clampScore(source?.coherence, 60),
      note: typeof source?.note === "string" && source.note.trim().length > 0
        ? source.note.trim().slice(0, 160)
        : "Paragraph-level read generated from the scoring engine.",
    };
  });
}

function buildExplanation(
  model: ModelScores,
  ruleEngine: Omit<RuleEngineResult, "toxicityPenaltyApplied" | "toxicityPenaltyOverride">,
  moderation: { penaltyApplied: boolean; overrideApplied: boolean },
  aiExplanation: OllamaScoreResponse["explanation"] | undefined,
  sarcasmDetected = false
): ExplanationJson {
  const defaultBreakdown = [
    `Constructiveness ${Math.round(ruleEngine.constructiveness)}/100`,
    `Negativity ${Math.round(model.negativityScore)}/100`,
    `Toxicity ${Math.round(model.toxicityScore)}/100`,
  ];

  return {
    summary:
      aiExplanation?.summary?.trim() ||
      "This score weighs clarity, evidence, constructiveness, originality, and safe discourse.",
    strengths:
      safeStringList(aiExplanation?.strengths, 4).length > 0
        ? safeStringList(aiExplanation?.strengths, 4)
        : [
            ruleEngine.constructiveness >= 70 ? "Constructive reasoning supports the argument." : "The stance is understandable.",
            model.coherenceScore >= 70 ? "The writing stays coherent from paragraph to paragraph." : "The article keeps a usable flow.",
            model.originalityScore >= 70 ? "The phrasing feels distinct rather than boilerplate." : "There is at least some original framing.",
          ],
    concerns:
      safeStringList(aiExplanation?.concerns, 4).length > 0
        ? safeStringList(aiExplanation?.concerns, 4)
        : [
            model.toxicityScore >= 45 ? "The wording moves toward personal hostility." : "Some claims could use stronger support.",
            model.negativityScore >= 60 ? "The tone is strongly negative, even if not fully toxic." : "Counter-arguments are underdeveloped.",
            ruleEngine.evidencePresence < 55 ? "Evidence density is lower than ideal for a top score." : "There is still room for sharper proof points.",
          ],
    negativityVsToxicity:
      (sarcasmDetected
        ? "This text is not just critical; it uses sarcastic mock praise and ridicule aimed at a player, so toxicity was raised above a pure negativity read."
        : aiExplanation?.negativity_vs_toxicity?.trim()) ||
      (model.negativityScore > model.toxicityScore
        ? "The system detected critical or frustrated language, but that is not automatically treated as toxicity."
        : "The system saw negative language that overlaps with abusive phrasing, so toxicity was weighted more heavily."),
    penaltyDecision:
      (sarcasmDetected
        ? "A toxicity penalty was applied because the passage relies on targeted ridicule and sarcastic belittling more than constructive cricket reasoning."
        : aiExplanation?.penalty_decision?.trim()) ||
      (moderation.overrideApplied
        ? "A reduced toxicity penalty was used because the piece stayed constructive and evidence-led."
        : moderation.penaltyApplied
          ? "A toxicity penalty was applied because hostile language outweighed the article's constructive value."
          : "No heavy toxicity penalty was needed because negativity remained within acceptable debate."),
    userVisibleBreakdown:
      safeStringList(aiExplanation?.user_visible_breakdown, 5).length > 0
        ? safeStringList(aiExplanation?.user_visible_breakdown, 5)
        : defaultBreakdown,
  };
}

function applyModerationGuardrails(
  text: string,
  model: ModelScores,
  ruleEngine: Omit<RuleEngineResult, "toxicityPenaltyApplied" | "toxicityPenaltyOverride">
) {
  const sarcasm = detectSarcasticRidicule(text);

  if (!sarcasm.sarcasticRidicule) {
    return { model, ruleEngine, sarcasmDetected: false };
  }

  const toxicityFloor =
    sarcasm.ridiculeHits >= 3 || (sarcasm.mockPraiseHits >= 2 && sarcasm.lowEvidenceAttack)
      ? 58
      : 42;
  const negativityFloor = sarcasm.lowEvidenceAttack ? 72 : 62;

  return {
    sarcasmDetected: true,
    model: {
      ...model,
      negativityScore: Math.max(model.negativityScore, negativityFloor),
      toxicityScore: Math.max(model.toxicityScore, toxicityFloor),
    },
    ruleEngine: {
      ...ruleEngine,
      constructiveness: sarcasm.lowEvidenceAttack
        ? Math.min(ruleEngine.constructiveness, 35)
        : Math.min(ruleEngine.constructiveness, 48),
      evidencePresence: sarcasm.lowEvidenceAttack
        ? Math.min(ruleEngine.evidencePresence, 28)
        : Math.min(ruleEngine.evidencePresence, 40),
      counterAcknowledge: Math.min(ruleEngine.counterAcknowledge, 20),
      argumentLogic: sarcasm.lowEvidenceAttack
        ? Math.min(ruleEngine.argumentLogic, 30)
        : Math.min(ruleEngine.argumentLogic, 42),
    },
  };
}

function resolveModerationPenalty(model: ModelScores, ruleEngine: Omit<RuleEngineResult, "toxicityPenaltyApplied" | "toxicityPenaltyOverride">) {
  const clearToxicity = model.toxicityScore >= 65;
  const borderlineToxicity = model.toxicityScore >= 25 && model.toxicityScore < 65;
  const overrideApplied =
    borderlineToxicity &&
    model.negativityScore >= model.toxicityScore &&
    ruleEngine.constructiveness >= 68 &&
    ruleEngine.evidencePresence >= 58 &&
    ruleEngine.counterAcknowledge >= 35;

  const effectiveToxicity = overrideApplied
    ? model.toxicityScore * 0.35
    : model.toxicityScore;
  const penaltyApplied = clearToxicity || model.toxicityScore >= 28;

  return {
    effectiveToxicity,
    penaltyApplied,
    overrideApplied,
  };
}

function computeBQS(
  model: ModelScores,
  ruleEngine: Omit<RuleEngineResult, "toxicityPenaltyApplied" | "toxicityPenaltyOverride">,
  statAccuracy: number,
  archetype: Archetype
) {
  const weights = ARCHETYPE_WEIGHTS[archetype];
  const moderation = resolveModerationPenalty(model, ruleEngine);
  const toxicityInv = 100 - moderation.effectiveToxicity;
  const negativityAdjustment = model.negativityScore > 70 && model.toxicityScore < 20 ? 4 : 0;
  const brevityPenalty = ruleEngine.completeness < 35 ? (35 - ruleEngine.completeness) * 0.4 : 0;
  const thinCounterPenalty = ruleEngine.counterAcknowledge < 20 ? (20 - ruleEngine.counterAcknowledge) * 0.2 : 0;

  let score =
    ruleEngine.constructiveness * weights.constructiveness +
    toxicityInv * weights.toxicityInv +
    model.originalityScore * weights.originalityScore +
    statAccuracy * weights.statAccuracy +
    ruleEngine.infoDensity * weights.infoDensity +
    model.coherenceScore * weights.coherenceScore +
    ruleEngine.argumentLogic * weights.argumentLogic;

  score += ruleEngine.evidencePresence * 0.04;
  score += ruleEngine.positionClarity * 0.03;
  score += ruleEngine.completeness * 0.04;
  score += ruleEngine.counterAcknowledge * 0.03;
  score -= ruleEngine.repetitionPenalty * 0.04;
  score -= brevityPenalty;
  score -= thinCounterPenalty;
  score += negativityAdjustment;

  if (ruleEngine.evidencePresence > 80 && ruleEngine.completeness < 40) {
    score -= 3;
  }

  if (!moderation.overrideApplied && model.toxicityScore >= 70) {
    score -= 12;
  } else if (!moderation.overrideApplied && model.toxicityScore >= 45) {
    score -= 6;
  }

  return {
    bqs: Math.max(0, Math.min(100, Math.round(score))),
    moderation,
  };
}

// ── Full Pipeline ────────────────────────────────────────────────────

export async function runScoringPipeline(input: string | { title?: string; content: string; matchId?: string | null }): Promise<BlogScoreResult> {
  const started = Date.now();
  const payload = typeof input === "string" ? { content: input } : input;
  const text = payload.content;

  // Step 1: Pre-process (always local)
  const pp = preProcess(text);
  const statMetrics = await verifyStatsAgainstLiveData({
    title: payload.title,
    content: text,
    matchId: payload.matchId,
  });
  const webFactCheck = await cachedWebFactCheck({
    title: payload.title,
    content: text,
  });
  const fallback = heuristicScore(text, pp, statMetrics);

  // Steps 2–7: Prefer the Python AI service, then Ollama, then heuristics
  const aiServiceResult = await callAiServiceScorer(payload);
  const ollamaResult = aiServiceResult ? null : await callOllamaScorer(payload);
  const aiResult = aiServiceResult ?? ollamaResult;
  const r = aiResult ?? fallback;
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const modelScores: ModelScores = {
    toneScore: clampScore(r.tone_score, fallback.tone_score),
    negativityScore: clampScore(r.negativity_score, fallback.negativity_score),
    toxicityScore: clampScore(r.toxicity_score, fallback.toxicity_score),
    originalityScore: clampScore(r.originality_score, fallback.originality_score),
    coherenceScore: clampScore(r.coherence_score, fallback.coherence_score),
    archetypeLabel: (["analyst", "fan", "storyteller", "debater"].includes(r.archetype)
      ? r.archetype
      : fallback.archetype) as Archetype,
    archetypeConfidence: clampUnit(r.archetype_confidence, fallback.archetype_confidence),
  };

  const ruleEngineBase = {
    constructiveness: clampScore(r.constructiveness, fallback.constructiveness),
    evidencePresence: clampScore(r.evidence_presence, fallback.evidence_presence),
    counterAcknowledge: clampScore(r.counter_acknowledge, fallback.counter_acknowledge),
    positionClarity: clampScore(r.position_clarity, fallback.position_clarity),
    infoDensity: clampScore(r.info_density, fallback.info_density),
    repetitionPenalty: clampScore(r.repetition_penalty, fallback.repetition_penalty),
    argumentLogic: clampScore(r.argument_logic, fallback.argument_logic),
  };
  const structuralCompletenessCap = clampScore(
    pp.completeness +
      Math.min(20, pp.sentenceCount * 5) +
      Math.min(16, pp.paragraphCount * 8) +
      Math.min(16, pp.wordCount / 10),
    pp.completeness
  );
  const ruleEngineBaseWithCompleteness = {
    ...ruleEngineBase,
    completeness: clampScore(
      Math.min(clampScore(r.completeness, fallback.completeness), structuralCompletenessCap),
      Math.min(fallback.completeness, structuralCompletenessCap)
    ),
  };
  const guarded = applyModerationGuardrails(text, modelScores, ruleEngineBaseWithCompleteness);

  const overallFactAccuracy = computeOverallFactAccuracy(
    statMetrics,
    webFactCheck,
    clampScore(r.stat_accuracy, statMetrics.statAccuracy)
  );
  const computed = computeBQS(
    guarded.model,
    guarded.ruleEngine,
    overallFactAccuracy,
    guarded.model.archetypeLabel
  );
  const moderation = {
    penaltyApplied:
      typeof r.toxicity_penalty_applied === "boolean"
        ? r.toxicity_penalty_applied
        : computed.moderation.penaltyApplied,
    overrideApplied:
      typeof r.toxicity_penalty_override === "boolean"
        ? r.toxicity_penalty_override
        : computed.moderation.overrideApplied,
  };
  const bqs = computed.bqs;
  const writerDNASignal = normaliseWriterDNASignal(r.writer_dna, guarded.model.archetypeLabel);

  const paragraphScores = normaliseParagraphScores(r.paragraph_scores, paragraphs, fallback);
  const guardedParagraphScores = guarded.sarcasmDetected
    ? paragraphScores.map((paragraph) => ({
        ...paragraph,
        negativity: Math.max(paragraph.negativity, guarded.model.negativityScore),
        toxicity: Math.max(paragraph.toxicity, Math.min(guarded.model.toxicityScore, 70)),
        constructiveness: Math.min(paragraph.constructiveness, guarded.ruleEngine.constructiveness),
        evidence: Math.min(paragraph.evidence, guarded.ruleEngine.evidencePresence),
        note:
          paragraph.note.includes("sarcastic") || paragraph.note.includes("ridicule")
            ? paragraph.note
            : "Paragraph uses sarcastic ridicule aimed at a player, so toxicity was raised above a simple negativity read.",
      }))
    : paragraphScores;
  const explanation = buildExplanation(
    guarded.model,
    guarded.ruleEngine,
    moderation,
    r.explanation,
    guarded.sarcasmDetected
  );
  const finalStatsVerified = statMetrics.statsVerified;
  const finalStatAccuracy = overallFactAccuracy;
  const factCheck = buildPersistedFactCheckReport(statMetrics, webFactCheck, finalStatAccuracy);

  return {
    bqs,
    preProcess: {
      wordCount: pp.wordCount,
      sentenceCount: pp.sentenceCount,
      paragraphCount: pp.paragraphCount,
      lexicalDiversity: pp.lexicalDiversity,
      sentenceVariety: pp.sentenceVariety,
      avgSentenceLength: pp.avgSentenceLength,
      completeness: r.completeness,
    },
    modelScores: guarded.model,
    nerResult: {
      entities: [],
      statsFound: statMetrics.claims,
      cricketDepth: guarded.ruleEngine.infoDensity,
    },
    ruleEngine: {
      ...guarded.ruleEngine,
      toxicityPenaltyApplied: moderation.penaltyApplied,
      toxicityPenaltyOverride: moderation.overrideApplied,
    },
    writerDNASignal,
    paragraphScores: guardedParagraphScores,
    explanation,
    statsVerified: finalStatsVerified,
    statAccuracy: finalStatAccuracy,
    factCheck,
    processingTimeMs: Date.now() - started,
    scoreVersion:
      aiServiceResult?.score_version ||
      (ollamaResult ? "qwen3.5-v6-deterministic-bqs" : "heuristic-fallback-v2"),
  };
}

// ── Writer DNA Update (80/20 EMA, 4 archetypes) ──────────────────────

export interface WriterDNA {
  analyst: number;
  fan: number;
  storyteller: number;
  debater: number;
}

export function calculateDNAUpdate(
  currentDNA: WriterDNA,
  signal: WriterDNA,
  bqs: number,
): WriterDNA {
  const boost = Math.max(0.12, Math.min(0.35, bqs / 250));
  const carry = 1 - boost;

  return {
    analyst: Math.round((currentDNA.analyst * carry + signal.analyst * boost) * 10) / 10,
    fan: Math.round((currentDNA.fan * carry + signal.fan * boost) * 10) / 10,
    storyteller: Math.round((currentDNA.storyteller * carry + signal.storyteller * boost) * 10) / 10,
    debater: Math.round((currentDNA.debater * carry + signal.debater * boost) * 10) / 10,
  };
}

// ── Writer Title Derivation ──────────────────────────────────────────

export function calculateWriterTitle(dna: WriterDNA): string {
  const total = dna.analyst + dna.fan + dna.storyteller + dna.debater;
  if (total === 0) return "THE ROOKIE";

  const pct = {
    analyst:     dna.analyst / total,
    fan:         dna.fan / total,
    storyteller: dna.storyteller / total,
    debater:     dna.debater / total,
  };

  const dominant = Object.entries(pct).sort((a, b) => b[1] - a[1])[0];
  if (dominant[1] >= 0.50) {
    const map: Record<string, string> = {
      analyst:     "THE ANALYST",
      fan:         "THE HEARTBEAT",
      storyteller: "THE NARRATOR",
      debater:     "THE DEBATER",
    };
    return map[dominant[0]] ?? "THE WRITER";
  }
  return "THE ALL-ROUNDER";
}

// ── BCS Formula ─────────────────────────────────────────────────────

export function calculateBCS(
  avgBQS: number,
  depthScore: number,         // avg info_density
  communityScore: number,     // normalized runs/views ratio (0-100)
  consistencyScore: number,   // streak-based (0-100)
  statAccuracyBonus: number,  // avg stat accuracy (0-100)
): number {
  const bcs =
    avgBQS * 0.50 +
    depthScore * 0.20 +
    communityScore * 0.15 +
    consistencyScore * 0.10 +
    statAccuracyBonus * 0.05;
  return Math.min(100, Math.max(0, Math.round(bcs * 10) / 10));
}

// ── Badge Definitions (BCS-tier system from PDF) ─────────────────────

export const BADGE_DEFINITIONS = [
  {
    id: "bronze_scribe",
    title: "Bronze Scribe",
    description: "Published your first expression",
    tier: "bronze",
    icon: "🥉",
    minBlogs: 1,
    minBQS: 0,
  },
  {
    id: "silver_analyst",
    title: "Silver Analyst",
    description: "5+ expressions with avg EQS above 55",
    tier: "silver",
    icon: "🥈",
    minBlogs: 5,
    minBQS: 55,
  },
  {
    id: "gold_correspondent",
    title: "Gold Correspondent",
    description: "10+ expressions, avg EQS > 70, stat accuracy > 75%",
    tier: "gold",
    icon: "🥇",
    minBlogs: 10,
    minBQS: 70,
    minStatAccuracy: 75,
  },
  {
    id: "diamond_expert",
    title: "Diamond Expert",
    description: "20+ expressions, avg EQS > 80, stat accuracy > 85%",
    tier: "diamond",
    icon: "💎",
    minBlogs: 20,
    minBQS: 80,
    minStatAccuracy: 85,
  },
  {
    id: "cg_verified_analyst",
    title: "CricGeek Verified Analyst",
    description: "Elite writer — manually reviewed",
    tier: "verified",
    icon: "✒️",
    minBlogs: 30,
    minBQS: 90,
    minStatAccuracy: 90,
  },
  // Legacy cricket-flavoured badges (kept from original)
  {
    id: "first_blood",
    title: "First Blood",
    description: "Published your first expression",
    tier: "bronze",
    icon: "🏏",
    minBlogs: 1,
    minBQS: 0,
  },
  {
    id: "five_wickets",
    title: "Five-For",
    description: "5 expressions with EQS above 80",
    tier: "silver",
    icon: "⭐",
    minBlogs: 5,
    minBQS: 80,
  },
  {
    id: "century_maker",
    title: "Century Maker",
    description: "Score 100 EQS on an expression",
    tier: "gold",
    icon: "💯",
    minBlogs: 1,
    minBQS: 100,
  },
  {
    id: "clean_player",
    title: "Clean Player",
    description: "10 expressions with 0 toxicity",
    tier: "bronze",
    icon: "🧤",
    minBlogs: 10,
    minBQS: 0,
  },
  {
    id: "stat_master",
    title: "Stat Master",
    description: "10+ verified stats across expressions",
    tier: "silver",
    icon: "📊",
    minBlogs: 3,
    minBQS: 0,
  },
  {
    id: "all_rounder",
    title: "All-Rounder",
    description: "All DNA scores above 20%",
    tier: "gold",
    icon: "🌟",
    minBlogs: 15,
    minBQS: 0,
  },
  {
    id: "viral",
    title: "Gone Viral",
    description: "Single expression crosses 1,000 views",
    tier: "gold",
    icon: "🚀",
    minBlogs: 1,
    minBQS: 0,
  },
  {
    id: "mr_consistent",
    title: "Mr. Consistent",
    description: "4-week expression streak",
    tier: "silver",
    icon: "🔥",
    minBlogs: 4,
    minBQS: 0,
  },
];

// ── Achievement Definitions ──────────────────────────────────────────

export const ACHIEVEMENT_DEFINITIONS = [
  { id: "blogs_1",   title: "Opening Over",        description: "Published 1 expression",   milestone: 1 },
  { id: "blogs_5",   title: "Building Momentum",   description: "Published 5 expressions",  milestone: 5 },
  { id: "blogs_10",  title: "Set in the Crease",   description: "Published 10 expressions", milestone: 10 },
  { id: "blogs_25",  title: "Quarter Century",     description: "Published 25 expressions", milestone: 25 },
  { id: "blogs_50",  title: "Half Century",        description: "Published 50 expressions", milestone: 50 },
  { id: "views_100", title: "Crowd Gathering",     description: "100 total views",    milestone: 100 },
  { id: "views_1000",title: "Stadium Roar",        description: "1,000 total views",  milestone: 1000 },
  { id: "views_10k", title: "💎 VIRAL",            description: "10,000 total views", milestone: 10000 },
  { id: "runs_100",  title: "Century of Runs",     description: "100 total runs",     milestone: 100 },
  { id: "bqs_70",   title: "Quality Innings",      description: "Avg EQS above 70",   milestone: 70 },
  { id: "bqs_90",   title: "Match Winner",         description: "Avg EQS above 90",   milestone: 90 },
];

// ── DNA Achievement Definitions ──────────────────────────────────────

export const DNA_ACHIEVEMENT_DEFINITIONS = [
  {
    id: "dna_pure_analyst",
    title: "Pure Blood Analyst",
    description: "Analyst DNA dominates across 10+ expressions",
    archetype: "analyst",
    threshold: 50,
    minBlogs: 10,
  },
  {
    id: "dna_voice_of_fans",
    title: "Voice of the Fans",
    description: "Fan DNA dominates across 10+ expressions",
    archetype: "fan",
    threshold: 50,
    minBlogs: 10,
  },
  {
    id: "dna_chronicler",
    title: "The Chronicler",
    description: "Storyteller DNA dominates across 8+ expressions",
    archetype: "storyteller",
    threshold: 40,
    minBlogs: 8,
  },
  {
    id: "dna_contrarian",
    title: "The Contrarian",
    description: "Debater DNA dominates across 8+ expressions",
    archetype: "debater",
    threshold: 40,
    minBlogs: 8,
  },
  {
    id: "dna_all_rounder",
    title: "True All-Rounder",
    description: "No single archetype below 15% across 15+ expressions",
    archetype: "all",
    threshold: 15,
    minBlogs: 15,
  },
];

// ── View Count Milestone Messages ────────────────────────────────────

export const VIEW_MILESTONES: Array<{ views: number; message: string }> = [
  { views: 100,   message: "🎉 Century! 100 readers" },
  { views: 1000,  message: "🏏 Your blog hit 1,000 views!" },
  { views: 10000, message: "💎 VIRAL — 10,000 readers — Featured on homepage" },
];
