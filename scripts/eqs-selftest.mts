/**
 * Offline self-test for the deterministic half of the EQS pipeline.
 *
 *   npx tsx scripts/eqs-selftest.mts
 *
 * Runs fast checks, DNA weight blending, normalisation, weighted scoring, and the
 * guardrails against the labelled benchmark set — with no database, no API keys, and
 * no network. It therefore exercises the heuristic fallback path, which is exactly
 * the path that has to stay correct when a provider is down.
 *
 * Checks it enforces:
 *   1. Every DNA weight table sums to 1.
 *   2. Blended mixed-profile weights sum to 1.
 *   3. Reasoned criticism is never scored as toxic (the spec's headline principle).
 *   4. Explicit abuse always trips the toxicity guardrail.
 *   5. Spam always trips the spam guardrail.
 *   6. Scores stay inside 0-100 and guardrails only ever lower a score.
 *   7. An AI-assistance signal never costs more than its configured cap.
 */

import benchmark from "../src/data/eqs-benchmark.json" with { type: "json" };
import { EQS_SCORING_CONFIG, getDnaWeightTable } from "../src/lib/eqs/config.ts";
import { buildDnaContext, buildDnaWeights } from "../src/lib/eqs/dna-weights.ts";
import {
  applyGuardrails,
  buildExplanation,
  computeConfidence,
  computeWeightedBaseScore,
  getBandLabel,
  normaliseDimensions,
  toLegacyAttributes,
} from "../src/lib/eqs/scoring-engine.ts";
import { runFastChecks } from "../src/lib/eqs/stages/fast-checks.ts";
import { EQS_DIMENSION_KEYS, EQS_DNA_PROFILES } from "../src/lib/eqs/types.ts";
import type { BenchmarkSample } from "../src/lib/eqs/benchmark.ts";
import type {
  ComponentResult,
  EqsDimensionKey,
  EqsDnaProfile,
} from "../src/lib/eqs/types.ts";

const samples = benchmark as unknown as BenchmarkSample[];

