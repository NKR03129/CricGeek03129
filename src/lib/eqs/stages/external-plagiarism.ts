/**
 * Stage 8 — External plagiarism.
 *
 * A deliberately separate system from internal plagiarism (spec section 6). It calls
 * a dedicated third-party provider and stores the provider's own evidence rather
 * than re-deriving a verdict locally.
 *
 * Providers differ wildly in request/response shape, so the request is a simple JSON
 * POST and the response reader accepts the field names used by the common vendors
 * (Copyleaks, Winston AI, PlagiarismCheck, Originality.ai). Point
 * `EXTERNAL_PLAGIARISM_API_URL` at the provider — or at a thin adapter of your own —
 * and the stage starts contributing. Unconfigured, it reports `unavailable` and the
 * pipeline continues.
 */

import { withCache } from "@/lib/eqs/cache";
import { getExternalPlagiarismConfig } from "@/lib/eqs/config";
import type { ComponentResult, EqsFlag } from "@/lib/eqs/types";
import {
  clamp0to1,
  clamp0to100,
  contentHash,
  createLinkedTimeoutSignal,
  errorMessage,
  truncate,
} from "@/lib/eqs/utils";

export const EXTERNAL_PLAGIARISM_VERSION = "eqs-external-plagiarism-v2.0.0";

export interface ExternalPlagiarismMatchSource {
  url: string;
  title: string | null;
  matchedPercent: number | null;
  matchedWords: number | null;
}

export interface ExternalPlagiarismEvidence {
  provider: string | null;
  /** Overall percentage of the article the provider matched to outside sources. */
  matchedPercent: number | null;
  sources: ExternalPlagiarismMatchSource[];
  /** Raw provider payload, trimmed, so a verdict can be re-explained later. */
  providerPayload: string | null;
  scanId: string | null;
}

export interface ExternalPlagiarismResult {
  component: ComponentResult<ExternalPlagiarismEvidence>;
  /** Multiplier applied to the originality dimension, 0-1. */
  originalityPenaltyFactor: number;
  flaggedForReview: boolean;
}

const EMPTY_EVIDENCE: ExternalPlagiarismEvidence = {
  provider: null,
  matchedPercent: null,
  sources: [],
  providerPayload: null,
  scanId: null,
};

