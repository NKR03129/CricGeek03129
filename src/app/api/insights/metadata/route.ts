import { NextResponse } from "next/server";
import { forwardInsightsService } from "@/lib/ai-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.toString();
    const upstream = await forwardInsightsService(
      `/t20-insights/meta${query ? `?${query}` : ""}`,
      undefined,
      request
    );

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.contentType },
    });
  } catch (error) {
    console.error("Insights metadata proxy error:", error);
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "production"
            ? "Unable to reach the T20 insights service"
            : "Unable to reach the T20 insights service. Start it with `npm run dev:insights`.",
      },
      { status: 502 }
    );
  }
}
