# 11 — Voice-to-Commentary

Converts a creator's spoken cricket commentary into usable live commentary while
preserving meaning and style.

## Pipeline

| Stage | Function | Implementation |
|---|---|---|
| 1. Microphone | Capture creator speech | Browser (`MediaRecorder`) in the commentary UI |
| 2. Streaming STT | Speech to text, low latency | [`voice/streaming.ts`](../src/lib/voice/streaming.ts) (token mint) or batch via [`deepgram.ts`](../src/lib/deepgram.ts) |
| 3. Cleanup | Fix transcription issues without changing meaning | [`commentary-player-correction.ts`](../src/lib/commentary-player-correction.ts) |
| 4. Transformation | Low-latency model turns the transcript into commentary, preserving style | [`commentary-polish.ts`](../src/lib/commentary-polish.ts) |
| 5. Output | Send to the commentary API | `/api/commentary/[sessionId]/entries` |
| 6. Target | ~15–30s end to end or faster | Measured per stage, stored per run |

Stages 2–5 are orchestrated by
[`voice/pipeline.ts`](../src/lib/voice/pipeline.ts) and exposed through
`POST /api/commentary/transcribe`.

## Latency

Every run records `sttMs`, `cleanupMs`, `transformMs`, and `totalMs` separately, so a
regression can be attributed to a stage rather than guessed at. The response includes:

```json
{
  "stages":  { "sttMs": 1840, "cleanupMs": 2, "transformMs": 1120, "totalMs": 3390 },
  "latencyMs": 3390,
  "targetMs": 30000,
  "withinTarget": true,
  "latencyWarning": false
}
```

Budget configuration:

```ini
VOICE_LATENCY_TARGET_MS=30000   # spec target; breaching it logs a warning
VOICE_LATENCY_WARN_MS=15000     # early-warning threshold
VOICE_STT_TIMEOUT_MS=20000
VOICE_TRANSFORM_TIMEOUT_MS=6000
```

Observed latency across stored runs is available from `getVoiceLatencyStats()` in
[`voice/persistence.ts`](../src/lib/voice/persistence.ts), which reports mean per stage
plus p95 and max on `totalMs`, and the share of runs inside target.

## Streaming STT

Batch transcription pays an upload round-trip per clip, which dominates the latency
budget. `POST /api/commentary/stt-token` mints a short-lived, scoped provider token so
the browser can stream microphone audio straight to the STT provider — the long-lived
API key never leaves the server.

```
POST /api/commentary/stt-token
{ "sessionId": "..." }

→ {
    "provider": "deepgram",
    "accessToken": "...",
    "expiresInSeconds": 60,
    "socketUrl": "wss://api.deepgram.com/v1/listen",
    "params":   { "model": "nova-3", "interim_results": "true", ... },
    "keyterms": ["Varun Chakravarthy", "..."]
  }
```

The client appends each `keyterms` entry as a repeated `keyterm` query parameter on the
socket URL. Requires an authenticated user with commentary permission.

**Status: server side complete, client not yet migrated.** The commentary UI still uses
the batch route, which continues to work unchanged. Adopting streaming is a frontend
change: open the socket, send audio frames, and post the final transcript to
`/api/commentary/transcribe` or straight to the entries endpoint. Disable the endpoint
with `VOICE_STREAMING_ENABLED=false`.

## Player-name accuracy

Wrong player names are the most damaging failure mode, so correction happens in three
places:

1. the session's squad list is passed to the STT provider as keyterms, so names are
   biased toward correct spellings at transcription time
2. deterministic roster-based correction runs on the raw transcript (stage 3)
3. the same deterministic correction runs **again** after the model polish, because the
   model is the last thing to touch the text and a name it reintroduced incorrectly
   would otherwise ship

The polish prompt is also given the official roster and told never to invent a name —
it must use a generic role term ("the batter") when no confident match exists.

## Storage

Each run is written to `VoiceCommentaryJob`: raw transcript, cleaned transcript, final
commentary, both providers and models, status, error, per-stage latency, and whether it
met target. Disable with `VOICE_PERSISTENCE_ENABLED=false`.

`attachVoiceJobToEntry()` links a job to the commentary entry it produced.

## Configuration

```ini
DEEPGRAM_API_KEY=""          # primary STT
DEEPGRAM_MODEL="nova-3"
AI_SERVICE_URL=""            # optional legacy Whisper fallback
OLLAMA_URL=""                # stage 4 transformation model
```

Provider selection: Deepgram when configured, falling back to the legacy Python Whisper
service on failure if `AI_SERVICE_URL` is set and reachable. With neither, the route
returns `503 TRANSCRIPTION_SERVICE_UNAVAILABLE`.

If no Ollama URL is set, stage 4 degrades to deterministic formatting
(`finalizeCommentaryText`) rather than failing — the commentary still publishes, just
without model polish.

Readiness is reported at `/api/health` under `checks.voiceReady`,
`checks.voiceBatchSttConfigured`, and `checks.voiceStreamingSttConfigured`.

## Limits

- clips are capped at 12MB; longer clips blow the latency budget before STT starts
- `commentary-polish` rejects a polished line more than 2.5× the fallback length, as a
  guard against the model inventing content
