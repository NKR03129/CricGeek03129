/**
 * GET /api/eqs/config — the effective EQS configuration.
 *
 * Admin only. Exists for auditability (spec section 9): before comparing two
 * benchmark reports you need to know exactly which provider, model, weights, and
 * thresholds produced them. Never returns secrets, only whether they are present.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { describeEqsCache } from "@/lib/eqs/cache";
import { describeEqsConfiguration } from "@/lib/eqs/config";
import { EQS_SCHEMA_VERSION, ensureEqsTables } from "@/lib/eqs/db-schema";
import { errorMessage } from "@/lib/eqs/utils";
import { isAdminRole } from "@/lib/roles";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await auth();
    const user = session?.user as { role?: string } | undefined;

    if (!isAdminRole(user?.role)) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const schemaReady = await ensureEqsTables();

    return NextResponse.json({
      ...describeEqsConfiguration(),
      schema: { version: EQS_SCHEMA_VERSION, ready: schemaReady },
      cache: describeEqsCache(),
    });
  } catch (error) {
    console.error("[eqs] /api/eqs/config failed", error);
    return NextResponse.json(
      {
        error: "Failed to describe the EQS configuration",
        detail: process.env.NODE_ENV === "production" ? undefined : errorMessage(error),
      },
      { status: 500 },
    );
  }
}
