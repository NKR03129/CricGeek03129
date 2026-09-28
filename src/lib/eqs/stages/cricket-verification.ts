/**
 * Stage 6 — Cricket verification.
 *
 * Owns the `statistical_claims` dimension. Claims are routed to trusted sources, in
 * order of authority:
 *   1. the match scorecard from the cricket data API (strongest)
 *   2. CricGeek's historical warehouse and web-search fact-check pipeline
 *
 * The language model is never the authority here (spec section 13). Every verdict
 * carries its source, provider, evidence, and timestamp so a score stays explainable.
 */

import { getMatchScorecard } from "@/lib/cricket-api";
import {
  buildScorecardPlayerIndex,
  isScorecardMetric,
  verifyClaimAgainstScorecard,
  type ScorecardStatClaim,
} from "@/lib/cricket-stat-match";
import { withCache } from "@/lib/eqs/cache";
import { cachedWebFactCheck } from "@/lib/eqs/cached-fact-check";
import { type WebFactCheckReport } from "@/lib/fact-check";
import type {
  ClaimVerificationStatus,
  ComponentResult,
  EqsClaim,
  EqsFlag,
} from "@/lib/eqs/types";
import { clamp0to1, clamp0to100, errorMessage, truncate } from "@/lib/eqs/utils";

export const CRICKET_VERIFICATION_VERSION = "eqs-cricket-verification-v2.0.0";

/** Score used when an article makes no checkable statistical claims at all. */
const NO_CLAIMS_SCORE = 75;

function toScorecardClaim(claim: EqsClaim): ScorecardStatClaim | null {
  if (!claim.player || claim.value === null || !isScorecardMetric(claim.metric)) return null;
  return { player: claim.player, metric: claim.metric, value: claim.value };
}

/** Matches a fact-check verdict back to the extracted claim it came from. */
function findVerdictForClaim(report: WebFactCheckReport, claim: EqsClaim) {
  const needle = claim.text.toLowerCase().slice(0, 60);
  if (!needle) return undefined;

  return report.verdicts.find((verdict) => {
    const haystack = verdict.claim.toLowerCase();
    return haystack.includes(needle) || needle.includes(haystack.slice(0, 60));
  });
}

export interface CricketVerificationEvidence {
  scorecardSource: "live-scorecard" | "unavailable" | "not-linked";
  matchId: string | null;
  claimsConsidered: number;
  claimsRequiringVerification: number;
  supported: number;
  contradicted: number;
  inconclusive: number;
  unverified: number;
  /** Fraction of verification-worthy claims that reached a definite verdict. */
  coverage: number;
  factCheck: {
    providerAvailable: boolean;
    searchBackend: string;
    searchError: string | null;
    historicalWarehouseAvailable: boolean;
    historicalWarehouseError: string | null;
    score: number;
    summary: string;
  } | null;
}

export interface CricketVerificationResult {
  component: ComponentResult<CricketVerificationEvidence>;
  /** Claims with their verification status filled in. */
  claims: EqsClaim[];
  /** 0-100 score for the `statistical_claims` dimension. */
  statisticalClaimsScore: number;
  statisticalClaimsConfidence: number;
  statisticalClaimsExplanation: string;
}

function buildSkippedResult(
  claims: EqsClaim[],
  reason: string,
  startedAt: number,
  status: ComponentResult["status"],
): CricketVerificationResult {
  return {
    component: {
      component: "cricket-verification",
      score: NO_CLAIMS_SCORE,
      confidence: 0.5,
      evidence: {
        scorecardSource: "not-linked",
        matchId: null,
        claimsConsidered: claims.length,
        claimsRequiringVerification: claims.filter((claim) => claim.requiresVerification).length,
        supported: 0,
        contradicted: 0,
        inconclusive: 0,
        unverified: claims.filter((claim) => claim.requiresVerification).length,
        coverage: 0,
        factCheck: null,
      },
      flags:
        status === "skipped"
          ? []
          : [
              {
                code: "CRICKET_VERIFICATION_UNAVAILABLE",
                severity: "warn",
                message: reason,
                component: "cricket-verification",
              },
            ],
      claims,
      source: "cricgeek-cricket-verification",
      version: CRICKET_VERIFICATION_VERSION,
      status,
      durationMs: Date.now() - startedAt,
    },
    claims,
    statisticalClaimsScore: NO_CLAIMS_SCORE,
    statisticalClaimsConfidence: 0.35,
    statisticalClaimsExplanation: reason,
  };
}

