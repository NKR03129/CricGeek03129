/**
 * Shared, cached entry point to the web/historical fact-check pipeline.
 *
 * The same draft is commonly checked two or three times in quick succession — the
 * editor preview, the publish flow, then `/api/scoring/analyze` running BQS and EQS
 * back to back. Keying by content hash removes the duplicate paid search calls
 * without changing any verdict (spec section 13: "cache reusable results to reduce
 * API calls and operating cost").
 *
 * Kept in its own module so both the BQS scorer and the EQS cricket-verification
 * stage can share it without either depending on the other.
 */

import { withCache } from "@/lib/eqs/cache";
import { runWebFactCheck, type WebFactCheckReport } from "@/lib/fact-check";
import { contentHash } from "@/lib/eqs/utils";

export function cachedWebFactCheck(input: {
  title?: string;
  content: string;
}): Promise<WebFactCheckReport> {
  return withCache(`web-fact-check:${contentHash(input)}`, () => runWebFactCheck(input));
}
