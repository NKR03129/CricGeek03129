import "server-only";

import { getConfiguredProvider } from "@/lib/eqs/config";
import { createGeminiFastProvider, createGeminiProvider } from "@/lib/eqs/providers/gemini";
import { createOllamaProvider } from "@/lib/eqs/providers/ollama";
import type { LanguageProvider, ProviderResult, StructuredRequest } from "@/lib/eqs/providers/types";

export type { LanguageProvider, ProviderResult, StructuredRequest };

/**
 * Ordered list of providers to try for a stage.
 *
 * `auto` prefers the spec's primary model (Gemini) and falls back to the
 * self-hosted model, so a missing key degrades quality instead of breaking scoring.
 * Pin `EQS_PROVIDER` to one value for reproducible benchmark runs.
 */
export function resolveProviderChain(options?: { fast?: boolean }): LanguageProvider[] {
  const configured = getConfiguredProvider();
  const gemini = options?.fast ? createGeminiFastProvider() : createGeminiProvider();
  const ollama = createOllamaProvider();

  if (configured === "heuristic") return [];
  if (configured === "gemini") return gemini.isConfigured() ? [gemini] : [];
  if (configured === "ollama") return ollama.isConfigured() ? [ollama] : [];

  return [gemini, ollama].filter((provider) => provider.isConfigured());
}

export type ChainOutcome<T> = ProviderResult<T> & {
  /** Providers that were tried and failed before the successful one. */
  attempts: Array<{ provider: string; model: string; error: string; latencyMs: number }>;
};

/** Walks the provider chain and returns the first validated payload. */
export async function generateStructuredWithChain<T>(
  request: StructuredRequest,
  validate: (value: unknown) => value is T,
  options?: { fast?: boolean },
): Promise<ChainOutcome<T>> {
  const chain = resolveProviderChain(options);
  const attempts: ChainOutcome<T>["attempts"] = [];

  if (chain.length === 0) {
    return {
      data: null,
      provider: "heuristic",
      model: "none",
      latencyMs: 0,
      error: "No language provider is configured for EQS",
      attempts,
    };
  }

  let lastResult: ProviderResult<T> | null = null;

  for (const provider of chain) {
    const result = await provider.generateStructured(request, validate);
    lastResult = result;

    if (result.data) {
      return { ...result, attempts };
    }

    attempts.push({
      provider: result.provider,
      model: result.model,
      error: result.error || "Unknown provider error",
      latencyMs: result.latencyMs,
    });

    // A caller-driven abort should not burn through the remaining providers.
    if (request.signal?.aborted) break;
  }

  return {
    data: null,
    provider: lastResult?.provider ?? "heuristic",
    model: lastResult?.model ?? "none",
    latencyMs: attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
    error: lastResult?.error ?? "All EQS language providers failed",
    attempts,
  };
}
