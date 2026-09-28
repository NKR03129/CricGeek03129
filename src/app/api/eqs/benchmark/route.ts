/**
 * GET /api/eqs/benchmark — run the calibration benchmark (spec section 9).
 *
 * Admin only: a full run scores every labelled sample through the live pipeline,
 * which costs real model and search calls.
 *
 * Query params:
 *   ?limit=10          cap the sample count for a smoke run
 *   ?category=sarcasm  restrict to one category
 *   ?fast=1            skip cricket verification and external plagiarism
 *   ?coverage=1        return dataset coverage only, without scoring anything
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  describeBenchmarkCoverage,
  runEqsBenchmark,
  type BenchmarkCategory,
} from "@/lib/eqs/benchmark";
import { errorMessage } from "@/lib/eqs/utils";
import { isAdminRole } from "@/lib/roles";

export const runtime = "nodejs";
export const maxDuration = 300;

const CATEGORIES: BenchmarkCategory[] = [
  "high-quality-human",
  "sarcasm",
  "strong-criticism",
  "toxicity",
  "incorrect-stats",
  "ai-paraphrase",
  "copied-text",
  "vague-writing",
  "mixed-quality",
];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Coverage is a cheap, read-only dataset description, so it needs no privileges.
    if (searchParams.get("coverage") === "1") {
      return NextResponse.json(describeBenchmarkCoverage());
    }

    const session = await auth();
    const user = session?.user as { role?: string } | undefined;

    if (!isAdminRole(user?.role)) {
      return NextResponse.json(
        { error: "Admin only. A benchmark run consumes model and search quota." },
        { status: 403 },
      );
    }

    const limitParam = Number(searchParams.get("limit"));
    const categoryParam = searchParams.get("category");

    if (categoryParam && !CATEGORIES.includes(categoryParam as BenchmarkCategory)) {
      return NextResponse.json(
        { error: `Unknown category. Expected one of: ${CATEGORIES.join(", ")}` },
        { status: 400 },
      );
    }

    const report = await runEqsBenchmark({
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
      category: (categoryParam as BenchmarkCategory | null) ?? undefined,
      fastMode: searchParams.get("fast") === "1",
    });

    return NextResponse.json({ ...report, coverage: describeBenchmarkCoverage() });
  } catch (error) {
    console.error("[eqs] Benchmark run failed", error);
    return NextResponse.json(
      {
        error: "Benchmark run failed",
        detail: process.env.NODE_ENV === "production" ? undefined : errorMessage(error),
      },
      { status: 500 },
    );
  }
}
