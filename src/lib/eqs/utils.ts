/** Small shared helpers for the EQS pipeline. */

import { createHash, randomBytes } from "node:crypto";

/**
 * Collision-resistant, sortable id that fits the VARCHAR(30) primary keys used
 * across this schema. Rows are written with raw SQL, so Prisma's `cuid()` default
 * is not available here.
 */
export function createShortId(prefix = "e"): string {
  const timePart = Date.now().toString(36);
  const randomPart = randomBytes(8).toString("hex");
  return `${prefix}${timePart}${randomPart}`.slice(0, 30);
}

export function clamp0to100(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

export function clamp0to1(value: unknown, fallback = 0.5): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function contentHash(input: { title?: string; content: string }): string {
  return createHash("sha256")
    .update(`${(input.title || "").trim()}\u0000${input.content.trim()}`)
    .digest("hex");
}

export function normaliseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

export function splitSentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function splitParagraphs(value: string): string[] {
  return value
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function truncate(value: string, max: number): string {
  const normalised = normaliseWhitespace(value);
  return normalised.length <= max ? normalised : `${normalised.slice(0, Math.max(0, max - 1))}…`;
}

export function countPatternHits(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance);
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Runs `task` with a hard deadline.
 *
 * The task is given an AbortSignal so it can cancel its own in-flight work, but the
 * returned promise also *races* the deadline. That matters: a stage whose underlying
 * library ignores the signal would otherwise hold the whole pipeline open well past
 * its budget. Racing guarantees the caller gets control back on time; the abandoned
 * task is already aborted and its result is discarded.
 */
export async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const forwardAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason ?? "EQS_PARENT_ABORT");
    }
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      forwardAbort();
    } else {
      parentSignal.addEventListener("abort", forwardAbort, { once: true });
    }
  }

  const deadline = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort("EQS_STAGE_TIMEOUT");
      reject(new TimeoutError(`Stage exceeded its ${timeoutMs}ms budget`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task(controller.signal), deadline]);
  } finally {
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener("abort", forwardAbort);
    // Stop a still-running task from holding resources after we stopped waiting.
    if (!controller.signal.aborted) controller.abort("EQS_STAGE_SETTLED");
  }
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof TimeoutError || isAbortError(error);
}

/**
 * Builds a signal that aborts after `timeoutMs`, or as soon as `parentSignal` does.
 *
 * Used for an overall ceiling around work made up of several independently budgeted
 * steps, where the sum of the step budgets can exceed what the caller allows. The
 * timer is unref'd so a caller that forgets `dispose()` cannot hold the process open.
 */
export function createLinkedTimeoutSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
  reason = "TIMEOUT",
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => controller.abort(reason), timeoutMs);
  // `unref` exists on Node's Timeout, not on the DOM's numeric handle.
  (timeoutId as unknown as { unref?: () => void }).unref?.();

  const forwardAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason ?? "PARENT_ABORT");
    }
  };

  if (parentSignal) {
    if (parentSignal.aborted) forwardAbort();
    else parentSignal.addEventListener("abort", forwardAbort, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", forwardAbort);
    },
  };
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return error instanceof Error && error.name === "AbortError";
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}
