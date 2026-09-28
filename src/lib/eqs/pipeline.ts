/**
 * The EQS pipeline (spec section 2).
 *
 *   1. Article input and metadata      -> caller
 *   2. Writer DNA                      -> resolveWriterDna
 *   3. Fast checks                     -> runFastChecks
 *   4. Language analysis               -> runLanguageAnalysis
 *   5. Claim extraction                -> runClaimExtraction
 *   6. Cricket verification            -> runCricketVerification
 *   7. Internal plagiarism             -> runInternalPlagiarism
 *   8. External plagiarism             -> runExternalPlagiarism
 *   9. Component results               -> normaliseDimensions
 *  10. Final EQS                       -> weighting + interpretation + guardrails
 *  11. Output                          -> EqsResult
 *
 * Stage ordering is load-bearing: 6 depends on 5, and 10 must run after every
 * component result exists. Everything else runs concurrently.
 */

import { AuditCollector } from "@/lib/eqs/audit";
import {
  EQS_FEATURES,
  EQS_PIPELINE_VERSION,
  EQS_SCORING_CONFIG,
  EQS_SCORING_CONFIG_VERSION,
  EQS_TIMEOUTS,
} from "@/lib/eqs/config";
import { resolveWriterDna } from "@/lib/eqs/dna";
import {
  applyGuardrails,
  buildExplanation,
  computeConfidence,
  computeWeightedBaseScore,
  getBandLabel,
  normaliseDimensions,
  toLegacyAttributes,
} from "@/lib/eqs/scoring-engine";
import {
  runFinalInterpretation,
  FINAL_INTERPRETATION_PROMPT_VERSION,
  type InterpretationOutcome,
} from "@/lib/eqs/stages/final-interpretation";
import {
  runClaimExtraction,
  type ClaimExtractionResult,
} from "@/lib/eqs/stages/claim-extraction";
import {
  runCricketVerification,
  type CricketVerificationResult,
} from "@/lib/eqs/stages/cricket-verification";
import {
  runExternalPlagiarism,
  skippedExternalPlagiarism,
  type ExternalPlagiarismResult,
} from "@/lib/eqs/stages/external-plagiarism";
import { runFastChecks } from "@/lib/eqs/stages/fast-checks";
import {
  runInternalPlagiarism,
  skippedInternalPlagiarism,
  type InternalPlagiarismResult,
} from "@/lib/eqs/stages/internal-plagiarism";
import {
  runLanguageAnalysis,
  type LanguageAnalysisResult,
} from "@/lib/eqs/stages/language-analysis";
import type {
  ComponentResult,
  EqsFlag,
  EqsModelVersionRecord,
  EqsPipelineInput,
  EqsResult,
} from "@/lib/eqs/types";
import {
  clamp0to100,
  contentHash,
  createLinkedTimeoutSignal,
  createShortId,
  errorMessage,
  isTimeoutError,
  round1,
  withTimeout,
} from "@/lib/eqs/utils";

const guardrailConfig = EQS_SCORING_CONFIG.guardrails;

/** Wraps a stage so a failure or timeout degrades that component only. */
async function runStage<T>(
  name: string,
  audit: AuditCollector,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
  task: (signal: AbortSignal) => Promise<T>,
  onFailure: (reason: string, timedOut: boolean) => T,
): Promise<T> {
  const startedAt = Date.now();

  try {
    const value = await withTimeout(task, timeoutMs, parentSignal);
    audit.record({ stage: name, eventName: "completed", status: "ok", durationMs: Date.now() - startedAt });
    return value;
  } catch (error) {
    const timedOut = isTimeoutError(error);
    const reason = timedOut ? `${name} timed out after ${timeoutMs}ms` : errorMessage(error);

    audit.record({
      stage: name,
      eventName: timedOut ? "timeout" : "failed",
      status: timedOut ? "timeout" : "error",
      message: reason,
      durationMs: Date.now() - startedAt,
    });

    return onFailure(reason, timedOut);
  }
}

