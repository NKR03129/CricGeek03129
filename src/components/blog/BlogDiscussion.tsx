"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, MessageSquare, Reply, Send } from "lucide-react";

interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface CommentNode {
  id: string;
  content: string;
  parentId: string | null;
  createdAt: string;
  author: {
    id: string;
    name: string;
    avatar: string | null;
  };
  replies: CommentNode[];
}

interface Props {
  blogSlug: string;
  initialCount: number;
  onCountChange?: (count: number) => void;
}

function CommentItem({
  comment,
  depth,
  activeReplyId,
  replyDraft,
  submittingReply,
  replyError,
  sessionUser,
  onReplyStart,
  onReplyCancel,
  onReplyDraftChange,
  onReplySubmit,
}: {
  comment: CommentNode;
  depth: number;
  activeReplyId: string | null;
  replyDraft: string;
  submittingReply: boolean;
  replyError: string;
  sessionUser: SessionUser | null;
  onReplyStart: (commentId: string) => void;
  onReplyCancel: () => void;
  onReplyDraftChange: (value: string) => void;
  onReplySubmit: (parentId: string) => void;
}) {
  const isReplying = activeReplyId === comment.id;

  return (
    <div className={`${depth > 0 ? "ml-4 sm:ml-8 border-l border-gray-800 pl-4 sm:pl-6" : ""}`}>
      <div className="rounded-xl border border-gray-800 bg-cg-dark-2/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cg-green/20 text-sm font-bold text-cg-green">
              {comment.author.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{comment.author.name}</p>
              <p className="text-xs text-gray-500">
                {new Date(comment.createdAt).toLocaleString("en-IN", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
          <button
            onClick={() => (isReplying ? onReplyCancel() : onReplyStart(comment.id))}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:border-cg-green/40 hover:text-cg-green"
          >
            <Reply size={12} />
            Reply
          </button>
        </div>

        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-200">{comment.content}</p>

        {isReplying && (
          <div className="mt-4 rounded-xl border border-cg-green/20 bg-cg-dark-3/70 p-3">
            {sessionUser ? (
              <>
                <textarea
                  value={replyDraft}
                  onChange={(e) => onReplyDraftChange(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-gray-700 bg-cg-dark px-3 py-2 text-sm text-white outline-none transition focus:border-cg-green"
                  placeholder={`Reply to ${comment.author.name}...`}
                />
                {replyError && (
                  <p className="mt-2 text-sm text-red-400">{replyError}</p>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => onReplySubmit(comment.id)}
                    disabled={submittingReply || !replyDraft.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-cg-green px-4 py-2 text-sm font-bold text-black transition hover:bg-cg-green-dark disabled:opacity-50"
                  >
                    {submittingReply ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Post Reply
                  </button>
                  <button
                    onClick={onReplyCancel}
                    className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 transition hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-400">Sign in to reply to this thread.</p>
                <Link
                  href={`/auth/login?next=/blog`}
                  className="inline-flex items-center justify-center rounded-lg bg-cg-green px-4 py-2 text-sm font-bold text-black transition hover:bg-cg-green-dark"
                >
                  Sign In
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      {comment.replies.length > 0 && (
        <div className="mt-3 space-y-3">
          {comment.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              depth={depth + 1}
              activeReplyId={activeReplyId}
              replyDraft={replyDraft}
              submittingReply={submittingReply}
              replyError={replyError}
              sessionUser={sessionUser}
              onReplyStart={onReplyStart}
              onReplyCancel={onReplyCancel}
              onReplyDraftChange={onReplyDraftChange}
              onReplySubmit={onReplySubmit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function BlogDiscussion({ blogSlug, initialCount, onCountChange }: Props) {
  const [comments, setComments] = useState<CommentNode[]>([]);
  const [commentCount, setCommentCount] = useState(initialCount);
  const [loading, setLoading] = useState(true);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [draft, setDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [replyError, setReplyError] = useState("");

  const updateCount = useCallback((count: number) => {
    setCommentCount(count);
    onCountChange?.(count);
  }, [onCountChange]);

  useEffect(() => {
    setCommentCount(initialCount);
  }, [initialCount]);

  const parseJsonSafely = async (res: Response) => {
    const text = await res.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { error: text };
    }
  };

  const loadComments = useCallback(async () => {
    setLoading(true);
    try {
      const [commentsRes, sessionRes] = await Promise.all([
        fetch(`/api/blogs/${blogSlug}/comments`),
        fetch("/api/auth/session"),
      ]);

      const commentsData = await parseJsonSafely(commentsRes);
      const sessionData = await parseJsonSafely(sessionRes);

      if (commentsRes.ok && commentsData) {
        setComments((commentsData.comments as CommentNode[]) || []);
        updateCount(Number(commentsData.count || 0));
      } else if (!commentsRes.ok) {
        setError(
          typeof commentsData?.error === "string"
            ? commentsData.error
            : "Failed to load the discussion thread."
        );
      }

      setSessionUser((sessionData?.user as SessionUser | null) || null);
    } catch {
      setError("Could not load the discussion thread. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [blogSlug, updateCount]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  const submitComment = async (parentId?: string) => {
    const value = parentId ? replyDraft : draft;
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    if (!sessionUser) {
      setError("You must be signed in to join the thread.");
      return;
    }

    setSubmitting(true);
    setError("");
    setReplyError("");

    try {
      const res = await fetch(`/api/blogs/${blogSlug}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: trimmed,
          parentId: parentId || null,
        }),
      });

      const data = await parseJsonSafely(res);
      if (!res.ok) {
        if (parentId) {
          setReplyError(
            typeof data?.error === "string" ? data.error : "Failed to post reply"
          );
        } else {
          setError(
            typeof data?.error === "string" ? data.error : "Failed to post comment"
          );
        }
        return;
      }

      if (parentId) {
        setReplyDraft("");
        setActiveReplyId(null);
      } else {
        setDraft("");
      }

      await loadComments();
    } catch {
      if (parentId) {
        setReplyError("Something went wrong while posting your reply.");
      } else {
        setError("Something went wrong while posting your comment.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="comments" className="rounded-2xl border border-gray-800 bg-cg-dark-2 p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-cg-green" />
            <h2 className="text-xl font-black text-white">Discussion Thread</h2>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            Every blog starts its own thread. Join the conversation or reply directly to someone else.
          </p>
        </div>
        <div className="rounded-full border border-gray-700 bg-gray-800/60 px-3 py-1 text-sm text-gray-300">
          {commentCount} {commentCount === 1 ? "comment" : "comments"}
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-cg-green/20 bg-cg-dark-3/60 p-4">
        {sessionUser ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-xl border border-gray-700 bg-cg-dark px-4 py-3 text-sm text-white outline-none transition focus:border-cg-green"
              placeholder="Add a constructive comment to this blog thread..."
            />
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500">
                Borderline toxic or spammy writing is blocked automatically.
              </p>
              <button
                onClick={() => void submitComment()}
                disabled={submitting || !draft.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-cg-green px-4 py-2.5 text-sm font-bold text-black transition hover:bg-cg-green-dark disabled:opacity-50"
              >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Post Comment
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-400">
              Sign in to start the thread or reply to someone else.
            </p>
            <Link
              href={`/auth/login?next=/blog/${blogSlug}`}
              className="inline-flex items-center justify-center rounded-xl bg-cg-green px-4 py-2.5 text-sm font-bold text-black transition hover:bg-cg-green-dark"
            >
              Sign In
            </Link>
          </div>
        )}
      </div>

      <div className="mt-6 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 size={16} className="animate-spin" />
            Loading discussion...
          </div>
        ) : comments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-800 px-4 py-10 text-center">
            <p className="text-lg font-semibold text-gray-300">No replies yet</p>
            <p className="mt-1 text-sm text-gray-500">Be the first to open the discussion for this blog.</p>
          </div>
        ) : (
          comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              depth={0}
              activeReplyId={activeReplyId}
              replyDraft={replyDraft}
              submittingReply={submitting}
              replyError={replyError}
              sessionUser={sessionUser}
              onReplyStart={(commentId) => {
                setActiveReplyId(commentId);
                setReplyDraft("");
                setReplyError("");
              }}
              onReplyCancel={() => {
                setActiveReplyId(null);
                setReplyDraft("");
                setReplyError("");
              }}
              onReplyDraftChange={setReplyDraft}
              onReplySubmit={(parentId) => void submitComment(parentId)}
            />
          ))
        )}
      </div>
    </section>
  );
}
