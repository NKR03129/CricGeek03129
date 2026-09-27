"use client";

import Link from "next/link";

interface WriterProfileCardProps {
  id: string;
  name: string;
  avatar?: string | null;
  archetype: string;
  level: number;
  xp: number;
  averageBQS: number;
  totalBlogs: number;
  compact?: boolean;
}

const ARCHETYPE_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  analyst: { color: "text-blue-400", icon: "📊", label: "The Analyst" },
  storyteller: { color: "text-purple-400", icon: "📖", label: "The Storyteller" },
  critic: { color: "text-amber-400", icon: "🔍", label: "The Critic" },
  reporter: { color: "text-cyan-400", icon: "📰", label: "The Reporter" },
  debater: { color: "text-red-400", icon: "⚔️", label: "The Debater" },
  rookie: { color: "text-gray-400", icon: "🏏", label: "Rookie" },
};

function getScoreColor(bqs: number): string {
  if (bqs >= 80) return "text-cg-green";
  if (bqs >= 60) return "text-yellow-400";
  if (bqs >= 40) return "text-orange-400";
  return "text-red-400";
}

function getScoreBg(bqs: number): string {
  if (bqs >= 80) return "bg-cg-green/10 border-cg-green/20";
  if (bqs >= 60) return "bg-yellow-400/10 border-yellow-400/20";
  if (bqs >= 40) return "bg-orange-400/10 border-orange-400/20";
  return "bg-red-400/10 border-red-400/20";
}

export default function WriterProfileCard({
  id,
  name,
  avatar,
  archetype,
  level,
  xp,
  averageBQS,
  totalBlogs,
  compact = false,
}: WriterProfileCardProps) {
  const config = ARCHETYPE_CONFIG[archetype] || ARCHETYPE_CONFIG.rookie;
  const xpForNext = (level) * 100;
  const xpProgress = Math.min(100, (xp % 100));

  if (compact) {
    return (
      <Link href={`/writer/${id}`} className="flex items-center gap-3 group">
        <div className="w-8 h-8 rounded-full bg-cg-dark-3 flex items-center justify-center text-sm font-bold text-cg-green border border-gray-700 group-hover:border-cg-green/50 transition-all">
          {avatar ? (
            <img src={avatar} alt={name} className="w-full h-full rounded-full object-cover" />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate group-hover:text-cg-green transition-colors">
            {name}
          </p>
          <p className={`text-[10px] ${config.color}`}>
            {config.icon} {config.label} · Lv.{level}
          </p>
        </div>
        <div className={`text-xs font-bold px-2 py-0.5 rounded-full border ${getScoreBg(averageBQS)} ${getScoreColor(averageBQS)}`}>
          {averageBQS.toFixed(0)}
        </div>
      </Link>
    );
  }

  return (
    <Link href={`/writer/${id}`} className="block group">
      <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-5 hover:border-cg-green/30 transition-all">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-cg-dark-3 flex items-center justify-center text-xl font-bold text-cg-green border-2 border-gray-700 group-hover:border-cg-green/50 transition-all shrink-0">
            {avatar ? (
              <img src={avatar} alt={name} className="w-full h-full rounded-full object-cover" />
            ) : (
              name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-white group-hover:text-cg-green transition-colors truncate">
              {name}
            </h3>
            <p className={`text-sm ${config.color} flex items-center gap-1`}>
              <span>{config.icon}</span>
              {config.label}
            </p>
            {/* Level & XP bar */}
            <div className="mt-2">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] text-gray-500">Level {level}</span>
                <span className="text-[10px] text-gray-500">{xp % 100}/{xpForNext} XP</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cg-green to-cg-green-light rounded-full xp-fill"
                  style={{ width: `${xpProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-gray-800">
          <div className="text-center">
            <p className={`text-lg font-bold ${getScoreColor(averageBQS)}`}>
              {averageBQS.toFixed(1)}
            </p>
            <p className="text-[10px] text-gray-500">Avg EQS</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-white">{totalBlogs}</p>
            <p className="text-[10px] text-gray-500">Expressions</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-white">Lv.{level}</p>
            <p className="text-[10px] text-gray-500">Level</p>
          </div>
        </div>
      </div>
    </Link>
  );
}

export { ARCHETYPE_CONFIG, getScoreColor, getScoreBg };
