import { NextRequest, NextResponse } from "next/server";
import { getOllamaHeaders, getOllamaUrl, OLLAMA_REQUEST_TIMEOUT_MS } from "@/lib/ollama";

export const runtime = "nodejs";

const OLLAMA_URL = getOllamaUrl();
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3.5:latest";
type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function isValidMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<ChatMessage>;
  const validRole =
    candidate.role === "system" ||
    candidate.role === "user" ||
    candidate.role === "assistant";

  return validRole && typeof candidate.content === "string" && candidate.content.trim().length > 0;
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const messages = Array.isArray((body as { messages?: unknown[] })?.messages)
    ? (body as { messages: unknown[] }).messages.filter(isValidMessage)
    : null;

  if (!messages || messages.length === 0) {
    return NextResponse.json(
      { error: "Body must include a non-empty messages array" },
      { status: 400 }
    );
  }

  try {
    const upstreamResponse = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: getOllamaHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        think: false,
        stream: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(OLLAMA_REQUEST_TIMEOUT_MS),
    });

    const responseText = await upstreamResponse.text();
    const contentType = upstreamResponse.headers.get("content-type") || "application/json";

    if (!upstreamResponse.ok) {
      return new NextResponse(
        responseText || JSON.stringify({ error: "Upstream Ollama request failed" }),
        {
          status: upstreamResponse.status,
          headers: { "Content-Type": contentType },
        }
      );
    }

    return new NextResponse(responseText, {
      status: 200,
      headers: { "Content-Type": contentType },
    });
  } catch (error) {
    const message =
      error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
        ? "Upstream Ollama request timed out"
        : "Unable to reach upstream Ollama service";

    console.error("[api/llm] Request failed:", error);

    return NextResponse.json(
      {
        error: message,
        upstream: OLLAMA_URL,
      },
      { status: 502 }
    );
  }
}
