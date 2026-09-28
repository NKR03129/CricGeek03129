import type { PostMatchBattingLeader } from "@/types/cricket";

interface BattingLeadersTableProps {
  leaders: PostMatchBattingLeader[];
}

export default function BattingLeadersTable({ leaders }: BattingLeadersTableProps) {
  if (leaders.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-cg-dark-2 p-5 text-sm text-gray-400">
        Batting leaders will appear once the innings scorecard is available.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-800 bg-cg-dark-2">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-cg-dark text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Batter</th>
              <th className="px-4 py-3">Innings</th>
              <th className="px-4 py-3">Runs</th>
              <th className="px-4 py-3">SR</th>
              <th className="px-4 py-3">Boundary %</th>
              <th className="px-4 py-3">Team Share</th>
            </tr>
          </thead>
          <tbody>
            {leaders.map((leader) => (
              <tr key={`${leader.inning}-${leader.name}`} className="border-t border-gray-800">
                <td className="px-4 py-3">
                  <p className="font-semibold text-white">{leader.name}</p>
                  <p className="text-xs text-gray-500">
                    {leader.fours}x4 · {leader.sixes}x6 · {leader.balls} balls
                  </p>
                </td>
                <td className="px-4 py-3 text-gray-300">{leader.inning}</td>
                <td className="px-4 py-3 font-semibold text-white">{leader.runs}</td>
                <td className="px-4 py-3 text-gray-300">{leader.strikeRate}</td>
                <td className="px-4 py-3 text-gray-300">{leader.boundaryPct}%</td>
                <td className="px-4 py-3 text-gray-300">{leader.sharePct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
