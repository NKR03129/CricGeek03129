/**
 * POST /api/eqs/run — score a saved expression and persist the full audit trail.
 *
 * Unlike `/api/ai/eqs` (draft preview), this always persists: the run, its component
 * results, claims, plagiarism findings, model versions, and audit events.
 *
 * Access: the blog's author, or an admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { scoreExpression } from "@/lib/eqs/service";
import { errorMessage, isAbortError } from "@/lib/eqs/utils";
import { isAdminRole } from "@/lib/roles";

export const runtime = "nodejs";
export const maxDuration = 120;

const REQUEST_TIMEOUT_MS = 115_000;

export async function POST(req: NextRequest) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("EQS_RUN_TIMEOUT"), REQUEST_TIMEOUT_MS);

  try {
    const session = await auth();
    const user = session?.user as { id?: string; role?: string } | undefined;

    if (!user?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = (await req.json()) as { blogId?: unknown };
    const blogId = typeof body.blogId === "string" ? body.blogId.trim() : "";

    if (!blogId) {
      return NextResponse.json({ error: "blogId is required" }, { status: 400 });
    }

    const blog = await prisma.blog.findUnique({
      where: { id: blogId },
      select: { id: true, title: true, content: true, authorId: true, matchTag: true },
    });

    if (!blog) {
      return NextResponse.json({ error: "Expression not found" }, { status: 404 });
    }

    if (blog.authorId !== user.id && !isAdminRole(user.role)) {
      return NextResponse.json({ error: "Not allowed to score this expression" }, { status: 403 });
    }

    const { result, persistence } = await scoreExpression({
      title: blog.title,
      content: blog.content,
      matchId: blog.matchTag,
      blogId: blog.id,
      writerId: blog.authorId,
      persist: true,
      signal: controller.signal,
    });

    return NextResponse.json({
      blogId: blog.id,
      eqs: result.eqs,
      band: result.band,
      confidence: result.confidence,
      baseScore: result.baseScore,
      requiresHumanReview: result.requiresHumanReview,
      humanReviewReasons: result.humanReviewReasons,
      writerDna: result.writerDna,
      dimensions: result.dimensions,
      claims: result.claims,
      flags: result.flags,
      guardrails: result.guardrails,
      explanation: result.explanation,
      components: result.components,
      modelVersions: result.modelVersions,
      pipelineVersion: result.pipelineVersion,
      scoringConfigVersion: result.scoringConfigVersion,
      processingTimeMs: result.processingTimeMs,
      timings: result.timings,
      persistence,
    });
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      return NextResponse.json({ error: "EQS run timed out" }, { status: 504 });
    }

    console.error("[eqs] /api/eqs/run failed", error);
    return NextResponse.json(
      {
        error: "EQS run failed",
        detail: process.env.NODE_ENV === "production" ? undefined : errorMessage(error),
      },
      { status: 500 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
