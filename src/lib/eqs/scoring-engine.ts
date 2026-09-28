/**
 * Stages 9 and 10 — the deterministic scoring core.
 *
 * Component normalisation, DNA-aware weighting, guardrails, confidence, and the
 * reader-facing explanation. Every function here is pure and synchronous, with no
 * provider or database imports, so the maths can be exercised offline
 * (`scripts/eqs-selftest.mts`).
 *
 * Order is fixed by the spec:
 *   normalise -> DNA/context weighting -> model interpretation -> guardrails
 *
 * The model interpretation step itself lives in `stages/final-interpretation.ts`;
 * `pipeline.ts` sequences the two. Guardrails run last so nothing upstream, model
 * included, can move a score past a hard constraint.
 */

import { EQS_SCORING_CONFIG, getBandLabel } from "@/lib/eqs/config";
import { buildDnaWeights } from "@/lib/eqs/dna-weights";
import {
  EQS_DIMENSION_KEYS,
  EQS_DIMENSION_LABELS,
  type ComponentResult,
  type EqsDimensionKey,
  type EqsDimensionResult,
  type EqsDnaContext,
  type EqsExplanation,
  type EqsFlag,
  type EqsGuardrailApplication,
  type EqsLegacyAttribute,
} from "@/lib/eqs/types";
import { clamp0to1, clamp0to100, mean, round1 } from "@/lib/eqs/utils";
import type { CricketVerificationResult } from "@/lib/eqs/stages/cricket-verification";
import type { InterpretationOutcome } from "@/lib/eqs/stages/final-interpretation";
import type { ExternalPlagiarismResult } from "@/lib/eqs/stages/external-plagiarism";
import type { FastCheckResult } from "@/lib/eqs/stages/fast-checks";
import type { InternalPlagiarismResult } from "@/lib/eqs/stages/internal-plagiarism";
import type { LanguageAnalysisResult } from "@/lib/eqs/stages/language-analysis";

const guardrailConfig = EQS_SCORING_CONFIG.guardrails;
const confidenceConfig = EQS_SCORING_CONFIG.confidence;

// ── Stage 9: normalisation ───────────────────────────────────────────

export interface NormalisedDimensions {
  dimensions: EqsDimensionResult[];
  byKey: Record<EqsDimensionKey, EqsDimensionResult>;
}

/**
 * Turns the specialist outputs into one normalised, DNA-weighted dimension set.
 *
 * Originality is the one dimension owned jointly: the language model scores the
 * framing, and the two plagiarism systems scale it down. That keeps "this is
 * unoriginal phrasing" and "this is copied text" as separate, visible signals.
 */
export function normaliseDimensions(input: {
  dna: EqsDnaContext;
  language: LanguageAnalysisResult;
  cricket: CricketVerificationResult;
  internalPlagiarism: InternalPlagiarismResult;
  externalPlagiarism: ExternalPlagiarismResult;
}): NormalisedDimensions {
  const weights = buildDnaWeights(input.dna);
  const plagiarismFactor = Math.min(
    input.internalPlagiarism.originalityPenaltyFactor,
    input.externalPlagiarism.originalityPenaltyFactor,
  );

  const dimensions: EqsDimensionResult[] = EQS_DIMENSION_KEYS.map((key) => {
    if (key === "statistical_claims") {
      return {
        key,
        label: EQS_DIMENSION_LABELS[key],
        score: input.cricket.statisticalClaimsScore,
        confidence: input.cricket.statisticalClaimsConfidence,
        explanation: input.cricket.statisticalClaimsExplanation,
        weight: weights[key],
        source: "cricket-verification" as const,
      };
    }

    const modelDimension = input.language.dimensions[key];

    if (key === "originality" && plagiarismFactor < 1) {
      const adjusted = clamp0to100(modelDimension.score * plagiarismFactor);
      const driver =
        input.internalPlagiarism.originalityPenaltyFactor <= input.externalPlagiarism.originalityPenaltyFactor
          ? "internal-plagiarism"
          : "external-plagiarism";

      return {
        key,
        label: EQS_DIMENSION_LABELS[key],
        score: adjusted,
        confidence: clamp0to1(
          Math.min(
            modelDimension.confidence,
            driver === "internal-plagiarism"
              ? input.internalPlagiarism.component.confidence
              : input.externalPlagiarism.component.confidence,
          ),
        ),
        explanation: `${modelDimension.explanation} Reduced from ${round1(modelDimension.score)} by the ${driver.replace("-", " ")} check.`,
        weight: weights[key],
        source: driver,
      };
    }

    return {
      key,
      label: EQS_DIMENSION_LABELS[key],
      score: modelDimension.score,
      confidence: modelDimension.confidence,
      explanation: modelDimension.explanation,
      weight: weights[key],
      source: modelDimension.source === "model" ? ("language-analysis" as const) : ("fast-checks" as const),
    };
  });

  const byKey = {} as Record<EqsDimensionKey, EqsDimensionResult>;
  for (const dimension of dimensions) {
    byKey[dimension.key] = dimension;
  }

  return { dimensions, byKey };
}

