/**
 * Process-local TTL cache for reusable component results (spec section 13).
 *
 * Scoped deliberately to a single server process: it removes the duplicate paid
 * calls that happen when the same draft is scored by the editor preview, the
 * publish flow, and `/api/scoring/analyze` in quick succession. It is not a
 * cross-instance cache, so correctness never depends on a hit.
 */

import { EQS_CACHE } from "@/lib/eqs/config";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

function evictIfNeeded() {
  if (store.size <= EQS_CACHE.maxEntries) return;

  // Map preserves insertion order, so the oldest keys come first.
  const overflow = store.size - EQS_CACHE.maxEntries;
  let removed = 0;
  for (const key of store.keys()) {
    store.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;

  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }

  return entry.value;
}

export function setCached<T>(key: string, value: T, ttlMs = EQS_CACHE.ttlMs): void {
  if (ttlMs <= 0) return;
  store.delete(key);
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  evictIfNeeded();
}

/**
 * Returns the cached value, or computes and caches it. Concurrent callers with the
 * same key share a single in-flight computation instead of duplicating the work.
 */
export async function withCache<T>(
  key: string,
  compute: () => Promise<T>,
  ttlMs = EQS_CACHE.ttlMs,
): Promise<T> {
  const cached = getCached<T>(key);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const promise = (async () => {
    try {
      const value = await compute();
      setCached(key, value, ttlMs);
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

export function clearEqsCache(): void {
  store.clear();
  inFlight.clear();
}

export function describeEqsCache() {
  return { entries: store.size, inFlight: inFlight.size, ttlMs: EQS_CACHE.ttlMs };
}
