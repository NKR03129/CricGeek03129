import "server-only";

const DEEPGRAM_API_URL = process.env.DEEPGRAM_API_URL || "https://api.deepgram.com/v1/listen";
const DEEPGRAM_MODEL = process.env.DEEPGRAM_MODEL || "nova-3";

const CRICKET_KEYTERMS = [
  "Abhishek Sharma",
  "Andre Russell",
  "Anrich Nortje",
  "BCCI",
  "Chakravarthy",
  "cover drive",
  "deep midwicket",
  "Delhi Capitals",
  "googly",
  "Harshit Rana",
  "Heinrich Klaasen",
  "Indian Premier League",
  "IPL",
  "Karn Sharma",
  "Karthik Tyagi",
  "KKR",
  "Kolkata Knight Riders",
  "Kuldeep Yadav",
  "LBW",
  "length ball",
  "mid-off",
  "mid-on",
  "Mohammed Shami",
  "no-ball",
  "off cutter",
  "powerplay",
  "Rajat Patidar",
  "Ravindra Jadeja",
  "Rinku Singh",
  "short ball",
  "slip cordon",
  "square leg",
  "SRH",
  "Sunrisers Hyderabad",
  "Travis Head",
  "Varun Chakravarthy",
  "wide yorker",
  "wrist spinner",
  "yorker",
] as const;

type DeepgramTranscriptionOptions = {
  keyterms?: string[];
};

type DeepgramTranscriptResult = {
  provider: "deepgram";
  text: string;
  confidence: number | null;
  requestId: string | null;
};

function getTranscriptFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const result = payload as {
    results?: {
      channels?: Array<{
        alternatives?: Array<{
          transcript?: string;
          paragraphs?: {
            transcript?: string;
          };
        }>;
      }>;
    };
  };

  const alternative = result.results?.channels?.[0]?.alternatives?.[0];

  return (
    alternative?.paragraphs?.transcript ||
    alternative?.transcript ||
    ""
  ).trim();
}

function getConfidenceFromPayload(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const result = payload as {
    results?: {
      channels?: Array<{
        alternatives?: Array<{
          confidence?: number;
        }>;
      }>;
    };
  };

  const confidence = result.results?.channels?.[0]?.alternatives?.[0]?.confidence;
  return typeof confidence === "number" ? confidence : null;
}

function normalizeKeyterms(keyterms: string[]) {
  return [...new Set(keyterms.map((term) => term.trim()).filter(Boolean))].slice(0, 120);
}

function buildDeepgramUrl(options?: DeepgramTranscriptionOptions) {
  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    language: "en-US",
    smart_format: "true",
    punctuate: "true",
    paragraphs: "true",
    utterances: "true",
    numerals: "true",
  });

  const mergedKeyterms = normalizeKeyterms([
    ...CRICKET_KEYTERMS,
    ...(options?.keyterms ?? []),
  ]);

  for (const keyterm of mergedKeyterms) {
    params.append("keyterm", keyterm);
  }

  return `${DEEPGRAM_API_URL}?${params.toString()}`;
}

export function hasDeepgramConfigured() {
  return Boolean(process.env.DEEPGRAM_API_KEY);
}

export async function transcribeWithDeepgram(
  audioFile: File,
  options?: DeepgramTranscriptionOptions
): Promise<DeepgramTranscriptResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Deepgram is not configured");
  }

  const audioBuffer = await audioFile.arrayBuffer();
  const contentType = audioFile.type || "audio/webm";
  const response = await fetch(buildDeepgramUrl(options), {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": contentType,
    },
    body: audioBuffer,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Deepgram transcription failed: ${response.status} ${responseText}`);
  }

  const payload = JSON.parse(responseText) as {
    metadata?: {
      request_id?: string;
    };
  };

  return {
    provider: "deepgram",
    text: getTranscriptFromPayload(payload),
    confidence: getConfidenceFromPayload(payload),
    requestId: payload.metadata?.request_id ?? null,
  };
}
