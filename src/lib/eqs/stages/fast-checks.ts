/**
 * Stage 3 — Fast checks.
 *
 * Pure, deterministic, offline. Two jobs:
 *  1. produce structural/lexical evidence and hard flags (spam, abuse, thin content)
 *  2. provide the heuristic dimension scores used when no language provider answers
 *
 * Nothing here calls the network, so this stage always succeeds and the pipeline
 * always has a floor to fall back to.
 */

import type { ComponentResult, EqsDimensionKey, EqsFlag } from "@/lib/eqs/types";
import {
  clamp0to100,
  countPatternHits,
  mean,
  normaliseWhitespace,
  splitParagraphs,
  splitSentences,
  standardDeviation,
  tokenize,
} from "@/lib/eqs/utils";

export const FAST_CHECKS_VERSION = "fast-checks-v2.0.0";

const ABUSE_PATTERNS = [
  /\bidiot\b/i,
  /\bmoron\b/i,
  /\bstupid\b/i,
  /\bdumb(?:ass)?\b/i,
  /\btrash\b/i,
  /\bgarbage\b/i,
  /\bloser\b/i,
  /\bpathetic\b/i,
  /\bdisgrace\b/i,
  /\bshut up\b/i,
  /\bkill yourself\b/i,
  /\bfuck(?:ing|ed)?\b/i,
  /\bshit(?:ty)?\b/i,
  /\bbitch\b/i,
  /\basshole\b/i,
  /\bscum\b/i,
];

const SPAM_PATTERNS = [
  /\bwhatsapp\b/i,
  /\btelegram\b/i,
  /\bdm me\b/i,
  /\bcontact me\b/i,
  /\bsubscribe now\b/i,
  /\bpromo(?: code)?\b/i,
  /\bguaranteed (?:profit|win)\b/i,
  /\bdouble your\b/i,
  /\bbet now\b/i,
  /\bearn money\b/i,
  /\bwork from home\b/i,
  /\bfree followers\b/i,
  /\bclick here\b/i,
  /\blimited offer\b/i,
];

const MOCK_PRAISE_PATTERNS = [
  /\bmasterclass\b/i,
  /\bvisionary\b/i,
  /\bgenius\b/i,
  /\blegendary\b/i,
  /\bworld[- ]class\b/i,
  /\binspiring\b/i,
];

const IRONY_MARKER_PATTERNS = [
  /\breally\?/i,
  /\byeah right\b/i,
  /\bas if\b/i,
  /\bsure, /i,
  /\bapparently\b/i,
  /\bof course\b/i,
  /\bobviously\b/i,
  /\/s\b/,
];

const REASONING_PATTERNS = [
  /\bbecause\b/i,
  /\btherefore\b/i,
  /\bwhich means\b/i,
  /\bas a result\b/i,
  /\bconsequently\b/i,
  /\bsuggests\b/i,
  /\bindicates\b/i,
  /\bcompared (?:to|with)\b/i,
];

const COUNTER_PATTERNS = [
  /\bhowever\b/i,
  /\balthough\b/i,
  /\bthat said\b/i,
  /\bon the other hand\b/i,
  /\bto be fair\b/i,
  /\badmittedly\b/i,
  /\bgranted\b/i,
];

const CRICKET_VOCAB_PATTERNS = [
  /\b(?:innings|over|overs|wicket|wickets|batter|batsman|bowler|spinner|seamer|pacer)\b/i,
  /\b(?:powerplay|death overs|middle overs|new ball|run rate|strike rate|economy)\b/i,
  /\b(?:lbw|yorker|googly|doosra|reverse swing|off[- ]spin|leg[- ]spin)\b/i,
  /\b(?:test|odi|t20|ipl|world cup)\b/i,
];

const FILLER_PATTERNS = [
  /\bat the end of the day\b/i,
  /\bonly time will tell\b/i,
  /\bit is what it is\b/i,
  /\bneedless to say\b/i,
  /\bin my humble opinion\b/i,
  /\bgame of cricket\b/i,
];

/** Stylistic tells that correlate with unedited LLM prose. Signal only. */
const AI_STYLE_PATTERNS = [
  /\bdelve into\b/i,
  /\brich tapestry\b/i,
  /\btestament to\b/i,
  /\bin the realm of\b/i,
  /\bit'?s important to note\b/i,
  /\bnavigate the (?:complex|intricate)\b/i,
  /\bunderscores the\b/i,
  /\bin conclusion,/i,
  /\bmoreover,/i,
  /\bfurthermore,/i,
];

