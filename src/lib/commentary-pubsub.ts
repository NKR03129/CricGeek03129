/**
 * In-memory pub/sub for SSE commentary streaming.
 * Each session has a set of subscriber callbacks.
 * For multi-instance deployments, replace with Redis Pub/Sub.
 */

type Subscriber = (entry: CommentaryEvent) => void;

export interface CommentaryEvent {
  id: string;
  sessionId: string;
  text: string;
  overText: string | null;
  source: string;
  createdAt: string;
}

const channels = new Map<string, Set<Subscriber>>();

export function subscribe(sessionId: string, callback: Subscriber): () => void {
  if (!channels.has(sessionId)) {
    channels.set(sessionId, new Set());
  }
  channels.get(sessionId)!.add(callback);

  // Return unsubscribe function
  return () => {
    const subs = channels.get(sessionId);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) channels.delete(sessionId);
    }
  };
}

export function publish(sessionId: string, event: CommentaryEvent): void {
  const subs = channels.get(sessionId);
  if (subs) {
    for (const cb of subs) {
      try {
        cb(event);
      } catch {
        // Subscriber errored — ignore (stale connection)
      }
    }
  }
}

export function getSubscriberCount(sessionId: string): number {
  return channels.get(sessionId)?.size ?? 0;
}
