/**
 * Streaming STT support (spec section 10, stage 2: "convert speech to text with low
 * latency").
 *
 * Batch transcription pays an upload round-trip per clip. To get the latency budget
 * down, the browser should stream audio straight to the STT provider. That requires
 * a credential in the browser, so this mints a short-lived, scoped token instead of
 * ever exposing the long-lived API key.
 *
 * The browser keeps using the existing batch route until it adopts this; nothing here
 * changes current behaviour.
 */

import "server-only";

import { errorMessage } from "@/lib/eqs/utils";
import { VOICE_STREAMING_TOKEN_TTL_SECONDS } from "@/lib/voice/config";

const DEEPGRAM_GRANT_URL =
  process.env.DEEPGRAM_GRANT_URL || "https://api.deepgram.com/v1/auth/grant";

/** Recommended connection parameters, so the client does not re-derive them. */
export const DEEPGRAM_STREAMING_PARAMS = {
  model: process.env.DEEPGRAM_MODEL || "nova-3",
  language: "en-US",
  smart_format: "true",
  punctuate: "true",
  interim_results: "true",
  endpointing: "300",
  numerals: "true",
} as const;

export const DEEPGRAM_STREAMING_URL =
  process.env.DEEPGRAM_STREAMING_URL || "wss://api.deepgram.com/v1/listen";

export interface StreamingTokenResult {
  provider: "deepgram";
  accessToken: string;
  expiresInSeconds: number;
  socketUrl: string;
  params: Record<string, string>;
  /**
   * Match-specific vocabulary. Append each one as a repeated `keyterm` query
   * parameter on the socket URL — repeated keys are how the provider expects a list.
   */
  keyterms: string[];
}

export function hasStreamingSttConfigured(): boolean {
  return Boolean(process.env.DEEPGRAM_API_KEY);
}

/**
 * Mints a short-lived Deepgram access token for direct browser streaming.
 *
 * Throws with a `code` so the route can map failures to the right status without
 * leaking provider detail to the client.
 */
export async function createStreamingSttToken(options?: {
  keyterms?: string[];
}): Promise<StreamingTokenResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();

  if (!apiKey) {
    throw Object.assign(new Error("Streaming STT is not configured"), {
      code: "STREAMING_STT_UNAVAILABLE",
    });
  }

  const ttl = Math.max(10, Math.min(VOICE_STREAMING_TOKEN_TTL_SECONDS, 300));

  try {
    const response = await fetch(DEEPGRAM_GRANT_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: ttl }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });

    const bodyText = await response.text();

    if (!response.ok) {
      throw new Error(`Deepgram token grant failed: ${response.status} ${bodyText.slice(0, 200)}`);
    }

    const payload = JSON.parse(bodyText) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!payload.access_token) {
      throw new Error("Deepgram token grant returned no access token");
    }

    return {
      provider: "deepgram",
      accessToken: payload.access_token,
      expiresInSeconds: typeof payload.expires_in === "number" ? payload.expires_in : ttl,
      socketUrl: DEEPGRAM_STREAMING_URL,
      params: { ...DEEPGRAM_STREAMING_PARAMS },
      keyterms: [
        ...new Set((options?.keyterms ?? []).map((term) => term.trim()).filter(Boolean)),
      ].slice(0, 100),
    };
  } catch (error) {
    throw Object.assign(new Error(errorMessage(error)), { code: "STREAMING_STT_ERROR" });
  }
}