const VAGUE_PATTERNS = [
  /\bvery good\b/i,
  /\bpretty good\b/i,
  /\bsome people\b/i,
  /\bthings like that\b/i,
  /\ba lot of\b/i,
  /\bsort of\b/i,
];

export interface FastCheckEvidence {
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  avgSentenceLength: number;
  sentenceLengthStdDev: number;
  lexicalDiversity: number;
  numericTokenCount: number;
  urlCount: number;
  capsRatio: number;
  exclamationCount: number;
  questionCount: number;
  repeatedWordExcess: number;
  repeatedBigramExcess: number;
  hits: {
    abuse: number;
    spam: number;
    mockPraise: number;
    ironyMarkers: number;
    reasoning: number;
    counterArgument: number;
    cricketVocabulary: number;
    filler: number;
    aiStyle: number;
    vague: number;
  };
  /** Raw polarity, reported as evidence only. Negative polarity is never a penalty. */
  rawPolarity: number;
  aiAssistanceSignals: string[];
}

export interface FastCheckResult {
  component: ComponentResult<FastCheckEvidence>;
  /** Heuristic 0-100 scores used when no language provider answers. */
  heuristicDimensions: Record<Exclude<EqsDimensionKey, "statistical_claims">, number>;
  /** True when spam patterns dominate; drives a hard guardrail. */
  spamDetected: boolean;
  /** True when explicit abuse is present; drives a hard guardrail. */
  abuseDetected: boolean;
}

const POSITIVE_PATTERNS = [
  /\bexcellent\b/i,
  /\bimpressive\b/i,
  /\bbrilliant\b/i,
  /\bsuperb\b/i,
  /\bclass\b/i,
  /\bcomposed\b/i,
  /\bclinical\b/i,
];

const NEGATIVE_PATTERNS = [
  /\bpoor\b/i,
  /\bdisappointing\b/i,
  /\bworrying\b/i,
  /\bstruggl(?:e|ed|ing)\b/i,
  /\bsloppy\b/i,
  /\bwasteful\b/i,
  /\bconcerning\b/i,
];

function countRepetition(tokens: string[]) {
  const stopWords = new Set([
    "a", "an", "and", "are", "as", "at", "be", "been", "but", "for", "from", "had", "has", "have",
    "he", "her", "his", "in", "is", "it", "its", "of", "on", "or", "that", "the", "their", "they",
    "this", "to", "was", "were", "with",
  ]);

  const significant = tokens.filter((token) => token.length >= 4 && !stopWords.has(token));
  const wordCounts = new Map<string, number>();
  for (const token of significant) {
    wordCounts.set(token, (wordCounts.get(token) ?? 0) + 1);
  }

  const bigramCounts = new Map<string, number>();
  for (let index = 0; index < significant.length - 1; index += 1) {
    const bigram = `${significant[index]} ${significant[index + 1]}`;
    bigramCounts.set(bigram, (bigramCounts.get(bigram) ?? 0) + 1);
  }

  return {
    repeatedWordExcess: [...wordCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 3), 0),
    repeatedBigramExcess: [...bigramCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
  };
}

