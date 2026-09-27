const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export const OLLAMA_REQUEST_TIMEOUT_MS = 120_000;

export function getOllamaUrl() {
  return process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL;
}

export function getOllamaHeaders(headers: HeadersInit = {}) {
  const mergedHeaders = new Headers(headers);
  const sharedSecret = process.env.OLLAMA_SHARED_SECRET?.trim();

  if (sharedSecret && !mergedHeaders.has("Authorization")) {
    mergedHeaders.set("Authorization", `Bearer ${sharedSecret}`);
  }

  return mergedHeaders;
}
