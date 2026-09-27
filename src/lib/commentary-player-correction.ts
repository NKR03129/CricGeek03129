type WordToken = {
  value: string;
  normalized: string;
  start: number;
  end: number;
  isCapitalized: boolean;
  isAllCaps: boolean;
};

type PlayerEntry = {
  canonical: string;
  tokens: string[];
  normalizedTokens: string[];
  phoneticTokens: string[];
  normalizedJoined: string;
  phoneticJoined: string;
  firstName: string;
  lastName: string;
  firstInitial: string;
  lastInitial: string;
  initialsKey: string;
  uniqueFirstName: boolean;
  uniqueLastName: boolean;
  uniqueInitials: boolean;
  aliasKeys: string[];
};

type Replacement = {
  startToken: number;
  endTokenExclusive: number;
  replacement: string;
  score: number;
};

const LOWERCASE_NAME_CONNECTORS = new Set(["de", "da", "di", "van", "von", "bin", "al"]);

const COMMON_NON_NAME_WORDS = new Set([
  "a",
  "after",
  "ball",
  "balls",
  "batting",
  "bowling",
  "boundary",
  "boundaries",
  "cricket",
  "drive",
  "field",
  "innings",
  "line",
  "length",
  "match",
  "midwicket",
  "off",
  "on",
  "over",
  "overs",
  "pitch",
  "play",
  "powerplay",
  "run",
  "runs",
  "score",
  "shot",
  "single",
  "six",
  "strike",
  "sweep",
  "team",
  "the",
  "throw",
  "wicket",
  "wickets",
  "yorker",
]);

export const MANUAL_ALIAS_OVERRIDES: Record<string, string[]> = {
  "Angkrish Raghuvanshi": [
    "english raghuvanshi",
    "angrish raghuvanshi",
    "ankrish raghuvanshi",
    "angkrish raghuwanshi",
    "angkrish raghubanshi",
    "angkrish raghuvanshee",
  ],
  "Heinrich Klaasen": [
    "henrik klaasen",
    "heinrick klaasen",
    "henrich klaasen",
    "classen",
    "klaasen",
  ],
  "Varun Chakravarthy": [
    "varun chakrabarthy",
    "varun chakraborty",
    "chakravarti",
    "chakrabarthy",
  ],
  "Quinton de Kock": [
    "quenton de kock",
    "quinton dekock",
    "quinton de cock",
  ],
  "Sunil Narine": [
    "sunil nareen",
    "sunny narine",
  ],
};

export function getManualAliasesForPlayer(playerName: string) {
  return MANUAL_ALIAS_OVERRIDES[playerName] ?? [];
}

function normalizeToken(token: string) {
  return token.toLowerCase().replace(/[^a-z]/g, "");
}

function phoneticForm(token: string) {
  let text = normalizeToken(token);
  if (!text) return "";

  text = text
    .replace(/ph/g, "f")
    .replace(/gh/g, "g")
    .replace(/kh/g, "k")
    .replace(/ck/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/ou/g, "u")
    .replace(/au/g, "o")
    .replace(/aa/g, "a")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/bh/g, "b")
    .replace(/sh/g, "s")
    .replace(/ch/g, "c")
    .replace(/zh/g, "j")
    .replace(/wr/g, "r")
    .replace(/kn/g, "n");

  const first = text[0];
  const rest = text
    .slice(1)
    .replace(/[aeiouy]/g, "")
    .replace(/(.)\1+/g, "$1");

  return `${first}${rest}`;
}

function levenshtein(left: string, right: string) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const matrix = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));

  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[left.length][right.length];
}

function similarity(left: string, right: string) {
  if (!left || !right) return 0;
  const maxLength = Math.max(left.length, right.length);
  return 1 - levenshtein(left, right) / maxLength;
}

function prefixSimilarity(left: string, right: string) {
  if (!left || !right) return 0;

  let matchLength = 0;
  const maxCheck = Math.min(left.length, right.length);

  while (matchLength < maxCheck && left[matchLength] === right[matchLength]) {
    matchLength += 1;
  }

  return matchLength / Math.min(left.length, right.length);
}

