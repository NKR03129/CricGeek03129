# 10 — EQS (Expression Quality Score)

## What EQS is

EQS evaluates the quality, credibility, expression, reasoning, originality, and
suitability of cricket content. It is **not** an AI detector, a sentiment score, or a
grammar checker.

The final score is produced only after the specialist component results are available.
It combines deterministic checks, structured AI output, cricket-stat verification,
plagiarism checks, and Writer DNA context.

### Core principles, and where each one is enforced

| Principle | Enforced by |
|---|---|
| No single signal decides whether an article is good or bad | Guardrails are *caps*, never fixed scores — [`scoring-engine.ts`](../src/lib/eqs/scoring-engine.ts) |
| Negative sentiment is not automatically poor quality | `sentiment` scores *appropriateness in context*, not polarity. Raw polarity is stored as evidence only |
| Positive wording is not automatically high quality | `sarcasm_intent` and `evidence_quality` are scored independently of tone |
| AI-generated probability is a signal, not a rejection rule | `ai_assistance` carries weight 0 and can only ever cost `guardrails.aiAssistance.maxPenalty` points |
| Cricket statistics must be verified separately | Owned by [`cricket-verification.ts`](../src/lib/eqs/stages/cricket-verification.ts); the language model is explicitly told not to judge stat correctness |
| Internal and external plagiarism are separate systems | Two modules, two component results, two database rows |

---

## Pipeline

| Stage | Purpose | Implementation |
|---|---|---|
| 1 | Article input and metadata | API route |
| 2 | Writer DNA | [`dna.ts`](../src/lib/eqs/dna.ts) + [`dna-weights.ts`](../src/lib/eqs/dna-weights.ts) |
| 3 | Fast checks | [`stages/fast-checks.ts`](../src/lib/eqs/stages/fast-checks.ts) |
| 4 | Language analysis | [`stages/language-analysis.ts`](../src/lib/eqs/stages/language-analysis.ts) |
| 5 | Claim extraction | [`stages/claim-extraction.ts`](../src/lib/eqs/stages/claim-extraction.ts) |
| 6 | Cricket verification | [`stages/cricket-verification.ts`](../src/lib/eqs/stages/cricket-verification.ts) |
| 7 | Internal plagiarism | [`stages/internal-plagiarism.ts`](../src/lib/eqs/stages/internal-plagiarism.ts) |
| 8 | External plagiarism | [`stages/external-plagiarism.ts`](../src/lib/eqs/stages/external-plagiarism.ts) |
| 9 | Component normalisation | `normaliseDimensions` in [`scoring-engine.ts`](../src/lib/eqs/scoring-engine.ts) |
| 10 | Final EQS | DNA weighting → [`stages/final-interpretation.ts`](../src/lib/eqs/stages/final-interpretation.ts) → guardrails |
| 11 | Output | [`service.ts`](../src/lib/eqs/service.ts) |

[`pipeline.ts`](../src/lib/eqs/pipeline.ts) sequences them. Stages 4, 5, 7, and 8 run
concurrently; stage 6 waits on stage 5's claims; stage 10 waits on everything.

**Key rule:** the final model receives only the *structured* results from the specialist
modules. It never sees raw stat or plagiarism findings to re-judge, and it cannot invent
them.

### Failure behaviour

Each stage is wrapped with its own timeout. A stage that fails or times out returns a
degraded `ComponentResult` with `status: "error" | "unavailable"` and a flag, and the
pipeline continues. The score still comes back — with lower **confidence**, which is the
honest signal that less of the pipeline ran.

If no language provider answers at all, the deterministic fast-check heuristics supply
every dimension. That path is the floor, not the target: it cannot read sarcasm in
context and it cannot detect fabricated stats or copied text, because those come from
the specialist systems. Confidence drops accordingly.

---

## The 13 evaluation dimensions

All are **0–100, higher is always better**.