export function runFastChecks(input: { title?: string; content: string }): FastCheckResult {
  const startedAt = Date.now();
  const content = input.content;
  const combined = normaliseWhitespace(`${input.title || ""} ${content}`);
  const tokens = tokenize(content);
  const sentences = splitSentences(content);
  const paragraphs = splitParagraphs(content);

  const wordCount = tokens.length;
  const sentenceCount = Math.max(1, sentences.length);
  const paragraphCount = Math.max(1, paragraphs.length);
  const sentenceLengths = sentences.map((sentence) => tokenize(sentence).length).filter((length) => length > 0);
  const avgSentenceLength = sentenceLengths.length > 0 ? mean(sentenceLengths) : wordCount;
  const sentenceLengthStdDev = standardDeviation(sentenceLengths);
  const lexicalDiversity = wordCount > 0 ? new Set(tokens).size / wordCount : 0;

  const numericTokenCount = (content.match(/\b\d+(?:\.\d+)?\b/g) ?? []).length;
  const urlCount = (content.match(/https?:\/\//gi) ?? []).length;
  const letters = combined.replace(/[^A-Za-z]/g, "").length;
  const uppercase = combined.replace(/[^A-Z]/g, "").length;
  const capsRatio = letters > 0 ? uppercase / letters : 0;
  const { repeatedWordExcess, repeatedBigramExcess } = countRepetition(tokens);

  const hits = {
    abuse: countPatternHits(combined, ABUSE_PATTERNS),
    spam: countPatternHits(combined, SPAM_PATTERNS),
    mockPraise: countPatternHits(combined, MOCK_PRAISE_PATTERNS),
    ironyMarkers: countPatternHits(combined, IRONY_MARKER_PATTERNS),
    reasoning: countPatternHits(combined, REASONING_PATTERNS),
    counterArgument: countPatternHits(combined, COUNTER_PATTERNS),
    cricketVocabulary: countPatternHits(combined, CRICKET_VOCAB_PATTERNS),
    filler: countPatternHits(combined, FILLER_PATTERNS),
    aiStyle: countPatternHits(combined, AI_STYLE_PATTERNS),
    vague: countPatternHits(combined, VAGUE_PATTERNS),
  };

  const positiveHits = countPatternHits(combined, POSITIVE_PATTERNS);
  const negativeHits = countPatternHits(combined, NEGATIVE_PATTERNS);
  const polarityTotal = positiveHits + negativeHits;
  const rawPolarity = polarityTotal === 0 ? 0 : Math.round(((positiveHits - negativeHits) / polarityTotal) * 100) / 100;

  // AI-assistance indicators. Deliberately descriptive: the spec says this is a
  // signal, so the pipeline records *why* and caps how much it can ever cost.
  const aiAssistanceSignals: string[] = [];
  if (hits.aiStyle >= 2) aiAssistanceSignals.push(`${hits.aiStyle} generic LLM-style phrases`);
  if (sentenceLengths.length >= 6 && sentenceLengthStdDev < 3.2) {
    aiAssistanceSignals.push(`unusually uniform sentence length (sd ${sentenceLengthStdDev.toFixed(1)})`);
  }
  const contractionCount = (content.match(/\b\w+'(?:s|t|re|ve|ll|d|m)\b/gi) ?? []).length;
  if (wordCount >= 180 && contractionCount === 0) {
    aiAssistanceSignals.push("no contractions across a long piece");
  }
  if (hits.cricketVocabulary === 0 && wordCount >= 120) {
    aiAssistanceSignals.push("no concrete cricket vocabulary despite length");
  }
  if (numericTokenCount === 0 && wordCount >= 200) {
    aiAssistanceSignals.push("no specific numbers across a long piece");
  }

  const spamScore =
    hits.spam +
    (urlCount >= 2 ? 2 : urlCount) +
    (/([!?])\1{3,}/.test(combined) ? 1 : 0) +
    (repeatedBigramExcess >= 4 ? 2 : 0) +
    (capsRatio > 0.6 && combined.length > 40 ? 1 : 0);

  const spamDetected = spamScore >= 3;
  const abuseDetected = hits.abuse >= 1;

  const flags: EqsFlag[] = [];
  if (abuseDetected) {
    flags.push({
      code: "ABUSIVE_LANGUAGE",
      severity: "critical",
      message: `Explicit abusive or insulting language detected (${hits.abuse} pattern${hits.abuse === 1 ? "" : "s"}).`,
      component: "fast-checks",
    });
  }
  if (spamDetected) {
    flags.push({
      code: "SPAM_PATTERNS",
      severity: "critical",
      message: `Promotional or spam signals detected (score ${spamScore}).`,
      component: "fast-checks",
    });
  }
  if (wordCount < 60) {
    flags.push({
      code: "THIN_CONTENT",
      severity: "warn",
      message: `Only ${wordCount} words; depth and completeness cannot be assessed reliably.`,
      component: "fast-checks",
    });
  }
  if (hits.mockPraise >= 1 && hits.ironyMarkers >= 1) {
    flags.push({
      code: "POSSIBLE_SARCASM",
      severity: "info",
      message: "Mock praise combined with irony markers; intent needs contextual reading.",
      component: "fast-checks",
    });
  }
  if (aiAssistanceSignals.length >= 2) {
    flags.push({
      code: "AI_ASSISTANCE_SIGNAL",
      severity: "info",
      message: `AI-assistance indicators present (${aiAssistanceSignals.join("; ")}). Signal only, not a rejection.`,
      component: "fast-checks",
    });
  }
  if (repeatedBigramExcess >= 3) {
    flags.push({
      code: "REPETITIVE_PHRASING",
      severity: "info",
      message: `${repeatedBigramExcess} repeated phrase pairs reduce information density.`,
      component: "fast-checks",
    });
  }

  const evidence: FastCheckEvidence = {
    wordCount,
    sentenceCount,
    paragraphCount,
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    sentenceLengthStdDev: Math.round(sentenceLengthStdDev * 10) / 10,
    lexicalDiversity: Math.round(lexicalDiversity * 1000) / 1000,
    numericTokenCount,
    urlCount,
    capsRatio: Math.round(capsRatio * 1000) / 1000,
    exclamationCount: (content.match(/!/g) ?? []).length,
    questionCount: (content.match(/\?/g) ?? []).length,
    repeatedWordExcess,
    repeatedBigramExcess,
    hits,
    rawPolarity,
    aiAssistanceSignals,
  };

  const structureBonus = (paragraphCount > 1 ? 8 : 0) + (sentenceCount > 3 ? 6 : 0);
  const lengthBonus = Math.min(14, wordCount / 20);

  // Concreteness is the signal that actually separates substance from filler.
  // Lexical diversity alone does not: vague prose rarely repeats itself, so it
  // scores *high* on diversity. Numbers, cricket vocabulary, and named entities are
  // what distinguish "the bowlers bowled very well" from real analysis.
  const properNounCount = new Set(
    (content.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).filter(
      (word) => !/^(The|This|That|These|Those|There|When|Where|What|Why|How|But|And)$/.test(word),
    ),
  ).size;
  const concreteness = Math.min(
    1,
    (numericTokenCount * 1.5 + hits.cricketVocabulary * 2 + properNounCount) / 12,
  );
  const fillerLoad = hits.filler * 2 + hits.vague;

  // Heuristic dimension scores. Intentionally conservative — they exist so a
  // provider outage degrades the score's confidence, not its availability.
  const heuristicDimensions: Record<Exclude<EqsDimensionKey, "statistical_claims">, number> = {
    originality: clamp0to100(
      34 + lexicalDiversity * 28 + concreteness * 24 - fillerLoad * 7 - repeatedBigramExcess * 3,
      50,
    ),
    expression_quality: clamp0to100(
      52 +
        structureBonus +
        (avgSentenceLength >= 8 && avgSentenceLength <= 26 ? 8 : -6) +
        concreteness * 8 -
        fillerLoad * 5,
      58,
    ),
    coherence: clamp0to100(
      50 + structureBonus + Math.min(12, hits.reasoning * 3) - fillerLoad * 3,
      58,
    ),
    relevance_focus: clamp0to100(
      44 + Math.min(16, hits.cricketVocabulary * 5) + concreteness * 18 - fillerLoad * 8 - repeatedWordExcess * 2,
      56,
    ),
    sentiment: clamp0to100(
      // Appropriateness, not polarity: strong feeling is fine when reasoning carries it.
      62 + Math.min(14, hits.reasoning * 4) - (hits.abuse > 0 ? 28 : 0) - (hits.ironyMarkers >= 2 ? 8 : 0),
      64,
    ),
    sarcasm_intent: clamp0to100(
      88 - hits.ironyMarkers * 10 - (hits.mockPraise >= 1 && hits.ironyMarkers >= 1 ? 18 : 0),
      80,
    ),
    toxicity: clamp0to100(96 - hits.abuse * 30 - (hits.mockPraise >= 1 && hits.ironyMarkers >= 1 ? 12 : 0), 90),
    constructive_criticism: clamp0to100(
      48 + Math.min(20, hits.reasoning * 5) + Math.min(14, hits.counterArgument * 6) - hits.abuse * 22,
      52,
    ),
    reasoning: clamp0to100(
      36 +
        Math.min(24, hits.reasoning * 6) +
        Math.min(12, hits.counterArgument * 5) +
        lengthBonus -
        fillerLoad * 6,
      48,
    ),
    evidence_quality: clamp0to100(
      30 +
        Math.min(24, numericTokenCount * 5) +
        Math.min(16, hits.cricketVocabulary * 5) +
        concreteness * 12 -
        fillerLoad * 7,
      44,
    ),
    writer_dna_suitability: clamp0to100(
      56 +
        Math.min(12, hits.cricketVocabulary * 4) +
        concreteness * 10 +
        (paragraphCount > 1 ? 6 : 0) -
        fillerLoad * 4 -
        (wordCount < 60 ? 12 : 0),
      62,
    ),
    ai_assistance: clamp0to100(92 - aiAssistanceSignals.length * 14, 80),
  };

  return {
    component: {
      component: "fast-checks",
      score: clamp0to100(
        mean([
          heuristicDimensions.expression_quality,
          heuristicDimensions.coherence,
          heuristicDimensions.relevance_focus,
          heuristicDimensions.toxicity,
        ]),
      ),
      confidence: 0.95, // Deterministic: high confidence in the signals it reports.
      evidence,
      flags,
      source: "cricgeek-fast-checks",
      version: FAST_CHECKS_VERSION,
      status: "ok",
      durationMs: Date.now() - startedAt,
    },
    heuristicDimensions,
    spamDetected,
    abuseDetected,
  };
}
