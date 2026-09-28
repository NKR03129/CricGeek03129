/**
 * Stage 5 — Claim extraction.
 *
 * Pulls the checkable factual claims out of an article as structured data so stage 6
 * can verify them against trusted cricket sources. The model only *identifies*
 * claims here; it never decides whether they are true.
 */

import { EQS_TIMEOUTS } from "@/lib/eqs/config";
import { generateStructuredWithChain } from "@/lib/eqs/providers";
import type { ClaimType, ComponentResult, EqsClaim, EqsFlag } from "@/lib/eqs/types";
import { clamp0to1, truncate } from "@/lib/eqs/utils";

export const CLAIM_EXTRACTION_PROMPT_VERSION = "eqs-claims-v2.0.0";

const MAX_CLAIMS = 12;
const MAX_CONTENT_CHARS = 14_000;

const CLAIM_TYPES: ClaimType[] = ["player_stat", "team_stat", "match_event", "record", "general"];

const SUPPORTED_METRICS = [
  "runs",
  "wickets",
  "strike_rate",
  "economy",
  "average",
  "overs",
  "fours",
  "sixes",
  "balls",
  "catches",
  "matches",
  "centuries",
  "fifties",
] as const;

type RawClaim = {
  text?: string;
  type?: string;
  player?: string | null;
  metric?: string | null;
  value?: number | null;
  timeframe?: string | null;
  requires_verification?: boolean;
};

type ClaimPayload = { claims?: RawClaim[] };

function isClaimPayload(value: unknown): value is ClaimPayload {
  if (!value || typeof value !== "object") return false;
  return Array.isArray((value as { claims?: unknown }).claims);
}

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          type: { type: "string", enum: CLAIM_TYPES },
          player: { type: "string", nullable: true },
          metric: { type: "string", enum: [...SUPPORTED_METRICS], nullable: true },
          value: { type: "number", nullable: true },
          timeframe: { type: "string", nullable: true },
          requires_verification: { type: "boolean" },
        },
        required: ["text", "type", "requires_verification"],
      },
    },
  },
  required: ["claims"],
};

function buildPrompt(input: { title?: string; content: string }): string {
  return `Extract the factual and statistical claims from this cricket article so a separate system can verify them.

Return strict JSON only.

RULES:
- Extract at most ${MAX_CLAIMS} claims, prioritising the ones a reader would most likely take as fact.
- "text" must quote or closely paraphrase the claim as written, max 200 characters.
- "type" must be one of: ${CLAIM_TYPES.join(", ")}.
- Set "player" only when the claim is about a named individual.
- Set "metric" only when the claim states a number for one of: ${SUPPORTED_METRICS.join(", ")}.
- Set "value" only when the article gives an explicit number. Never infer or estimate a value.
- Set "timeframe" when the claim is scoped in time, e.g. "2024 season", "last 10 innings".
- "requires_verification" is true for any claim that asserts a checkable fact, and false for opinion, prediction, or rhetorical statements.
- Do NOT judge whether a claim is correct. Only extract it.
- If the article makes no checkable claims, return an empty array.

REQUIRED JSON SHAPE:
{ "claims": [ { "text": "", "type": "player_stat", "player": null, "metric": null, "value": null, "timeframe": null, "requires_verification": true } ] }

TITLE: ${input.title || "Untitled"}

ARTICLE:
${truncate(input.content, MAX_CONTENT_CHARS)}`;
}

function normaliseClaimType(value: unknown): ClaimType {
  return CLAIM_TYPES.includes(value as ClaimType) ? (value as ClaimType) : "general";
}

function normaliseMetric(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalised = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (SUPPORTED_METRICS as readonly string[]).includes(normalised) ? normalised : null;
}

/**
 * Deterministic fallback used when no provider answers. It cannot understand a
 * claim, so it only surfaces sentences that pair a number with a cricket metric and
 * marks them for verification.
 */
function extractClaimsHeuristically(content: string): EqsClaim[] {
  const metricPattern = new RegExp(`\\b(${SUPPORTED_METRICS.join("|").replace(/_/g, "[ _]?")})\\b`, "i");
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const claims: EqsClaim[] = [];

  for (const sentence of sentences) {
    if (claims.length >= MAX_CLAIMS) break;
    if (!/\d/.test(sentence)) continue;
    if (!metricPattern.test(sentence)) continue;

    const numberMatch = sentence.match(/\b\d+(?:\.\d+)?\b/);
    const metricMatch = sentence.match(metricPattern);

    claims.push({
      id: `heuristic-${claims.length + 1}`,
      text: truncate(sentence, 200),
      type: "general",
      player: null,
      metric: metricMatch ? normaliseMetric(metricMatch[1].replace(/\s+/g, "_")) : null,
      value: numberMatch ? Number(numberMatch[0]) : null,
      timeframe: null,
      requiresVerification: true,
      status: "unverified",
      verificationSource: null,
      provider: null,
      evidence: [],
      verifiedAt: null,
    });
  }

  return claims;
}

