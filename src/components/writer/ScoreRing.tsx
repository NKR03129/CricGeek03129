"use client";

import { useId } from "react";

interface ScoreRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  showLabel?: boolean;
}

function getScoreGradient(score: number): { start: string; end: string } {
  if (score >= 80) return { start: "#22C55E", end: "#16A34A" };
  if (score >= 60) return { start: "#FBBF24", end: "#F59E0B" };
  if (score >= 40) return { start: "#FB923C", end: "#EA580C" };
  return { start: "#EF4444", end: "#DC2626" };
}

export default function ScoreRing({
  score,
  size = 80,
  strokeWidth = 6,
  label,
  showLabel = true,
}: ScoreRingProps) {
  const gradientSeed = useId().replace(/:/g, "");
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const gradientId = `score-gradient-${gradientSeed}`;
  const colors = getScoreGradient(score);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="w-full h-full -rotate-90"
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={colors.start} />
              <stop offset="100%" stopColor={colors.end} />
            </linearGradient>
          </defs>
          {/* Background ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={strokeWidth}
          />
          {/* Score ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="score-ring-animated"
            style={{
              "--score-circumference": `${circumference}`,
              "--score-offset": `${offset}`,
            } as React.CSSProperties}
          />
        </svg>
        {/* Score number */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-black"
            style={{
              fontSize: size * 0.3,
              color: colors.start,
            }}
          >
            {Math.round(score)}
          </span>
        </div>
      </div>
      {showLabel && label && (
        <span className="text-[10px] text-gray-500 font-medium">{label}</span>
      )}
    </div>
  );
}