// ── Stage 10a: DNA-aware weighted base score ─────────────────────────

export function computeWeightedBaseScore(dimensions: EqsDimensionResult[]): number {
  const totalWeight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  if (totalWeight <= 0) return 0;

  const weighted = dimensions.reduce(
    (sum, dimension) => sum + dimension.score * dimension.weight,
    0,
  );

  return clamp0to100(weighted / totalWeight);
}

// ── Stage 10c: deterministic guardrails ──────────────────────────────

export interface GuardrailOutcome {
  score: number;
  applications: EqsGuardrailApplication[];
  flags: EqsFlag[];
  humanReviewReasons: string[];
}

/**
 * Hard constraints applied last so nothing upstream can override them.
 *
 * Every guardrail is a *cap*, never a fixed score: an article that trips one still
 * keeps the ordering the rest of its dimensions earned below the cap. That honours
 * "no single signal should decide whether an article is good or bad" while still
 * making the constraint absolute.
 */
export function applyGuardrails(input: {
  score: number;
  dimensions: Record<EqsDimensionKey, EqsDimensionResult>;
  fastChecks: FastCheckResult;
  cricket: CricketVerificationResult;
  internalPlagiarism: InternalPlagiarismResult;
  externalPlagiarism: ExternalPlagiarismResult;
}): GuardrailOutcome {
  let score = input.score;
  const applications: EqsGuardrailApplication[] = [];
  const flags: EqsFlag[] = [];
  const humanReviewReasons: string[] = [];

  /**
   * Enforces a ceiling and always records that it fired.
   *
   * `cap` is only reached once a guardrail's trigger condition has already matched,
   * so the application is recorded even when the score was under the ceiling
   * anyway. Staying silent there would let an abusive or plagiarised article report
   * "no deterministic guardrail needed", which is exactly the audit trail the spec
   * says has to be trustworthy.
   */
  const cap = (code: string, reason: string, ceiling: number) => {
    const before = score;
    if (score > ceiling) score = ceiling;

    applications.push({
      code,
      reason:
        score === before
          ? `${reason} Score was already at or below the ${ceiling}-point cap, so no reduction was needed.`
          : reason,
      before: round1(before),
      after: round1(score),
    });
  };

  // Toxicity / personal attacks.
  const toxicity = input.dimensions.toxicity.score;
  if (toxicity < guardrailConfig.toxicity.criticalBelow || input.fastChecks.abuseDetected) {
    cap(
      "TOXICITY_CAP",
      `Toxicity dimension at ${round1(toxicity)} (critical below ${guardrailConfig.toxicity.criticalBelow})${input.fastChecks.abuseDetected ? " with explicit abusive language detected" : ""}.`,
      guardrailConfig.toxicity.capEqsAt,
    );
    humanReviewReasons.push("Toxicity guardrail triggered.");
  } else if (toxicity < guardrailConfig.toxicity.warnBelow) {
    flags.push({
      code: "TOXICITY_ELEVATED",
      severity: "warn",
      message: `Toxicity dimension at ${round1(toxicity)}; hostility is close to the acceptable limit.`,
      component: "scoring-engine",
    });
  }

  // Spam / promotion.
  if (input.fastChecks.spamDetected) {
    cap(
      "SPAM_CAP",
      "Promotional or spam patterns dominate the submission.",
      guardrailConfig.spam.capEqsAt,
    );
  }

  // Internal plagiarism.
  const internalEvidence = input.internalPlagiarism.component.evidence;
  if (internalEvidence.exactMatchFlagged) {
    cap(
      "INTERNAL_EXACT_MATCH_CAP",
      `${Math.round(internalEvidence.maxExactOverlapRatio * 100)}% of the draft appears verbatim in an existing CricGeek expression.`,
      guardrailConfig.internalPlagiarism.exactMatchCapEqsAt,
    );
    humanReviewReasons.push("Verbatim overlap with existing CricGeek content.");
  }
  if (internalEvidence.vectorFlagged) {
    cap(
      "INTERNAL_DUPLICATE_CAP",
      `Near-duplicate of an existing expression (${Math.round(internalEvidence.maxVectorSimilarity * 100)}% similarity).`,
      guardrailConfig.internalPlagiarism.flaggedCapEqsAt,
    );
    humanReviewReasons.push("Near-duplicate of existing CricGeek content.");
  }

  // External plagiarism.
  const externalEvidence = input.externalPlagiarism.component.evidence;
  if (
    externalEvidence.matchedPercent !== null &&
    externalEvidence.matchedPercent >= guardrailConfig.externalPlagiarism.matchPercentThreshold
  ) {
    cap(
      "EXTERNAL_PLAGIARISM_CAP",
      `External provider matched ${Math.round(externalEvidence.matchedPercent)}% of the article to outside sources.`,
      guardrailConfig.externalPlagiarism.capEqsAt,
    );
    humanReviewReasons.push("External plagiarism match above threshold.");
  }

  // Contradicted cricket statistics.
  const contradicted = input.cricket.component.evidence.contradicted;
  if (contradicted >= guardrailConfig.statVerification.manyContradictedCount) {
    cap(
      "STAT_CONTRADICTION_CAP_SEVERE",
      `${contradicted} statistical claims were contradicted by trusted cricket data.`,
      guardrailConfig.statVerification.manyContradictedCapEqsAt,
    );
    humanReviewReasons.push("Multiple contradicted statistics.");
  } else if (contradicted >= guardrailConfig.statVerification.minContradictedToCap) {
    cap(
      "STAT_CONTRADICTION_CAP",
      `${contradicted} statistical claim(s) were contradicted by trusted cricket data.`,
      guardrailConfig.statVerification.contradictedCapEqsAt,
    );
  }

  // Thin content: not enough text to assess depth honestly.
  const wordCount = input.fastChecks.component.evidence.wordCount;
  if (wordCount < guardrailConfig.thinContent.minWords) {
    cap(
      "THIN_CONTENT_CAP",
      `Only ${wordCount} words, below the ${guardrailConfig.thinContent.minWords}-word floor for a full assessment.`,
      guardrailConfig.thinContent.capEqsAt,
    );
  }

  // AI-assistance signal: a bounded deduction, never a rejection (spec section 1).
  const aiScore = input.dimensions.ai_assistance.score;
  if (aiScore < guardrailConfig.aiAssistance.warnBelow) {
    const penalty = Math.min(
      guardrailConfig.aiAssistance.maxPenalty,
      ((guardrailConfig.aiAssistance.warnBelow - aiScore) / guardrailConfig.aiAssistance.warnBelow) *
        guardrailConfig.aiAssistance.maxPenalty,
    );
    const before = score;
    score = clamp0to100(score - penalty);
    applications.push({
      code: "AI_ASSISTANCE_SIGNAL_PENALTY",
      reason: `AI-assistance signal at ${round1(aiScore)}; applied a capped ${round1(penalty)}-point deduction. Treated as a signal, not a rejection.`,
      before: round1(before),
      after: round1(score),
    });
    flags.push({
      code: "AI_ASSISTANCE_REVIEW",
      severity: "info",
      message:
        "AI-generation indicators are present. Per policy this is a signal only; a human should decide if it matters.",
      component: "scoring-engine",
    });
  }

  // Sarcasm needs a human read when intent is genuinely ambiguous.
  if (input.dimensions.sarcasm_intent.score < guardrailConfig.sarcasmIntent.warnBelow) {
    humanReviewReasons.push("Sarcasm or intent is ambiguous.");
    flags.push({
      code: "SARCASM_AMBIGUOUS",
      severity: "warn",
      message: `Sarcasm & intent dimension at ${round1(input.dimensions.sarcasm_intent.score)}; literal and intended meaning may differ.`,
      component: "scoring-engine",
    });
  }

  return { score: clamp0to100(score), applications, flags, humanReviewReasons };
}