let failures = 0;
const check = (label: string, condition: boolean, detail = "") => {
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

console.log("EQS offline self-test\n");

// ── 1. Weight tables are normalised ─────────────────────────────────
console.log("Weight tables");
for (const profile of EQS_DNA_PROFILES) {
  const table = getDnaWeightTable(profile);
  const total = EQS_DIMENSION_KEYS.reduce((sum, key) => sum + (table[key] ?? 0), 0);
  check(`${profile} weights sum to 1`, Math.abs(total - 1) < 0.001, `got ${total.toFixed(4)}`);
  check(
    `${profile} excludes ai_assistance from weighting`,
    (table.ai_assistance ?? 0) === 0,
    `got ${table.ai_assistance}`,
  );
}
console.log(`  ${EQS_DNA_PROFILES.length} profiles checked\n`);

// ── 2. Blended mixed weights are normalised ─────────────────────────
console.log("Mixed-profile blending");
const mixes: Array<Partial<Record<EqsDnaProfile, number>>> = [
  { analyst: 70, debater: 20, fan: 10 },
  { storyteller: 50, fan: 50 },
  { analyst: 25, fan: 25, debater: 25, storyteller: 25 },
  { debater: 100 },
];
for (const mix of mixes) {
  const context = buildDnaContext(mix, "request-override");
  const weights = buildDnaWeights(context);
  const total = EQS_DIMENSION_KEYS.reduce((sum, key) => sum + weights[key], 0);
  check(`blend ${JSON.stringify(mix)} sums to 1`, Math.abs(total - 1) < 0.001, `got ${total.toFixed(4)}`);
}
const evenContext = buildDnaContext({ analyst: 25, fan: 25, debater: 25, storyteller: 25 }, "default");
check("an even split is reported as a mixed profile", evenContext.mixed);
const analystContext = buildDnaContext({ analyst: 90, fan: 10 }, "writer-profile");
check("a dominant profile is not reported as mixed", !analystContext.mixed);
check("dominant profile is identified", analystContext.dominant === "analyst");
console.log(`  ${mixes.length} blends checked\n`);

// ── Stubs for the specialist components we cannot run offline ───────
function stubComponent(component: ComponentResult["component"]): ComponentResult {
  return {
    component,
    score: null,
    confidence: 0.2,
    evidence: {},
    flags: [],
    source: "selftest-stub",
    version: "selftest",
    status: "skipped",
    durationMs: 0,
  };
}

const cricketStub = {
  component: {
    ...stubComponent("cricket-verification"),
    score: 75,
    evidence: {
      scorecardSource: "not-linked" as const,
      matchId: null,
      claimsConsidered: 0,
      claimsRequiringVerification: 0,
      supported: 0,
      contradicted: 0,
      inconclusive: 0,
      unverified: 0,
      coverage: 0,
      factCheck: null,
    },
  },
  claims: [],
  statisticalClaimsScore: 75,
  statisticalClaimsConfidence: 0.35,
  statisticalClaimsExplanation: "Offline self-test: verification not run.",
};

const internalStub = {
  component: {
    ...stubComponent("internal-plagiarism"),
    evidence: {
      maxVectorSimilarity: 0,
      vectorThreshold: 0.85,
      vectorFlagged: false,
      maxExactOverlapRatio: 0,
      exactMatchFlagged: false,
      matchedBlogId: null,
      matchedTitle: null,
      matchedPassage: null,
      candidatesCompared: 0,
      exactMatchCandidatesChecked: 0,
    },
  },
  originalityPenaltyFactor: 1,
  flaggedForReview: false,
};

const externalStub = {
  component: {
    ...stubComponent("external-plagiarism"),
    evidence: {
      provider: null,
      matchedPercent: null,
      sources: [],
      providerPayload: null,
      scanId: null,
    },
  },
  originalityPenaltyFactor: 1,
  flaggedForReview: false,
};

// ── 3-7. Score every benchmark sample through the offline path ──────
console.log("Benchmark samples (heuristic fallback path)");

type Row = {
  id: string;
  category: string;
  expected: string;
  eqs: number;
  band: string;
  toxicity: number;
  sarcasm: number;
  ai: number;
  guardrails: string[];
};

const rows: Row[] = [];

for (const sample of samples) {
  const fastChecks = runFastChecks({ title: sample.title, content: sample.content });
  const dna = buildDnaContext(sample.dna, "request-override");

  // Stand in for the language model with the deterministic heuristics.
  const language = {
    component: {
      ...stubComponent("language-analysis"),
      status: "unavailable" as const,
      evidence: {
        summary: "",
        strengths: [],
        concerns: [],
        sentimentVsToxicity: "",
        reviewNotes: [],
        heuristicFallbackDimensions: [],
        providerAttempts: [],
      },
    },
    dimensions: Object.fromEntries(
      Object.entries(fastChecks.heuristicDimensions).map(([key, score]) => [
        key,
        { score, confidence: 0.4, explanation: "heuristic", source: "heuristic" as const },
      ]),
    ),
    provider: "heuristic",
    model: "none",
    promptVersion: "selftest",
    latencyMs: 0,
  };

  const { dimensions, byKey } = normaliseDimensions({
    dna,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    language: language as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cricket: cricketStub as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    internalPlagiarism: internalStub as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    externalPlagiarism: externalStub as any,
  });

  const baseScore = computeWeightedBaseScore(dimensions);
  const guardrails = applyGuardrails({
    score: baseScore,
    dimensions: byKey,
    fastChecks,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cricket: cricketStub as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    internalPlagiarism: internalStub as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    externalPlagiarism: externalStub as any,
  });

  const components: ComponentResult[] = [
    fastChecks.component,
    language.component,
    cricketStub.component,
    internalStub.component,
    externalStub.component,
  ];

  const confidence = computeConfidence({ dimensions, components });

  // 6. Range and monotonicity invariants.
  check(`${sample.id}: base score in range`, baseScore >= 0 && baseScore <= 100, `${baseScore}`);
  check(
    `${sample.id}: guardrails never raise the score`,
    guardrails.score <= baseScore + 0.001,
    `base ${baseScore} -> ${guardrails.score}`,
  );
  check(`${sample.id}: final score in range`, guardrails.score >= 0 && guardrails.score <= 100);
  check(`${sample.id}: confidence in range`, confidence >= 0 && confidence <= 1, `${confidence}`);
  for (const dimension of dimensions) {
    check(
      `${sample.id}: ${dimension.key} in range`,
      dimension.score >= 0 && dimension.score <= 100,
      `${dimension.score}`,
    );
  }

  // 3. Reasoned criticism must never be scored as toxic.
  if (sample.groundTruth.criticalButConstructive) {
    check(
      `${sample.id}: reasoned criticism is not scored as toxic`,
      byKey.toxicity.score >= EQS_SCORING_CONFIG.guardrails.toxicity.warnBelow,
      `toxicity ${byKey.toxicity.score}`,
    );
    check(
      `${sample.id}: reasoned criticism does not trip the toxicity cap`,
      !guardrails.applications.some((entry) => entry.code === "TOXICITY_CAP"),
    );
  }

  // 4. Explicit abuse must always trip the toxicity guardrail.
  if (sample.groundTruth.toxic && sample.category === "toxicity") {
    check(
      `${sample.id}: abuse trips the toxicity guardrail`,
      guardrails.applications.some((entry) => entry.code === "TOXICITY_CAP"),
      `toxicity ${byKey.toxicity.score}`,
    );
  }

  // 7. The AI signal can never cost more than its configured cap.
  const aiPenalty = guardrails.applications.find(
    (entry) => entry.code === "AI_ASSISTANCE_SIGNAL_PENALTY",
  );
  if (aiPenalty) {
    check(
      `${sample.id}: AI penalty respects its cap`,
      aiPenalty.before - aiPenalty.after <= EQS_SCORING_CONFIG.guardrails.aiAssistance.maxPenalty + 0.01,
      `${aiPenalty.before} -> ${aiPenalty.after}`,
    );
  }

  // Explanation and the legacy projection must both be well-formed.
  const explanation = buildExplanation({
    dimensions: byKey,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    language: language as any,
    interpretation: null,
    guardrails: guardrails.applications,
    eqs: guardrails.score,
  });
  check(`${sample.id}: explanation has a summary`, explanation.summary.length > 0);
  check(`${sample.id}: explanation lists strengths`, explanation.strengths.length > 0);

  const legacy = toLegacyAttributes(dimensions);
  check(
    `${sample.id}: legacy projection covers all dimensions`,
    legacy.length === EQS_DIMENSION_KEYS.length,
    `${legacy.length}`,
  );
  check(
    `${sample.id}: legacy weights are positive`,
    legacy.every((attribute) => attribute.weight > 0),
  );

  rows.push({
    id: sample.id,
    category: sample.category,
    expected: sample.groundTruth.band,
    eqs: Math.round(guardrails.score * 10) / 10,
    band: getBandLabel(guardrails.score),
    toxicity: byKey.toxicity.score,
    sarcasm: byKey.sarcasm_intent.score,
    ai: byKey.ai_assistance.score,
    guardrails: guardrails.applications.map((entry) => entry.code),
  });
}

// 5. Spam detection.
const spamProbe = runFastChecks({
  title: "Free betting tips",
  content:
    "CLICK HERE for guaranteed profit!!!! DM me on whatsapp or telegram to double your money. Limited offer, bet now! Visit https://a.example and https://b.example. Earn money from home!",
});
check("spam probe detects spam", spamProbe.spamDetected);
check(
  "spam probe raises a critical flag",
  spamProbe.component.flags.some((flag) => flag.code === "SPAM_PATTERNS" && flag.severity === "critical"),
);

const cleanProbe = runFastChecks({
  title: "Middle overs analysis",
  content: samples.find((sample) => sample.id === "eqs-hq-001")!.content,
});
check("clean article is not flagged as spam", !cleanProbe.spamDetected);
check("clean article is not flagged as abusive", !cleanProbe.abuseDetected);

// ── Report ──────────────────────────────────────────────────────────
console.log("");
console.log(
  ["id", "category", "exp", "eqs", "band", "tox", "sarc", "ai", "guardrails"]
    .map((header, index) => header.padEnd([14, 20, 7, 6, 13, 6, 6, 6, 0][index]))
    .join(""),
);
for (const row of rows) {
  console.log(
    [
      row.id.padEnd(14),
      row.category.padEnd(20),
      row.expected.padEnd(7),
      String(row.eqs).padEnd(6),
      row.band.padEnd(13),
      String(row.toxicity).padEnd(6),
      String(row.sarcasm).padEnd(6),
      String(row.ai).padEnd(6),
      row.guardrails.join(",") || "-",
    ].join(""),
  );
}

console.log(`\n${samples.length} samples scored, ${failures} assertion failure(s).`);

if (failures > 0) {
  console.error(
    "\nSelf-test FAILED. Note this run uses the heuristic fallback path only; a failure here means the deterministic floor is wrong.",
  );
  process.exit(1);
}

console.log("Self-test PASSED (deterministic fallback path).");
