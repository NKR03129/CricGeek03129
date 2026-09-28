/**
 * EQS configuration.
 *
 * Model/provider selection, timeouts, weights, and thresholds are resolved here so
 * the pipeline stages stay free of environment lookups (spec section 13).
 */

import rawScoringConfig from "@/data/eqs-scoring-config.json";
import type { EqsDimensionKey, EqsDnaProfile } from "@/lib/eqs/types";

/** Bumped whenever pipeline behaviour changes, so stored runs stay explainable. */
export const EQS_PIPELINE_VERSION = "eqs-pipeline-2.0.0";

export type EqsProviderId = "gemini" | "ollama" | "heuristic";

type ScoringConfig = {
  configVersion: string;
  dnaWeights: Record<EqsDnaProfile, Record<string, number>>;
  modelInterpretation: { enabled: boolean; maxAdjustment: number };
  guardrails: {
    toxicity: { criticalBelow: number; capEqsAt: number; warnBelow: number };
    sarcasmIntent: { warnBelow: number };
    internalPlagiarism: {
      flaggedCapEqsAt: number;
      reviewSimilarity: number;
      exactMatchCapEqsAt: number;
      exactMatchRatioThreshold: number;
    };
    externalPlagiarism: { matchPercentThreshold: number; capEqsAt: number };
    statVerification: {
      minContradictedToCap: number;
      contradictedCapEqsAt: number;
      manyContradictedCount: number;
      manyContradictedCapEqsAt: number;
    };
    spam: { capEqsAt: number };
    thinContent: { minWords: number; capEqsAt: number };
    aiAssistance: { signalOnly: boolean; maxPenalty: number; warnBelow: number };
  };
  confidence: {
    humanReviewBelow: number;
    componentUnavailablePenalty: number;
    conflictPenalty: number;
    floor: number;
  };
  bands: Array<{ minEqs: number; label: string }>;
};

const scoringConfig = rawScoringConfig as unknown as ScoringConfig;

