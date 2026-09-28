/**
 * GET /api/eqs/review-queue — runs the pipeline routed to a human.
 *
 * Implements the spec's "route low-confidence or materially conflicting results to
 * human review" principle: instead of auto-rejecting on a toxicity, plagiarism, or
 * AI-assistance signal, the pipeline flags the run and it surfaces here.
 *
 * Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listRunsAwaitingReview } from "@/lib/eqs/persistence";
import { errorMessage } from "@/lib/eqs/utils";
import { isAdminRole } from "@/lib/roles";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const user = session?.user as { role?: string } | undefined;

    if (!isAdminRole(user?.role)) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const limitParam = Number(new URL(req.url).searchParams.get("limit"));
    const runs = await listRunsAwaitingReview(
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50,
    );

    return NextResponse.json({ count: runs.length, runs });
  } catch (error) {
    console.error("[eqs] /api/eqs/review-queue failed", error);
    return NextResponse.json(
      {
        error: "Failed to load the EQS review queue",
        detail: process.env.NODE_ENV === "production" ? undefined : errorMessage(error),
      },
      { status: 500 },
    );
  }
}
