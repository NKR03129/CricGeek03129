/**
 * Benchmark and calibration harness (spec section 9).
 *
 * Runs the labelled set in `src/data/eqs-benchmark.json` through the live pipeline
 * and reports the metrics the spec asks for: band accuracy, mean absolute error, and
 * false positive / negative rates for sarcasm, toxicity, originality, plagiarism,
 * stat verification, and the AI-assistance signal.
 *
 * Every report is stamped with the pipeline, config, and model versions so results
 * stay comparable across changes ("benchmark before changing production models,
 * weights, or thresholds").
 */

import rawBenchmark from "@/data/eqs-benchmark.json";
import {
  EQS_PIPELINE_VERSION,
  EQS_SCORING_CONFIG,
  EQS_SCORING_CONFIG_VERSION,
  describeEqsConfiguration,
} from "@/lib/eqs/config";
import { runEqsPipeline } from "@/lib/eqs/pipeline";
import type { EqsDnaProfile, EqsResult } from "@/lib/eqs/types";
import { errorMessage, mean, round1, round3 } from "@/lib/eqs/utils";

export type BenchmarkBand = "low" | "medium" | "high";

export type BenchmarkCategory =
  | "high-quality-human"
  | "sarcasm"
  | "strong-criticism"
  | "toxicity"
  | "incorrect-stats"
  | "ai-paraphrase"
  | "copied-text"
  | "vague-writing"
  | "mixed-quality";

export interface BenchmarkSample {
  id: string;
  title: string;
  content: string;
  category: BenchmarkCategory;
  /** Writer DNA to score against. A mix exercises the mixed-profile path. */
  dna: Partial<Record<EqsDnaProfile, number>>;
  groundTruth: {
    /** Editorial judgement of overall quality. */
    band: BenchmarkBand;
    /** True when a human editor reads the piece as sarcastic or ironic. */
    sarcastic?: boolean;
    /** True when the piece contains personal attacks or abuse. */
    toxic?: boolean;
    /** True when the piece is criticism but NOT abuse (the key false-positive test). */
    criticalButConstructive?: boolean;
    /** True when the piece contains statistics a verifier should contradict. */
    incorrectStats?: boolean;
    /** True when the piece reads as AI-generated or heavily AI-assisted. */
    aiAssisted?: boolean;
    /** True when the piece reuses existing text. */
    plagiarised?: boolean;
    /** True when the piece is vague or filler-heavy. */
    vague?: boolean;
  };
  notes?: string;
}

const samples = rawBenchmark as unknown as BenchmarkSample[];

export function getBenchmarkSamples(): BenchmarkSample[] {
  return samples;
}

/** Midpoint of each editorial band, used for mean absolute error. */
const BAND_TARGETS: Record<BenchmarkBand, number> = { high: 82, medium: 62, low: 32 };

/** Boundaries used to turn a numeric EQS back into a band. */
function eqsToBand(eqs: number): BenchmarkBand {
  if (eqs >= 72) return "high";
  if (eqs >= 48) return "medium";
  return "low";
}

/** Detector thresholds. These are what calibration tunes. */
const DETECTION_THRESHOLDS = {
  sarcasm: EQS_SCORING_CONFIG.guardrails.sarcasmIntent.warnBelow,
  toxicity: EQS_SCORING_CONFIG.guardrails.toxicity.warnBelow,
  aiAssistance: EQS_SCORING_CONFIG.guardrails.aiAssistance.warnBelow,
  originality: 55,
};

export interface ConfusionCounts {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
}

export interface ConfusionMetrics extends ConfusionCounts {
  precision: number | null;
  recall: number | null;
  falsePositiveRate: number | null;
  falseNegativeRate: number | null;
}

function emptyConfusion(): ConfusionCounts {
  return { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 };
}

function record(counts: ConfusionCounts, expected: boolean, detected: boolean) {
  if (expected && detected) counts.truePositive += 1;
  else if (!expected && detected) counts.falsePositive += 1;
  else if (!expected && !detected) counts.trueNegative += 1;
  else counts.falseNegative += 1;
}

