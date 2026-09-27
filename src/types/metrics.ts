export type MetricConfidenceTier = "high" | "medium" | "low";
export type MetricProvenance = "observed" | "historical" | "blended" | "modeled" | "inferred";

export interface MetricUncertainty {
  label: string;
  lower: number;
  upper: number;
  unit?: string | null;
  decimals?: number;
}

export interface MetricReadiness {
  label: string;
  current: number;
  required: number;
  unit: string;
}

export interface MetricQuality {
  sampleSize?: number | null;
  confidence?: MetricConfidenceTier;
  confidenceScore?: number | null;
  warning?: string | null;
  suppressed?: boolean;
  uncertainty?: MetricUncertainty | null;
  provenance?: MetricProvenance;
  readiness?: MetricReadiness | null;
}
