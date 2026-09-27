import { getOllamaHeaders, getOllamaUrl, OLLAMA_REQUEST_TIMEOUT_MS } from "@/lib/ollama";

const OLLAMA_URL = getOllamaUrl();
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || process.env.OLLAMA_BQS_MODEL || "qwen3.5:latest";
const LOCAL_AI_TIMEOUT_MS = 8_000;

function combineAbortSignals(timeoutMs: number, externalSignal?: AbortSignal) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort("LOCAL_AI_TIMEOUT"), timeoutMs);

  const combinedController = new AbortController();

  const abortFrom = (signal: AbortSignal) => {
    if (signal.aborted) {
      combinedController.abort(signal.reason);
      return;
    }

    signal.addEventListener(
      "abort",
      () => {
        if (!combinedController.signal.aborted) {
          combinedController.abort(signal.reason);
        }
      },
      { once: true },
    );
  };

  abortFrom(timeoutController.signal);
  if (externalSignal) {
    abortFrom(externalSignal);
  }

  return {
    signal: combinedController.signal,
    dispose: () => clearTimeout(timeoutId),
  };
}

type EqsAttributeName =
  | "Toxicity"
  | "Sarcasm & Tone Mismatch"
  | "Factual Accuracy"
  | "Bias / Fandom Skew"
  | "Originality"
  | "Grammar & Readability"
  | "Depth of Insight"
  | "Engagement / Hook Quality"
  | "Coherence & Structure"
  | "Emotional Register"
  | "Spam / Low-effort Detection"
  | "Archetype Alignment";

type EqsAttribute = {
  name: EqsAttributeName;
  score: number;
  explanation: string;
  weight: number;
};

const EQS_ATTRIBUTE_WEIGHTS: Record<EqsAttributeName, number> = {
  Toxicity: 13,
  "Sarcasm & Tone Mismatch": 8,
  "Factual Accuracy": 12,
  "Bias / Fandom Skew": 9,
  Originality: 10,
  "Grammar & Readability": 10,
  "Depth of Insight": 10,
  "Engagement / Hook Quality": 8,
  "Coherence & Structure": 10,
  "Emotional Register": 5,
  "Spam / Low-effort Detection": 5,
  "Archetype Alignment": 10,
};

