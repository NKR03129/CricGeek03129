import "server-only";

import {
  GEMINI_API_BASE_URL,
  GEMINI_EQS_FAST_MODEL,
  GEMINI_EQS_MODEL,
  getGeminiApiKey,
} from "@/lib/eqs/config";
import { parseJsonText } from "@/lib/eqs/json";
import { errorMessage } from "@/lib/eqs/utils";
import type { LanguageProvider, ProviderResult, StructuredRequest } from "@/lib/eqs/providers/types";

type GeminiCandidate = {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
};

function collectText(payload: GeminiResponse): string {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

/**
 * Gemini rejects JSON Schema keywords it does not implement, so the schema is
 * reduced to the subset its `responseSchema` field accepts.
 */
function toGeminiSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!schema) return undefined;

  const allowed = new Set([
    "type",
    "format",
    "description",
    "nullable",
    "enum",
    "items",
    "properties",
    "required",
    "propertyOrdering",
    "minimum",
    "maximum",
  ]);

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;

    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (!allowed.has(key)) continue;
      output[key] = key === "enum" ? value : walk(value);
    }
    return output;
  };

  return walk(schema) as Record<string, unknown>;
}

function createProvider(model: string, id: string): LanguageProvider {
  return {
    id,
    model,

    isConfigured() {
      return Boolean(getGeminiApiKey());
    },

    async generateStructured<T>(
      request: StructuredRequest,
      validate: (value: unknown) => value is T,
    ): Promise<ProviderResult<T>> {
      const startedAt = Date.now();
      const apiKey = getGeminiApiKey();

      if (!apiKey) {
        return { data: null, provider: id, model, latencyMs: 0, error: "GEMINI_API_KEY is not configured" };
      }

      const responseSchema = toGeminiSchema(request.schema);

      try {
        const response = await fetch(
          `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: request.prompt }] }],
              generationConfig: {
                temperature: request.temperature ?? 0.15,
                maxOutputTokens: request.maxOutputTokens ?? 2048,
                responseMimeType: "application/json",
                ...(responseSchema ? { responseSchema } : {}),
              },
            }),
            cache: "no-store",
            signal: request.signal,
          },
        );

        const bodyText = await response.text();

        if (!response.ok) {
          return {
            data: null,
            provider: id,
            model,
            latencyMs: Date.now() - startedAt,
            error: `Gemini responded with ${response.status}: ${bodyText.slice(0, 300)}`,
          };
        }

        const payload = JSON.parse(bodyText) as GeminiResponse;

        if (payload.promptFeedback?.blockReason) {
          return {
            data: null,
            provider: id,
            model,
            latencyMs: Date.now() - startedAt,
            error: `Gemini blocked the prompt: ${payload.promptFeedback.blockReason}`,
          };
        }

        const text = collectText(payload);
        const parsed = parseJsonText(text, validate);

        return {
          data: parsed,
          provider: id,
          model,
          latencyMs: Date.now() - startedAt,
          error: parsed ? undefined : "Gemini returned a payload that failed validation",
        };
      } catch (error) {
        return {
          data: null,
          provider: id,
          model,
          latencyMs: Date.now() - startedAt,
          error: errorMessage(error),
        };
      }
    },
  };
}

export function createGeminiProvider(): LanguageProvider {
  return createProvider(GEMINI_EQS_MODEL, "gemini");
}

/** Cheaper/lower-latency variant for high-volume sub-tasks. */
export function createGeminiFastProvider(): LanguageProvider {
  return createProvider(GEMINI_EQS_FAST_MODEL, "gemini-fast");
}