export const EQS_SCORING_CONFIG = scoringConfig;
export const EQS_SCORING_CONFIG_VERSION = scoringConfig.configVersion;

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = readEnv(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

// ── Language model configuration ─────────────────────────────────────
//
// The spec names Gemini 3.5 Flash (`gemini-3.5-flash`) as the planned primary
// language-analysis model and requires the production model to stay configurable so
// newer or cheaper models can be benchmarked later. The model id therefore defaults
// to the spec value but is overridable, and the *provider* defaults to "auto" so the
// app keeps working on whatever backend is actually reachable.

export const GEMINI_API_BASE_URL =
  readEnv("GEMINI_API_BASE_URL") || "https://generativelanguage.googleapis.com/v1beta";

/** Primary language-analysis model id (spec section 3). Override per environment. */
export const GEMINI_EQS_MODEL = readEnv("GEMINI_EQS_MODEL") || "gemini-3.5-flash";

/**
 * Cheaper model for high-volume sub-tasks (claim extraction, final interpretation).
 * The spec only permits this once CricGeek's own benchmark shows acceptable quality,
 * so it defaults to the same model as the primary pass.
 */
export const GEMINI_EQS_FAST_MODEL = readEnv("GEMINI_EQS_FAST_MODEL") || GEMINI_EQS_MODEL;

export function getGeminiApiKey(): string | undefined {
  return readEnv("GEMINI_API_KEY") || readEnv("GOOGLE_GENERATIVE_AI_API_KEY");
}

export const OLLAMA_EQS_MODEL =
  readEnv("OLLAMA_EQS_MODEL") || readEnv("OLLAMA_BQS_MODEL") || readEnv("OLLAMA_MODEL") || "qwen3.5:latest";

/**
 * "auto" walks the provider chain in order of preference and uses the first
 * configured one. Pin to a single provider for reproducible benchmark runs.
 */
export function getConfiguredProvider(): EqsProviderId | "auto" {
  const raw = readEnv("EQS_PROVIDER")?.toLowerCase();
  if (raw === "gemini" || raw === "ollama" || raw === "heuristic") return raw;
  return "auto";
}

export const EQS_TIMEOUTS = {
  languageAnalysisMs: readNumber("EQS_LANGUAGE_TIMEOUT_MS", 45_000),
  claimExtractionMs: readNumber("EQS_CLAIM_TIMEOUT_MS", 25_000),
  cricketVerificationMs: readNumber("EQS_CRICKET_TIMEOUT_MS", 30_000),
  internalPlagiarismMs: readNumber("EQS_INTERNAL_PLAGIARISM_TIMEOUT_MS", 6_000),
  externalPlagiarismMs: readNumber("EQS_EXTERNAL_PLAGIARISM_TIMEOUT_MS", 20_000),
  finalInterpretationMs: readNumber("EQS_FINAL_INTERPRETATION_TIMEOUT_MS", 20_000),
  pipelineMs: readNumber("EQS_PIPELINE_TIMEOUT_MS", 110_000),
};

export const EQS_FEATURES = {
  /** Stage 8. Off unless an external plagiarism provider is configured. */
  externalPlagiarism: readBoolean("EQS_EXTERNAL_PLAGIARISM_ENABLED", true),
  /** Stage 7. */
  internalPlagiarism: readBoolean("EQS_INTERNAL_PLAGIARISM_ENABLED", true),
  /** Stage 6. */
  cricketVerification: readBoolean("EQS_CRICKET_VERIFICATION_ENABLED", true),
  /** Stage 10's bounded model interpretation pass. */
  finalInterpretation: readBoolean(
    "EQS_FINAL_INTERPRETATION_ENABLED",
    scoringConfig.modelInterpretation.enabled,
  ),
  /** Persist runs, components, claims, and audit events. */
  persistence: readBoolean("EQS_PERSISTENCE_ENABLED", true),
  /** Run the EQS pipeline as part of `/api/scoring/analyze`. */
  runOnAnalyze: readBoolean("EQS_RUN_ON_ANALYZE", true),
};

export const EQS_CACHE = {
  ttlMs: readNumber("EQS_CACHE_TTL_MS", 10 * 60 * 1000),
  maxEntries: readNumber("EQS_CACHE_MAX_ENTRIES", 200),
};

// ── External plagiarism provider (spec section 6) ────────────────────

export type ExternalPlagiarismProviderConfig = {
  provider: string;
  url: string;
  apiKey: string | undefined;
  /** Header used to pass the key. Providers differ, so this stays configurable. */
  authHeader: string;
  authScheme: string;
};

export function getExternalPlagiarismConfig(): ExternalPlagiarismProviderConfig | null {
  const url = readEnv("EXTERNAL_PLAGIARISM_API_URL");
  if (!url) return null;

  return {
    provider: readEnv("EXTERNAL_PLAGIARISM_PROVIDER") || "external-plagiarism-api",
    url,
    apiKey: readEnv("EXTERNAL_PLAGIARISM_API_KEY"),
    authHeader: readEnv("EXTERNAL_PLAGIARISM_AUTH_HEADER") || "Authorization",
    authScheme: readEnv("EXTERNAL_PLAGIARISM_AUTH_SCHEME") ?? "Bearer",
  };
}

// ── Weights and thresholds ───────────────────────────────────────────

export function getDnaWeightTable(profile: EqsDnaProfile): Record<EqsDimensionKey, number> {
  return scoringConfig.dnaWeights[profile] as Record<EqsDimensionKey, number>;
}

export function getBandLabel(eqs: number): string {
  const band = scoringConfig.bands.find((entry) => eqs >= entry.minEqs);
  return band?.label ?? "below-bar";
}

export function getMaxModelAdjustment(): number {
  return readNumber("EQS_MAX_MODEL_ADJUSTMENT", scoringConfig.modelInterpretation.maxAdjustment);
}

/** Full effective configuration, for the admin auditability endpoint. */
export function describeEqsConfiguration() {
  return {
    pipelineVersion: EQS_PIPELINE_VERSION,
    scoringConfigVersion: EQS_SCORING_CONFIG_VERSION,
    provider: getConfiguredProvider(),
    geminiConfigured: Boolean(getGeminiApiKey()),
    geminiModel: GEMINI_EQS_MODEL,
    geminiFastModel: GEMINI_EQS_FAST_MODEL,
    ollamaModel: OLLAMA_EQS_MODEL,
    externalPlagiarismConfigured: Boolean(getExternalPlagiarismConfig()),
    externalPlagiarismProvider: getExternalPlagiarismConfig()?.provider ?? null,
    features: EQS_FEATURES,
    timeouts: EQS_TIMEOUTS,
    cache: EQS_CACHE,
    maxModelAdjustment: getMaxModelAdjustment(),
    guardrails: scoringConfig.guardrails,
    confidence: scoringConfig.confidence,
    bands: scoringConfig.bands,
    dnaWeights: scoringConfig.dnaWeights,
  };
}
