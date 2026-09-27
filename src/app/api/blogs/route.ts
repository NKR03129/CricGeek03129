import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getDemoBlogs } from "@/lib/demo-data";
import { upsertExpressionEmbedding } from "@/lib/internal-originality";

// GET all approved blogs
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pageValue = Number.parseInt(searchParams.get("page") || "1", 10);
  const limitValue = Number.parseInt(searchParams.get("limit") || "10", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : 10;
  const tag = searchParams.get("tag");

  try {
    const where: Record<string, unknown> = { status: "approved" };
    if (tag) {
      where.tags = { contains: tag };
    }

    const [blogs, total] = await Promise.all([
      prisma.blog.findMany({
        where: {
          ...where,
          score: {
            is: {
              processingStatus: "completed",
            },
          },
        },
        include: {
          author: { select: { id: true, name: true, avatar: true } },
          _count: { select: { comments: true } },
          score: {
            select: {
              bqs: true,
              archetypeLabel: true,
              processingStatus: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.blog.count({ where }),
    ]);

    return NextResponse.json({
      blogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch {
    const demoBlogs = getDemoBlogs();
    const start = (page - 1) * limit;
    const pageBlogs = demoBlogs.slice(start, start + limit);

    return NextResponse.json({
      blogs: pageBlogs,
      pagination: {
        page,
        limit,
        total: demoBlogs.length,
        totalPages: Math.ceil(demoBlogs.length / limit),
      },
    });
  }
}

// POST new blog
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const sessionUser = session?.user as { id?: string } | undefined;
    if (!sessionUser?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { title, content, tags } = await req.json();
    const authorId = sessionUser.id;

    if (!title || !content || !authorId) {
      return NextResponse.json(
        { error: "Title and content are required" },
        { status: 400 }
      );
    }

    // Word count validation (50-2000 words)
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 50 || wordCount > 2000) {
      return NextResponse.json(
        { error: `Blog must be 50-2000 words. Current: ${wordCount} words` },
        { status: 400 }
      );
    }

    const slug =
      title
        .toLowerCase()
        .replace(/[^\w ]+/g, "")
        .replace(/ +/g, "-") +
      "-" +
      Date.now().toString(36);

    const blog = await prisma.blog.create({
      data: {
        title,
        content,
        excerpt: content.slice(0, 150) + "...",
        slug,
        tags: tags || "",
        authorId,
        status: "approved", // Auto-approve for now; enable moderation later
      },
    });

    try {
      await upsertExpressionEmbedding({ blogId: blog.id, title: blog.title, content: blog.content });
    } catch (embeddingError) {
      console.error("Embedding upsert failed after publish:", embeddingError);
    }

    return NextResponse.json(
      { message: "Expression submitted for review", blog },
      { status: 201 }
    );
  } catch (error) {
    console.error("Blog creation error:", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2003") {
        return NextResponse.json(
          {
            error: "Could not create blog because the author profile is not fully initialized.",
            detail: "Foreign key constraint failed while linking author.",
            code: error.code,
            meta: error.meta ?? null,
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          error: "Database request failed while creating blog.",
          detail: error.message,
          code: error.code,
          meta: error.meta ?? null,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to create blog",
        detail: error instanceof Error ? error.message : "Unknown server error",
      },
      { status: 500 }
    );
  }
}
