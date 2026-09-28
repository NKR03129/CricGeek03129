/**
 * Stage 7 — Internal plagiarism.
 *
 * Compares the draft against CricGeek's own corpus using BOTH mechanisms the spec
 * requires: exact matching and embedding/vector similarity. Vector similarity finds
 * the nearest neighbours cheaply, then an exact shingle pass on those neighbours
 * produces the hard evidence (the actual copied passage).
 *
 * This is a separate system from external plagiarism, on purpose.
 */

import { withCache } from "@/lib/eqs/cache";
import { prisma } from "@/lib/db";
import { assessInternalOriginality } from "@/lib/internal-originality";
import type { ComponentResult, EqsFlag } from "@/lib/eqs/types";
import { clamp0to1, clamp0to100, contentHash, errorMessage, tokenize, truncate } from "@/lib/eqs/utils";

export const INTERNAL_PLAGIARISM_VERSION = "eqs-internal-plagiarism-v2.0.0";

/** Shingle width in words. 8 is long enough that natural overlap is rare. */
const SHINGLE_SIZE = 8;

/** How many nearest neighbours get the expensive exact-match pass. */
const EXACT_MATCH_CANDIDATES = 3;

type CandidateRow = { id: string; title: string | null; content: string };

function buildShingles(text: string): Set<string> {
  const tokens = tokenize(text);
  const shingles = new Set<string>();

  for (let index = 0; index + SHINGLE_SIZE <= tokens.length; index += 1) {
    shingles.add(tokens.slice(index, index + SHINGLE_SIZE).join(" "));
  }

  return shingles;
}

/**
 * Fraction of the draft's shingles that also appear in the candidate. Asymmetric on
 * purpose: we care how much of *this* article is reused, not how similar the two
 * documents are overall.
 */
function exactOverlapRatio(draftShingles: Set<string>, candidateText: string) {
  if (draftShingles.size === 0) return { ratio: 0, matched: [] as string[] };

  const candidateShingles = buildShingles(candidateText);
  const matched: string[] = [];

  for (const shingle of draftShingles) {
    if (candidateShingles.has(shingle)) matched.push(shingle);
  }

  return { ratio: matched.length / draftShingles.size, matched };
}

/** Longest run of consecutive matching shingles, rendered as a readable passage. */
function longestMatchedPassage(draftText: string, candidateText: string): string {
  const draftTokens = tokenize(draftText);
  const candidateShingles = buildShingles(candidateText);

  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  let currentLength = 0;

  for (let index = 0; index + SHINGLE_SIZE <= draftTokens.length; index += 1) {
    const shingle = draftTokens.slice(index, index + SHINGLE_SIZE).join(" ");

    if (candidateShingles.has(shingle)) {
      if (currentStart === -1) currentStart = index;
      currentLength += 1;

      if (currentLength > bestLength) {
        bestLength = currentLength;
        bestStart = currentStart;
      }
    } else {
      currentStart = -1;
      currentLength = 0;
    }
  }

  if (bestStart === -1) return "";
  return truncate(draftTokens.slice(bestStart, bestStart + bestLength + SHINGLE_SIZE - 1).join(" "), 300);
}

export interface InternalPlagiarismEvidence {
  /** Cosine similarity against the nearest stored expression. */
  maxVectorSimilarity: number;
  vectorThreshold: number;
  vectorFlagged: boolean;
  /** Fraction of the draft's 8-word shingles found verbatim in a stored expression. */
  maxExactOverlapRatio: number;
  exactMatchFlagged: boolean;
  matchedBlogId: string | null;
  matchedTitle: string | null;
  matchedPassage: string | null;
  candidatesCompared: number;
  exactMatchCandidatesChecked: number;
}

export interface InternalPlagiarismResult {
  component: ComponentResult<InternalPlagiarismEvidence>;
  /** Multiplier applied to the originality dimension, 0-1. */
  originalityPenaltyFactor: number;
  flaggedForReview: boolean;
}

const EMPTY_EVIDENCE: InternalPlagiarismEvidence = {
  maxVectorSimilarity: 0,
  vectorThreshold: 0,
  vectorFlagged: false,
  maxExactOverlapRatio: 0,
  exactMatchFlagged: false,
  matchedBlogId: null,
  matchedTitle: null,
  matchedPassage: null,
  candidatesCompared: 0,
  exactMatchCandidatesChecked: 0,
};

function unavailableResult(
  reason: string,
  startedAt: number,
  status: ComponentResult["status"],
): InternalPlagiarismResult {
  return {
    component: {
      component: "internal-plagiarism",
      score: null,
      confidence: 0.2,
      evidence: EMPTY_EVIDENCE,
      flags:
        status === "skipped"
          ? []
          : [
              {
                code: "INTERNAL_PLAGIARISM_UNAVAILABLE",
                severity: "warn",
                message: reason,
                component: "internal-plagiarism",
              },
            ],
      source: "cricgeek-internal-corpus",
      version: INTERNAL_PLAGIARISM_VERSION,
      status,
      durationMs: Date.now() - startedAt,
      error: status === "error" ? reason : undefined,
    },
    originalityPenaltyFactor: 1,
    flaggedForReview: false,
  };
}