// ── Confidence ───────────────────────────────────────────────────────

/**
 * Confidence reflects how much of the pipeline actually ran, weighted by each
 * dimension's importance, then reduced for unavailable components and conflicts.
 */
export function computeConfidence(input: {
  dimensions: EqsDimensionResult[];
  components: ComponentResult[];
}): number {
  const totalWeight = input.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  const weightedConfidence =
    totalWeight > 0
      ? input.dimensions.reduce((sum, dimension) => sum + dimension.confidence * dimension.weight, 0) /
        totalWeight
      : mean(input.dimensions.map((dimension) => dimension.confidence));

  const degraded = input.components.filter(
    (component) => component.status === "unavailable" || component.status === "error",
  ).length;

  let confidence = weightedConfidence - degraded * confidenceConfig.componentUnavailablePenalty;

  // A component reporting a critical flag while the weighted score stays high is a
  // material conflict, so trim confidence rather than pretending certainty.
  const hasCriticalFlag = input.components.some((component) =>
    component.flags.some((flag) => flag.severity === "critical"),
  );
  if (hasCriticalFlag) {
    confidence -= confidenceConfig.conflictPenalty;
  }

  return clamp0to1(Math.max(confidenceConfig.floor, confidence));
}

// ── Explanation assembly ─────────────────────────────────────────────