export async function runCricketVerification(input: {
  title?: string;
  content: string;
  matchId?: string | null;
  claims: EqsClaim[];
  signal?: AbortSignal;
}): Promise<CricketVerificationResult> {
  const startedAt = Date.now();
  const verifiable = input.claims.filter((claim) => claim.requiresVerification);

  if (verifiable.length === 0) {
    return buildSkippedResult(
      input.claims,
      "No statistical or factual claims required cricket verification.",
      startedAt,
      "skipped",
    );
  }

  const claims = input.claims.map((claim) => ({ ...claim, evidence: [...claim.evidence] }));
  const flags: EqsFlag[] = [];
  let scorecardSource: CricketVerificationEvidence["scorecardSource"] = "not-linked";

  // ── Route 1: the match scorecard (highest authority) ───────────────
  if (input.matchId) {
    try {
      const scorecards = await withCache(`scorecard:${input.matchId}`, () =>
        getMatchScorecard(input.matchId as string),
      );

      if (scorecards && scorecards.length > 0) {
        scorecardSource = "live-scorecard";
        const index = buildScorecardPlayerIndex(scorecards);
        const verifiedAt = new Date().toISOString();

        for (const claim of claims) {
          if (!claim.requiresVerification) continue;
          const scorecardClaim = toScorecardClaim(claim);
          if (!scorecardClaim) continue;

          const { verdict, actualValues } = verifyClaimAgainstScorecard(scorecardClaim, index);
          if (verdict === "inconclusive") continue;

          claim.status = verdict;
          claim.verificationSource = "live-scorecard";
          claim.provider = "cricket-data-api";
          claim.verifiedAt = verifiedAt;
          claim.evidence.push(
            `Scorecard ${scorecardClaim.metric} for ${scorecardClaim.player}: ${actualValues.join(", ")} (article claimed ${scorecardClaim.value}).`,
          );
        }
      } else {
        scorecardSource = "unavailable";
        flags.push({
          code: "SCORECARD_UNAVAILABLE",
          severity: "info",
          message: `No scorecard was available for match ${input.matchId}; claims were routed to the broader fact-check instead.`,
          component: "cricket-verification",
        });
      }
    } catch (error) {
      scorecardSource = "unavailable";
      flags.push({
        code: "SCORECARD_ERROR",
        severity: "warn",
        message: `Scorecard lookup failed: ${truncate(errorMessage(error), 160)}`,
        component: "cricket-verification",
      });
    }
  }

  // ── Route 2: historical warehouse + web search ─────────────────────
  let factCheckReport: WebFactCheckReport | null = null;
  const stillOpen = claims.filter((claim) => claim.requiresVerification && claim.status === "unverified");

  if (stillOpen.length > 0) {
    try {
      factCheckReport = await cachedWebFactCheck({ title: input.title, content: input.content });
      const verifiedAt = new Date().toISOString();

      for (const claim of claims) {
        if (!claim.requiresVerification || claim.status !== "unverified") continue;

        const verdict = findVerdictForClaim(factCheckReport, claim);
        if (!verdict) continue;

        claim.status = verdict.verdict as ClaimVerificationStatus;
        claim.verificationSource =
          verdict.route === "historical_structured" ? "historical-warehouse" : "web-search";
        claim.provider =
          verdict.route === "historical_structured"
            ? "cricgeek-historical-warehouse"
            : factCheckReport.searchBackend;
        claim.verifiedAt = verifiedAt;
        claim.evidence.push(truncate(verdict.evidence, 400));
        for (const source of verdict.sources.slice(0, 3)) {
          claim.evidence.push(`${source.domain}: ${source.url}`);
        }
      }

      if (factCheckReport.searchError) {
        flags.push({
          code: "FACT_CHECK_SEARCH_ERROR",
          severity: "warn",
          message: `External search backend reported: ${truncate(factCheckReport.searchError, 160)}`,
          component: "cricket-verification",
        });
      }

      if (!factCheckReport.providerAvailable && !factCheckReport.historicalWarehouseAvailable) {
        flags.push({
          code: "VERIFICATION_SOURCES_UNAVAILABLE",
          severity: "warn",
          message:
            "Neither the historical warehouse nor a web-search provider was available, so statistical claims could not be verified.",
          component: "cricket-verification",
        });
      }
    } catch (error) {
      flags.push({
        code: "FACT_CHECK_ERROR",
        severity: "warn",
        message: `Fact-check pipeline failed: ${truncate(errorMessage(error), 160)}`,
        component: "cricket-verification",
      });
    }
  }

  // ── Score the statistical_claims dimension ────────────────────────
  const supported = claims.filter((claim) => claim.status === "supported").length;
  const contradicted = claims.filter((claim) => claim.status === "contradicted").length;
  const inconclusive = claims.filter((claim) => claim.status === "inconclusive").length;
  const unverified = claims.filter(
    (claim) => claim.requiresVerification && claim.status === "unverified",
  ).length;

  const resolved = supported + contradicted;
  const coverage = verifiable.length > 0 ? resolved / verifiable.length : 0;

  let statisticalClaimsScore: number;
  let explanation: string;

  if (resolved === 0) {
    // Nothing could be resolved. Stay neutral rather than punishing the writer for
    // an infrastructure gap, and let confidence carry the uncertainty.
    statisticalClaimsScore = NO_CLAIMS_SCORE;
    explanation = `${verifiable.length} claim(s) needed verification but none could be resolved against a trusted source. Score held neutral and confidence reduced.`;
  } else {
    const accuracy = (supported / resolved) * 100;
    // Partial coverage pulls the score toward neutral so an unverified article never
    // looks as trustworthy as a fully verified one.
    statisticalClaimsScore = clamp0to100(accuracy * coverage + NO_CLAIMS_SCORE * (1 - coverage));
    explanation = `${supported}/${resolved} resolved claim(s) matched trusted cricket data${contradicted > 0 ? `, ${contradicted} contradicted` : ""}${unverified + inconclusive > 0 ? `, ${unverified + inconclusive} unresolved` : ""}.`;
  }

  if (contradicted > 0) {
    flags.push({
      code: "STAT_CLAIMS_CONTRADICTED",
      severity: contradicted >= 3 ? "critical" : "warn",
      message: `${contradicted} statistical claim(s) were contradicted by trusted cricket data.`,
      component: "cricket-verification",
    });
  }

  if (unverified > 0 && resolved > 0) {
    flags.push({
      code: "STAT_CLAIMS_PARTIALLY_VERIFIED",
      severity: "info",
      message: `${unverified} claim(s) could not be verified against any trusted source.`,
      component: "cricket-verification",
    });
  }

  const evidence: CricketVerificationEvidence = {
    scorecardSource,
    matchId: input.matchId ?? null,
    claimsConsidered: claims.length,
    claimsRequiringVerification: verifiable.length,
    supported,
    contradicted,
    inconclusive,
    unverified,
    coverage: Math.round(coverage * 1000) / 1000,
    factCheck: factCheckReport
      ? {
          providerAvailable: factCheckReport.providerAvailable,
          searchBackend: factCheckReport.searchBackend,
          searchError: factCheckReport.searchError ?? null,
          historicalWarehouseAvailable: factCheckReport.historicalWarehouseAvailable ?? false,
          historicalWarehouseError: factCheckReport.historicalWarehouseError ?? null,
          score: factCheckReport.score,
          summary: truncate(factCheckReport.summary, 600),
        }
      : null,
  };

  return {
    component: {
      component: "cricket-verification",
      score: statisticalClaimsScore,
      // Confidence tracks how much of the article we could actually verify.
      confidence: clamp0to1(0.3 + coverage * 0.65),
      evidence,
      flags,
      claims,
      source: scorecardSource === "live-scorecard" ? "cricket-data-api" : "cricgeek-fact-check",
      version: CRICKET_VERIFICATION_VERSION,
      status: resolved > 0 ? "ok" : "unavailable",
      durationMs: Date.now() - startedAt,
    },
    claims,
    statisticalClaimsScore,
    statisticalClaimsConfidence: clamp0to1(0.3 + coverage * 0.65),
    statisticalClaimsExplanation: explanation,
  };
}
