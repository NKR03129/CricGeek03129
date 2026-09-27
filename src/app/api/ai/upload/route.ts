import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "A file is required" }, { status: 400 });
    }

    if (!ALLOWED_IMAGE_TYPES.has((file as File).type)) {
      return NextResponse.json({ error: "Use a JPG, PNG, or WEBP image." }, { status: 415 });
    }

    const bytes = await (file as File).arrayBuffer();
    const buffer = Buffer.from(bytes);
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image must be 8MB or smaller after compression." }, { status: 413 });
    }

    const ext = path.extname((file as File).name || ".webp") || ".webp";
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);

    return NextResponse.json({ url: `/uploads/${filename}` });
  } catch (error) {
    console.error("Image upload route failed", error);
    return NextResponse.json({ error: "Image upload failed" }, { status: 500 });
  }
}
