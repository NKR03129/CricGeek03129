import { NextRequest, NextResponse } from "next/server";
import calibrationSamples from "@/data/bqs-calibration.json";
import { runScoringPipeline } from "@/lib/scoring";

type CalibrationSample = {
  id: string;
  title: string;
  content: string;
  expectedArchetype: "analyst" | "fan" | "storyteller" | "debater";
  expectedBqsBand: "low" | "medium" | "high";
  expectedToxicity: "low" | "medium" | "high";
};

const samples = calibrationSamples as CalibrationSample[];

function bandTarget(band: CalibrationSample["expectedBqsBand"]) {
  if (band === "high") return 82;
  if (band === "medium") return 62;
  return 28;
}

function toxicityBand(score: number): CalibrationSample["expectedToxicity"] {
  if (score >= 55) return "high";
  if (score >= 22) return "medium";
  return "low";
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(60, Number(searchParams.get("limit") || samples.length)));
    const selected = samples.slice(0, limit);

    const results = [];
    let archetypeMatches = 0;
    let toxicityMatches = 0;
    let totalBqsError = 0;
    let overrideCount = 0;

    for (const sample of selected) {
      const score = await runScoringPipeline({
        title: sample.title,
        content: sample.content,
      });

      const expectedTarget = bandTarget(sample.expectedBqsBand);
      const bqsError = Math.abs(score.bqs - expectedTarget);
      const archetypeMatch = score.modelScores.archetypeLabel === sample.expectedArchetype;
      const toxicityMatch = toxicityBand(score.modelScores.toxicityScore) === sample.expectedToxicity;

      if (archetypeMatch) archetypeMatches += 1;
      if (toxicityMatch) toxicityMatches += 1;
      if (score.ruleEngine.toxicityPenaltyOverride) overrideCount += 1;
      totalBqsError += bqsError;

      results.push({
        id: sample.id,
        expected: {
          archetype: sample.expectedArchetype,
          bqsBand: sample.expectedBqsBand,
          toxicity: sample.expectedToxicity,
        },
        actual: {
          bqs: score.bqs,
          archetype: score.modelScores.archetypeLabel,
          negativity: score.modelScores.negativityScore,
          toxicity: score.modelScores.toxicityScore,
          override: score.ruleEngine.toxicityPenaltyOverride,
        },
        matches: {
          archetype: archetypeMatch,
          toxicity: toxicityMatch,
        },
        bqsError,
      });
    }

    return NextResponse.json({
      model: process.env.OLLAMA_BQS_MODEL || process.env.OLLAMA_MODEL || "qwen3.5:latest",
      datasetSize: selected.length,
      summary: {
        archetypeAccuracy: Number(((archetypeMatches / selected.length) * 100).toFixed(1)),
        toxicityBandAccuracy: Number(((toxicityMatches / selected.length) * 100).toFixed(1)),
        averageBqsError: Number((totalBqsError / selected.length).toFixed(2)),
        overrideCount,
      },
      results,
    });
  } catch (error) {
    console.error("Scoring validation error:", error);
    return NextResponse.json({ error: "Validation runner failed" }, { status: 500 });
  }
}
