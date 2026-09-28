/**
 * EQS audit trail (spec section 11 "Audit").
 *
 * Records processing events, failures, and retries so a score can be explained and
 * a bad run can be diagnosed after the fact. Writing an audit row must never be able
 * to fail a scoring request, so every call here swallows its own errors.
 */

import { prisma } from "@/lib/db";
import { EQS_FEATURES } from "@/lib/eqs/config";
import { ensureEqsTables } from "@/lib/eqs/db-schema";
import { createShortId, errorMessage, truncate } from "@/lib/eqs/utils";

export type AuditStatus = "ok" | "warn" | "error" | "timeout" | "skipped";

export interface AuditEvent {
  runId?: string | null;
  blogId?: string | null;
  stage: string;
  eventName: string;
  status?: AuditStatus;
  message?: string | null;
  detail?: unknown;
  durationMs?: number | null;
}

/** Buffers events for one pipeline run so they can be flushed in a single batch. */
export class AuditCollector {
  private readonly events: AuditEvent[] = [];

  constructor(
    private readonly context: { blogId?: string | null; requestId: string },
  ) {}

  record(event: Omit<AuditEvent, "blogId" | "runId">) {
    this.events.push({ ...event, blogId: this.context.blogId ?? null });

    if (event.status === "error" || event.status === "timeout") {
      console.warn(
        `[eqs:${this.context.requestId}] ${event.stage}/${event.eventName} ${event.status}: ${event.message ?? ""}`,
      );
    }
  }

  list(): AuditEvent[] {
    return [...this.events];
  }

  /** Persists everything collected so far, tagged with the run id. */
  async flush(runId: string | null): Promise<void> {
    if (!EQS_FEATURES.persistence || this.events.length === 0) return;

    const ready = await ensureEqsTables();
    if (!ready) return;

    for (const event of this.events) {
      await writeAuditEvent({ ...event, runId });
    }
  }
}

export async function writeAuditEvent(event: AuditEvent): Promise<void> {
  if (!EQS_FEATURES.persistence) return;

  try {
    const ready = await ensureEqsTables();
    if (!ready) return;

    await prisma.$executeRawUnsafe(
      `INSERT INTO dbo.EqsAuditEvent (id, runId, blogId, stage, eventName, status, message, detailJson, durationMs)
       VALUES (@P1, @P2, @P3, @P4, @P5, @P6, @P7, @P8, @P9)`,
      createShortId("a"),
      event.runId ?? null,
      event.blogId ?? null,
      truncate(event.stage, 60),
      truncate(event.eventName, 60),
      event.status ?? "ok",
      event.message ? truncate(event.message, 1000) : null,
      event.detail === undefined ? null : truncate(safeStringify(event.detail), 4000),
      typeof event.durationMs === "number" ? Math.round(event.durationMs) : null,
    );
  } catch (error) {
    console.error("[eqs] Failed to write audit event", errorMessage(error));
  }
}

export async function listAuditEvents(input: {
  runId?: string | null;
  blogId?: string | null;
  limit?: number;
}) {
  const ready = await ensureEqsTables();
  if (!ready) return [];

  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));

  if (input.runId) {
    return (await prisma.$queryRawUnsafe(
      `SELECT TOP (${limit}) id, runId, blogId, stage, eventName, status, message, detailJson, durationMs, createdAt
       FROM dbo.EqsAuditEvent WHERE runId = @P1 ORDER BY createdAt ASC`,
      input.runId,
    )) as unknown[];
  }

  if (input.blogId) {
    return (await prisma.$queryRawUnsafe(
      `SELECT TOP (${limit}) id, runId, blogId, stage, eventName, status, message, detailJson, durationMs, createdAt
       FROM dbo.EqsAuditEvent WHERE blogId = @P1 ORDER BY createdAt DESC`,
      input.blogId,
    )) as unknown[];
  }

  return (await prisma.$queryRawUnsafe(
    `SELECT TOP (${limit}) id, runId, blogId, stage, eventName, status, message, detailJson, durationMs, createdAt
     FROM dbo.EqsAuditEvent ORDER BY createdAt DESC`,
  )) as unknown[];
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return String(value);
  }
}
