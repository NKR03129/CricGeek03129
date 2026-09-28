/**
 * GET /api/eqs/[blogId] — the stored EQS breakdown for an expression.
 *
 * Returns the persisted run with its component results, claims, plagiarism findings,
 * and model versions, so a score can be explained long after it was produced
 * (spec section 13: "store evidence and version information").
 *
 * Add `?audit=1` to include the processing event trail (author or admin only).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listAuditEvents } from "@/lib/eqs/audit";
import { getLatestEqsRunForBlog } from "@/lib/eqs/persistence";
import { errorMessage } from "@/lib/eqs/utils";
import { isAdminRole } from "@/lib/roles";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ blogId: string }> }) {
  try {
    const { blogId } = await params;

    if (!blogId) {
      return NextResponse.json({ error: "blogId is required" }, { status: 400 });
    }

    const blog = await prisma.blog.findUnique({
      where: { id: blogId },
      select: { id: true, title: true, slug: true, status: true, authorId: true },
    });

    if (!blog) {
      return NextResponse.json({ error: "Expression not found" }, { status: 404 });
    }

    const run = await getLatestEqsRunForBlog(blogId);

    if (!run) {
      return NextResponse.json(
        {
          blogId,
          scored: false,
          message: "No EQS run has been stored for this expression yet. POST /api/eqs/run to score it.",
        },
        { status: 404 },
      );
    }

    const session = await auth().catch(() => null);
    const user = session?.user as { id?: string; role?: string } | undefined;
    const isPrivileged = Boolean(user?.id && (user.id === blog.authorId || isAdminRole(user.role)));

    const includeAudit = new URL(req.url).searchParams.get("audit") === "1";
    const auditEvents = includeAudit && isPrivileged ? await listAuditEvents({ runId: run.runId }) : undefined;

    return NextResponse.json({
      blogId,
      scored: true,
      expression: { id: blog.id, title: blog.title, slug: blog.slug, status: blog.status },
      run,
      ...(auditEvents ? { auditEvents } : {}),
      ...(includeAudit && !isPrivileged
        ? { auditNote: "Audit events are visible to the author and admins only." }
        : {}),
    });
  } catch (error) {
    console.error("[eqs] /api/eqs/[blogId] failed", error);
    return NextResponse.json(
      {
        error: "Failed to load the EQS breakdown",
        detail: process.env.NODE_ENV === "production" ? undefined : errorMessage(error),
      },
      { status: 500 },
    );
  }
}
