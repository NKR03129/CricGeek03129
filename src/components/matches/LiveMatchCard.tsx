import Link from "next/link";
import { cn, getMatchTypeColor } from "@/lib/utils";
import type { Match } from "@/types/cricket";

interface LiveMatchCardProps {
  match: Match;
}

export default function LiveMatchCard({ match }: LiveMatchCardProps) {
  const isLive = match.matchStarted && !match.matchEnded;

  return (
    <Link href={`/matches/${match.id}`}>
      <div className="bg-cg-dark-2 border border-gray-800 rounded-xl p-4 hover:border-cg-green/50 transition-all hover:shadow-lg hover:shadow-green-500/5 group">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <span
            className={cn(
              "text-xs font-bold px-2 py-0.5 rounded-full text-white",
              getMatchTypeColor(match.matchType)
            )}
          >
            {match.matchType}
          </span>
          {isLive && (
            <span className="flex items-center gap-1 text-xs font-medium text-red-400">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              LIVE
            </span>
          )}
          {match.matchEnded && (
            <span className="text-xs font-medium text-gray-400">Completed</span>
          )}
          {!match.matchStarted && (
            <span className="text-xs font-medium text-yellow-400">Upcoming</span>
          )}
        </div>

        {/* Teams */}
        <div className="space-y-2">
          {match.teams.map((team, idx) => {
            const score = match.score?.[idx];
            const teamInfo = match.teamInfo?.[idx];
            return (
              <div key={team} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-gray-700 rounded-full flex items-center justify-center text-[10px] font-bold text-white">
                    {teamInfo?.shortname?.slice(0, 2) || team.slice(0, 2)}
                  </div>
                  <span className="text-white text-sm font-medium group-hover:text-cg-green transition-colors">
                    {teamInfo?.shortname || team}
                  </span>
                </div>
                {score && (
                  <span className="text-white text-sm font-bold">
                    {score.r}/{score.w}
                    <span className="text-gray-400 text-xs font-normal ml-1">
                      ({score.o} ov)
                    </span>
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Status */}
        <div className="mt-3 pt-3 border-t border-gray-800">
          <p className="text-xs text-gray-400 truncate">{match.status}</p>
          <p className="text-xs text-gray-500 mt-1 truncate">{match.venue}</p>
        </div>
      </div>
    </Link>
  );
}