| Key | Dimension | Owner |
|---|---|---|
| `originality` | Own information, interpretation, framing, expression | language analysis, scaled by both plagiarism systems |
| `expression_quality` | Clarity, readability, precision, sentence quality | language analysis |
| `coherence` | Logical flow, paragraph relationships | language analysis |
| `relevance_focus` | Topic connection; avoids filler and repetition | language analysis |
| `sentiment` | Whether emotional direction fits the argument in context | language analysis |
| `sarcasm_intent` | Sarcasm, mockery, literal vs intended meaning | language analysis |
| `toxicity` | Insults, harassment, targeted attacks. 100 = none | language analysis + fast checks |
| `constructive_criticism` | Explains a weakness vs attacking a person | language analysis |
| `reasoning` | Argument quality, cause/effect, inference | language analysis |
| `evidence_quality` | Whether claims are *supported* (not whether they are true) | language analysis |
| `statistical_claims` | Whether claims are *correct* | **cricket verification only** |
| `writer_dna_suitability` | Success against the writer's intended type | language analysis |
| `ai_assistance` | AI-generation indicators. 100 = reads as human | fast checks + language analysis |

`statistical_claims` is deliberately excluded from the model's remit. `ai_assistance`
is deliberately excluded from the weighted sum.

---

## Writer DNA and mixed profiles

EQS is DNA-aware because different cricket writers have different purposes.

DNA is resolved in this order:

1. explicit `dnaOverride` (used by the benchmark runner)
2. the writer's stored `WriterDNA` row
3. inferred from the article text (anonymous or brand-new writers)

The result is always a **normalised mix across all four profiles**, never a single
archetype. `buildDnaWeights` blends the four weight tables by that mix, so a writer who
is 60% analyst / 40% storyteller gets a genuinely blended weighting. A profile needs 45%
of the mix to be called dominant; below that the run is marked `mixed: true`.

Weights live in [`src/data/eqs-scoring-config.json`](../src/data/eqs-scoring-config.json),
not in code, and the blended weights are re-normalised to sum to exactly 1.

---

## Final scoring methodology

```
Article
  → Writer DNA
  → specialist analysis (stages 3-8, concurrent)
  → individual component results
  → normalisation                    (stage 9)
  → DNA/context weighting            → baseScore
  → final model interpretation       → bounded ±EQS_MAX_MODEL_ADJUSTMENT (default 6)
  → deterministic guardrails         → capped
  → Final EQS + confidence + explanation + flags
```

The model runs **before** the guardrails, so it can never talk a score past a hard
constraint, and its adjustment is clamped so runs stay reproducible.

### Guardrails

Each is a *ceiling*, so an article that trips one still keeps the ordering its other
dimensions earned below that ceiling.

| Code | Trigger | Default cap |
|---|---|---|
| `TOXICITY_CAP` | toxicity < 35, or explicit abuse detected | 45 |
| `SPAM_CAP` | spam/promotion patterns dominate | 30 |
| `INTERNAL_EXACT_MATCH_CAP` | ≥35% of the draft appears verbatim in CricGeek content | 40 |
| `INTERNAL_DUPLICATE_CAP` | vector similarity ≥ 0.85 | 45 |
| `EXTERNAL_PLAGIARISM_CAP` | provider matched ≥25% to outside sources | 45 |
| `STAT_CONTRADICTION_CAP` | ≥1 claim contradicted by trusted data | 60 |
| `STAT_CONTRADICTION_CAP_SEVERE` | ≥3 claims contradicted | 45 |
| `THIN_CONTENT_CAP` | under 60 words | 55 |
| `AI_ASSISTANCE_SIGNAL_PENALTY` | ai_assistance < 45 | bounded deduction, max 8 points |

Every guardrail that fires is recorded in `guardrails[]` — including when the score was
already under the cap, so the audit trail never claims "no guardrail needed" for an
abusive or plagiarised article.

### Confidence and human review

Confidence is the weight-weighted mean of per-dimension confidence, reduced for each
unavailable or errored component and again when a critical flag conflicts with a high
score. A run is routed to `/api/eqs/review-queue` when confidence drops below 0.5, a
guardrail demands it, or the model asks for it — the spec's "route low-confidence or
materially conflicting results to human review".

