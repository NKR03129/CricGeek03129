import { getOllamaHeaders, getOllamaUrl, OLLAMA_REQUEST_TIMEOUT_MS } from "@/lib/ollama";

const OLLAMA_URL = getOllamaUrl();
const OLLAMA_MODEL =
  process.env.OLLAMA_MATCH_MODEL || process.env.OLLAMA_BQS_MODEL || process.env.OLLAMA_MODEL || "qwen3.5:latest";
const DEFAULT_TIMEOUT_MS = Number(process.env.OLLAMA_MATCH_TIMEOUT_MS || 5000);

function parseJsonCandidate<T>(raw: string): T | null {
  const candidate = raw.trim();
  const possible = [candidate, ...(candidate.match(/\{[\s\S]*\}/g) ?? [])];

  for (const value of possible) {
    try {
      return JSON.parse(value) as T;
    } catch {
      continue;
    }
  }

  return null;
}

export async function generateStructuredJson<T>(prompt: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: getOllamaHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        format: "json",
        think: false,
        stream: false,
        options: {
          temperature: 0.15,
          num_predict: 800,
        },
      }),
      signal: AbortSignal.timeout(Math.min(timeoutMs, OLLAMA_REQUEST_TIMEOUT_MS)),
    });

    if (!res.ok) {
      return null;
    }

    const payload = (await res.json()) as { response?: string };
    if (!payload.response) {
      return null;
    }

    return parseJsonCandidate<T>(payload.response);
  } catch {
    return null;
  }
}
