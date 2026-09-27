import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { screenSubmittedWriting } from "@/lib/content-moderation";

interface CommentNode {
  id: string;
  content: string;
  blogId: string;
  authorId: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    name: string;
    avatar: string | null;
  };
  replies: CommentNode[];
}

function buildCommentTree(comments: Omit<CommentNode, "replies">[]): CommentNode[] {
  const byId = new Map<string, CommentNode>();
  const roots: CommentNode[] = [];

  for (const comment of comments) {
    byId.set(comment.id, { ...comment, replies: [] });
  }

  for (const comment of byId.values()) {
    if (comment.parentId) {
      const parent = byId.get(comment.parentId);
      if (parent) {
        parent.replies.push(comment);
        continue;
      }
    }
    roots.push(comment);
  }

  return roots;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const blog = await prisma.blog.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });

    if (!blog || blog.status !== "approved") {
      return NextResponse.json({ error: "Blog not found" }, { status: 404 });
    }

    const comments = await prisma.comment.findMany({
      where: { blogId: blog.id },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      comments: buildCommentTree(
        comments.map((comment) => ({
          ...comment,
          parentId: comment.parentId ?? null,
        }))
      ),
      count: comments.length,
    });
  } catch (error) {
    console.error("Failed to load blog comments:", error);
    return NextResponse.json(
      { error: "Failed to load comments" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth();
    const user = session?.user as { id: string } | undefined;
    if (!user?.id) {
      return NextResponse.json(
        { error: "You must be signed in to comment" },
        { status: 401 }
      );
    }

    const { slug } = await params;
    const { content, parentId } = await req.json();

    const cleanContent = String(content || "").trim();
    if (!cleanContent) {
      return NextResponse.json(
        { error: "Comment content is required" },
        { status: 400 }
      );
    }

    if (cleanContent.length > 2000) {
      return NextResponse.json(
        { error: "Comments must be 2000 characters or fewer" },
        { status: 400 }
      );
    }

    const moderation = screenSubmittedWriting({ content: cleanContent });
    if (!moderation.allowed) {
      return NextResponse.json(
        { error: moderation.reason || "This comment did not pass moderation." },
        { status: 422 }
      );
    }

    const blog = await prisma.blog.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });

    if (!blog || blog.status !== "approved") {
      return NextResponse.json({ error: "Blog not found" }, { status: 404 });
    }

    if (parentId) {
      const parent = await prisma.comment.findUnique({
        where: { id: String(parentId) },
        select: { id: true, blogId: true },
      });

      if (!parent || parent.blogId !== blog.id) {
        return NextResponse.json(
          { error: "Reply target not found" },
          { status: 404 }
        );
      }
    }

    const comment = await prisma.comment.create({
      data: {
        content: cleanContent,
        blog: {
          connect: { id: blog.id },
        },
        author: {
          connect: { id: user.id },
        },
        ...(parentId
          ? {
              parent: {
                connect: { id: String(parentId) },
              },
            }
          : {}),
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    console.error("Failed to create comment:", error);
    return NextResponse.json(
      { error: "Failed to create comment" },
      { status: 500 }
    );
  }
}
