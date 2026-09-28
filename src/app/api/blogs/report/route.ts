import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { blogId, userId, reason, details } = await req.json();

    if (!blogId || !userId || !reason) {
      return NextResponse.json(
        { error: "blogId, userId, and reason are required" },
        { status: 400 }
      );
    }

    const report = await prisma.report.create({
      data: {
        blogId,
        userId,
        reason,
        details: details || null,
      },
    });

    return NextResponse.json(
      { message: "Report submitted", report },
      { status: 201 }
    );
  } catch (error) {
    console.error("Report error:", error);
    return NextResponse.json(
      { error: "Failed to submit report" },
      { status: 500 }
    );
  }
}
