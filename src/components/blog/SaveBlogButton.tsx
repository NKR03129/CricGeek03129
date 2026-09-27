"use client";

import { useState } from "react";
import { Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";

interface SaveBlogButtonProps {
  slug: string;
  initialSaved: boolean;
  initialCount?: number;
  compact?: boolean;
  loginHref?: string;
  onUpdate?: (next: { saved: boolean; count: number }) => void;
}

export default function SaveBlogButton({
  slug,
  initialSaved,
  initialCount = 0,
  compact = false,
  loginHref = "/auth/login",
  onUpdate,
}: SaveBlogButtonProps) {
  const [saved, setSaved] = useState(initialSaved);
  const [count, setCount] = useState(initialCount);
  const [submitting, setSubmitting] = useState(false);

  const handleToggle = async () => {
    if (submitting) return;
    setSubmitting(true);

    const nextSaved = !saved;
    const optimisticCount = Math.max(0, count + (nextSaved ? 1 : -1));
    setSaved(nextSaved);
    setCount(optimisticCount);

    try {
      const res = await fetch(`/api/blogs/${slug}/save`, {
        method: nextSaved ? "POST" : "DELETE",
      });

      if (res.status === 401) {
        window.location.href = loginHref;
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update saved state");
      }

      const nextState = {
        saved: Boolean(data.saved ?? nextSaved),
        count: Number(data.saveCount ?? optimisticCount),
      };
      setSaved(nextState.saved);
      setCount(nextState.count);
      onUpdate?.(nextState);
    } catch {
      setSaved(!nextSaved);
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
        saved
          ? "border-blue-400/40 bg-blue-400/10 text-blue-200"
          : "border-gray-700 bg-white/5 text-gray-300 hover:border-blue-400/30 hover:text-blue-200",
        submitting && "opacity-70"
      )}
      title="Save this blog"
      type="button"
    >
      <Bookmark size={compact ? 13 : 15} className={saved ? "fill-current" : ""} />
      <span>{saved ? "Saved" : "Save"}</span>
      {count > 0 && <span className="text-[11px] opacity-80">{count}</span>}
    </button>
  );
}
