import { NextRequest, NextResponse } from "next/server";
import { getOllamaHeaders, getOllamaUrl, OLLAMA_REQUEST_TIMEOUT_MS } from "@/lib/ollama";

const OLLAMA_URL = getOllamaUrl();
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3.5:latest";

export async function POST(req: NextRequest) {
  try {
    const { title, content } = await req.json();

    if (!content || content.trim().length < 20) {
      return NextResponse.json(
        { error: "Need at least some content to generate tags" },
        { status: 400 }
      );
    }

    // Truncate content to avoid huge prompts
    const truncatedContent = content.slice(0, 1000);

    const prompt = `You are a cricket blog tag generator. Given a blog title and content, generate exactly 4-6 relevant tags.

Rules:
- Tags must be lowercase, single words or short hyphenated phrases (e.g. "test-cricket", "ipl", "batting")
- Tags must be cricket-specific and relevant to the content
- Return ONLY a comma-separated list of tags, nothing else, no explanations, no JSON
- Good examples: analysis, ipl, test-cricket, india, batting, bowling, t20, world-cup, virat-kohli, bumrah

Blog Title: ${title || "Untitled"}
Blog Content: ${truncatedContent}

Tags:`;

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: getOllamaHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        think: false,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 60,
          stop: ["\n", ".", "Tags:", "Blog"],
        },
      }),
      signal: AbortSignal.timeout(OLLAMA_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Ollama error:", errText);
      return NextResponse.json(
        { error: "Ollama model returned an error", details: errText },
        { status: 502 }
      );
    }

    const data = await response.json();
    const rawOutput: string = data.response || "";

    // Parse and clean the tag list
    const tags = rawOutput
      .split(",")
      .map((t: string) =>
        t
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9\-]/g, "")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
      )
      .filter((t: string) => t.length > 1 && t.length < 30)
      .slice(0, 8); // max 8 tags

    if (tags.length === 0) {
      return NextResponse.json(
        { error: "Could not parse tags from model output", raw: rawOutput },
        { status: 500 }
      );
    }

    return NextResponse.json({ tags, raw: rawOutput });
  } catch (err: unknown) {
    const isTimeout =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    const isConnection =
      err instanceof Error && err.message.includes("ECONNREFUSED");

    if (isTimeout || isConnection) {
      return NextResponse.json(
        {
          error: isTimeout
            ? "Ollama took too long to respond"
            : "Could not connect to Ollama — is it running? Run: ollama serve",
          ollama_url: OLLAMA_URL,
        },
        { status: 503 }
      );
    }

    console.error("Tag generation error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