function summarise(counts: ConfusionCounts): ConfusionMetrics {
  const predictedPositive = counts.truePositive + counts.falsePositive;
  const actualPositive = counts.truePositive + counts.falseNegative;
  const actualNegative = counts.trueNegative + counts.falsePositive;

  return {
    ...counts,
    precision: predictedPositive > 0 ? round3(counts.truePositive / predictedPositive) : null,
    recall: actualPositive > 0 ? round3(counts.truePositive / actualPositive) : null,
    falsePositiveRate: actualNegative > 0 ? round3(counts.falsePositive / actualNegative) : null,
    falseNegativeRate: actualPositive > 0 ? round3(counts.falseNegative / actualPositive) : null,
  };
}

export interface BenchmarkSampleResult {
  id: string;
  category: BenchmarkCategory;
  expectedBand: BenchmarkBand;
  actualBand: BenchmarkBand;
  bandMatch: boolean;
  eqs: number;
  absoluteError: number;
  confidence: number;
  requiresHumanReview: boolean;
  dnaSource: string;
  dnaMixed: boolean;
  detections: {
    sarcasm: boolean;
    toxicity: boolean;
    aiAssistance: boolean;
    lowOriginality: boolean;
    plagiarism: boolean;
    contradictedStats: boolean;
  };
  guardrails: string[];
  error?: string;
}

export interface BenchmarkReport {
  runAt: string;
  pipelineVersion: string;
  scoringConfigVersion: string;
  configuration: ReturnType<typeof describeEqsConfiguration>;
  /** Models that actually served the run, so a report is attributable. */
  observedModels: Array<{ stage: string; provider: string; model: string }>;
  datasetSize: number;
  sampled: number;
  summary: {
    bandAccuracy: number;
    meanAbsoluteError: number;
    meanConfidence: number;
    humanReviewRate: number;
    failures: number;
  };
  /** False positive / negative behaviour for the signals the spec calls out. */
  detectionMetrics: {
    sarcasm: ConfusionMetrics;
    toxicity: ConfusionMetrics;
    aiAssistance: ConfusionMetrics;
    originality: ConfusionMetrics;
    plagiarism: ConfusionMetrics;
    statVerification: ConfusionMetrics;
  };
  /** Does reasoned criticism survive without being scored as abuse? */
  criticismNotPenalised: {
    samples: number;
    passed: number;
    failedIds: string[];
  };
  byCategory: Array<{
    category: BenchmarkCategory;
    samples: number;
    bandAccuracy: number;
    meanAbsoluteError: number;
    meanEqs: number;
  }>;
  results: BenchmarkSampleResult[];
  warnings: string[];
}

function detect(result: EqsResult) {
  const byKey = new Map(result.dimensions.map((dimension) => [dimension.key, dimension.score]));
  const flagCodes = new Set(result.flags.map((flag) => flag.code));

  const cricketEvidence = result.components.find(
    (component) => component.component === "cricket-verification",
  )?.evidence as { contradicted?: number } | undefined;

  return {
    sarcasm: (byKey.get("sarcasm_intent") ?? 100) < DETECTION_THRESHOLDS.sarcasm,
    toxicity: (byKey.get("toxicity") ?? 100) < DETECTION_THRESHOLDS.toxicity,
    aiAssistance: (byKey.get("ai_assistance") ?? 100) < DETECTION_THRESHOLDS.aiAssistance,
    lowOriginality: (byKey.get("originality") ?? 100) < DETECTION_THRESHOLDS.originality,
    plagiarism:
      flagCodes.has("INTERNAL_DUPLICATE") ||
      flagCodes.has("INTERNAL_EXACT_MATCH") ||
      flagCodes.has("EXTERNAL_PLAGIARISM_MATCH"),
    contradictedStats: (cricketEvidence?.contradicted ?? 0) > 0,
  };
}

