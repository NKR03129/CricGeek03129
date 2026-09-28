import { NextRequest, NextResponse } from "next/server";
import { paraphraseWithLocalModel } from "@/lib/local-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { title, content } = await req.json();

    if (!content || typeof content !== "string") {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const polishedContent = await paraphraseWithLocalModel({ title, content });

    return NextResponse.json({ polishedContent });
  } catch (error) {
    console.error("Paraphrase route failed", error);
    return NextResponse.json({ error: "Failed to polish content" }, { status: 500 });
  }
}
