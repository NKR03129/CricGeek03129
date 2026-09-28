import type { Match } from "@/types/cricket";
import type { EdaConfidence, EdaConfidenceLabel, EdaFreshness, EdaSourceReference } from "@/types/eda";
import type { MetricConfidenceTier, MetricProvenance, MetricQuality, MetricReadiness, MetricUncertainty } from "@/types/metrics";

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function pct(part: number, total: number) {
  if (!total) return 0;
  return round((part / total) * 100, 1);
}

export function deriveMatchState(match: Match): EdaFreshness["matchState"] {
  if (match.matchEnded) return "completed";
  if (match.matchStarted) return "live";
  if (match.dateTimeGMT || match.date) return "scheduled";
  return "unknown";
}

export function deriveCompetitionLabel(match: Match) {
  const competitionMatch = match.name.match(/\(([^)]+)\)\s*$/);
  return competitionMatch?.[1]?.trim() || null;
}

export function getScheduledOvers(matchType: string) {
  const raw = matchType.trim().toLowerCase();
  if (!raw) return null;

  if (raw.includes("t10")) return 10;
  if (raw.includes("t20") || raw.includes("it20")) return 20;
  if (raw.includes("odi") || raw.includes("one day")) return 50;

  return null;
}

export function warehouseMatchType(matchType: string) {
  const raw = matchType.trim().toUpperCase();
  if (raw === "TEST") return "TEST";
  if (raw === "ODI" || raw === "ODI-W") return "ODI";
  if (raw === "T20I" || raw === "IT20") return "T20I";
  if (raw.includes("T20")) return "T20";
  if (raw === "FC") return "FC";
  return raw;
}

export function confidenceLabel(score: number): EdaConfidenceLabel {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

export function buildConfidence(score: number, reasons: string[]): EdaConfidence {
  const normalized = clamp(round(score, 1), 0, 100);
  return {
    score: normalized,
    label: confidenceLabel(normalized),
    reasons,
  };
}

export function confidenceTierFromSample(
  sampleSize: number,
  thresholds: { medium: number; high: number } = { medium: 5, high: 12 }
): MetricConfidenceTier {
  if (sampleSize >= thresholds.high) return "high";
  if (sampleSize >= thresholds.medium) return "medium";
  return "low";
}

export function confidenceScoreFromSample(
  sampleSize: number,
  thresholds: { medium: number; high: number } = { medium: 5, high: 12 }
) {
  if (sampleSize <= 0) return 20;
  if (sampleSize >= thresholds.high) return 88;
  if (sampleSize >= thresholds.medium) return 66;
  return 42;
}

export function wilsonInterval(successes: number, total: number, z = 1.96): MetricUncertainty | null {
  if (total <= 0) return null;

  const p = clamp(successes / total, 0, 1);
  const z2 = z ** 2;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin =
    (z / denominator) * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total ** 2));

  return {
    label: "95% CI",
    lower: round(clamp(center - margin, 0, 1) * 100, 1),
    upper: round(clamp(center + margin, 0, 1) * 100, 1),
    unit: "%",
    decimals: 1,
  };
}

export function meanInterval(values: number[], z = 1.28, label = "80% CI"): MetricUncertainty | null {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length < 2) return null;

  const mean = average(valid);
  const variance = average(valid.map((value) => (value - mean) ** 2));
  const standardError = Math.sqrt(Math.max(variance, 0) / valid.length);
  const margin = z * standardError;

  return {
    label,
    lower: round(mean - margin, 1),
    upper: round(mean + margin, 1),
    decimals: 1,
  };
}

export function buildMetricQuality(input: {
  sampleSize?: number | null;
  provenance: MetricProvenance;
  confidence?: MetricConfidenceTier;
  confidenceScore?: number | null;
  warning?: string | null;
  suppressed?: boolean;
  uncertainty?: MetricUncertainty | null;
  readiness?: MetricReadiness | null;
}): MetricQuality {
  return {
    sampleSize: input.sampleSize ?? null,
    provenance: input.provenance,
    confidence:
      input.confidence ??
      (input.provenance === "observed"
        ? "high"
        : confidenceTierFromSample(Math.max(0, input.sampleSize ?? 0))),
    confidenceScore:
      input.confidenceScore ??
      (input.provenance === "observed"
        ? 95
        : confidenceScoreFromSample(Math.max(0, input.sampleSize ?? 0))),
    warning: input.warning ?? null,
    suppressed: input.suppressed ?? false,
    uncertainty: input.uncertainty ?? null,
    readiness: input.readiness ?? null,
  };
}

export function lowSampleWarning(
  sampleSize: number,
  thresholds: { medium: number; high: number } = { medium: 5, high: 12 }
) {
  if (sampleSize >= thresholds.high) return null;
  if (sampleSize >= thresholds.medium) {
    return `Moderate evidence only: based on ${sampleSize} comparable observations.`;
  }
  if (sampleSize > 0) {
    return `Low-data metric: based on just ${sampleSize} comparable observations.`;
  }
  return "No supporting observations were available.";
}

export function shrinkRate(
  successes: number,
  total: number,
  priorRate: number,
  priorStrength: number
) {
  if (total <= 0) {
    return clamp(priorRate, 0, 1);
  }

  const priorSuccesses = clamp(priorRate, 0, 1) * Math.max(priorStrength, 0);
  return clamp((successes + priorSuccesses) / (total + Math.max(priorStrength, 0)), 0, 1);
}

export function buildFreshness(input: {
  match: Match;
  historicalAvailable: boolean;
  newsUpdatedAt?: string | null;
  notes?: string[];
}): EdaFreshness {
  return {
    generatedAt: new Date().toISOString(),
    matchState: deriveMatchState(input.match),
    historicalAvailable: input.historicalAvailable,
    newsUpdatedAt: input.newsUpdatedAt ?? null,
    notes: input.notes ?? [],
  };
}

export function dedupeSources<T extends EdaSourceReference>(sources: T[]): T[] {
  const seen = new Set<string>();
  const output: T[] = [];

  for (const source of sources) {
    const key = `${source.type}:${source.url || source.title}:${source.note}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(source);
  }

  return output;
}

export function inferPhase(overOrOvers: number, matchType?: string) {
  const over = Math.floor(overOrOvers);
  const scheduledOvers = matchType ? getScheduledOvers(matchType) : null;

  if (scheduledOvers === 10) {
    if (over < 3) return "Powerplay";
    if (over < 8) return "Middle";
    return "Death";
  }

  if (scheduledOvers === 20) {
    if (over < 6) return "Powerplay";
    if (over < 16) return "Middle";
    return "Death";
  }

  if (scheduledOvers === 50) {
    if (over < 10) return "Powerplay";
    if (over < 40) return "Middle";
    return "Death";
  }

  if (scheduledOvers) {
    const progress = overOrOvers / scheduledOvers;
    if (progress < 0.25) return "Opening phase";
    if (progress < 0.8) return "Middle phase";
    return "Closing phase";
  }

  if (over < 15) return "Opening spell";
  if (over < 60) return "Middle spell";
  return "Old-ball spell";
}