export function buildExplanation(input: {
  dimensions: Record<EqsDimensionKey, EqsDimensionResult>;
  language: LanguageAnalysisResult;
  interpretation: InterpretationOutcome | null;
  guardrails: EqsGuardrailApplication[];
  eqs: number;
}): EqsExplanation {
  const fromModel = input.interpretation?.explanation ?? {};
  const languageEvidence = input.language.component.evidence;

  const strengths =
    (fromModel.strengths?.length ? fromModel.strengths : languageEvidence.strengths).slice(0, 4);
  const concerns =
    (fromModel.concerns?.length ? fromModel.concerns : languageEvidence.concerns).slice(0, 4);

  const topDimensions = Object.values(input.dimensions)
    .filter((dimension) => dimension.weight > 0)
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 3);

  return {
    summary:
      fromModel.summary ||
      languageEvidence.summary ||
      `This expression scored ${round1(input.eqs)} across originality, expression, reasoning, evidence, and safe-discourse dimensions.`,
    strengths:
      strengths.length > 0
        ? strengths
        : [
            `${EQS_DIMENSION_LABELS[topDimensions[0]?.key ?? "expression_quality"]} is the strongest weighted dimension for this writer profile.`,
          ],
    concerns:
      concerns.length > 0
        ? concerns
        : Object.values(input.dimensions)
            .sort((left, right) => left.score - right.score)
            .slice(0, 2)
            .map((dimension) => `${dimension.label} is the weakest dimension at ${round1(dimension.score)}.`),
    sentimentVsToxicity:
      fromModel.sentimentVsToxicity ||
      languageEvidence.sentimentVsToxicity ||
      (input.dimensions.toxicity.score >= 70
        ? "Criticism in this piece was read as negativity, not abuse, so it was not penalised as toxicity."
        : "Hostility in this piece went beyond criticism, so the toxicity dimension was scored down."),
    guardrailDecision:
      input.guardrails.length === 0
        ? "No deterministic guardrail needed to change the weighted score."
        : input.guardrails
            .map((application) => `${application.code}: ${application.reason} (${application.before} → ${application.after})`)
            .join(" "),
    userVisibleBreakdown: topDimensions.map(
      (dimension) => `${dimension.label} ${round1(dimension.score)}/100`,
    ),
  };
}

/** Projects the dimension set onto the legacy attribute shape the publish UI reads. */
export function toLegacyAttributes(dimensions: EqsDimensionResult[]): EqsLegacyAttribute[] {
  // The legacy consumer recomputes a weighted mean from these weights, so
  // `ai_assistance` gets a small nominal weight rather than 0 to keep that
  // recomputation close to the real EQS.
  const nominalAiWeight = 0.04;

  return dimensions.map((dimension) => ({
    name: dimension.label,
    score: Math.round(dimension.score),
    explanation: dimension.explanation,
    weight: Math.round(
      (dimension.key === "ai_assistance" ? nominalAiWeight : dimension.weight) * 100,
    ),
  }));
}

export { getBandLabel };