function buildInitialsKey(tokens: string[]) {
  return tokens
    .map(normalizeToken)
    .filter((token) => token && !LOWERCASE_NAME_CONNECTORS.has(token))
    .map((token) => token[0])
    .join("");
}

function tokenizeWords(text: string): WordToken[] {
  const matches = text.matchAll(/[A-Za-z][A-Za-z'’-]*/g);
  const tokens: WordToken[] = [];

  for (const match of matches) {
    const value = match[0];
    const start = match.index ?? 0;
    const end = start + value.length;
    tokens.push({
      value,
      normalized: normalizeToken(value),
      start,
      end,
      isCapitalized: /^[A-Z]/.test(value),
      isAllCaps: value === value.toUpperCase(),
    });
  }

  return tokens;
}

function isInitialToken(token: WordToken | string) {
  const value = typeof token === "string" ? normalizeToken(token) : token.normalized;
  return value.length === 1;
}

function isNameishToken(token: WordToken) {
  return token.isCapitalized || token.isAllCaps || isInitialToken(token) || LOWERCASE_NAME_CONNECTORS.has(token.normalized);
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAliasKey(firstPart: string, secondPart?: string) {
  return normalizeToken(`${firstPart}${secondPart ?? ""}`);
}

function buildPlayerEntries(playerNames: string[]) {
  const firstNameCounts = new Map<string, number>();
  const lastNameCounts = new Map<string, number>();
  const initialsCounts = new Map<string, number>();

  const baseEntries = playerNames
    .map((name) => {
      const tokens = name.split(/\s+/).filter(Boolean);
      const normalizedTokens = tokens.map(normalizeToken).filter(Boolean);
      const phoneticTokens = tokens.map(phoneticForm).filter(Boolean);
      if (normalizedTokens.length === 0) return null;

      const nonConnectorTokens = normalizedTokens.filter((token) => !LOWERCASE_NAME_CONNECTORS.has(token));
      const firstName = nonConnectorTokens[0] || normalizedTokens[0];
      const lastName = nonConnectorTokens[nonConnectorTokens.length - 1] || normalizedTokens[normalizedTokens.length - 1];
      const initialsKey = buildInitialsKey(tokens);

      firstNameCounts.set(firstName, (firstNameCounts.get(firstName) || 0) + 1);
      lastNameCounts.set(lastName, (lastNameCounts.get(lastName) || 0) + 1);
      if (initialsKey) {
        initialsCounts.set(initialsKey, (initialsCounts.get(initialsKey) || 0) + 1);
      }

      return {
        canonical: name,
        tokens,
        normalizedTokens,
        phoneticTokens,
        normalizedJoined: normalizedTokens.join(""),
        phoneticJoined: phoneticTokens.join(""),
        firstName,
        lastName,
        firstInitial: firstName[0] || "",
        lastInitial: lastName[0] || "",
        initialsKey,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return baseEntries.map((entry) => {
    const aliasKeys = new Set<string>();
    aliasKeys.add(entry.normalizedJoined);

    const surnamePrefixes = Array.from({ length: Math.max(0, Math.min(8, entry.lastName.length) - 3) }, (_, index) =>
      entry.lastName.slice(0, index + 4)
    );
    const firstNamePrefixes = Array.from({ length: Math.max(0, Math.min(8, entry.firstName.length) - 2) }, (_, index) =>
      entry.firstName.slice(0, index + 3)
    );

    aliasKeys.add(buildAliasKey(entry.firstInitial, entry.lastName));
    aliasKeys.add(buildAliasKey(entry.firstInitial, entry.normalizedTokens.slice(1).join("")));
    aliasKeys.add(buildAliasKey(entry.firstName, entry.lastInitial));
    aliasKeys.add(buildAliasKey(entry.firstInitial, entry.lastInitial));

    for (const prefix of surnamePrefixes) {
      aliasKeys.add(buildAliasKey(entry.firstInitial, prefix));
    }

    for (const prefix of firstNamePrefixes) {
      aliasKeys.add(buildAliasKey(prefix, entry.lastInitial));
    }

    if ((firstNameCounts.get(entry.firstName) || 0) === 1) {
      aliasKeys.add(entry.firstName);
    }

    if ((lastNameCounts.get(entry.lastName) || 0) === 1) {
      aliasKeys.add(entry.lastName);
    }

    for (const alias of MANUAL_ALIAS_OVERRIDES[entry.canonical] ?? []) {
      aliasKeys.add(normalizeToken(alias));
    }

    return {
      ...entry,
      uniqueFirstName: (firstNameCounts.get(entry.firstName) || 0) === 1,
      uniqueLastName: (lastNameCounts.get(entry.lastName) || 0) === 1,
      uniqueInitials: entry.initialsKey ? (initialsCounts.get(entry.initialsKey) || 0) === 1 : false,
      aliasKeys: [...aliasKeys].filter(Boolean),
    } satisfies PlayerEntry;
  });
}

function buildAliasIndex(players: PlayerEntry[]) {
  const aliasIndex = new Map<string, PlayerEntry | null>();

  for (const player of players) {
    for (const aliasKey of player.aliasKeys) {
      const existing = aliasIndex.get(aliasKey);
      if (!existing) {
        aliasIndex.set(aliasKey, player);
      } else if (existing.canonical !== player.canonical) {
        aliasIndex.set(aliasKey, null);
      }
    }
  }

  return aliasIndex;
}

function buildLooseTokenPattern(token: string) {
  const normalized = normalizeToken(token);

  if (!normalized) {
    return "";
  }

  if (LOWERCASE_NAME_CONNECTORS.has(normalized)) {
    return escapeRegExp(normalized);
  }

  const stem = normalized.slice(0, Math.min(4, normalized.length));
  const fragment = [...stem]
    .map((character, index) => {
      if (index === 0) {
        if ("ckq".includes(character)) return "[ckq]";
        if ("vw".includes(character)) return "[vw]";
        if ("sz".includes(character)) return "[sz]";
        if ("gj".includes(character)) return "[gj]";
      }

      if ("ckq".includes(character)) return "[ckq]";
      if ("vw".includes(character)) return "[vw]";
      if ("sz".includes(character)) return "[sz]";
      return escapeRegExp(character);
    })
    .join("");

  return `${fragment}[a-z'’-]*`;
}

function applyGeneratedPatternCorrections(text: string, players: PlayerEntry[]) {
  let nextText = text;

  for (const player of players) {
    const tailPattern = player.tokens
      .slice(1)
      .map(buildLooseTokenPattern)
      .filter(Boolean)
      .join("\\s+");

    if (player.firstInitial && tailPattern) {
      const initialAndTail = new RegExp(`\\b${player.firstInitial}\\.?(?:\\s+${tailPattern})\\b`, "gi");
      nextText = nextText.replace(initialAndTail, player.canonical);
    }

    if (player.lastInitial) {
      const firstPattern = buildLooseTokenPattern(player.tokens[0] || "");
      if (firstPattern) {
        const firstAndLastInitial = new RegExp(`\\b${firstPattern}\\s+${player.lastInitial}\\.?(?=\\b)`, "gi");
        nextText = nextText.replace(firstAndLastInitial, player.canonical);
      }
    }

    if (player.uniqueInitials && player.initialsKey.length >= 2) {
      const initialsPattern = player.initialsKey
        .split("")
        .map((initial) => `${initial}\\.?`)
        .join("\\s*");
      const initialsRegex = new RegExp(`\\b${initialsPattern}\\b`, "gi");
      nextText = nextText.replace(initialsRegex, player.canonical);
    }
  }

  return nextText;
}

function applyCallbackInitialCorrections(text: string, players: PlayerEntry[]) {
  const firstInitialPattern = /\b([A-Z])\.?\s+((?:[A-Z][a-z'’-]*|de|da|di|van|von|bin|al)(?:\s+(?:[A-Z][a-z'’-]*|de|da|di|van|von|bin|al)){0,2})\b/g;
  const firstNameLastInitialPattern = /\b([A-Z][a-z'’-]{2,})\s+([A-Z])\.?\b/g;

  let nextText = text.replace(firstInitialPattern, (match, initial: string, tail: string) => {
    const normalizedInitial = normalizeToken(initial);
    const tailTokens = tail
      .split(/\s+/)
      .map(normalizeToken)
      .filter(Boolean);
    const tailCore = tailTokens.filter((token) => !LOWERCASE_NAME_CONNECTORS.has(token));
    const tailLast = tailCore[tailCore.length - 1] || tailTokens[tailTokens.length - 1] || "";
    const tailJoined = tailCore.join("");

    let best: { player: PlayerEntry; score: number } | null = null;

    for (const player of players) {
      if (player.firstInitial !== normalizedInitial) continue;

      const score = Math.max(
        similarity(tailLast, player.lastName),
        prefixSimilarity(tailLast, player.lastName),
        similarity(phoneticForm(tailLast), phoneticForm(player.lastName)),
        similarity(tailJoined, player.normalizedTokens.slice(1).join("")),
        similarity(tailCore.map(phoneticForm).join(""), player.phoneticTokens.slice(1).join(""))
      );

      if (score < 0.56) continue;

      if (!best || score > best.score) {
        best = { player, score };
      }
    }

    return best ? best.player.canonical : match;
  });

  nextText = nextText.replace(firstNameLastInitialPattern, (match, firstNameLike: string, initial: string) => {
    const normalizedFirst = normalizeToken(firstNameLike);
    const normalizedInitial = normalizeToken(initial);

    let best: { player: PlayerEntry; score: number } | null = null;

    for (const player of players) {
      if (player.lastInitial !== normalizedInitial) continue;

      const score = Math.max(
        similarity(normalizedFirst, player.firstName),
        prefixSimilarity(normalizedFirst, player.firstName),
        similarity(phoneticForm(normalizedFirst), phoneticForm(player.firstName))
      );

      if (score < 0.62) continue;

      if (!best || score > best.score) {
        best = { player, score };
      }
    }

    return best ? best.player.canonical : match;
  });

  return nextText;
}

function applySpanReplacements(text: string, tokens: WordToken[], replacements: Replacement[]) {
  if (replacements.length === 0) {
    return text;
  }

  const ordered = [...replacements].sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }

    const leftLength = left.endTokenExclusive - left.startToken;
    const rightLength = right.endTokenExclusive - right.startToken;
    if (leftLength !== rightLength) {
      return rightLength - leftLength;
    }

    return left.startToken - right.startToken;
  });

  const selected: Replacement[] = [];

  for (const replacement of ordered) {
    const overlapsExisting = selected.some(
      (existing) =>
        replacement.startToken < existing.endTokenExclusive &&
        existing.startToken < replacement.endTokenExclusive
    );
    if (overlapsExisting) continue;
    selected.push(replacement);
  }

  selected.sort((left, right) => left.startToken - right.startToken);

  let cursor = 0;
  let output = "";

  for (const replacement of selected) {
    const start = tokens[replacement.startToken]?.start ?? cursor;
    const end = tokens[replacement.endTokenExclusive - 1]?.end ?? start;
    output += text.slice(cursor, start);
    output += replacement.replacement;
    cursor = end;
  }

  output += text.slice(cursor);
  return output;
}

function applyManualAliasCorrections(text: string, playerNames: string[]) {
  let nextText = text;

  for (const playerName of playerNames) {
    const aliases = MANUAL_ALIAS_OVERRIDES[playerName] ?? [];
    for (const alias of aliases) {
      const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi");
      nextText = nextText.replace(pattern, playerName);
    }
  }

  return nextText;
}

function findExactAliasReplacement(spanTokens: WordToken[], aliasIndex: Map<string, PlayerEntry | null>) {
  const aliasKey = spanTokens
    .map((token) => token.normalized)
    .filter(Boolean)
    .join("");

  if (!aliasKey) {
    return null;
  }

  const direct = aliasIndex.get(aliasKey);
  if (direct) {
    return direct;
  }

  return null;
}

function findInitialPatternMatch(spanTokens: WordToken[], players: PlayerEntry[]) {
  const spanNormalized = spanTokens.map((token) => token.normalized).filter(Boolean);
  const nonConnector = spanNormalized.filter((token) => !LOWERCASE_NAME_CONNECTORS.has(token));

  if (nonConnector.length < 2) {
    return null;
  }

  const first = nonConnector[0];
  const last = nonConnector[nonConnector.length - 1];
  const spanInitials = buildInitialsKey(spanTokens.map((token) => token.value));

  let best: { player: PlayerEntry; score: number } | null = null;

  for (const player of players) {
    let score = 0;

    if (first.length === 1 && first === player.firstInitial) {
      score = Math.max(
        score,
        similarity(last, player.lastName),
        prefixSimilarity(last, player.lastName),
        similarity(phoneticForm(last), phoneticForm(player.lastName))
      );
    }

    if (last.length === 1 && last === player.lastInitial) {
      score = Math.max(
        score,
        similarity(first, player.firstName),
        prefixSimilarity(first, player.firstName),
        similarity(phoneticForm(first), phoneticForm(player.firstName))
      );
    }

    if (spanInitials && spanInitials === player.initialsKey && player.uniqueInitials) {
      score = Math.max(score, 1);
    }

    if (score < 0.56) {
      continue;
    }

    if (!best || score > best.score) {
      best = { player, score };
    }
  }

  return best;
}

function chooseBestSpanMatch(spanTokens: WordToken[], players: PlayerEntry[]) {
  const spanNormalized = spanTokens.map((token) => token.normalized).filter(Boolean);
  if (spanNormalized.length === 0) {
    return null;
  }

  const spanJoined = spanNormalized.join("");
  const spanPhoneticJoined = spanNormalized.map(phoneticForm).join("");
  const spanFirst = spanNormalized.find((token) => !LOWERCASE_NAME_CONNECTORS.has(token)) || spanNormalized[0];
  const spanLast = [...spanNormalized].reverse().find((token) => !LOWERCASE_NAME_CONNECTORS.has(token)) || spanNormalized[spanNormalized.length - 1];
  const spanInitials = buildInitialsKey(spanTokens.map((token) => token.value));
  const spanLooksNameLike = spanTokens.every(isNameishToken);
  const spanHasProperNounSignal = spanTokens.some((token) => token.isCapitalized || token.isAllCaps || isInitialToken(token));

  if (!spanLooksNameLike || !spanHasProperNounSignal) {
    return null;
  }

  if (spanTokens.length === 1 && COMMON_NON_NAME_WORDS.has(spanFirst)) {
    return null;
  }

  const initialPatternMatch = findInitialPatternMatch(spanTokens, players);
  if (initialPatternMatch) {
    return initialPatternMatch;
  }

  const uniqueFirstNameMatch = players.find((player) => {
    if (!player.uniqueFirstName) return false;

    const firstNameScore = Math.max(
      similarity(spanFirst, player.firstName),
      prefixSimilarity(spanFirst, player.firstName),
      similarity(phoneticForm(spanFirst), phoneticForm(player.firstName))
    );

    const tailScore = Math.max(
      similarity(spanLast, player.lastName),
      prefixSimilarity(spanLast, player.lastName),
      similarity(phoneticForm(spanLast), phoneticForm(player.lastName))
    );

    if (firstNameScore >= 0.97) {
      return true;
    }

    return firstNameScore >= 0.92 && tailScore >= 0.28;
  });

  if (uniqueFirstNameMatch) {
    return {
      player: uniqueFirstNameMatch,
      score: 1.05,
    };
  }

  let best: { player: PlayerEntry; score: number } | null = null;

  for (const player of players) {
    const joinedScore = similarity(spanJoined, player.normalizedJoined);
    const phoneticScore = similarity(spanPhoneticJoined, player.phoneticJoined);
    const surnameScore = similarity(spanLast, player.lastName);
    const surnamePrefixScore = prefixSimilarity(spanLast, player.lastName);
    const surnamePhoneticScore = similarity(phoneticForm(spanLast), phoneticForm(player.lastName));
    const firstScore = similarity(spanFirst, player.firstName);
    const firstPrefixScore = prefixSimilarity(spanFirst, player.firstName);
    const firstPhoneticScore = similarity(phoneticForm(spanFirst), phoneticForm(player.firstName));

    let score =
      joinedScore * 0.34 +
      phoneticScore * 0.2 +
      surnameScore * 0.2 +
      firstScore * 0.12 +
      surnamePrefixScore * 0.09 +
      firstPrefixScore * 0.03 +
      surnamePhoneticScore * 0.01 +
      firstPhoneticScore * 0.01;

    if (player.uniqueFirstName && firstScore >= 0.88) {
      score += 0.18;
    }

    if (player.uniqueLastName && surnameScore >= 0.88) {
      score += 0.18;
    }

    const exactInitials = Boolean(spanInitials && spanInitials === player.initialsKey);
    const firstInitialMatch = isInitialToken(spanFirst) && spanFirst === player.firstInitial;
    const lastInitialMatch = isInitialToken(spanLast) && spanLast === player.lastInitial;

    if (exactInitials && player.uniqueInitials) {
      score += 0.35;
    }

    if (firstInitialMatch) {
      score += 0.2;
    }

    if (lastInitialMatch) {
      score += 0.2;
    }

    if (spanTokens.length === 1 && player.uniqueLastName && (surnameScore >= 0.8 || surnamePrefixScore >= 0.85)) {
      score += 0.3;
    }

    if (spanTokens.length === 1 && player.uniqueFirstName && (firstScore >= 0.8 || firstPrefixScore >= 0.85)) {
      score += 0.25;
    }

    const strongEnough =
      score >= 0.74 ||
      (exactInitials && player.uniqueInitials) ||
      (firstInitialMatch &&
        Math.max(surnameScore, surnamePrefixScore, surnamePhoneticScore) >= 0.56) ||
      (lastInitialMatch &&
        Math.max(firstScore, firstPrefixScore, firstPhoneticScore) >= 0.56) ||
      (spanTokens.length === 1 && player.uniqueLastName && (surnameScore >= 0.82 || surnamePrefixScore >= 0.9)) ||
      (spanTokens.length === 1 && player.uniqueFirstName && (firstScore >= 0.85 || firstPrefixScore >= 0.9));

    if (!strongEnough) continue;

    if (!best || score > best.score) {
      best = { player, score };
    }
  }

  return best;
}

function applyProperNounPhraseCorrections(text: string, players: PlayerEntry[]) {
  const properNounPhrasePattern = /\b([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){1,2})\b/g;

  return text.replace(properNounPhrasePattern, (match) => {
    const rawWords = match.split(/\s+/).filter(Boolean);
    const firstWordNormalized = normalizeToken(rawWords[0] || "");

    const uniqueFirstWordPlayer = players.find((player) => {
      if (!player.uniqueFirstName) return false;

      const score = Math.max(
        similarity(firstWordNormalized, player.firstName),
        prefixSimilarity(firstWordNormalized, player.firstName),
        similarity(phoneticForm(firstWordNormalized), phoneticForm(player.firstName))
      );

      return score >= 0.95;
    });

    if (uniqueFirstWordPlayer) {
      return uniqueFirstWordPlayer.canonical;
    }

    const tokens = rawWords.map((value) => ({
      value,
      normalized: normalizeToken(value),
      start: 0,
      end: 0,
      isCapitalized: /^[A-Z]/.test(value),
      isAllCaps: value === value.toUpperCase(),
    }));

    const best = chooseBestSpanMatch(tokens, players);
    if (!best) {
      return match;
    }

    if (best.score < 0.78) {
      return match;
    }

    return best.player.canonical;
  });
}

function collectSpanReplacements(text: string, tokens: WordToken[], players: PlayerEntry[], aliasIndex: Map<string, PlayerEntry | null>) {
  const replacements: Replacement[] = [];

  for (let start = 0; start < tokens.length; start += 1) {
    for (let size = 2; size <= 4; size += 1) {
      const end = start + size;
      if (end > tokens.length) continue;

      const spanTokens = tokens.slice(start, end);
      const exactAliasMatch = findExactAliasReplacement(spanTokens, aliasIndex);

      if (exactAliasMatch) {
        replacements.push({
          startToken: start,
          endTokenExclusive: end,
          replacement: exactAliasMatch.canonical,
          score: 1.5,
        });
        continue;
      }

      const closestMatch = chooseBestSpanMatch(spanTokens, players);
      if (!closestMatch) continue;

      replacements.push({
        startToken: start,
        endTokenExclusive: end,
        replacement: closestMatch.player.canonical,
        score: closestMatch.score,
      });
    }
  }

  return applySpanReplacements(text, tokens, replacements);
}

function applySingleTokenCorrections(
  text: string,
  tokens: WordToken[],
  players: PlayerEntry[],
  aliasIndex: Map<string, PlayerEntry | null>
) {
  const isAlreadyInsideCanonicalName = (index: number, player: PlayerEntry) => {
    const playerLength = player.normalizedTokens.length;

    for (
      let start = Math.max(0, index - playerLength + 1);
      start <= index && start + playerLength <= tokens.length;
      start += 1
    ) {
      const window = tokens.slice(start, start + playerLength).map((token) => token.normalized);
      const matchesCanonical =
        window.length === player.normalizedTokens.length &&
        window.every((token, tokenIndex) => token === player.normalizedTokens[tokenIndex]);

      if (matchesCanonical) {
        return true;
      }
    }

    return false;
  };

  const replacements: Replacement[] = [];

  tokens.forEach((token, index) => {
    if (!token.normalized || (!token.isCapitalized && !token.isAllCaps)) {
      return;
    }

    if (COMMON_NON_NAME_WORDS.has(token.normalized)) {
      return;
    }

    const exactAliasMatch = aliasIndex.get(token.normalized);
    if (exactAliasMatch && !isAlreadyInsideCanonicalName(index, exactAliasMatch)) {
      replacements.push({
        startToken: index,
        endTokenExclusive: index + 1,
        replacement: exactAliasMatch.canonical,
        score: 1.4,
      });
      return;
    }

    let bestPlayer: PlayerEntry | null = null;
    let bestScore = 0;

    for (const player of players) {
      const surnameScore = similarity(token.normalized, player.lastName);
      const surnamePrefixScore = prefixSimilarity(token.normalized, player.lastName);
      const firstScore = similarity(token.normalized, player.firstName);
      const firstPrefixScore = prefixSimilarity(token.normalized, player.firstName);
      const phoneticSurnameScore = similarity(phoneticForm(token.normalized), phoneticForm(player.lastName));
      const phoneticFirstScore = similarity(phoneticForm(token.normalized), phoneticForm(player.firstName));

      let score = 0;

      if (player.uniqueLastName) {
        score = Math.max(score, surnameScore * 0.75 + surnamePrefixScore * 0.25, phoneticSurnameScore);
      }

      if (player.uniqueFirstName) {
        score = Math.max(score, firstScore * 0.75 + firstPrefixScore * 0.25, phoneticFirstScore);
      }

      if (score > bestScore) {
        bestScore = score;
        bestPlayer = player;
      }
    }

    if (!bestPlayer || bestScore < 0.86 || isAlreadyInsideCanonicalName(index, bestPlayer)) {
      return;
    }

    replacements.push({
      startToken: index,
      endTokenExclusive: index + 1,
      replacement: bestPlayer.canonical,
      score: bestScore,
    });
  });

  return applySpanReplacements(text, tokens, replacements);
}

export function correctPlayerNamesInCommentary(text: string, playerNames: string[]) {
  if (!text.trim() || playerNames.length === 0) {
    return text;
  }

  const players = buildPlayerEntries(playerNames);
  if (players.length === 0) {
    return text;
  }

  const aliasIndex = buildAliasIndex(players);

  let corrected = applyManualAliasCorrections(text, playerNames);
  corrected = applyGeneratedPatternCorrections(corrected, players);
  corrected = applyCallbackInitialCorrections(corrected, players);
  corrected = applyProperNounPhraseCorrections(corrected, players);
  let tokens = tokenizeWords(corrected);
  corrected = collectSpanReplacements(corrected, tokens, players, aliasIndex);

  tokens = tokenizeWords(corrected);
  corrected = applySingleTokenCorrections(corrected, tokens, players, aliasIndex);

  return corrected;
}
