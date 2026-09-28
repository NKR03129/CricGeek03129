/**
 * Stage 4 — Language analysis.
 *
 * Scores every model-owned dimension from spec section 5 via the configured
 * language provider, and falls back to the deterministic fast-check heuristics when
 * no provider answers. `statistical_claims` is NOT scored here: the spec assigns it
 * to the cricket-verification module.
 */

import { EQS_TIMEOUTS } from "@/lib/eqs/config";
import { generateStructuredWithChain } from "@/lib/eqs/providers";
import {
  EQS_DIMENSION_DESCRIPTIONS,
  EQS_DIMENSION_LABELS,
  MODEL_SCORED_DIMENSIONS,
  type ComponentResult,
  type EqsDimensionKey,
  type EqsDnaContext,
  type EqsFlag,
} from "@/lib/eqs/types";
import { clamp0to1, clamp0to100, errorMessage, truncate } from "@/lib/eqs/utils";
import type { FastCheckResult } from "@/lib/eqs/stages/fast-checks";

export const LANGUAGE_ANALYSIS_PROMPT_VERSION = "eqs-language-v2.0.0";

/** Longest excerpt sent to the provider. Keeps cost and latency predictable. */
const MAX_CONTENT_CHARS = 14_000;

type ModelDimensionScore = {
  dimension: string;
  score: number;
  confidence?: number;
  explanation?: string;
};

type ModelLanguagePayload = {
  dimensions: ModelDimensionScore[];
  summary?: string;
  strengths?: string[];
  concerns?: string[];
  sentiment_vs_toxicity?: string;
  /** Free-text notes the model wants a human to see. */
  review_notes?: string[];
};

function isModelLanguagePayload(value: unknown): value is ModelLanguagePayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { dimensions?: unknown };
  return Array.isArray(candidate.dimensions) && candidate.dimensions.length > 0;
}

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    dimensions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dimension: { type: "string", enum: MODEL_SCORED_DIMENSIONS },
          score: { type: "integer", minimum: 0, maximum: 100 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          explanation: { type: "string" },
        },
        required: ["dimension", "score", "explanation"],
      },
    },
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    sentiment_vs_toxicity: { type: "string" },
    review_notes: { type: "array", items: { type: "string" } },
  },
  required: ["dimensions", "summary"],
};

function buildPrompt(input: {
  title?: string;
  content: string;
  dna: EqsDnaContext;
}): string {
  const dimensionSpec = MODEL_SCORED_DIMENSIONS.map(
    (key) => `- "${key}" (${EQS_DIMENSION_LABELS[key]}): ${EQS_DIMENSION_DESCRIPTIONS[key]}`,
  ).join("\n");

  const dnaMix = Object.entries(input.dna.mix)
    .filter(([, weight]) => weight > 0.01)
    .sort(([, left], [, right]) => right - left)
    .map(([profile, weight]) => `${profile} ${Math.round(weight * 100)}%`)
    .join(", ");

  return `You are CricGeek's Expression Quality Score (EQS) language analyst for cricket writing.

Return strict JSON only. No markdown, no commentary outside the JSON.

SCORE EACH DIMENSION 0-100 WHERE 100 IS BEST:
${dimensionSpec}

SCORING RULES YOU MUST FOLLOW:
1. Higher is always better. For "toxicity", 100 means no insults or personal attacks at all, and a low score means abusive or hostile expression.
2. For "ai_assistance", 100 means the writing reads as clearly human; a low score means strong indicators of AI-generated or AI-assisted text. This is only a signal. Do not reduce any other dimension because you suspect AI use.
3. Negative sentiment is NOT automatically poor quality. Strong criticism scores high when it is reasoned and constructive. Score "sentiment" on whether the emotional direction fits the argument in context, never on whether the mood is positive or negative.
4. Positive wording is NOT automatically high quality. Sarcasm, vague praise, unsupported claims, and manipulation must lower the relevant dimensions.
5. Do NOT judge whether cricket statistics are factually correct. A separate verification system owns that. Score "evidence_quality" on whether claims are *supported* (numbers, examples, references, clear reasoning), not on whether the numbers are right.
6. Do NOT guess about plagiarism or copying. Score "originality" on framing, interpretation, and expression only.
7. Keep every explanation to one short sentence.

WRITER DNA CONTEXT (for the "writer_dna_suitability" dimension only): ${dnaMix || "unknown"}.
Judge "writer_dna_suitability" as how well the article succeeds at what this writer type is trying to do, not as how closely it matches a template.

REQUIRED JSON SHAPE:
{
  "dimensions": [ { "dimension": "originality", "score": 0, "confidence": 0.0, "explanation": "" } ],
  "summary": "one sentence",
  "strengths": ["short phrase"],
  "concerns": ["short phrase"],
  "sentiment_vs_toxicity": "one sentence separating criticism from abuse",
  "review_notes": ["only if a human editor should look at something"]
}

Include exactly one entry per dimension listed above.

TITLE: ${input.title || "Untitled"}

ARTICLE:
${truncate(input.content, MAX_CONTENT_CHARS)}`;
}

export interface LanguageAnalysisEvidence {
  summary: string;
  strengths: string[];
  concerns: string[];
  sentimentVsToxicity: string;
  reviewNotes: string[];
  /** Dimensions that fell back to the deterministic heuristic. */
  heuristicFallbackDimensions: EqsDimensionKey[];
  providerAttempts: Array<{ provider: string; model: string; error: string }>;
}

