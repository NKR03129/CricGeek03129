const TEAM_ABBREVIATIONS = [
  "csk",
  "dc",
  "gt",
  "ipl",
  "kkr",
  "lsg",
  "mi",
  "odi",
  "pbks",
  "rcb",
  "rr",
  "srh",
  "t20",
] as const;

const SPLIT_MARKERS = [
  "but",
  "however",
  "meanwhile",
  "still",
  "let's",
  "now",
  "then",
  "after that",
  "at the same time",
  "on the other hand",
] as const;

const FILLER_PATTERNS = [
  /\b(?:uh|um|erm|hmm)\b/gi,
  /\b(?:you know|i mean|sort of|kind of)\b/gi,
  /\b(?:basically|literally)\b/gi,
] as const;

function normalizeWhitespace(input: string): string {
  return input
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCommonCricketTerms(input: string): string {
  let text = input;

  for (const abbreviation of TEAM_ABBREVIATIONS) {
    const pattern = new RegExp(`\\b${abbreviation}\\b`, "gi");
    text = text.replace(pattern, abbreviation.toUpperCase());
  }

  return text
    .replace(/\bgood length\b/gi, "good length")
    .replace(/\bshort ball\b/gi, "short ball")
    .replace(/\bfull toss\b/gi, "full toss")
    .replace(/\bleg side\b/gi, "leg side")
    .replace(/\boff side\b/gi, "off side")
    .replace(/\bpower play\b/gi, "powerplay")
    .replace(/\bit's a\b/gi, "it's a")
    .replace(/\blet s\b/gi, "let's")
    .replace(/\bi m\b/gi, "I'm")
    .replace(/\bi ve\b/gi, "I've");
}

function normalizePunctuation(input: string): string {
  return input
    .replace(/\s+([,!?;:])/g, "$1")
    .replace(/([,!?;:])([^\s])/g, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

function collapseRepeatedWords(text: string): string {
  return text
    .replace(/\b([A-Za-z]{1,20})\s+\1\b/gi, "$1")
    .replace(/\b([A-Za-z]{1,20})\s+\1\s+\1\b/gi, "$1")
    .replace(/\b([A-Za-z]{1,20})\s+([A-Za-z]{1,20})\s+\1\s+\2\b/gi, "$1 $2");
}

function collapseRepeatedPhrases(text: string): string {
  return text.replace(
    /\b([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){1,3})\s+\1\b/gi,
    "$1"
  );
}

function removeSpeechFillers(text: string): string {
  let nextText = text;

  for (const pattern of FILLER_PATTERNS) {
    nextText = nextText.replace(pattern, " ");
  }

  return nextText
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ", ")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFalseStarts(text: string): string {
  return text
    .replace(/\b([A-Za-z]{2,20})\s*-\s*\1\b/gi, "$1")
    .replace(/\b([A-Za-z]{2,20})\s+\1(?=\s+(?:is|was|will|would|can|could|should|has|have|had)\b)/gi, "$1")
    .replace(/\b(i|we|he|she|they|it)\s+\1\b/gi, "$1")
    .replace(/\b(the|a|an|to|of|in|on|for|with|at|from)\s+\1\b/gi, "$1");
}

function sentenceCase(text: string): string {
  if (!text) return "";

  const withCapitalizedStarts = text.replace(
    /(^|[.!?]\s+)([a-z])/g,
    (_match, boundary: string, letter: string) => `${boundary}${letter.toUpperCase()}`
  );

  return withCapitalizedStarts.charAt(0).toUpperCase() + withCapitalizedStarts.slice(1);
}

function splitLongRunOnSentence(input: string): string {
  if (/[.!?]/.test(input) || input.split(" ").length < 18) {
    return input;
  }

  let text = input;

  for (const marker of SPLIT_MARKERS) {
    const pattern = new RegExp(`\\s+(${marker})\\b`, "i");
    text = text.replace(pattern, ". $1");
  }

  return text;
}

function finalizeSentenceEnd(text: string): string {
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function fixStandalonePronouns(text: string): string {
  return text.replace(/\bi\b/g, "I");
}

function cleanupCommentary(input: string, aggressive: boolean): string {
  let text = normalizeWhitespace(input);

  if (!text) {
    return "";
  }

  text = normalizeCommonCricketTerms(text);
  text = collapseRepeatedPhrases(text);
  text = collapseRepeatedWords(text);
  text = normalizeFalseStarts(text);
  text = removeSpeechFillers(text);
  text = normalizePunctuation(text);
  text = fixStandalonePronouns(text);

  if (aggressive) {
    text = splitLongRunOnSentence(text)
      .replace(/\b([A-Z]{2,5}) the\b/g, "$1. The")
      .replace(/\b([a-z]+) even though\b/gi, "$1. Even though")
      .replace(/\b([a-z]+) let's\b/gi, "$1. Let's")
      .replace(/\b(and|but|so)\s+\1\b/gi, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  text = sentenceCase(text);
  return finalizeSentenceEnd(text);
}

export function beautifyCommentaryText(input: string): string {
  return cleanupCommentary(input, false);
}

export function finalizeCommentaryText(input: string): string {
  return cleanupCommentary(input, true);
}
