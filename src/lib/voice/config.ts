/** Voice-to-Commentary configuration (spec section 10). */

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

export const VOICE_PIPELINE_VERSION = "voice-pipeline-1.0.0";

/**
 * Stage 6 of the spec: "approximately 15-30 seconds or faster end-to-end, subject to
 * testing." `targetMs` is the hard target; crossing `warnMs` is recorded so the
 * latency budget can be tracked before it is breached.
 */
export const VOICE_LATENCY = {
  targetMs: readNumber("VOICE_LATENCY_TARGET_MS", 30_000),
  warnMs: readNumber("VOICE_LATENCY_WARN_MS", 15_000),
};

export const VOICE_TIMEOUTS = {
  sttMs: readNumber("VOICE_STT_TIMEOUT_MS", 20_000),
  transformMs: readNumber("VOICE_TRANSFORM_TIMEOUT_MS", 6_000),
};

export const VOICE_FEATURES = {
  /** Persist transcript, commentary, and stage latencies for auditability. */
  persistence: process.env.VOICE_PERSISTENCE_ENABLED !== "false",
  /** Allow the browser to open a streaming STT socket via a short-lived token. */
  streaming: process.env.VOICE_STREAMING_ENABLED !== "false",
};

/** TTL for the browser's streaming-STT token. Short by design. */
export const VOICE_STREAMING_TOKEN_TTL_SECONDS = readNumber("VOICE_STREAMING_TOKEN_TTL", 60);

export function describeVoiceConfiguration() {
  return {
    pipelineVersion: VOICE_PIPELINE_VERSION,
    latency: VOICE_LATENCY,
    timeouts: VOICE_TIMEOUTS,
    features: VOICE_FEATURES,
    streamingTokenTtlSeconds: VOICE_STREAMING_TOKEN_TTL_SECONDS,
    deepgramConfigured: Boolean(process.env.DEEPGRAM_API_KEY),
    legacySttConfigured: Boolean(process.env.AI_SERVICE_URL),
  };
}