function buildUnavailable(
  reason: string,
  status: ComponentResult["status"],
  startedAt: number,
  provider: string | null,
): ExternalPlagiarismResult {
  return {
    component: {
      component: "external-plagiarism",
      score: null,
      confidence: 0.15,
      evidence: { ...EMPTY_EVIDENCE, provider },
      flags:
        status === "skipped"
          ? []
          : [
              {
                code: "EXTERNAL_PLAGIARISM_UNAVAILABLE",
                severity: "warn",
                message: reason,
                component: "external-plagiarism",
              },
            ],
      source: provider ?? "none",
      version: EXTERNAL_PLAGIARISM_VERSION,
      status,
      durationMs: Date.now() - startedAt,
      error: status === "error" ? reason : undefined,
    },
    originalityPenaltyFactor: 1,
    flaggedForReview: false,
  };
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Reads the overall match percentage under any of the common vendor field names. */
function readMatchedPercent(payload: Record<string, unknown>): number | null {
  const results = (payload.results ?? payload.result ?? payload.scan ?? {}) as Record<string, unknown>;
  const score = (payload.score ?? results.score ?? {}) as Record<string, unknown>;

  const raw = firstNumber(
    payload.matchedPercent,
    payload.plagiarismPercent,
    payload.plagiarism_score,
    payload.similarity,
    payload.percentPlagiarism,
    results.matchedPercent,
    results.plagiarismPercent,
    results.similarity,
    score.identicalWords,
    score.aggregatedScore,
  );

  if (raw === null) return null;
  // Some providers report 0-1, others 0-100.
  return clamp0to100(raw <= 1 ? raw * 100 : raw);
}

function readSources(payload: Record<string, unknown>): ExternalPlagiarismMatchSource[] {
  const results = (payload.results ?? payload.result ?? payload.scan ?? {}) as Record<string, unknown>;

  const candidates = [
    payload.sources,
    payload.matches,
    payload.internet,
    results.sources,
    results.matches,
    results.internet,
  ].find((value): value is unknown[] => Array.isArray(value) && value.length > 0);

  if (!candidates) return [];

  return candidates
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .slice(0, 8)
    .map((entry) => ({
      url: firstString(entry.url, entry.link, entry.sourceUrl, entry.website) ?? "",
      title: firstString(entry.title, entry.name, entry.sourceTitle),
      matchedPercent: (() => {
        const raw = firstNumber(entry.matchedPercent, entry.percent, entry.similarity, entry.score);
        return raw === null ? null : clamp0to100(raw <= 1 ? raw * 100 : raw);
      })(),
      matchedWords: firstNumber(entry.matchedWords, entry.identicalWords, entry.words),
    }))
    .filter((source) => source.url.length > 0);
}

export async function runExternalPlagiarism(input: {
  title?: string;
  content: string;
  matchPercentThreshold: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ExternalPlagiarismResult> {
  const startedAt = Date.now();
  const config = getExternalPlagiarismConfig();

  if (!config) {
    return buildUnavailable(
      "No external plagiarism provider is configured (set EXTERNAL_PLAGIARISM_API_URL).",
      "unavailable",
      startedAt,
      null,
    );
  }

  try {
    const payload = await withCache(
      `external-plagiarism:${config.provider}:${contentHash(input)}`,
      async () => {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (config.apiKey) {
          headers[config.authHeader] = config.authScheme
            ? `${config.authScheme} ${config.apiKey}`
            : config.apiKey;
        }

        const { signal, dispose } = createLinkedTimeoutSignal(
          input.timeoutMs,
          input.signal,
          "EXTERNAL_PLAGIARISM_TIMEOUT",
        );

        try {
          const response = await fetch(config.url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              title: input.title || "Untitled",
              text: input.content,
              // Common aliases so most providers accept the body unchanged.
              content: input.content,
              language: "en",
            }),
            cache: "no-store",
            signal,
          });

          const bodyText = await response.text();

          if (!response.ok) {
            throw new Error(`provider responded with ${response.status}: ${bodyText.slice(0, 200)}`);
          }

          return JSON.parse(bodyText) as Record<string, unknown>;
        } finally {
          dispose();
        }
      },
      // Plagiarism scans are expensive; cache them longer than other components.
      30 * 60 * 1000,
    );

    const matchedPercent = readMatchedPercent(payload);
    const sources = readSources(payload);

    if (matchedPercent === null && sources.length === 0) {
      return buildUnavailable(
        `External plagiarism provider "${config.provider}" returned a payload with no recognisable match data.`,
        "error",
        startedAt,
        config.provider,
      );
    }

    const effectivePercent = matchedPercent ?? 0;
    const flagged = effectivePercent >= input.matchPercentThreshold;
    const flags: EqsFlag[] = [];

    if (flagged) {
      flags.push({
        code: "EXTERNAL_PLAGIARISM_MATCH",
        severity: effectivePercent >= input.matchPercentThreshold * 2 ? "critical" : "warn",
        message: `External plagiarism provider matched ${Math.round(effectivePercent)}% of this article to outside sources${sources[0]?.url ? ` (e.g. ${sources[0].url})` : ""}.`,
        component: "external-plagiarism",
      });
    }

    const evidence: ExternalPlagiarismEvidence = {
      provider: config.provider,
      matchedPercent,
      sources,
      providerPayload: truncate(JSON.stringify(payload), 2000),
      scanId: firstString(payload.scanId, payload.id, payload.requestId),
    };

    return {
      component: {
        component: "external-plagiarism",
        score: clamp0to100(100 - effectivePercent),
        confidence: clamp0to1(matchedPercent === null ? 0.5 : 0.85),
        evidence,
        flags,
        source: config.provider,
        version: EXTERNAL_PLAGIARISM_VERSION,
        status: "ok",
        durationMs: Date.now() - startedAt,
      },
      originalityPenaltyFactor: flagged ? 0.35 : effectivePercent >= input.matchPercentThreshold / 2 ? 0.8 : 1,
      flaggedForReview: flagged,
    };
  } catch (error) {
    return buildUnavailable(
      `External plagiarism check failed: ${truncate(errorMessage(error), 200)}`,
      "error",
      startedAt,
      config.provider,
    );
  }
}

export function skippedExternalPlagiarism(): ExternalPlagiarismResult {
  return buildUnavailable(
    "External plagiarism check disabled by configuration.",
    "skipped",
    Date.now(),
    null,
  );
}
