/**
 * Stage 10b — bounded model interpretation.
 *
 * Asks the configured language model to sanity-check the deterministic weighted
 * score against the structured component evidence and propose a small, hard-capped
 * adjustment.
 *
 * It is given only the normalised component results — never raw stat or plagiarism
 * findings to re-judge — because the spec forbids the final model from inventing
 * those. The adjustment is clamped so runs stay reproducible, and it is applied
 * before the deterministic guardrails so it can never talk a score past a hard
 * constraint.
 *
 * Lives here rather than in `scoring-engine.ts` so that module stays free of
 * provider imports and its maths can be tested without a server runtime.
 */

import { EQS_TIMEOUTS, getMaxModelAdjustment } from "@/lib/eqs/config";
import { generateStructuredWithChain } from "@/lib/eqs/providers";
import {
  EQS_DIMENSION_LABELS,
  type ComponentResult,
  type EqsDimensionResult,
  type EqsDnaContext,
  type EqsExplanation,
  type EqsFlag,
} from "@/lib/eqs/types";
import { round1, round3, truncate } from "@/lib/eqs/utils";

export const FINAL_INTERPRETATION_PROMPT_VERSION = "eqs-final-interpretation-v2.0.0";

type InterpretationPayload = {
  adjustment?: number;
  summary?: string;
  strengths?: string[];
  concerns?: string[];
  sentiment_vs_toxicity?: string;
  requires_human_review?: boolean;
  human_review_reason?: string;
};

function isInterpretationPayload(value: unknown): value is InterpretationPayload {
  return Boolean(value) && typeof value === "object" && "summary" in (value as object);
}

const INTERPRETATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    adjustment: { type: "number" },
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    sentiment_vs_toxicity: { type: "string" },
    requires_human_review: { type: "boolean" },
    human_review_reason: { type: "string" },
  },
  required: ["summary"],
};

export interface InterpretationOutcome {
  adjustment: number;
  explanation: Partial<EqsExplanation>;
  requiresHumanReview: boolean;
  humanReviewReason: string | null;
  provider: string;
  model: string;
  latencyMs: number;
  status: ComponentResult["status"];
  error?: string;
}

/**
 * Asks the model to interpret the *structured* component results and nudge the score
 * within a hard bound. It is given no raw stat or plagiarism findings to re-judge,
 * per the spec's key rule.
 */
export async function runFinalInterpretation(input: {
  title?: string;
  dna: EqsDnaContext;
  baseScore: number;
  dimensions: EqsDimensionResult[];
  components: ComponentResult[];
  flags: EqsFlag[];
  signal?: AbortSignal;
}): Promise<InterpretationOutcome> {
  const maxAdjustment = getMaxModelAdjustment();

  const dimensionLines = input.dimensions
    .map(
      (dimension) =>
        `- ${dimension.key} (${EQS_DIMENSION_LABELS[dimension.key]}): score ${round1(dimension.score)}, weight ${round3(dimension.weight)}, confidence ${round3(dimension.confidence)}, source ${dimension.source} — ${dimension.explanation}`,
    )
    .join("\n");

  const componentLines = input.components
    .map(
      (component) =>
        `- ${component.component}: status ${component.status}, score ${component.score ?? "n/a"}, confidence ${round3(component.confidence)}, source ${component.source}`,
    )
    .join("\n");

  const flagLines =
    input.flags.length > 0
      ? input.flags.map((flag) => `- [${flag.severity}] ${flag.code}: ${flag.message}`).join("\n")
      : "- none";

  const dnaSummary = Object.entries(input.dna.mix)
    .sort(([, left], [, right]) => right - left)
    .map(([profile, share]) => `${profile} ${Math.round(share * 100)}%`)
    .join(", ");

  const prompt = `You are CricGeek's final EQS interpretation layer.

You are given ONLY the structured results produced by the specialist modules. Do not invent cricket-stat or plagiarism findings, and do not re-judge whether any statistic is correct — dedicated systems already did that and their results are below.

Your job:
1. Sanity-check the deterministic weighted score against the component evidence.
2. Propose a small adjustment in the range -${maxAdjustment} to +${maxAdjustment} points. Use 0 when the weighted score already reads correctly.
3. Write the reader-facing explanation.

Hard rules:
- Negative sentiment or strong criticism must NEVER be a reason to lower the score. Reasoned, constructive criticism is high quality.
- Positive wording must NEVER be a reason to raise the score on its own.
- An AI-assistance signal must NEVER be a reason to reject or heavily penalise.
- If the evidence conflicts materially, or confidence is low, set "requires_human_review" to true and explain why instead of guessing.

DETERMINISTIC WEIGHTED SCORE: ${round1(input.baseScore)}
WRITER DNA MIX: ${dnaSummary}${input.dna.mixed ? " (mixed profile)" : ""}

DIMENSIONS:
${dimensionLines}

COMPONENT STATUS:
${componentLines}

FLAGS RAISED:
${flagLines}

Return strict JSON only:
{
  "adjustment": 0,
  "summary": "one or two sentences for the writer",
  "strengths": ["short phrase"],
  "concerns": ["short phrase"],
  "sentiment_vs_toxicity": "one sentence separating criticism from abuse",
  "requires_human_review": false,
  "human_review_reason": ""
}`;

  const outcome = await generateStructuredWithChain(
    {
      purpose: "final-interpretation",
      prompt,
      schema: INTERPRETATION_SCHEMA,
      temperature: 0.1,
      maxOutputTokens: 1024,
      timeoutMs: EQS_TIMEOUTS.finalInterpretationMs,
      signal: input.signal,
    },
    isInterpretationPayload,
    { fast: true },
  );

  if (!outcome.data) {
    return {
      adjustment: 0,
      explanation: {},
      requiresHumanReview: false,
      humanReviewReason: null,
      provider: outcome.provider,
      model: outcome.model,
      latencyMs: outcome.latencyMs,
      status: outcome.provider === "heuristic" ? "unavailable" : "error",
      error: outcome.error,
    };
  }

  const rawAdjustment =
    typeof outcome.data.adjustment === "number" && Number.isFinite(outcome.data.adjustment)
      ? outcome.data.adjustment
      : 0;

  const safeStrings = (value: unknown, limit: number) =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => truncate(item, 160))
          .slice(0, limit)
      : [];

  return {
    // Clamped, not trusted: this is the reproducibility guarantee.
    adjustment: Math.max(-maxAdjustment, Math.min(maxAdjustment, round1(rawAdjustment))),
    explanation: {
      summary: truncate(outcome.data.summary ?? "", 500) || undefined,
      strengths: safeStrings(outcome.data.strengths, 4),
      concerns: safeStrings(outcome.data.concerns, 4),
      sentimentVsToxicity: truncate(outcome.data.sentiment_vs_toxicity ?? "", 400) || undefined,
    },
    requiresHumanReview: outcome.data.requires_human_review === true,
    humanReviewReason:
      typeof outcome.data.human_review_reason === "string" && outcome.data.human_review_reason.trim()
        ? truncate(outcome.data.human_review_reason, 300)
        : null,
    provider: outcome.provider,
    model: outcome.model,
    latencyMs: outcome.latencyMs,
    status: "ok",
  };
}