export interface LanguageAnalysisResult {
  component: ComponentResult<LanguageAnalysisEvidence>;
  /** Score + confidence + explanation per model-owned dimension. */
  dimensions: Record<
    Exclude<EqsDimensionKey, "statistical_claims">,
    { score: number; confidence: number; explanation: string; source: "model" | "heuristic" }
  >;
  provider: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
}

function safeStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => truncate(item, 160))
    .slice(0, limit);
}

export async function runLanguageAnalysis(input: {
  title?: string;
  content: string;
  dna: EqsDnaContext;
  fastChecks: FastCheckResult;
  signal?: AbortSignal;
}): Promise<LanguageAnalysisResult> {
  const startedAt = Date.now();
  const heuristics = input.fastChecks.heuristicDimensions;

  const outcome = await generateStructuredWithChain(
    {
      purpose: "language-analysis",
      prompt: buildPrompt(input),
      schema: RESPONSE_SCHEMA,
      temperature: 0.15,
      maxOutputTokens: 3072,
      timeoutMs: EQS_TIMEOUTS.languageAnalysisMs,
      signal: input.signal,
    },
    isModelLanguagePayload,
  );

  const heuristicFallbackDimensions: EqsDimensionKey[] = [];
  const dimensions = {} as LanguageAnalysisResult["dimensions"];

  for (const key of MODEL_SCORED_DIMENSIONS) {
    const typedKey = key as Exclude<EqsDimensionKey, "statistical_claims">;
    const matched = outcome.data?.dimensions.find(
      (entry) => typeof entry?.dimension === "string" && entry.dimension.trim() === key,
    );

    if (matched && typeof matched.score === "number" && Number.isFinite(matched.score)) {
      dimensions[typedKey] = {
        score: clamp0to100(matched.score, heuristics[typedKey]),
        confidence: clamp0to1(matched.confidence, 0.75),
        explanation:
          typeof matched.explanation === "string" && matched.explanation.trim().length > 0
            ? truncate(matched.explanation, 240)
            : `${EQS_DIMENSION_LABELS[key]} scored by ${outcome.provider}.`,
        source: "model",
      };
      continue;
    }

    heuristicFallbackDimensions.push(key);
    dimensions[typedKey] = {
      score: heuristics[typedKey],
      confidence: 0.4, // Deterministic but shallow: lowers overall confidence honestly.
      explanation: `Deterministic fallback used for ${EQS_DIMENSION_LABELS[key]} because the language model did not return a usable score.`,
      source: "heuristic",
    };
  }

  const flags: EqsFlag[] = [];
  const status: ComponentResult["status"] = outcome.data
    ? "ok"
    : outcome.provider === "heuristic"
      ? "unavailable"
      : "error";

  if (!outcome.data) {
    flags.push({
      code: "LANGUAGE_ANALYSIS_FALLBACK",
      severity: "warn",
      message: `Language analysis fell back to deterministic heuristics (${outcome.error || "no provider available"}).`,
      component: "language-analysis",
    });
  } else if (heuristicFallbackDimensions.length > 0) {
    flags.push({
      code: "LANGUAGE_ANALYSIS_PARTIAL",
      severity: "warn",
      message: `Model omitted ${heuristicFallbackDimensions.length} dimension(s); heuristics used for those.`,
      component: "language-analysis",
    });
  }

  const reviewNotes = safeStrings(outcome.data?.review_notes, 4);
  if (reviewNotes.length > 0) {
    flags.push({
      code: "MODEL_REVIEW_NOTE",
      severity: "info",
      message: reviewNotes.join(" | "),
      component: "language-analysis",
    });
  }

  const modelScored = Object.values(dimensions).filter((entry) => entry.source === "model").length;
  const coverage = modelScored / MODEL_SCORED_DIMENSIONS.length;

  const evidence: LanguageAnalysisEvidence = {
    summary:
      typeof outcome.data?.summary === "string" && outcome.data.summary.trim().length > 0
        ? truncate(outcome.data.summary, 400)
        : "Language analysis summary unavailable; deterministic signals were used instead.",
    strengths: safeStrings(outcome.data?.strengths, 4),
    concerns: safeStrings(outcome.data?.concerns, 4),
    sentimentVsToxicity:
      typeof outcome.data?.sentiment_vs_toxicity === "string" &&
      outcome.data.sentiment_vs_toxicity.trim().length > 0
        ? truncate(outcome.data.sentiment_vs_toxicity, 400)
        : "",
    reviewNotes,
    heuristicFallbackDimensions,
    providerAttempts: outcome.attempts.map((attempt) => ({
      provider: attempt.provider,
      model: attempt.model,
      error: truncate(attempt.error, 200),
    })),
  };

  return {
    component: {
      component: "language-analysis",
      score: clamp0to100(
        Object.values(dimensions).reduce((sum, entry) => sum + entry.score, 0) /
          Math.max(1, Object.keys(dimensions).length),
      ),
      confidence: clamp0to1(outcome.data ? 0.45 + coverage * 0.5 : 0.35),
      evidence,
      flags,
      source: outcome.provider,
      version: `${outcome.model}/${LANGUAGE_ANALYSIS_PROMPT_VERSION}`,
      status,
      durationMs: Date.now() - startedAt,
      error: outcome.error ? truncate(outcome.error, 300) : undefined,
    },
    dimensions,
    provider: outcome.provider,
    model: outcome.model,
    promptVersion: LANGUAGE_ANALYSIS_PROMPT_VERSION,
    latencyMs: outcome.latencyMs,
  };
}

export function describeLanguageAnalysisFailure(error: unknown): string {
  return `Language analysis stage failed: ${errorMessage(error)}`;
}
