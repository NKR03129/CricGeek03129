"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface CricketBallReactionButtonProps {
  slug: string;
  initialCount: number;
  initialReacted: boolean;
  compact?: boolean;
  loginHref?: string;
  onUpdate?: (next: { count: number; reacted: boolean }) => void;
}

export default function CricketBallReactionButton({
  slug,
  initialCount,
  initialReacted,
  compact = false,
  loginHref = "/auth/login",
  onUpdate,
}: CricketBallReactionButtonProps) {
  const [count, setCount] = useState(initialCount);
  const [reacted, setReacted] = useState(initialReacted);
  const [submitting, setSubmitting] = useState(false);

  const handleToggle = async () => {
    if (submitting) return;
    setSubmitting(true);

    const nextReacted = !reacted;
    const optimisticCount = Math.max(0, count + (nextReacted ? 1 : -1));
    setReacted(nextReacted);
    setCount(optimisticCount);

    try {
      const res = await fetch(`/api/blogs/${slug}/runs`, {
        method: nextReacted ? "POST" : "DELETE",
      });

      if (res.status === 401) {
        window.location.href = loginHref;
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update reaction");
      }

      const nextState = {
        count: Number(data.runs ?? optimisticCount),
        reacted: Boolean(data.reacted ?? nextReacted),
      };
      setCount(nextState.count);
      setReacted(nextState.reacted);
      onUpdate?.(nextState);
    } catch {
      setReacted(!nextReacted);
      setCount(count);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <button
      onClick={handleToggle}
      disabled={submitting}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border transition-all",
        compact
          ? "px-3 py-1.5 text-xs font-semibold"
          : "px-4 py-2 text-sm font-bold",
        reacted
          ? "border-orange-400/40 bg-orange-400/10 text-orange-300"
          : "border-gray-700 bg-white/5 text-gray-300 hover:border-orange-400/30 hover:text-orange-200",
        submitting && "opacity-70"
      )}
      title="Give this blog a cricket-ball reaction"
      type="button"
    >
      <span className={cn("leading-none", compact ? "text-sm" : "text-base")}>🏏</span>
      <span>{count}</span>
    </button>
  );
}