Note that a toxicity, plagiarism, or AI signal **flags** a post; it does not auto-reject
it. Publishing is not blocked by EQS.

---

## Specialist systems

### Cricket statistics verification

Claims are routed to trusted sources in order of authority:

1. the match scorecard from the cricket data API — strongest, requires the post to be
   linked to a match (`matchTag`)
2. the historical warehouse and web-search fact-check pipeline

Scorecard matching is shared with the BQS pipeline via
[`cricket-stat-match.ts`](../src/lib/cricket-stat-match.ts), so both scorers agree on
what "verified" means. Verdicts are three-way: `supported`, `contradicted`, or
`inconclusive`. Only a **contradiction** pulls the score down — "the scorecard has
nothing on this player" is not evidence against the writer.

When nothing can be resolved, `statistical_claims` stays neutral at 75 and confidence
drops, rather than punishing a writer for an infrastructure gap.

### Internal plagiarism

Both mechanisms the spec requires:

- **vector similarity** — hashed embeddings over the `ExpressionEmbedding` table find
  the nearest neighbours cheaply
- **exact matching** — 8-word shingle overlap against those neighbours' real text,
  producing the actual matched passage as evidence

### External plagiarism

A genuinely separate system calling a dedicated provider. Unconfigured, it reports
`unavailable` and the pipeline continues. Set `EXTERNAL_PLAGIARISM_API_URL` to your
provider's scan endpoint (or a thin adapter of your own); the response reader accepts
the field names used by the common vendors. Provider evidence is stored verbatim rather
than re-derived locally.

---

## Structured intermediate results

Every module returns a `ComponentResult`:

| Field | Purpose |
|---|---|
| `component` | Module name |
| `score` | Normalised 0–100, or `null` where not applicable |
| `confidence` | 0–1 confidence in this result |
| `evidence` | Module-specific supporting evidence |
| `flags` | Issues requiring attention, with severity |
| `claims` | Extracted claims and verification state |
| `source` | Provider or module |
| `version` | Model, rule, or API version |
| `status` | `ok` / `unavailable` / `error` / `skipped` |
| `durationMs` | Stage latency |

---

## Model configuration

The primary language-analysis model is **Gemini**, kept configurable so newer or cheaper
models can be benchmarked later.

```ini
EQS_PROVIDER=auto              # auto | gemini | ollama | heuristic
GEMINI_API_KEY=...
GEMINI_EQS_MODEL=gemini-3.5-flash
GEMINI_EQS_FAST_MODEL=         # cheaper model for high-volume sub-tasks
```

> **Verify the model id before deploying.** `GEMINI_EQS_MODEL` defaults to
> `gemini-3.5-flash` because that is the id named in the technical spec, but Google's
> published Flash line has used 1.5 / 2.0 / 2.5 ids. If the id does not exist in your
> project, every Gemini call fails and the pipeline silently falls back to Ollama or to
> heuristics. Check `/api/health` → `checks.eqsPrimaryProvider` after configuring, and
> override the variable if your project exposes a different id.

`auto` walks Gemini → Ollama → heuristics and uses the first that is configured. **Pin
`EQS_PROVIDER` to a single value before comparing benchmark reports**, otherwise two
reports may not have used the same model.

Provider selection lives in [`providers/`](../src/lib/eqs/providers/); adding one means
implementing the `LanguageProvider` interface and adding it to the chain.

---

## Benchmark and calibration

```bash
curl "http://localhost:3000/api/eqs/benchmark?coverage=1"        # free, no scoring
curl "http://localhost:3000/api/eqs/benchmark?limit=10"          # admin, costs API calls
curl "http://localhost:3000/api/eqs/benchmark?category=sarcasm"  # one category
```

The labelled set is [`src/data/eqs-benchmark.json`](../src/data/eqs-benchmark.json).
It covers Fan / Analyst / Debater / Storyteller and mixed DNA, across nine categories:
high-quality human, sarcasm, strong criticism, toxicity, incorrect statistics, AI
paraphrasing, copied text, vague writing, and mixed quality.

