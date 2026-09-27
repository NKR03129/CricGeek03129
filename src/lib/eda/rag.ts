const DEFAULT_RAG_URL =
  process.env.NODE_ENV !== "production" ? "http://127.0.0.1:8020" : "";

export async function queryInternalRag(question: string): Promise<{ answer: string; contexts: string[] } | null> {
  const baseUrl = process.env.RAG_SERVICE_URL || DEFAULT_RAG_URL;
  if (!baseUrl) return null;

  try {
    const res = await fetch(`${baseUrl}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question }),
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });

    if (!res.ok) return null;
    const payload = (await res.json()) as { answer?: string; contexts?: string[] };
    if (!payload.answer || !Array.isArray(payload.contexts)) {
      return null;
    }

    return {
      answer: payload.answer,
      contexts: payload.contexts.slice(0, 4),
    };
  } catch {
    return null;
  }
}
