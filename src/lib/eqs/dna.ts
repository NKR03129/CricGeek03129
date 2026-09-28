/**
 * Stage 2 — Writer DNA resolution.
 *
 * Resolves the DNA mix that drives the final weighting. The spec requires mixed
 * profiles to be supported, so this never collapses a writer to a single archetype.
 *
 * The mixing and weight-blending maths live in `dna-weights.ts`; this module only
 * adds the database lookup, so the pure functions stay importable without Prisma.
 */

import { prisma } from "@/lib/db";
import {
  buildDnaContext,
  inferDnaFromContent,
} from "@/lib/eqs/dna-weights";
import { EQS_DNA_PROFILES, type EqsDnaContext, type EqsDnaProfile } from "@/lib/eqs/types";

export {
  buildDnaWeights,
  describeDna,
  inferDnaFromContent,
  normaliseDnaMix,
  EVEN_DNA_MIX,
} from "@/lib/eqs/dna-weights";

export async function resolveWriterDna(input: {
  content: string;
  writerId?: string | null;
  dnaOverride?: Partial<Record<EqsDnaProfile, number>> | null;
}): Promise<EqsDnaContext> {
  if (input.dnaOverride && Object.keys(input.dnaOverride).length > 0) {
    return buildDnaContext(input.dnaOverride, "request-override");
  }

  if (input.writerId) {
    try {
      const stored = await prisma.writerDNA.findUnique({ where: { userId: input.writerId } });

      if (stored) {
        const raw = {
          analyst: stored.analyst,
          fan: stored.fan,
          debater: stored.debater,
          storyteller: stored.storyteller,
        };

        // A brand-new writer sits at the 25/25/25/25 default, which carries no
        // information. Fall through to content inference in that case.
        const isDefault = EQS_DNA_PROFILES.every(
          (profile) => Math.abs((raw[profile] ?? 0) - 25) < 0.01,
        );

        if (!isDefault) {
          return buildDnaContext(raw, "writer-profile");
        }
      }
    } catch (error) {
      console.warn("[eqs] Writer DNA lookup failed; inferring from content instead", error);
    }
  }

  return inferDnaFromContent(input.content);
}
