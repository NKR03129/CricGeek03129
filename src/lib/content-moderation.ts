const TOXIC_PATTERNS = [
  /\bidiot\b/i,
  /\bstupid\b/i,
  /\bmoron\b/i,
  /\bdumb(?:ass)?\b/i,
  /\btrash\b/i,
  /\bgarbage\b/i,
  /\bloser\b/i,
  /\bkill yourself\b/i,
  /\bshut up\b/i,
  /\bfuck(?:ing)?\b/i,
  /\bshit(?:ty)?\b/i,
  /\bbitch\b/i,
  /\basshole\b/i,
];

const SPAM_PATTERNS = [
  /\bwhatsapp\b/i,
  /\btelegram\b/i,
  /\bdm me\b/i,
  /\bcontact me\b/i,
  /\bsubscribe\b/i,
  /\bpromo(?: code)?\b/i,
  /\bguaranteed\b/i,
  /\bdouble your\b/i,
  /\bbet now\b/i,
  /\bearn money\b/i,
  /\bwork from home\b/i,
  /\bfree followers\b/i,
];

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
}

export interface ModerationResult {
  allowed: boolean;
  reason?: string;
}

export function screenSubmittedWriting(input: {
  title?: string;
  content: string;
  tags?: string;
}): ModerationResult {
  const title = normalizeText(input.title || "");
  const content = normalizeText(input.content);
  const tags = normalizeText(input.tags || "");
  const combined = normalizeText([title, content, tags].filter(Boolean).join(" "));
  const lower = combined.toLowerCase();

  if (!combined) {
    return {
      allowed: false,
      reason: "Please add some writing before submitting.",
    };
  }

  const toxicMatches = countMatches(combined, TOXIC_PATTERNS);
  if (toxicMatches > 0) {
    return {
      allowed: false,
      reason: "This submission is too hostile or abusive to publish. Please rewrite it in a constructive way.",
    };
  }

  const spamMatches = countMatches(combined, SPAM_PATTERNS);
  const urlCount = (combined.match(/https?:\/\//gi) || []).length;
  const repeatedPunctuation = /([!?$*.])\1{4,}/.test(combined);
  const repeatedChars = /(.)\1{7,}/i.test(combined);
  const repeatedWords = /\b(\w+)\b(?:\s+\1){4,}/i.test(lower);
  const contactBait = /\b(?:@\w+|\+?\d[\d\s-]{7,}\d)\b/.test(combined);
  const uppercaseLetters = combined.replace(/[^A-Z]/g, "").length;
  const letters = combined.replace(/[^A-Za-z]/g, "").length;
  const capsRatio = letters > 0 ? uppercaseLetters / letters : 0;

  const spamScore =
    spamMatches +
    (urlCount >= 2 ? 2 : urlCount) +
    (repeatedPunctuation ? 1 : 0) +
    (repeatedChars ? 1 : 0) +
    (repeatedWords ? 2 : 0) +
    (contactBait ? 1 : 0) +
    (capsRatio > 0.65 && combined.length > 40 ? 1 : 0);

  if (spamScore >= 2) {
    return {
      allowed: false,
      reason: "This looks too much like spam or promotion to publish here.",
    };
  }

  return { allowed: true };
}
