/**
 * Shared contracts for the EQS (Expression Quality Score) pipeline.
 *
 * Every specialist module returns a `ComponentResult` (spec section 7) so the final
 * scoring layer only ever consumes structured data — never prose, and never a
 * cricket-stat or plagiarism finding that it invented itself.
 */

export type EqsDnaProfile = "fan" | "analyst" | "debater" | "storyteller";

export const EQS_DNA_PROFILES: EqsDnaProfile[] = ["fan", "analyst", "debater", "storyteller"];

/** The 13 evaluation dimensions from spec section 5. All are 0-100, higher is better. */
export type EqsDimensionKey =
  | "originality"
  | "expression_quality"
  | "coherence"
  | "relevance_focus"
  | "sentiment"
  | "sarcasm_intent"
  | "toxicity"
  | "constructive_criticism"
  | "reasoning"
  | "evidence_quality"
  | "statistical_claims"
  | "writer_dna_suitability"
  | "ai_assistance";

export const EQS_DIMENSION_KEYS: EqsDimensionKey[] = [
  "originality",
  "expression_quality",
  "coherence",
  "relevance_focus",
  "sentiment",
  "sarcasm_intent",
  "toxicity",
  "constructive_criticism",
  "reasoning",
  "evidence_quality",
  "statistical_claims",
  "writer_dna_suitability",
  "ai_assistance",
];

/**
 * Dimensions the language model is allowed to score. `statistical_claims` is
 * excluded on purpose: it is owned by the cricket-verification module, because the
 * spec forbids the model from inventing stat findings.
 */
export const MODEL_SCORED_DIMENSIONS: EqsDimensionKey[] = EQS_DIMENSION_KEYS.filter(
  (key) => key !== "statistical_claims",
);

export const EQS_DIMENSION_LABELS: Record<EqsDimensionKey, string> = {
  originality: "Originality",
  expression_quality: "Expression quality",
  coherence: "Coherence",
  relevance_focus: "Relevance & focus",
  sentiment: "Sentiment",
  sarcasm_intent: "Sarcasm & intent",
  toxicity: "Toxicity / personal attacks",
  constructive_criticism: "Constructive criticism",
  reasoning: "Reasoning",
  evidence_quality: "Evidence quality",
  statistical_claims: "Statistical claims",
  writer_dna_suitability: "Writer-DNA suitability",
  ai_assistance: "AI assistance signal",
};

export const EQS_DIMENSION_DESCRIPTIONS: Record<EqsDimensionKey, string> = {
  originality:
    "Whether the article adds its own information, interpretation, framing, or expression rather than merely reproducing a source.",
  expression_quality:
    "Clarity, readability, precision, vocabulary, sentence quality, and communication of the intended point.",
  coherence:
    "Logical flow, paragraph relationships, beginning/middle/end where applicable, and absence of confusing jumps.",
  relevance_focus: "Connection to the topic; avoidance of filler, repetition, and vague statements.",
  sentiment:
    "How well the emotional direction fits the argument in context. Never a positive=good / negative=bad rule.",
  sarcasm_intent:
    "Contextual understanding of sarcasm, mockery, rhetorical language, and literal-vs-intended meaning.",
  toxicity: "Insults, harassment, abusive language, targeted attacks, or unnecessarily hostile expression.",
  constructive_criticism:
    "Whether criticism explains a weakness or disagreement rather than merely attacking a person.",
  reasoning: "Quality of arguments, cause/effect logic, comparisons, inference, and explanation.",
  evidence_quality:
    "Whether important claims are supported by statistics, examples, references, or clear reasoning.",
  statistical_claims: "Claims verified separately against trusted cricket data sources.",
  writer_dna_suitability: "Whether the article succeeds according to its intended writer type.",
  ai_assistance:
    "Likelihood of AI-generated or AI-assisted content. Treated only as a signal, never as a rejection rule.",
};

export type EqsComponentName =
  | "fast-checks"
  | "language-analysis"
  | "claim-extraction"
  | "cricket-verification"
  | "internal-plagiarism"
  | "external-plagiarism";

export type ComponentStatus = "ok" | "unavailable" | "error" | "skipped";

export type FlagSeverity = "info" | "warn" | "critical";

export interface EqsFlag {
  code: string;
  severity: FlagSeverity;
  message: string;
  component: EqsComponentName | "scoring-engine";
}

export type ClaimType = "player_stat" | "team_stat" | "match_event" | "record" | "general";

export type ClaimVerificationStatus = "supported" | "contradicted" | "inconclusive" | "unverified";

