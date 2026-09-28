const KNOWN_CODES = new Set([
  "KKR", "MI", "CSK", "RCB", "DC", "SRH", "PBKS", "RR", "GT", "LSG",
  "IND", "AUS", "ENG", "PAK", "SA", "NZ", "WI", "SL", "BAN", "AFG",
  "ZIM", "IRE", "SCO", "NAM", "UAE", "OMA", "NEP", "PNG", "USA", "CAN",
  "TKR", "JAM", "GUY", "BAR", "SKN", "ANT",
  "STR", "MLR", "SYS", "SYT", "BRH", "PRS", "HBH", "ACT",
]);

const EXACT_NAME_TO_CODE: Record<string, string> = {
  "kolkata knight riders": "KKR",
  "mumbai indians": "MI",
  "chennai super kings": "CSK",
  "royal challengers bengaluru": "RCB",
  "royal challengers bangalore": "RCB",
  "delhi capitals": "DC",
  "sunrisers hyderabad": "SRH",
  "punjab kings": "PBKS",
  "rajasthan royals": "RR",
  "gujarat titans": "GT",
  "lucknow super giants": "LSG",
  "india": "IND",
  "australia": "AUS",
  "england": "ENG",
  "pakistan": "PAK",
  "south africa": "SA",
  "new zealand": "NZ",
  "west indies": "WI",
  "sri lanka": "SL",
  "bangladesh": "BAN",
  "afghanistan": "AFG",
  "zimbabwe": "ZIM",
  "ireland": "IRE",
  "scotland": "SCO",
};

function normalizeSide(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function stripTrailingMetadata(text: string) {
  return normalizeSide(
    text
      .replace(/\s+\((?:[^()]*)\)\s*$/g, "")
      .replace(/\s+-\s+.*$/g, "")
      .replace(/\s+—\s+.*$/g, "")
      .replace(/\s*,\s+.*$/g, "")
  );
}

function resolveTeamCodeFromPrefix(raw: string): string | null {
  const normalized = normalizeSide(raw);
  const lower = normalized.toLowerCase();

  for (const [name, code] of Object.entries(EXACT_NAME_TO_CODE).sort(
    ([left], [right]) => right.length - left.length
  )) {
    if (lower === name || lower.startsWith(`${name} `) || lower.startsWith(`${name},`) || lower.startsWith(`${name} (`)) {
      return code;
    }
  }

  return null;
}

function resolveTeamCode(raw: string): string | null {
  const normalized = stripTrailingMetadata(raw);
  const upper = normalized.toUpperCase();

  if (KNOWN_CODES.has(upper)) {
    return upper;
  }

  const mapped = EXACT_NAME_TO_CODE[normalized.toLowerCase()];
  return mapped ?? resolveTeamCodeFromPrefix(raw);
}

export function extractTeamHintsFromTitle(title: string): string[] {
  const normalized = title.trim();
  const match = normalized.match(/^(.+?)\s+vs\s+(.+)$/i);

  if (!match) {
    return [];
  }

  const leftCode = resolveTeamCode(match[1]);
  const rightCode = resolveTeamCode(match[2]);

  if (!leftCode || !rightCode) {
    return [];
  }

  if (leftCode === rightCode) {
    return [leftCode.toLowerCase()];
  }

  return [leftCode.toLowerCase(), rightCode.toLowerCase()];
}

export function formatCommentaryTitleFromCodes(leftCode: string, rightCode: string) {
  return `${leftCode.toUpperCase()} vs ${rightCode.toUpperCase()}`;
}
