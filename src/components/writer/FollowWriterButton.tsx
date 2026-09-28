"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

interface FollowWriterButtonProps {
  writerId: string;
  initialFollowing: boolean;
  initialFollowerCount: number;
  disabled?: boolean;
  compact?: boolean;
  loginHref?: string;
  onUpdate?: (next: { following: boolean; followerCount: number }) => void;
}

export default function FollowWriterButton({
  writerId,
  initialFollowing,
  initialFollowerCount,
  disabled = false,
  compact = false,
  loginHref = "/auth/login",
  onUpdate,
}: FollowWriterButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [followerCount, setFollowerCount] = useState(initialFollowerCount);
  const [submitting, setSubmitting] = useState(false);

  const handleToggle = async () => {
    if (disabled || submitting) return;
    setSubmitting(true);

    const nextFollowing = !following;
    const optimisticCount = Math.max(0, followerCount + (nextFollowing ? 1 : -1));
    setFollowing(nextFollowing);
    setFollowerCount(optimisticCount);

    try {
      const res = await fetch(`/api/writer/${writerId}/follow`, {
        method: nextFollowing ? "POST" : "DELETE",
      });

      if (res.status === 401) {
        window.location.href = loginHref;
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update follow state");
      }

      const nextState = {
        following: Boolean(data.following ?? nextFollowing),
        followerCount: Number(data.followerCount ?? optimisticCount),
      };
      setFollowing(nextState.following);
      setFollowerCount(nextState.followerCount);
      onUpdate?.(nextState);
    } catch {
      setFollowing(!nextFollowing);
      setFollowerCount(followerCount);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <button
      onClick={handleToggle}
      disabled={disabled || submitting}
      type="button"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border transition-all",
        compact
          ? "px-3 py-1.5 text-xs font-semibold"
          : "px-4 py-2 text-sm font-bold",
        following
          ? "border-cg-green/40 bg-cg-green/10 text-cg-green"
          : "border-gray-700 bg-white/5 text-gray-300 hover:border-cg-green/30 hover:text-white",
        (disabled || submitting) && "opacity-70"
      )}
    >
      <UserPlus size={compact ? 13 : 15} />
      <span>{following ? "Following" : "Follow Writer"}</span>
      <span className="text-[11px] opacity-80">{followerCount}</span>
    </button>
  );
}