export interface BenchmarkOptions {
  /** Cap the number of samples, for a quick smoke run. */
  limit?: number;
  /** Only run one category. */
  category?: BenchmarkCategory;
  /** Skip the paid specialist calls. Faster, but stat/plagiarism metrics go blind. */
  fastMode?: boolean;
}

export async function runEqsBenchmark(options: BenchmarkOptions = {}): Promise<BenchmarkReport> {
  const pool = options.category
    ? samples.filter((sample) => sample.category === options.category)
    : samples;
  const selected = options.limit ? pool.slice(0, Math.max(1, options.limit)) : pool;

  const results: BenchmarkSampleResult[] = [];
  const warnings: string[] = [];
  const observedModels = new Map<string, { stage: string; provider: string; model: string }>();

  const confusion = {
    sarcasm: emptyConfusion(),
    toxicity: emptyConfusion(),
    aiAssistance: emptyConfusion(),
    originality: emptyConfusion(),
    plagiarism: emptyConfusion(),
    statVerification: emptyConfusion(),
  };

  const criticismFailedIds: string[] = [];
  let criticismSamples = 0;
  let criticismPassed = 0;

  for (const sample of selected) {
    try {
      const result = await runEqsPipeline({
        title: sample.title,
        content: sample.content,
        dnaOverride: sample.dna,
        fastMode: options.fastMode,
      });

      for (const version of result.modelVersions) {
        observedModels.set(`${version.stage}:${version.provider}:${version.model}`, {
          stage: version.stage,
          provider: version.provider,
          model: version.model,
        });
      }

      const detections = detect(result);
      const expected = sample.groundTruth;

      record(confusion.sarcasm, expected.sarcastic === true, detections.sarcasm);
      record(confusion.toxicity, expected.toxic === true, detections.toxicity);
      record(confusion.aiAssistance, expected.aiAssisted === true, detections.aiAssistance);
      record(
        confusion.originality,
        expected.plagiarised === true || expected.vague === true,
        detections.lowOriginality,
      );
      record(confusion.plagiarism, expected.plagiarised === true, detections.plagiarism);
      record(confusion.statVerification, expected.incorrectStats === true, detections.contradictedStats);

      // The spec's headline principle: reasoned criticism must not be read as abuse.
      if (expected.criticalButConstructive) {
        criticismSamples += 1;
        if (!detections.toxicity) {
          criticismPassed += 1;
        } else {
          criticismFailedIds.push(sample.id);
        }
      }

      const actualBand = eqsToBand(result.eqs);

      results.push({
        id: sample.id,
        category: sample.category,
        expectedBand: expected.band,
        actualBand,
        bandMatch: actualBand === expected.band,
        eqs: round1(result.eqs),
        absoluteError: round1(Math.abs(result.eqs - BAND_TARGETS[expected.band])),
        confidence: round3(result.confidence),
        requiresHumanReview: result.requiresHumanReview,
        dnaSource: result.writerDna.source,
        dnaMixed: result.writerDna.mixed,
        detections,
        guardrails: result.guardrails.map((entry) => entry.code),
      });
    } catch (error) {
      const message = errorMessage(error);
      warnings.push(`Sample ${sample.id} failed: ${message}`);
      results.push({
        id: sample.id,
        category: sample.category,
        expectedBand: sample.groundTruth.band,
        actualBand: "low",
        bandMatch: false,
        eqs: 0,
        absoluteError: BAND_TARGETS[sample.groundTruth.band],
        confidence: 0,
        requiresHumanReview: true,
        dnaSource: "default",
        dnaMixed: false,
        detections: {
          sarcasm: false,
          toxicity: false,
          aiAssistance: false,
          lowOriginality: false,
          plagiarism: false,
          contradictedStats: false,
        },
        guardrails: [],
        error: message,
      });
    }
  }

  const scored = results.filter((entry) => !entry.error);
  const categories = [...new Set(selected.map((sample) => sample.category))];

  if (options.fastMode) {
    warnings.push(
      "fastMode skipped cricket verification and external plagiarism, so statVerification and plagiarism metrics are not meaningful in this report.",
    );
  }

  const config = describeEqsConfiguration();
  if (!config.geminiConfigured && config.provider !== "ollama") {
    warnings.push(
      "The spec's primary model (Gemini) is not configured, so this report reflects the fallback provider. Pin EQS_PROVIDER before comparing reports.",
    );
  }
  if (!config.externalPlagiarismConfigured) {
    warnings.push(
      "No external plagiarism provider is configured, so external-plagiarism detections cannot contribute to the plagiarism metrics.",
    );
  }

  return {
    runAt: new Date().toISOString(),
    pipelineVersion: EQS_PIPELINE_VERSION,
    scoringConfigVersion: EQS_SCORING_CONFIG_VERSION,
    configuration: config,
    observedModels: [...observedModels.values()],
    datasetSize: samples.length,
    sampled: selected.length,
    summary: {
      bandAccuracy: scored.length
        ? round3(scored.filter((entry) => entry.bandMatch).length / scored.length)
        : 0,
      meanAbsoluteError: scored.length ? round1(mean(scored.map((entry) => entry.absoluteError))) : 0,
      meanConfidence: scored.length ? round3(mean(scored.map((entry) => entry.confidence))) : 0,
      humanReviewRate: scored.length
        ? round3(scored.filter((entry) => entry.requiresHumanReview).length / scored.length)
        : 0,
      failures: results.length - scored.length,
    },
    detectionMetrics: {
      sarcasm: summarise(confusion.sarcasm),
      toxicity: summarise(confusion.toxicity),
      aiAssistance: summarise(confusion.aiAssistance),
      originality: summarise(confusion.originality),
      plagiarism: summarise(confusion.plagiarism),
      statVerification: summarise(confusion.statVerification),
    },
    criticismNotPenalised: {
      samples: criticismSamples,
      passed: criticismPassed,
      failedIds: criticismFailedIds,
    },
    byCategory: categories.map((category) => {
      const inCategory = scored.filter((entry) => entry.category === category);
      return {
        category,
        samples: inCategory.length,
        bandAccuracy: inCategory.length
          ? round3(inCategory.filter((entry) => entry.bandMatch).length / inCategory.length)
          : 0,
        meanAbsoluteError: inCategory.length
          ? round1(mean(inCategory.map((entry) => entry.absoluteError)))
          : 0,
        meanEqs: inCategory.length ? round1(mean(inCategory.map((entry) => entry.eqs))) : 0,
      };
    }),
    results,
    warnings,
  };
}

/** Coverage check against the categories and DNA profiles the spec requires. */
export function describeBenchmarkCoverage() {
  const byCategory = new Map<string, number>();
  const byDominantDna = new Map<string, number>();
  let mixedDnaSamples = 0;

  for (const sample of samples) {
    byCategory.set(sample.category, (byCategory.get(sample.category) ?? 0) + 1);

    const entries = Object.entries(sample.dna).filter(([, weight]) => (weight ?? 0) > 0);
    const total = entries.reduce((sum, [, weight]) => sum + (weight ?? 0), 0) || 1;
    const dominant = entries.sort(([, left], [, right]) => (right ?? 0) - (left ?? 0))[0];

    if (dominant) {
      byDominantDna.set(dominant[0], (byDominantDna.get(dominant[0]) ?? 0) + 1);
      if ((dominant[1] ?? 0) / total < 0.45) mixedDnaSamples += 1;
    }
  }

  return {
    datasetSize: samples.length,
    /** The spec targets 200-500 editorially labelled examples. */
    targetSize: { min: 200, max: 500 },
    meetsTarget: samples.length >= 200,
    byCategory: Object.fromEntries(byCategory),
    byDominantDna: Object.fromEntries(byDominantDna),
    mixedDnaSamples,
  };
}
