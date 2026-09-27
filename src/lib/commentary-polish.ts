import "server-only";

import { finalizeCommentaryText } from "@/lib/commentary-format";
import { getOllamaHeaders, getOllamaUrl } from "@/lib/ollama";

const COMMENTARY_POLISH_TIMEOUT_MS = 4_500;
const OLLAMA_URL = getOllamaUrl();
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3.5:latest";

export type CommentaryPlayer = {
  name: string;
  role?: string;
  team?: string;
  aliases?: string[];
};

type CommentaryPolishOptions = {
  players?: CommentaryPlayer[];
  playerNames?: string[];
  keyterms?: string[];
  preNormalizedText?: string;
  emphasizeNames?: boolean;
};

function normalizeModelOutput(text: string): string {
  return text
    .replace(/^["'`\s]+|["'`\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAlias(text: string) {
  return text.trim();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRosterNames(options?: CommentaryPolishOptions) {
  if (options?.players && options.players.length > 0) {
    return options.players.map((player) => player.name).filter(Boolean);
  }

  return options?.playerNames?.filter(Boolean) ?? [];
}

type ProtectedNameSet = {
  input: string;
  preNormalizedText?: string;
  placeholders: Array<{ token: string; name: string }>;
};

function buildProtectedNameSet(input: string, options?: CommentaryPolishOptions): ProtectedNameSet {
  const names = [...new Set(getRosterNames(options))]
    .filter((name) => name && name.trim().length > 0)
    .sort((left, right) => right.length - left.length);

  let nextInput = input;
  let nextPreNormalized = options?.preNormalizedText;
  const placeholders: Array<{ token: string; name: string }> = [];

  for (const name of names) {
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi");
    const appearsInInput = pattern.test(nextInput);
    pattern.lastIndex = 0;
    const appearsInPreNormalized = nextPreNormalized ? pattern.test(nextPreNormalized) : false;
    pattern.lastIndex = 0;

    if (!appearsInInput && !appearsInPreNormalized) {
      continue;
    }

    const token = `PLAYER_TOKEN_${placeholders.length + 1}`;
    nextInput = nextInput.replace(pattern, token);
    if (nextPreNormalized) {
      pattern.lastIndex = 0;
      nextPreNormalized = nextPreNormalized.replace(pattern, token);
    }
    placeholders.push({ token, name });
  }

  return {
    input: nextInput,
    preNormalizedText: nextPreNormalized,
    placeholders,
  };
}

function restoreProtectedNames(text: string, protectedNames: ProtectedNameSet) {
  let nextText = text;

  for (const placeholder of protectedNames.placeholders) {
    const pattern = new RegExp(`\\b${escapeRegExp(placeholder.token)}\\b`, "g");
    nextText = nextText.replace(pattern, placeholder.name);
  }

  return nextText;
}

function buildPlayerRosterBlock(options?: CommentaryPolishOptions): string {
  if (options?.players && options.players.length > 0) {
    const rows = options.players
      .map((p) => {
        const rolePart = p.role ? ` | role: ${p.role}` : "";
        const teamPart = p.team ? ` | team: ${p.team}` : "";
        const aliasPart =
          p.aliases && p.aliases.length > 0
            ? ` | aliases: ${p.aliases.map(normalizeAlias).join(", ")}`
            : "";
        return `- ${p.name}${rolePart}${teamPart}${aliasPart}`;
      })
      .join("\n");

    return `
OFFICIAL PLAYER ROSTER
Use ONLY names from this roster when resolving any person reference in the transcript.
If a spoken name is partial, garbled, phonetically similar, or reduced to initials, map it to the closest valid full name from this roster.

${rows}`.trim();
  }

  if (options?.playerNames && options.playerNames.length > 0) {
    return `
OFFICIAL PLAYER ROSTER
Valid player names for this match:
${options.playerNames.map((name) => `- ${name}`).join("\n")}`.trim();
  }

  return "";
}

function buildStrictResolutionRules(options?: CommentaryPolishOptions): string {
  const boldInstruction = options?.emphasizeNames
    ? `
BOLDING RULE:
- Wrap resolved player names in markdown bold only when they appear as the key cricketing actor in the sentence.
- Example: "**Angkrish Raghuvanshi** drives it through covers."
- Do NOT bold team abbreviations, scores, overs, or random nouns.
`
    : `
BOLDING RULE:
- Do not add markdown bold unless it already exists in the input.
`;

  return `
PLAYER NAME RESOLUTION RULES — HIGHEST PRIORITY
1. Every player mention in the output must be a valid full name from the OFFICIAL PLAYER ROSTER.
2. Never output a raw ASR form such as "Ankesh", "Angrish", "Boomra", "Rinkoo", "Venki", "Raghu", or initials like "VK", "AR", "HP" if a roster match exists.
3. If the transcript contains a partial name, initials, nickname, or phonetic approximation, expand it to the single best full roster name.
4. Use sentence meaning to resolve ambiguity:
   - if the person is batting, prefer a batter from the roster
   - if bowling or taking a wicket, prefer a bowler
   - if fielding or wicketkeeping, prefer the player whose role best fits
5. If multiple names sound similar, choose the roster name that best matches BOTH sound and cricket context.
6. Never invent a player name that is not in the roster.
7. If no confident roster match exists, keep the phrase generic instead of hallucinating a wrong person.
   Example: use "the batter" or "the bowler" rather than inventing a name.
8. Team abbreviations such as KKR, MI, RCB, CSK, SRH, RR, PBKS, DC, GT, LSG must remain uppercase.
9. Preserve all cricket facts exactly. Do not change runs, wickets, overs, dismissal type, or match events.
10. If the raw transcript or the pre-normalized version already contains an exact full roster name, preserve that exact roster name. Never rewrite one valid roster player into another.
${boldInstruction}

OUTPUT RULES
- Return exactly one polished commentary line.
- No explanation.
- No bullet points.
- No quotation marks unless required by meaning.
- Clean grammar and punctuation.
- Remove filler words, hesitations, stutters, false starts, and duplicate fragments.
- If the commentator repeats a word or short phrase accidentally, keep only the intended single version.
- If the speaker trails off or speaks in broken grammar, infer the most likely intended cricket commentary and rewrite it into clean English without changing the cricket meaning.
- Stay very close to the original speech. Improve clarity, but do not add new facts or extra analysis.
- If tokens like PLAYER_TOKEN_1 appear, preserve them exactly.
`.trim();
}

function buildSystemPrompt(options?: CommentaryPolishOptions) {
  const rosterBlock = buildPlayerRosterBlock(options);
  const keytermContext =
    options?.keyterms && options.keyterms.length > 0
      ? `\nMATCH KEYWORDS\n- ${options.keyterms.join("\n- ")}`
      : "";

  const rosterRequirement = rosterBlock
    ? `
You MUST use the roster below as the exclusive source of truth for player names.

${rosterBlock}
`
    : "";

  return `
You are a cricket commentary post-processor.

Your task is to convert noisy speech-to-text cricket commentary into one clean, publish-ready commentary sentence.

${buildStrictResolutionRules(options)}

CORE REQUIREMENTS
- Fix grammar, punctuation, capitalization, spacing, and sentence structure.
- Preserve the original cricket meaning.
- Correct player names aggressively but only using the roster when a roster is available.
- Prefer full player names over surnames, initials, or nicknames.
- Keep cricket terminology natural and professional.
- Do not make the sentence longer than needed.
${rosterRequirement}${keytermContext}

Return only the corrected commentary line.
`.trim();
}

function buildUserPrompt(input: string, _fallback: string, options?: CommentaryPolishOptions) {
  const preNormalizedVersion =
    options?.preNormalizedText && options.preNormalizedText !== input
      ? `
PRE-NORMALIZED VERSION
${options.preNormalizedText}
`
      : "";

  return `
Rewrite the following raw cricket commentary transcript into one polished commentary line.

RAW TRANSCRIPT
${input}
${preNormalizedVersion}

Important:
- Resolve every player reference to the exact full roster name whenever possible.
- If the transcript contains a garbled player name, do not preserve the garbled form.
- If the sentence strongly implies a roster player, use that full name.
- If no safe match exists, use a generic cricket role term instead of hallucinating.
- Remove spoken disfluencies such as "I, I think", "the the", "yeah so yeah", and other repeated fragments.
- Repair obvious grammatical mistakes caused by speech-to-text, but keep the intended meaning and tone.
- If the transcript is broken or awkward, rewrite it into the cleanest natural commentary sentence that still says the same thing.

Now output the final corrected commentary line only.
`.trim();
}

export async function polishCommentaryForSubmission(
  input: string,
  options?: CommentaryPolishOptions
): Promise<string> {
  const fallback = finalizeCommentaryText(input);

  if (!fallback) {
    return "";
  }

  if (!process.env.OLLAMA_URL && !process.env.OLLAMA_BASE_URL) {
    return fallback;
  }

  const protectedNames = buildProtectedNameSet(input, options);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: getOllamaHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        think: false,
        stream: false,
        options: {
          temperature: 0,
        },
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(options),
          },
          {
            role: "user",
            content: buildUserPrompt(protectedNames.input, fallback, {
              ...options,
              preNormalizedText: protectedNames.preNormalizedText,
            }),
          },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(COMMENTARY_POLISH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return fallback;
    }

    const payload = await response.json();
    const candidate =
      typeof payload?.message?.content === "string"
        ? payload.message.content
        : typeof payload?.response === "string"
          ? payload.response
          : "";

    const polished = finalizeCommentaryText(
      restoreProtectedNames(normalizeModelOutput(candidate), protectedNames)
    );

    if (!polished) {
      return fallback;
    }

    if (polished.length > fallback.length * 2.5) {
      return fallback;
    }

    return polished;
  } catch {
    return fallback;
  }
}
