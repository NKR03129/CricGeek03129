import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";

async function requireAdmin() {
  const session = await auth();
  const user = session?.user as { role?: string } | undefined;

  return user?.role === "admin";
}

// GET all blogs for admin (any status)
export async function GET(req: NextRequest) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "pending";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    const where: Record<string, unknown> = {};
    if (status !== "all") where.status = status;

    const [blogs, total] = await Promise.all([
      prisma.blog.findMany({
        where,
        include: {
          author: { select: { id: true, name: true, email: true } },
          _count: { select: { comments: true, reports: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.blog.count({ where }),
    ]);

    return NextResponse.json({ blogs, total });
  } catch (error) {
    console.error("Admin blog fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch blogs" },
      { status: 500 }
    );
  }
}

// PATCH - update blog status
export async function PATCH(req: NextRequest) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const { blogId, status } = await req.json();

    if (!blogId || !status) {
      return NextResponse.json(
        { error: "blogId and status are required" },
        { status: 400 }
      );
    }

    if (!["approved", "rejected", "featured", "pending"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 }
      );
    }

    const blog = await prisma.blog.update({
      where: { id: blogId },
      data: { status },
    });

    return NextResponse.json({ message: "Blog updated", blog });
  } catch (error) {
    console.error("Admin blog update error:", error);
    return NextResponse.json(
      { error: "Failed to update blog" },
      { status: 500 }
    );
  }
}