const EQS_ATTRIBUTE_ORDER: EqsAttributeName[] = [
  "Toxicity",
  "Sarcasm & Tone Mismatch",
  "Factual Accuracy",
  "Bias / Fandom Skew",
  "Originality",
  "Grammar & Readability",
  "Depth of Insight",
  "Engagement / Hook Quality",
  "Coherence & Structure",
  "Emotional Register",
  "Spam / Low-effort Detection",
  "Archetype Alignment",
];

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function tokenize(content: string) {
  return content.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

function countSentences(content: string) {
  return Math.max(1, (content.match(/[.!?]+/g) ?? []).length);
}

function weightedEqs(attributes: EqsAttribute[]) {
  const totalWeight = attributes.reduce((sum, attribute) => sum + attribute.weight, 0) || 1;
  const weightedSum = attributes.reduce((sum, attribute) => sum + attribute.score * attribute.weight, 0);
  return Math.round(weightedSum / totalWeight);
}

function buildEqsResult(attributes: EqsAttribute[]) {
  const orderedAttributes = EQS_ATTRIBUTE_ORDER
    .map((name) => attributes.find((attribute) => attribute.name === name))
    .filter((attribute): attribute is EqsAttribute => Boolean(attribute));

  const overallEqs = weightedEqs(orderedAttributes);

  return {
    overallEqs,
    weightedEqs: overallEqs,
    attributes: orderedAttributes,
  };
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export async function callOllama(
  prompt: string,
  options?: { model?: string; format?: "json" | "text"; timeoutMs?: number; signal?: AbortSignal },
) {
  const model = options?.model || OLLAMA_MODEL;
  const format = options?.format || "text";
  const timeoutMs = Math.min(options?.timeoutMs || OLLAMA_REQUEST_TIMEOUT_MS, OLLAMA_REQUEST_TIMEOUT_MS);
  const { signal, dispose } = combineAbortSignals(timeoutMs, options?.signal);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: getOllamaHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model,
        prompt,
        think: false,
        stream: false,
        format,
        options: { temperature: 0.2, top_p: 0.9, num_predict: 1200 },
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama responded with ${response.status}`);
    }

    const data = await response.json();
    return typeof data?.response === "string" ? data.response : "";
  } catch {
    return "";
  } finally {
    dispose();
  }
}

export async function paraphraseWithLocalModel(input: { title?: string; content: string }) {
  const prompt = `You are CricGeek's writing polish assistant. Preserve the writer's meaning, opinion, tone, and structure. Improve grammar, clarity, flow, and readability only. Do not add new facts, do not change the core message. Return only the polished version of the article.\n\nTitle: ${input.title || "Untitled"}\n\nContent:\n${input.content}`;

  const response = await callOllama(prompt, { format: "text", timeoutMs: LOCAL_AI_TIMEOUT_MS });
  if (response) {
    return cleanText(response);
  }

  return input.content
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\b([A-Za-z])\b/g, "$1")
    .replace(/\s{2,}/g, " ");
}

export async function evaluateEqsWithLocalModel(
  input: { title?: string; content: string },
  options?: { signal?: AbortSignal; timeoutMs?: number },
) {
  const prompt = `You are CricGeek's EQS evaluator. Return strict JSON with these exact keys: \n{\n  "overallEqs": 0,\n  "weightedEqs": 0,\n  "attributes": [\n    {"name": "Toxicity", "score": 0, "weight": 13, "explanation": ""},\n    {"name": "Sarcasm & Tone Mismatch", "score": 0, "weight": 8, "explanation": ""},\n    {"name": "Factual Accuracy", "score": 0, "weight": 12, "explanation": ""},\n    {"name": "Bias / Fandom Skew", "score": 0, "weight": 9, "explanation": ""},\n    {"name": "Originality", "score": 0, "weight": 10, "explanation": ""},\n    {"name": "Grammar & Readability", "score": 0, "weight": 10, "explanation": ""},\n    {"name": "Depth of Insight", "score": 0, "weight": 10, "explanation": ""},\n    {"name": "Engagement / Hook Quality", "score": 0, "weight": 8, "explanation": ""},\n    {"name": "Coherence & Structure", "score": 0, "weight": 10, "explanation": ""},\n    {"name": "Emotional Register", "score": 0, "weight": 5, "explanation": ""},\n    {"name": "Spam / Low-effort Detection", "score": 0, "weight": 5, "explanation": ""},\n    {"name": "Archetype Alignment", "score": 0, "weight": 10, "explanation": ""}\n  ]\n}\n\nScore each attribute 0-100, where 100 is excellent. The final weighted score should use the attribute weights above. Keep explanations short. Title: ${input.title || "Untitled"}\n\nContent:\n${input.content}`;

  const response = await callOllama(prompt, {
    format: "json",
    timeoutMs: options?.timeoutMs ?? LOCAL_AI_TIMEOUT_MS,
    signal: options?.signal,
  });
  if (response) {
    try {
      const parsed = JSON.parse(response);
      if (parsed?.attributes && Array.isArray(parsed.attributes)) {
        const attributes = EQS_ATTRIBUTE_ORDER.map((name) => {
          const matched = parsed.attributes.find((attribute: { name?: string; score?: number; explanation?: string }) => attribute?.name === name);
          return {
            name,
            score: clampScore(typeof matched?.score === "number" ? matched.score : 0),
            explanation: typeof matched?.explanation === "string" && matched.explanation.trim() ? matched.explanation.trim() : "Model returned no explanation.",
            weight: EQS_ATTRIBUTE_WEIGHTS[name],
          } satisfies EqsAttribute;
        });

        return buildEqsResult(attributes);
      }
    } catch {
      // fall through to heuristics
    }
  }

  return evaluateEqsHeuristically(input.content);
}

export function evaluateEqsHeuristically(content: string) {
  const cleanedContent = cleanText(content);
  const words = tokenize(cleanedContent);
  const uniqueWords = new Set(words);
  const wordCount = words.length;
  const sentenceCount = countSentences(cleanedContent);
  const paragraphCount = Math.max(1, cleanedContent.split(/\n\s*\n/).filter(Boolean).length);
  const hasStructure = cleanedContent.includes("\n") || cleanedContent.includes(". ") || paragraphCount > 1;
  const hasStats = /\d/.test(cleanedContent);
  const hasSpam = /(click here|buy now|subscribe now|keyword stuffing|lorem ipsum|limited offer|free trial)/i.test(cleanedContent);
  const hasInsult = /(clown|useless|trash|idiot|fraud|embarrassing|pathetic|stupid)/i.test(cleanedContent);
  const hasMockPraise = /(really|obviously|masterclass|legendary|visionary|great job)/i.test(cleanedContent) && /(not|lol|yeah right|sure)/i.test(cleanedContent);
  const hasHookWords = /^(why|how|when|this|the night|here's|what|a|an)\b/i.test(cleanedContent.trim()) || /\b(but|yet|however|instead)\b/i.test(cleanedContent);
  const hasAnalysisWords = /\b(because|therefore|however|pattern|phase|pressure|matchup|analysis|tactic|structure)\b/i.test(cleanedContent);
  const hasCricketVoice = /\b(bowler|batting|innings|over|wicket|pitch|field|chase|strike|spinner|seamer|powerplay)\b/i.test(cleanedContent);
  const uniqueRatio = wordCount > 0 ? uniqueWords.size / wordCount : 0;

  const toxicityScore = clampScore(94 - (hasInsult ? 34 : 0) - (hasMockPraise ? 10 : 0) - (hasSpam ? 35 : 0));
  const sarcasmToneScore = clampScore(92 - (hasMockPraise ? 28 : 0) - (/\b(really|obviously|as if)\b/i.test(cleanedContent) ? 8 : 0));
  const factualAccuracyScore = clampScore(70 + (hasStats ? 16 : 0) + (hasAnalysisWords ? 8 : 0) - (/\b(might|maybe|perhaps|guess)\b/i.test(cleanedContent) ? 6 : 0));
  const biasScore = clampScore(90 - (/\b(we|our team|my team|my club|they suck|they are useless)\b/i.test(cleanedContent) ? 18 : 0) - (hasInsult ? 8 : 0));
  const originalityScore = clampScore(58 + Math.round(uniqueRatio * 32) + (hasHookWords ? 5 : 0) - (/\b(lorem ipsum|template|copy|generic)\b/i.test(cleanedContent) ? 18 : 0));
  const grammarScore = clampScore(64 + (sentenceCount > 1 ? 10 : 0) + (paragraphCount > 1 ? 8 : 0) + (cleanedContent.includes(",") ? 6 : 0) + (cleanedContent.includes(".") ? 6 : 0) - (/\s{2,}/.test(cleanedContent) ? 8 : 0));
  const depthScore = clampScore(48 + Math.min(20, Math.floor(cleanedContent.length / 120)) + (hasStats ? 12 : 0) + (hasAnalysisWords ? 12 : 0) + (paragraphCount > 1 ? 8 : 0));
  const engagementScore = clampScore(52 + (hasHookWords ? 16 : 0) + (/\b(contrast|instead|but|yet|however)\b/i.test(cleanedContent) ? 12 : 0) + (cleanedContent.includes("?") ? 5 : 0));
  const coherenceScore = clampScore(58 + (hasStructure ? 16 : 0) + (paragraphCount > 1 ? 10 : 0) + (sentenceCount > 2 ? 8 : 0) - (/\b(random|unrelated|chaos)\b/i.test(cleanedContent) ? 10 : 0));
  const emotionalScore = clampScore(76 - (hasInsult ? 18 : 0) - (hasMockPraise ? 8 : 0) + (cleanedContent.includes("!") ? 4 : 0));
  const spamScore = clampScore(96 - (hasSpam ? 48 : 0) - (wordCount < 60 ? 12 : 0) - (/\b(earn money|act now|limited offer)\b/i.test(cleanedContent) ? 18 : 0));
  const archetypeScore = clampScore(72 + (hasCricketVoice ? 10 : 0) + (hasAnalysisWords ? 8 : 0) + (hasHookWords ? 4 : 0) - (wordCount < 40 ? 10 : 0));

  const attributes: EqsAttribute[] = [
    { name: "Toxicity", score: toxicityScore, weight: EQS_ATTRIBUTE_WEIGHTS.Toxicity, explanation: hasInsult ? "The wording leans into personal attack." : "The tone stays measured and non-abusive." },
    { name: "Sarcasm & Tone Mismatch", score: sarcasmToneScore, weight: EQS_ATTRIBUTE_WEIGHTS["Sarcasm & Tone Mismatch"], explanation: hasMockPraise ? "Mock praise or irony may blur the intended tone." : "The tone reads directly and consistently." },
    { name: "Factual Accuracy", score: factualAccuracyScore, weight: EQS_ATTRIBUTE_WEIGHTS["Factual Accuracy"], explanation: hasStats ? "It includes concrete cricket details and numbers." : "No major factual claims were detected." },
    { name: "Bias / Fandom Skew", score: biasScore, weight: EQS_ATTRIBUTE_WEIGHTS["Bias / Fandom Skew"], explanation: /\b(we|our team|my team|my club)\b/i.test(cleanedContent) ? "Some fandom alignment is visible." : "The piece reads broadly balanced." },
    { name: "Originality", score: originalityScore, weight: EQS_ATTRIBUTE_WEIGHTS.Originality, explanation: uniqueRatio > 0.55 ? "The phrasing feels distinct for a draft." : "The draft is readable but fairly familiar in phrasing." },
    { name: "Grammar & Readability", score: grammarScore, weight: EQS_ATTRIBUTE_WEIGHTS["Grammar & Readability"], explanation: "Grammar and readability are reasonably clear." },
    { name: "Depth of Insight", score: depthScore, weight: EQS_ATTRIBUTE_WEIGHTS["Depth of Insight"], explanation: hasAnalysisWords ? "It shows tactical or analytical reasoning." : "The draft is competent but lightly developed." },
    { name: "Engagement / Hook Quality", score: engagementScore, weight: EQS_ATTRIBUTE_WEIGHTS["Engagement / Hook Quality"], explanation: hasHookWords ? "The opening and transitions create a hook." : "The hook is serviceable but could be sharper." },
    { name: "Coherence & Structure", score: coherenceScore, weight: EQS_ATTRIBUTE_WEIGHTS["Coherence & Structure"], explanation: hasStructure ? "The structure is easy to follow." : "The flow is understandable but compact." },
    { name: "Emotional Register", score: emotionalScore, weight: EQS_ATTRIBUTE_WEIGHTS["Emotional Register"], explanation: hasInsult ? "Emotion pushes too close to hostility." : "The emotional tone stays controlled." },
    { name: "Spam / Low-effort Detection", score: spamScore, weight: EQS_ATTRIBUTE_WEIGHTS["Spam / Low-effort Detection"], explanation: hasSpam ? "Promotional or low-effort phrasing is visible." : "The draft does not read as spammy." },
    { name: "Archetype Alignment", score: archetypeScore, weight: EQS_ATTRIBUTE_WEIGHTS["Archetype Alignment"], explanation: hasCricketVoice ? "It fits a clear cricket-writing voice." : "The article still aligns with a general editorial voice." },
  ];

  return buildEqsResult(attributes);
}
