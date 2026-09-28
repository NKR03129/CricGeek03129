import type { Squad } from "@/types/cricket";
import { getPlayerAccent, getPlayerThumbnailSrc } from "@/lib/player-avatars";

interface SquadListProps {
  squads: Squad[];
}

export default function SquadList({ squads }: SquadListProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {squads.map((squad) => (
        <div
          key={squad.teamName}
          className="bg-cg-dark-2 border border-gray-800 rounded-xl overflow-hidden"
        >
          <div className="px-4 py-3 bg-cg-dark border-b border-gray-800">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-cg-green/20 rounded-full flex items-center justify-center text-xs font-bold text-cg-green">
                {squad.shortname}
              </div>
              <h3 className="text-white font-semibold">{squad.teamName}</h3>
              <span className="text-gray-400 text-xs ml-auto">
                {squad.players.length} players
              </span>
            </div>
          </div>
          <div className="divide-y divide-gray-800/50">
            {squad.players.map((player) => (
              <div key={player.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-800/20">
                <div
                  className="w-10 h-10 rounded-full overflow-hidden border"
                  style={{ borderColor: `${getPlayerAccent(player.name).fg}33` }}
                >
                  <img
                    src={getPlayerThumbnailSrc(player.playerImg, player.name)}
                    alt={player.name}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">
                    {player.name}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    {player.role && (
                      <p className="text-gray-500 text-xs">{player.role}</p>
                    )}
                    {player.country && (
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-gray-400">
                        {player.country}
                      </span>
                    )}
                  </div>
                  {(player.battingStyle || player.bowlingStyle) && (
                    <p className="mt-1 text-[10px] text-gray-500 truncate">
                      {[player.battingStyle, player.bowlingStyle].filter(Boolean).join(" • ")}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
