import "server-only";

import { OLLAMA_EQS_MODEL } from "@/lib/eqs/config";
import { parseJsonPayload } from "@/lib/eqs/json";
import { errorMessage } from "@/lib/eqs/utils";
import { getOllamaHeaders, getOllamaUrl } from "@/lib/ollama";
import type { LanguageProvider, ProviderResult, StructuredRequest } from "@/lib/eqs/providers/types";

type OllamaGenerateResponse = {
  response?: string;
  thinking?: string;
};

/**
 * Self-hosted fallback provider. Kept because CricGeek already runs Ollama for BQS
 * and commentary polish, so EQS degrades to it rather than to pure heuristics.
 */
export function createOllamaProvider(): LanguageProvider {
  return {
    id: "ollama",
    model: OLLAMA_EQS_MODEL,

    isConfigured() {
      return Boolean(process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL);
    },

    async generateStructured<T>(
      request: StructuredRequest,
      validate: (value: unknown) => value is T,
    ): Promise<ProviderResult<T>> {
      const startedAt = Date.now();

      try {
        const response = await fetch(`${getOllamaUrl()}/api/generate`, {
          method: "POST",
          headers: getOllamaHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            model: OLLAMA_EQS_MODEL,
            prompt: request.prompt,
            format: "json",
            think: false,
            stream: false,
            options: {
              temperature: request.temperature ?? 0.15,
              top_p: 0.85,
              num_predict: request.maxOutputTokens ?? 2048,
            },
          }),
          cache: "no-store",
          signal: request.signal,
        });

        if (!response.ok) {
          const bodyText = await response.text();
          return {
            data: null,
            provider: "ollama",
            model: OLLAMA_EQS_MODEL,
            latencyMs: Date.now() - startedAt,
            error: `Ollama responded with ${response.status}: ${bodyText.slice(0, 300)}`,
          };
        }

        const payload = (await response.json()) as OllamaGenerateResponse;
        const parsed = parseJsonPayload(payload, validate);

        return {
          data: parsed,
          provider: "ollama",
          model: OLLAMA_EQS_MODEL,
          latencyMs: Date.now() - startedAt,
          error: parsed ? undefined : "Ollama returned a payload that failed validation",
        };
      } catch (error) {
        return {
          data: null,
          provider: "ollama",
          model: OLLAMA_EQS_MODEL,
          latencyMs: Date.now() - startedAt,
          error: errorMessage(error),
        };
      }
    },
  };
}