The report measures band accuracy, mean absolute error, and **false positive / negative
rates** for sarcasm, toxicity, originality, plagiarism, stat verification, and the AI
signal. It also reports `criticismNotPenalised` — the spec's headline principle, checked
explicitly: reasoned criticism must not be scored as abuse.

Every report is stamped with the pipeline version, config version, and the models that
actually served the run, so two reports are only comparable when those match.

### Current state of the dataset

**The shipped set has 36 samples. The spec targets 200–500.** The harness, metrics, and
labelling schema are complete and production-ready; growing the set to target is
editorial work that needs human/editorial ground truth, which is exactly what the spec
asks for and is not something the code can generate for itself.

To extend it, append objects to the JSON using the existing `BenchmarkSample` shape —
`groundTruth.band` is the editorial quality judgement, and the boolean fields
(`sarcastic`, `toxic`, `criticalButConstructive`, `incorrectStats`, `aiAssisted`,
`plagiarised`, `vague`) drive the false-positive/negative metrics. `describeBenchmarkCoverage()`
reports progress against the 200-sample target.

Two dataset notes:

- the `copied-text` samples only trip plagiarism detection once their source articles
  are in the corpus with embeddings; they document the exact-match path
- the `incorrect-stats` samples need `SPORTMONKS_API_TOKEN` or `TAVILY_API_KEY`
  configured, otherwise there is no trusted source to contradict them

### Offline self-test

```bash
npm run eqs:selftest
```

Runs the deterministic core against every benchmark sample with no database, no API
keys, and no network. It asserts the invariants that must hold regardless of provider:
weight tables sum to 1, blended mixed weights sum to 1, guardrails only ever lower a
score, scores stay in range, the AI penalty respects its cap, explicit abuse always
trips the toxicity cap, and **reasoned criticism never does**.

---

## API

| Endpoint | Method | Access | Purpose |
|---|---|---|---|
| `/api/ai/eqs` | POST | any | Score a draft. Not persisted unless `persist: true` |
| `/api/eqs/run` | POST | author or admin | Score a saved post and persist the full audit trail |
| `/api/eqs/[blogId]` | GET | any (`?audit=1` author/admin) | Stored breakdown with evidence |
| `/api/eqs/review-queue` | GET | admin | Runs routed to a human |
| `/api/eqs/benchmark` | GET | admin (`?coverage=1` open) | Calibration report |
| `/api/eqs/config` | GET | admin | Effective config, versions, weights, thresholds |

`/api/ai/eqs` keeps the legacy `overallEqs` / `weightedEqs` / `attributes` /
`originalityCheck` response fields so the existing publish UI is unaffected, and adds
the full breakdown alongside them.

`/api/scoring/analyze` runs BQS and then EQS. EQS runs second on purpose: both need the
web/historical fact-check, and running BQS first warms the content-hash cache so the
search is paid for once. An EQS failure there degrades to "BQS only" and is reported in
`eqsError`.

---

## Storage

See [05-DATABASE.md](05-DATABASE.md). In short: `EqsRun` holds the score and everything
needed to re-explain it; `EqsComponentResult`, `EqsClaim`, `EqsPlagiarismResult`, and
`EqsModelVersion` hold the per-module detail; `EqsAuditEvent` holds the processing trail;
`WriterDNAHistory` records the DNA mix that actually drove each score. `BlogScore` carries
a denormalised EQS summary so feed queries need no join.

Tables are created automatically on first use by `ensureEqsTables()`. To apply them by
hand instead, run [`prisma/eqs_migration.sql`](../prisma/eqs_migration.sql) and set
`EQS_AUTO_MIGRATE=false`.

---

## Changing production behaviour

Per the spec's engineering principles, in this order:

1. run the benchmark and save the report
2. change weights or thresholds in `src/data/eqs-scoring-config.json`
3. bump `configVersion` in that file
4. re-run the benchmark and compare against the saved report
5. confirm `criticismNotPenalised.failedIds` is still empty
6. only then deploy

`npm run eqs:selftest` is the fast pre-check; the full benchmark is the real gate.
