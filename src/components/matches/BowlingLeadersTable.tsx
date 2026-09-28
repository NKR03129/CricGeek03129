import type { PostMatchBowlingLeader } from "@/types/cricket";

interface BowlingLeadersTableProps {
  leaders: PostMatchBowlingLeader[];
}

export default function BowlingLeadersTable({ leaders }: BowlingLeadersTableProps) {
  if (leaders.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-cg-dark-2 p-5 text-sm text-gray-400">
        Bowling leaders will appear once spell data is available.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-800 bg-cg-dark-2">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-cg-dark text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Bowler</th>
              <th className="px-4 py-3">Context</th>
              <th className="px-4 py-3">Figures</th>
              <th className="px-4 py-3">Economy</th>
              <th className="px-4 py-3">Balls / wicket</th>
            </tr>
          </thead>
          <tbody>
            {leaders.map((leader) => (
              <tr key={`${leader.inning}-${leader.name}`} className="border-t border-gray-800">
                <td className="px-4 py-3">
                  <p className="font-semibold text-white">{leader.name}</p>
                  <p className="text-xs text-gray-500">
                    {leader.overs} ov · {leader.maidens} mdn · {leader.runsConceded} runs
                  </p>
                </td>
                <td className="px-4 py-3 text-gray-300">{leader.inning}</td>
                <td className="px-4 py-3 font-semibold text-white">
                  {leader.wickets}/{leader.runsConceded}
                </td>
                <td className="px-4 py-3 text-gray-300">{leader.economy}</td>
                <td className="px-4 py-3 text-gray-300">
                  {leader.ballsPerWicket ? leader.ballsPerWicket : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
