import { subscribe } from "@/lib/commentary-pubsub";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// GET /api/commentary/[sessionId]/stream — SSE endpoint for live updates
export async function GET(_request: Request, { params }: RouteParams) {
  const { sessionId } = await params;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ sessionId })}\n\n`)
      );

      // Send heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      // Subscribe to commentary events for this session
      const unsubscribe = subscribe(sessionId, (event) => {
        try {
          controller.enqueue(
            encoder.encode(`event: entry\ndata: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // Connection closed
          unsubscribe();
          clearInterval(heartbeat);
        }
      });

      // Clean up on abort (client disconnects)
      _request.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}
