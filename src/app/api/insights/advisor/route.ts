import { NextRequest, NextResponse } from "next/server";
import { forwardInsightsService } from "@/lib/ai-service";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const upstream = await forwardInsightsService(
      "/t20-insights/advisor",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      },
      request
    );

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.contentType },
    });
  } catch (error) {
    console.error("Insights advisor proxy error:", error);
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