function degradedLanguageAnalysis(
  fastChecks: ReturnType<typeof runFastChecks>,
  reason: string,
): LanguageAnalysisResult {
  const heuristics = fastChecks.heuristicDimensions;
  const dimensions = {} as LanguageAnalysisResult["dimensions"];

  for (const [key, score] of Object.entries(heuristics)) {
    dimensions[key as keyof LanguageAnalysisResult["dimensions"]] = {
      score,
      confidence: 0.35,
      explanation: "Deterministic fallback: the language-analysis stage did not complete.",
      source: "heuristic",
    };
  }

  return {
    component: {
      component: "language-analysis",
      score: clamp0to100(
        Object.values(heuristics).reduce((sum, value) => sum + value, 0) /
          Math.max(1, Object.values(heuristics).length),
      ),
      confidence: 0.3,
      evidence: {
        summary: "Language analysis did not complete; deterministic signals were used.",
        strengths: [],
        concerns: [],
        sentimentVsToxicity: "",
        reviewNotes: [],
        heuristicFallbackDimensions: Object.keys(heuristics) as never,
        providerAttempts: [],
      },
      flags: [
        {
          code: "LANGUAGE_ANALYSIS_FAILED",
          severity: "warn",
          message: reason,
          component: "language-analysis",
        },
      ],
      source: "cricgeek-fast-checks",
      version: "heuristic-fallback",
      status: "error",
      durationMs: 0,
      error: reason,
    },
    dimensions,
    provider: "heuristic",
    model: "none",
    promptVersion: "heuristic-fallback",
    latencyMs: 0,
  };
}

function degradedClaimExtraction(reason: string): ClaimExtractionResult {
  return {
    component: {
      component: "claim-extraction",
      score: null,
      confidence: 0.2,
      evidence: {
        claimsExtracted: 0,
        claimsRequiringVerification: 0,
        extractionMode: "heuristic",
        providerAttempts: [],
      },
      flags: [
        {
          code: "CLAIM_EXTRACTION_FAILED",
          severity: "warn",
          message: reason,
          component: "claim-extraction",
        },
      ],
      claims: [],
      source: "none",
      version: "none",
      status: "error",
      durationMs: 0,
      error: reason,
    },
    claims: [],
    provider: "none",
    model: "none",
    promptVersion: "none",
    latencyMs: 0,
  };
}

function degradedCricketVerification(reason: string): CricketVerificationResult {
  return {
    component: {
      component: "cricket-verification",
      score: 75,
      confidence: 0.2,
      evidence: {
        scorecardSource: "unavailable",
        matchId: null,
        claimsConsidered: 0,
        claimsRequiringVerification: 0,
        supported: 0,
        contradicted: 0,
        inconclusive: 0,
        unverified: 0,
        coverage: 0,
        factCheck: null,
      },
      flags: [
        {
          code: "CRICKET_VERIFICATION_FAILED",
          severity: "warn",
          message: reason,
          component: "cricket-verification",
        },
      ],
      claims: [],
      source: "none",
      version: "none",
      status: "error",
      durationMs: 0,
      error: reason,
    },
    claims: [],
    statisticalClaimsScore: 75,
    statisticalClaimsConfidence: 0.2,
    statisticalClaimsExplanation: reason,
  };
}

export interface EqsPipelineRun {
  result: EqsResult;
  /**
   * Buffered audit events. Flush with the persisted run id so the trail is
   * queryable, or with `null` for an unsaved preview run.
   */
  audit: AuditCollector;
}

/**
 * Runs the pipeline and returns the audit buffer alongside the result, so the caller
 * can flush it against the run id it persists.
 */