export interface EqsClaim {
  id: string;
  text: string;
  type: ClaimType;
  player: string | null;
  metric: string | null;
  value: number | null;
  timeframe: string | null;
  requiresVerification: boolean;
  status: ClaimVerificationStatus;
  /** Which verification route produced the status, e.g. "live-scorecard", "historical-warehouse", "web-search". */
  verificationSource: string | null;
  provider: string | null;
  evidence: string[];
  verifiedAt: string | null;
}

/**
 * The common structured shape every specialist module returns (spec section 7).
 *
 * `TEvidence` defaults to `unknown` so a heterogeneous `ComponentResult[]` stays
 * assignable; consumers narrow the evidence with the component's own evidence type.
 */
export interface ComponentResult<TEvidence = unknown> {
  component: EqsComponentName;
  /** Normalized 0-100 where applicable, or null when the component does not produce a score. */
  score: number | null;
  /** 0-1 confidence in this component's own result. */
  confidence: number;
  evidence: TEvidence;
  flags: EqsFlag[];
  claims?: EqsClaim[];
  /** Provider or module that produced the result. */
  source: string;
  /** Model, rule, or API version used. */
  version: string;
  status: ComponentStatus;
  durationMs: number;
  error?: string;
}

export interface EqsDimensionResult {
  key: EqsDimensionKey;
  label: string;
  score: number;
  confidence: number;
  explanation: string;
  /** DNA-blended weight applied to this dimension. `ai_assistance` is 0 because it is a bounded signal. */
  weight: number;
  /** Which component produced this dimension score. */
  source: EqsComponentName;
}

export interface EqsDnaContext {
  /** Normalized 0-1 mix across the four profiles. Supports mixed profiles (spec section 4). */
  mix: Record<EqsDnaProfile, number>;
  /** Highest-weighted profile, for display only. */
  dominant: EqsDnaProfile;
  /** True when no single profile holds a clear majority. */
  mixed: boolean;
  /** Where the mix came from. */
  source: "writer-profile" | "request-override" | "content-inference" | "default";
}

export interface EqsGuardrailApplication {
  code: string;
  reason: string;
  /** Score before this guardrail ran. */
  before: number;
  /** Score after this guardrail ran. */
  after: number;
}

export interface EqsExplanation {
  summary: string;
  strengths: string[];
  concerns: string[];
  /** Explicitly separates criticism from abuse, per the spec's core principles. */
  sentimentVsToxicity: string;
  guardrailDecision: string;
  userVisibleBreakdown: string[];
}

export interface EqsModelVersionRecord {
  stage: string;
  provider: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
  status: ComponentStatus;
}

/** Legacy attribute shape kept so existing `/api/ai/eqs` consumers keep working. */
export interface EqsLegacyAttribute {
  name: string;
  score: number;
  explanation: string;
  weight: number;
}

export interface EqsResult {
  /** Final DNA-aware, guardrailed score, 0-100. */
  eqs: number;
  /** 0-1 confidence in the final score. */
  confidence: number;
  band: string;
  dimensions: EqsDimensionResult[];
  components: ComponentResult[];
  claims: EqsClaim[];
  flags: EqsFlag[];
  guardrails: EqsGuardrailApplication[];
  writerDna: EqsDnaContext;
  explanation: EqsExplanation;
  requiresHumanReview: boolean;
  humanReviewReasons: string[];
  /** Weighted score before the model interpretation and guardrail layers ran. */
  baseScore: number;
  pipelineVersion: string;
  scoringConfigVersion: string;
  modelVersions: EqsModelVersionRecord[];
  contentHash: string;
  timings: Record<string, number>;
  processingTimeMs: number;
  /** Backwards-compatible projection for the existing publish-flow UI. */
  overallEqs: number;
  weightedEqs: number;
  attributes: EqsLegacyAttribute[];
}

export interface EqsPipelineInput {
  title?: string;
  content: string;
  /** Cricket match id used to verify stats against a live/completed scorecard. */
  matchId?: string | null;
  /** Writer whose stored DNA profile drives the weighting. */
  writerId?: string | null;
  /** Blog being scored, when scoring an already-persisted expression. */
  blogId?: string | null;
  /** Explicit DNA mix override, used by the benchmark runner. */
  dnaOverride?: Partial<Record<EqsDnaProfile, number>> | null;
  signal?: AbortSignal;
  /** Skip the paid/slow specialist calls. Used for fast in-editor previews. */
  fastMode?: boolean;
}