export async function runInternalPlagiarism(input: {
  content: string;
  excludeBlogId?: string | null;
  exactMatchRatioThreshold: number;
  reviewSimilarity: number;
  signal?: AbortSignal;
}): Promise<InternalPlagiarismResult> {
  const startedAt = Date.now();

  try {
    const match = await withCache(
      `internal-plagiarism:${contentHash({ content: input.content })}:${input.excludeBlogId ?? ""}`,
      () =>
        assessInternalOriginality({
          content: input.content,
          excludeBlogId: input.excludeBlogId,
          signal: input.signal,
        }),
    );

    // ── Exact-match pass over the nearest neighbours ────────────────
    const draftShingles = buildShingles(input.content);
    const candidateIds = match.topMatches.slice(0, EXACT_MATCH_CANDIDATES).map((entry) => entry.blogId);

    let maxExactOverlapRatio = 0;
    let exactMatchBlogId: string | null = null;
    let exactMatchTitle: string | null = null;
    let matchedPassage: string | null = null;
    let exactMatchCandidatesChecked = 0;

    if (candidateIds.length > 0 && draftShingles.size > 0) {
      const rows = (await prisma.$queryRawUnsafe(
        `SELECT id, title, content FROM Blog WHERE id IN (${candidateIds.map((_, i) => `@P${i + 1}`).join(", ")})`,
        ...candidateIds,
      )) as CandidateRow[];

      for (const row of rows) {
        if (!row?.content) continue;
        exactMatchCandidatesChecked += 1;

        const { ratio } = exactOverlapRatio(draftShingles, row.content);
        if (ratio > maxExactOverlapRatio) {
          maxExactOverlapRatio = ratio;
          exactMatchBlogId = row.id;
          exactMatchTitle = row.title;
          matchedPassage = longestMatchedPassage(input.content, row.content) || null;
        }
      }
    }

    const exactMatchFlagged = maxExactOverlapRatio >= input.exactMatchRatioThreshold;
    const flags: EqsFlag[] = [];

    if (match.flagged) {
      flags.push({
        code: "INTERNAL_DUPLICATE",
        severity: "critical",
        message: `Near-duplicate of an existing CricGeek expression (${Math.round(match.maxSimilarity * 100)}% vector similarity${match.matchedTitle ? `: "${truncate(match.matchedTitle, 80)}"` : ""}).`,
        component: "internal-plagiarism",
      });
    } else if (match.maxSimilarity >= input.reviewSimilarity) {
      flags.push({
        code: "INTERNAL_SIMILARITY_ELEVATED",
        severity: "warn",
        message: `Notable overlap with an existing expression (${Math.round(match.maxSimilarity * 100)}% vector similarity).`,
        component: "internal-plagiarism",
      });
    }

    if (exactMatchFlagged) {
      flags.push({
        code: "INTERNAL_EXACT_MATCH",
        severity: "critical",
        message: `${Math.round(maxExactOverlapRatio * 100)}% of this draft appears verbatim in an existing CricGeek expression.`,
        component: "internal-plagiarism",
      });
    }

    if (match.candidatesCompared === 0) {
      flags.push({
        code: "INTERNAL_CORPUS_EMPTY",
        severity: "info",
        message: "No stored expression embeddings were available to compare against.",
        component: "internal-plagiarism",
      });
    }

    // Originality is scaled, not zeroed: the spec forbids a single signal from
    // deciding an article's fate, so the guardrail layer applies the hard cap.
    const vectorPenalty = match.flagged
      ? 0.35
      : match.maxSimilarity >= input.reviewSimilarity
        ? 0.75
        : 1;
    const exactPenalty = exactMatchFlagged ? 0.3 : maxExactOverlapRatio >= 0.15 ? 0.8 : 1;
    const originalityPenaltyFactor = Math.min(vectorPenalty, exactPenalty);

    const evidence: InternalPlagiarismEvidence = {
      maxVectorSimilarity: match.maxSimilarity,
      vectorThreshold: match.threshold,
      vectorFlagged: match.flagged,
      maxExactOverlapRatio: Math.round(maxExactOverlapRatio * 1000) / 1000,
      exactMatchFlagged,
      matchedBlogId: exactMatchBlogId ?? match.matchedBlogId,
      matchedTitle: exactMatchTitle ?? match.matchedTitle,
      matchedPassage,
      candidatesCompared: match.candidatesCompared,
      exactMatchCandidatesChecked,
    };

    return {
      component: {
        component: "internal-plagiarism",
        // Reported as an originality-confidence score: 100 means nothing matched.
        score: clamp0to100(100 - Math.max(match.maxSimilarity, maxExactOverlapRatio) * 100),
        confidence: clamp0to1(match.candidatesCompared > 0 ? 0.85 : 0.3),
        evidence,
        flags,
        source: "cricgeek-internal-corpus",
        version: INTERNAL_PLAGIARISM_VERSION,
        status: match.candidatesCompared > 0 ? "ok" : "unavailable",
        durationMs: Date.now() - startedAt,
      },
      originalityPenaltyFactor,
      flaggedForReview: match.flagged || exactMatchFlagged,
    };
  } catch (error) {
    return unavailableResult(
      `Internal plagiarism check failed: ${truncate(errorMessage(error), 200)}`,
      startedAt,
      "error",
    );
  }
}

export function skippedInternalPlagiarism(): InternalPlagiarismResult {
  return unavailableResult("Internal plagiarism check disabled by configuration.", Date.now(), "skipped");
}