export async function runEqsPipelineDetailed(input: EqsPipelineInput): Promise<EqsPipelineRun> {
  const startedAt = Date.now();
  const requestId = createShortId("q").slice(0, 10);
  const audit = new AuditCollector({ blogId: input.blogId ?? null, requestId });
  const timings: Record<string, number> = {};

  // Overall ceiling for the run, on top of the per-stage budgets. The stage timeouts
  // can sum to more than a serverless invocation allows, so this bounds the whole
  // pipeline even while every individual stage is still inside its own budget.
  const { signal, dispose } = createLinkedTimeoutSignal(
    EQS_TIMEOUTS.pipelineMs,
    input.signal,
    "EQS_PIPELINE_TIMEOUT",
  );

  try {
    const track = async <T>(name: string, task: () => Promise<T>): Promise<T> => {
      const stageStart = Date.now();
      try {
        return await task();
      } finally {
        timings[name] = Date.now() - stageStart;
      }
    };

    audit.record({
      stage: "pipeline",
      eventName: "started",
      status: "ok",
      detail: { requestId, hasMatchId: Boolean(input.matchId), fastMode: Boolean(input.fastMode) },
    });

    // ── Stage 3: fast checks (synchronous, always succeeds) ────────────
    const fastChecks = await track("fastChecks", async () => runFastChecks(input));

    // ── Stage 2: Writer DNA ───────────────────────────────────────────
    const dna = await track("writerDna", () =>
      resolveWriterDna({
        content: input.content,
        writerId: input.writerId,
        dnaOverride: input.dnaOverride,
      }).catch((error) => {
        audit.record({
          stage: "writerDna",
          eventName: "failed",
          status: "error",
          message: errorMessage(error),
        });
        return {
          mix: { fan: 0.25, analyst: 0.25, debater: 0.25, storyteller: 0.25 },
          dominant: "fan" as const,
          mixed: true,
          source: "default" as const,
        };
      }),
    );

    // ── Stages 4, 5, 7, 8 run concurrently ────────────────────────────
    const languagePromise = track("languageAnalysis", () =>
      runStage(
        "languageAnalysis",
        audit,
        EQS_TIMEOUTS.languageAnalysisMs,
        signal,
        (signal) => runLanguageAnalysis({ ...input, dna, fastChecks, signal }),
        (reason) => degradedLanguageAnalysis(fastChecks, reason),
      ),
    );

    const claimsPromise = track("claimExtraction", () =>
      runStage(
        "claimExtraction",
        audit,
        EQS_TIMEOUTS.claimExtractionMs,
        signal,
        (signal) => runClaimExtraction({ title: input.title, content: input.content, signal }),
        (reason) => degradedClaimExtraction(reason),
      ),
    );

    const internalPlagiarismPromise: Promise<InternalPlagiarismResult> = EQS_FEATURES.internalPlagiarism
      ? track("internalPlagiarism", () =>
          runStage(
            "internalPlagiarism",
            audit,
            EQS_TIMEOUTS.internalPlagiarismMs,
            signal,
            (signal) =>
              runInternalPlagiarism({
                content: input.content,
                excludeBlogId: input.blogId,
                exactMatchRatioThreshold: guardrailConfig.internalPlagiarism.exactMatchRatioThreshold,
                reviewSimilarity: guardrailConfig.internalPlagiarism.reviewSimilarity,
                signal,
              }),
            () => skippedInternalPlagiarism(),
          ),
        )
      : Promise.resolve(skippedInternalPlagiarism());

    // Skipped in fast mode: this is the paid, slowest specialist call.
    const externalPlagiarismPromise: Promise<ExternalPlagiarismResult> =
      EQS_FEATURES.externalPlagiarism && !input.fastMode
        ? track("externalPlagiarism", () =>
            runStage(
              "externalPlagiarism",
              audit,
              EQS_TIMEOUTS.externalPlagiarismMs,
              signal,
              (signal) =>
                runExternalPlagiarism({
                  title: input.title,
                  content: input.content,
                  matchPercentThreshold: guardrailConfig.externalPlagiarism.matchPercentThreshold,
                  timeoutMs: EQS_TIMEOUTS.externalPlagiarismMs,
                  signal,
                }),
              () => skippedExternalPlagiarism(),
            ),
          )
        : Promise.resolve(skippedExternalPlagiarism());

    const [language, claimExtraction, internalPlagiarism, externalPlagiarism] = await Promise.all([
      languagePromise,
      claimsPromise,
      internalPlagiarismPromise,
      externalPlagiarismPromise,
    ]);

    // ── Stage 6: cricket verification (needs stage 5's claims) ────────
    const cricket: CricketVerificationResult =
      EQS_FEATURES.cricketVerification && !input.fastMode
        ? await track("cricketVerification", () =>
            runStage(
              "cricketVerification",
              audit,
              EQS_TIMEOUTS.cricketVerificationMs,
              signal,
              (signal) =>
                runCricketVerification({
                  title: input.title,
                  content: input.content,
                  matchId: input.matchId,
                  claims: claimExtraction.claims,
                  signal,
                }),
              (reason) => degradedCricketVerification(reason),
            ),
          )
        : degradedCricketVerification(
            input.fastMode
              ? "Cricket verification skipped in fast preview mode."
              : "Cricket verification disabled by configuration.",
          );

    // ── Stage 9: normalise component results ──────────────────────────
    const { dimensions, byKey } = normaliseDimensions({
      dna,
      language,
      cricket,
      internalPlagiarism,
      externalPlagiarism,
    });

    const components: ComponentResult[] = [
      fastChecks.component,
      language.component,
      claimExtraction.component,
      cricket.component,
      internalPlagiarism.component,
      externalPlagiarism.component,
    ];

    const componentFlags: EqsFlag[] = components.flatMap((component) => component.flags);

    // ── Stage 10a: DNA-aware weighted base score ──────────────────────
    const baseScore = computeWeightedBaseScore(dimensions);

    // ── Stage 10b: bounded model interpretation ───────────────────────
    let interpretation: InterpretationOutcome | null = null;

    if (EQS_FEATURES.finalInterpretation && !input.fastMode) {
      interpretation = await track("finalInterpretation", () =>
        runStage(
          "finalInterpretation",
          audit,
          EQS_TIMEOUTS.finalInterpretationMs,
          signal,
          (signal) =>
            runFinalInterpretation({
              title: input.title,
              dna,
              baseScore,
              dimensions,
              components,
              flags: componentFlags,
              signal,
            }),
          (reason) => ({
            adjustment: 0,
            explanation: {},
            requiresHumanReview: false,
            humanReviewReason: null,
            provider: "heuristic",
            model: "none",
            latencyMs: 0,
            status: "error" as const,
            error: reason,
          }),
        ),
      );
    }

    const interpretedScore = clamp0to100(baseScore + (interpretation?.adjustment ?? 0));

    // ── Stage 10c: deterministic guardrails (always last) ─────────────
    const guardrails = applyGuardrails({
      score: interpretedScore,
      dimensions: byKey,
      fastChecks,
      cricket,
      internalPlagiarism,
      externalPlagiarism,
    });

    const eqs = guardrails.score;
    const confidence = computeConfidence({ dimensions, components });

    const allFlags: EqsFlag[] = [...componentFlags, ...guardrails.flags];

    const humanReviewReasons = [...new Set(guardrails.humanReviewReasons)];
    if (confidence < EQS_SCORING_CONFIG.confidence.humanReviewBelow) {
      humanReviewReasons.push(
        `Confidence ${confidence.toFixed(2)} is below the ${EQS_SCORING_CONFIG.confidence.humanReviewBelow} review threshold.`,
      );
    }
    if (interpretation?.requiresHumanReview && interpretation.humanReviewReason) {
      humanReviewReasons.push(interpretation.humanReviewReason);
    }

    const explanation = buildExplanation({
      dimensions: byKey,
      language,
      interpretation,
      guardrails: guardrails.applications,
      eqs,
    });

    const modelVersions: EqsModelVersionRecord[] = [
      {
        stage: "language-analysis",
        provider: language.provider,
        model: language.model,
        promptVersion: language.promptVersion,
        latencyMs: language.latencyMs,
        status: language.component.status,
      },
      {
        stage: "claim-extraction",
        provider: claimExtraction.provider,
        model: claimExtraction.model,
        promptVersion: claimExtraction.promptVersion,
        latencyMs: claimExtraction.latencyMs,
        status: claimExtraction.component.status,
      },
    ];

    if (interpretation) {
      modelVersions.push({
        stage: "final-interpretation",
        provider: interpretation.provider,
        model: interpretation.model,
        promptVersion: FINAL_INTERPRETATION_PROMPT_VERSION,
        latencyMs: interpretation.latencyMs,
        status: interpretation.status,
      });
    }

    const processingTimeMs = Date.now() - startedAt;

    audit.record({
      stage: "pipeline",
      eventName: "scored",
      status: "ok",
      message: `EQS ${round1(eqs)} (base ${round1(baseScore)}, adjustment ${interpretation?.adjustment ?? 0})`,
      detail: {
        eqs,
        baseScore,
        confidence,
        guardrails: guardrails.applications.map((application) => application.code),
        requiresHumanReview: humanReviewReasons.length > 0,
      },
      durationMs: processingTimeMs,
    });

    const result: EqsResult = {
      eqs,
      confidence,
      band: getBandLabel(eqs),
      dimensions,
      components,
      claims: cricket.claims.length > 0 ? cricket.claims : claimExtraction.claims,
      flags: allFlags,
      guardrails: guardrails.applications,
      writerDna: dna,
      explanation,
      requiresHumanReview: humanReviewReasons.length > 0,
      humanReviewReasons,
      baseScore,
      pipelineVersion: EQS_PIPELINE_VERSION,
      scoringConfigVersion: EQS_SCORING_CONFIG_VERSION,
      modelVersions,
      contentHash: contentHash(input),
      timings,
      processingTimeMs,

      // Backwards-compatible projection for the existing publish-flow UI.
      overallEqs: Math.round(eqs),
      weightedEqs: Math.round(eqs),
      attributes: toLegacyAttributes(dimensions),
    };

    return { result, audit };
  } finally {
    dispose();
  }
}

/**
 * Convenience wrapper for callers that only need the score. Audit events are still
 * written, but without a run id to join on.
 */
export async function runEqsPipeline(input: EqsPipelineInput): Promise<EqsResult> {
  const { result, audit } = await runEqsPipelineDetailed(input);
  await audit.flush(null).catch(() => undefined);
  return result;
}

export { AuditCollector };