export interface ClaimExtractionEvidence {
  claimsExtracted: number;
  claimsRequiringVerification: number;
  extractionMode: "model" | "heuristic";
  providerAttempts: Array<{ provider: string; model: string; error: string }>;
}

export interface ClaimExtractionResult {
  component: ComponentResult<ClaimExtractionEvidence>;
  claims: EqsClaim[];
  provider: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
}

export async function runClaimExtraction(input: {
  title?: string;
  content: string;
  signal?: AbortSignal;
}): Promise<ClaimExtractionResult> {
  const startedAt = Date.now();

  // Nothing numeric or factual to extract: skip the provider call entirely.
  if (!/\d/.test(input.content) && input.content.length < 400) {
    return {
      component: {
        component: "claim-extraction",
        score: null,
        confidence: 0.9,
        evidence: {
          claimsExtracted: 0,
          claimsRequiringVerification: 0,
          extractionMode: "heuristic",
          providerAttempts: [],
        },
        flags: [],
        claims: [],
        source: "cricgeek-claim-extraction",
        version: CLAIM_EXTRACTION_PROMPT_VERSION,
        status: "skipped",
        durationMs: Date.now() - startedAt,
      },
      claims: [],
      provider: "none",
      model: "none",
      promptVersion: CLAIM_EXTRACTION_PROMPT_VERSION,
      latencyMs: 0,
    };
  }

  const outcome = await generateStructuredWithChain(
    {
      purpose: "claim-extraction",
      prompt: buildPrompt(input),
      schema: RESPONSE_SCHEMA,
      temperature: 0,
      maxOutputTokens: 1536,
      timeoutMs: EQS_TIMEOUTS.claimExtractionMs,
      signal: input.signal,
    },
    isClaimPayload,
    { fast: true }, // High-volume sub-task: use the cost-efficient model when configured.
  );

  const flags: EqsFlag[] = [];
  let claims: EqsClaim[];
  let extractionMode: "model" | "heuristic";

  if (outcome.data?.claims) {
    extractionMode = "model";
    claims = outcome.data.claims
      .filter((claim): claim is RawClaim => Boolean(claim) && typeof claim.text === "string")
      .slice(0, MAX_CLAIMS)
      .map((claim, index) => ({
        id: `claim-${index + 1}`,
        text: truncate(claim.text as string, 200),
        type: normaliseClaimType(claim.type),
        player: typeof claim.player === "string" && claim.player.trim() ? claim.player.trim() : null,
        metric: normaliseMetric(claim.metric),
        value:
          typeof claim.value === "number" && Number.isFinite(claim.value) ? claim.value : null,
        timeframe:
          typeof claim.timeframe === "string" && claim.timeframe.trim() ? claim.timeframe.trim() : null,
        requiresVerification: claim.requires_verification !== false,
        status: "unverified" as const,
        verificationSource: null,
        provider: null,
        evidence: [],
        verifiedAt: null,
      }));
  } else {
    extractionMode = "heuristic";
    claims = extractClaimsHeuristically(input.content);
    flags.push({
      code: "CLAIM_EXTRACTION_FALLBACK",
      severity: "warn",
      message: `Claim extraction fell back to pattern matching (${outcome.error || "no provider available"}); verification coverage is reduced.`,
      component: "claim-extraction",
    });
  }

  const requiringVerification = claims.filter((claim) => claim.requiresVerification).length;

  return {
    component: {
      component: "claim-extraction",
      score: null, // Extraction has no quality score of its own.
      confidence: clamp0to1(extractionMode === "model" ? 0.85 : 0.4),
      evidence: {
        claimsExtracted: claims.length,
        claimsRequiringVerification: requiringVerification,
        extractionMode,
        providerAttempts: outcome.attempts.map((attempt) => ({
          provider: attempt.provider,
          model: attempt.model,
          error: truncate(attempt.error, 200),
        })),
      },
      flags,
      claims,
      source: extractionMode === "model" ? outcome.provider : "cricgeek-claim-extraction",
      version: `${outcome.model}/${CLAIM_EXTRACTION_PROMPT_VERSION}`,
      status: extractionMode === "model" ? "ok" : "unavailable",
      durationMs: Date.now() - startedAt,
      error: outcome.error ? truncate(outcome.error, 300) : undefined,
    },
    claims,
    provider: outcome.provider,
    model: outcome.model,
    promptVersion: CLAIM_EXTRACTION_PROMPT_VERSION,
    latencyMs: outcome.latencyMs,
  };
}
