# 11-VOICE-TO-COMMENTARY

## Overview

The app contains a voice-to-commentary or audio commentary flow, designed to convert spoken cricket commentary into stored and polished text.

This functionality is split across:

- src/app/api/commentary/transcribe/route.ts
- src/lib/deepgram.ts
- commentary session routes
- related UI under src/app/commentary and component folders

## Supported flow

The intended flow is:

1. User submits or records commentary audio
2. Audio is sent to a transcription provider
3. The raw transcript is normalized and polished for cricket-specific wording
4. The resulting commentary text is stored to a session or blog-like commentary record
5. The UI shows the commentary stream

## Transcription providers

The code includes Deepgram support through src/lib/deepgram.ts. There are also fallback patterns for AI-based transcription or polishing when external services are unavailable.

This indicates the app expects a layered transcription strategy rather than a single hard dependency.

## Commentary session model

The Prisma schema includes live commentary-specific tables and session state, allowing the app to model:

- commentary sessions
- session memberships or participants
- commentary entries
- voice and text events

## Operational dependencies

This workflow depends on:

- Deepgram API key or valid fallback service
- valid audio uploads or capture paths
- optional AI polishing logic
- database persistence for commentary sessions

## Status

The feature is implemented in a substantial way, but the real runtime depends on configured external transcription services and careful audio flow management.

This is a functional product area, but not one that can be assumed to work in a local environment without the required service credentials.
