/**
 * Writer DNA mixing and weight blending — pure functions, no database access.
 *
 * Split from `dna.ts` (which owns the writer-profile lookup) so the scoring maths
 * can be imported and tested without a Prisma client.
 */

import { getDnaWeightTable } from "@/lib/eqs/config";
import {
  EQS_DIMENSION_KEYS,
  EQS_DNA_PROFILES,
  type EqsDimensionKey,
  type EqsDnaContext,
  type EqsDnaProfile,
} from "@/lib/eqs/types";
import { countPatternHits, round3, round4 } from "@/lib/eqs/utils";

export const EVEN_DNA_MIX: Record<EqsDnaProfile, number> = {
  fan: 0.25,
  analyst: 0.25,
  debater: 0.25,
  storyteller: 0.25,
};

/** A profile needs this share of the mix to count as dominant rather than mixed. */
export const DNA_DOMINANCE_THRESHOLD = 0.45;

const PROFILE_PATTERNS: Record<EqsDnaProfile, RegExp[]> = {
  analyst: [
    /\bstrike rate\b/i,
    /\beconomy\b/i,
    /\baverage\b/i,
    /\bper cent\b|\bpercent\b|%/i,
    /\bsample\b/i,
    /\bmatch[- ]?up\b/i,
    /\bphase\b/i,
    /\bdata\b/i,
  ],
  fan: [
    /\bwe\b/i,
    /\bour\b/i,
    /\blove\b/i,
    /\bheart\b/i,
    /\bproud\b/i,
    /\bcan'?t wait\b/i,
    /\bgoosebumps\b/i,
  ],
  debater: [
    /\bdisagree\b/i,
    /\bargu(?:e|ment)\b/i,
    /\bhowever\b/i,
    /\bthe case for\b/i,
    /\bversus\b|\bvs\b/i,
    /\bmyth\b/i,
    /\bcounterpoint\b/i,
  ],
  storyteller: [
    /\bremember\b/i,
    /\bthat evening\b|\bthat night\b|\bthat morning\b/i,
    /\bgrew up\b/i,
    /\bthe crowd\b/i,
    /\bstory\b/i,
    /\bjourney\b/i,
    /\bsilence\b/i,
  ],
};

export function normaliseDnaMix(
  raw: Partial<Record<EqsDnaProfile, number>>,
): Record<EqsDnaProfile, number> {
  const positive = EQS_DNA_PROFILES.map((profile) => {
    const value = raw[profile];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  });

  const total = positive.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { ...EVEN_DNA_MIX };

  const mix = {} as Record<EqsDnaProfile, number>;
  EQS_DNA_PROFILES.forEach((profile, index) => {
    mix[profile] = round3(positive[index] / total);
  });

  return mix;
}

export function buildDnaContext(
  raw: Partial<Record<EqsDnaProfile, number>>,
  source: EqsDnaContext["source"],
): EqsDnaContext {
  const mix = normaliseDnaMix(raw);
  const dominant = EQS_DNA_PROFILES.reduce<EqsDnaProfile>(
    (best, profile) => (mix[profile] > mix[best] ? profile : best),
    "fan",
  );

  return { mix, dominant, mixed: mix[dominant] < DNA_DOMINANCE_THRESHOLD, source };
}

/** Infers a DNA mix from the article itself, for anonymous or first-time writers. */
export function inferDnaFromContent(content: string): EqsDnaContext {
  const raw = {} as Record<EqsDnaProfile, number>;

  for (const profile of EQS_DNA_PROFILES) {
    // +1 keeps every profile in play so a short article never gets a 100% label.
    raw[profile] = countPatternHits(content, PROFILE_PATTERNS[profile]) + 1;
  }

  return buildDnaContext(raw, "content-inference");
}

/**
 * Blends the four per-profile weight tables by the DNA mix, giving genuine
 * mixed-profile weighting rather than picking one archetype.
 *
 * `ai_assistance` is absent from every table by design: the spec requires it to be a
 * bounded signal, so it is applied as an adjustment and carries weight 0 here.
 */
export function buildDnaWeights(dna: EqsDnaContext): Record<EqsDimensionKey, number> {
  const blended = {} as Record<EqsDimensionKey, number>;

  for (const key of EQS_DIMENSION_KEYS) {
    blended[key] = 0;
  }

  for (const profile of EQS_DNA_PROFILES) {
    const share = dna.mix[profile];
    if (share <= 0) continue;

    const table = getDnaWeightTable(profile);
    for (const key of EQS_DIMENSION_KEYS) {
      blended[key] += (table[key] ?? 0) * share;
    }
  }

  // Re-normalise so rounding in the config file cannot drift the total off 1.
  const total = EQS_DIMENSION_KEYS.reduce((sum, key) => sum + blended[key], 0);
  if (total <= 0) return blended;

  for (const key of EQS_DIMENSION_KEYS) {
    blended[key] = round4(blended[key] / total);
  }

  // Rounding 13 weights independently can leave the total a few ten-thousandths off
  // 1, so the residual goes onto the heaviest weight. That keeps "weights sum to 1"
  // an exact invariant, which the explanation and legacy projection both rely on.
  const rounded = EQS_DIMENSION_KEYS.reduce((sum, key) => sum + blended[key], 0);
  const residual = 1 - rounded;

  if (Math.abs(residual) > 0) {
    const heaviest = EQS_DIMENSION_KEYS.reduce((best, key) =>
      blended[key] > blended[best] ? key : best,
    );
    blended[heaviest] = round4(blended[heaviest] + residual);
  }

  return blended;
}

export function describeDna(dna: EqsDnaContext): string {
  const parts = EQS_DNA_PROFILES.filter((profile) => dna.mix[profile] >= 0.05)
    .sort((left, right) => dna.mix[right] - dna.mix[left])
    .map((profile) => `${profile} ${Math.round(dna.mix[profile] * 100)}%`);

  return dna.mixed ? `mixed profile (${parts.join(", ")})` : `${dna.dominant} (${parts.join(", ")})`;
}
