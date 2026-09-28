"use client";

import Link from "next/link";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import type { Match } from "@/types/cricket";
import type {
  BattingRecommendation,
  BowlingRecommendation,
  InsightsAdvisorResponse,
  InsightsEvaluationResponse,
  InsightsMetadata,
  LiveAdvisorResponse,
  MetricSupport,
  PlayerExplorerResponse,
} from "@/types/insights";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  Flame,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";

type TabId = "manual" | "live" | "evaluation" | "player";

type ManualFormState = {
  battingTeam: string;
  bowlingTeam: string;
  innings: number;
  overs: number;
  runs: number;
  wickets: number;
  target: number;
  matchGender: "male" | "female";
  strategy: "balanced" | "batting_first" | "aggressive";
  topN: number;
};

const TABS: { id: TabId; label: string; icon: typeof Target; blurb: string }[] = [
  {
    id: "manual",
    label: "Manual Advisor",
    icon: Target,
    blurb: "Build a T20 state by hand and get batting and bowling suggestions instantly.",
  },
  {
    id: "live",
    label: "Live Match Advisor",
    icon: Activity,
    blurb: "Read the current CricGeek score state and translate it into T20 recommendations.",
  },
  {
    id: "evaluation",
    label: "Evaluation",
    icon: BarChart3,
    blurb: "Inspect coverage, precision, calibration, and baseline lift from the capstone engine.",
  },
  {
    id: "player",
    label: "Player Explorer",
    icon: Radar,
    blurb: "Explore a batter's situation profile, phase strength, and risk-reward footprint.",
  },
];

const DEFAULT_MANUAL_STATE: ManualFormState = {
  battingTeam: "",
  bowlingTeam: "",
  innings: 1,
  overs: 10,
  runs: 80,
  wickets: 3,
  target: 160,
  matchGender: "male",
  strategy: "balanced",
  topN: 5,
};

function formatPct(value: number | null | undefined, alreadyPercent = false) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "NA";
  }

  if (alreadyPercent) {
    return `${value.toFixed(1)}%`;
  }

  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "NA";
  }

  return value.toFixed(digits);
}

function formatInterval(interval?: MetricSupport["uncertainty"] | null) {
  if (!interval) return undefined;
  const decimals = interval.decimals ?? 1;
  const unit = interval.unit ?? "";
  return `${interval.label} ${interval.lower.toFixed(decimals)}–${interval.upper.toFixed(decimals)}${unit}`;
}

function normalizePlayerText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function playerSignature(value: string) {
  const tokens = normalizePlayerText(value).split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return "";
  }
  if (tokens.length === 1) {
    return tokens[0];
  }
  return `${tokens[0][0]} ${tokens[tokens.length - 1]}`;
}

function matchesPlayerQuery(player: string, query: string) {
  const normalizedPlayer = normalizePlayerText(player);
  const normalizedQuery = normalizePlayerText(query);

  if (!normalizedQuery) {
    return true;
  }

  if (
    normalizedPlayer.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedPlayer)
  ) {
    return true;
  }

  const playerTokens = normalizedPlayer.split(" ").filter(Boolean);
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  if (
    playerTokens.length >= 2 &&
    queryTokens.length >= 2 &&
    playerTokens[playerTokens.length - 1] === queryTokens[queryTokens.length - 1] &&
    playerTokens[0][0] === queryTokens[0][0]
  ) {
    return true;
  }

  return playerSignature(player) === playerSignature(query);
}

function scoreTone(value: number) {
  if (value >= 65) return "text-cg-green";
  if (value >= 45) return "text-amber-300";
  return "text-red-300";
}

function supportTone(tier?: MetricSupport["confidenceTier"]) {
  if (tier === "high") return "border-cg-green/30 bg-cg-green/10 text-cg-green";
  if (tier === "medium") return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return "border-red-400/30 bg-red-400/10 text-red-200";
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-black/30 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">
        {label}
      </p>
      <p className="mt-3 text-2xl font-black text-white">{value}</p>
      {detail ? <p className="mt-2 text-xs text-gray-400">{detail}</p> : null}
    </div>
  );
}

function SupportPanel({ support }: { support?: MetricSupport | null }) {
  if (!support) return null;

  return (
    <div className="mt-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
        <span className="rounded-full border border-gray-700 bg-black/20 px-3 py-1 text-gray-300">
          n={support.sampleSize}
        </span>
        <span className={`rounded-full border px-3 py-1 ${supportTone(support.confidenceTier)}`}>
          {support.confidenceTier} confidence
        </span>
      </div>
      {formatInterval(support.uncertainty) ? (
        <p className="text-xs text-gray-400">{formatInterval(support.uncertainty)}</p>
      ) : null}
      {support.warning ? (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          {support.warning}
        </div>
      ) : null}
    </div>
  );
}

function RecommendationCard({
  recommendation,
  rank,
}: {
  recommendation: BattingRecommendation;
  rank: number;
}) {
  return (
    <article className="rounded-3xl border border-gray-800 bg-[linear-gradient(160deg,rgba(17,17,17,0.95),rgba(12,28,18,0.9))] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex rounded-full border border-cg-green/20 bg-cg-green/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cg-green">
            Rank {rank}
          </div>
          <h3 className="mt-3 text-xl font-black text-white">{recommendation.player}</h3>
          <p className="mt-1 text-sm text-gray-400">
            {recommendation.team || "Team context unavailable"} · {recommendation.phase}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-700 bg-white/[0.03] px-4 py-3 text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
            Situation Score
          </p>
          <p className={`mt-2 text-2xl font-black ${scoreTone(recommendation.situationSuitability)}`}>
            {recommendation.situationSuitability.toFixed(1)}
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="xRuns" value={formatNumber(recommendation.expRuns)} />
        <StatCard label="Dismissal" value={formatPct(recommendation.dismissalProbability)} />
        <StatCard label="Sit. SR" value={formatNumber(recommendation.situationStrikeRate, 0)} />
        <StatCard
          label="Entries"
          value={String(recommendation.entryCount)}
          detail={recommendation.support ? `${recommendation.support.confidenceTier} confidence` : undefined}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-gray-800 bg-black/20 p-3">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Phase Dominance</p>
          <p className="mt-2 text-lg font-bold text-white">{recommendation.phaseDominance.toFixed(2)}</p>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-black/20 p-3">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Consistency</p>
          <p className="mt-2 text-lg font-bold text-white">{recommendation.consistency.toFixed(2)}</p>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-black/20 p-3">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Pressure Score</p>
          <p className="mt-2 text-lg font-bold text-white">{recommendation.pressureScore.toFixed(2)}</p>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        {recommendation.reasons.map((reason) => (
          <div
            key={reason}
            className="rounded-2xl border border-gray-800 bg-white/[0.03] px-4 py-3 text-sm text-gray-300"
          >
            {reason}
          </div>
        ))}
      </div>
      <SupportPanel support={recommendation.support} />
    </article>
  );
}

function BowlingCard({
  recommendation,
  rank,
}: {
  recommendation: BowlingRecommendation;
  rank: number;
}) {
  return (
    <article className="rounded-3xl border border-gray-800 bg-[linear-gradient(160deg,rgba(17,17,17,0.95),rgba(23,15,9,0.9))] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300">
            Bowler {rank}
          </div>
          <h3 className="mt-3 text-xl font-black text-white">{recommendation.player}</h3>
          <p className="mt-1 text-sm text-gray-400">{recommendation.team || "Team context unavailable"}</p>
        </div>
        <div className="rounded-2xl border border-gray-700 bg-white/[0.03] px-4 py-3 text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
            Utility
          </p>
          <p className={`mt-2 text-2xl font-black ${scoreTone((recommendation.utilityScore + 2) * 25)}`}>
            {recommendation.utilityScore.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="xWickets/Ov" value={formatNumber(recommendation.expectedWickets, 2)} />
        <StatCard label="xRuns/Ov" value={formatNumber(recommendation.expectedRunsConceded)} />
        <StatCard
          label="Overs Sample"
          value={String(recommendation.oversSample)}
          detail={recommendation.support ? `${recommendation.support.confidenceTier} confidence` : undefined}
        />
      </div>

      <div className="mt-5 space-y-2">
        {recommendation.reasons.map((reason) => (
          <div
            key={reason}
            className="rounded-2xl border border-gray-800 bg-white/[0.03] px-4 py-3 text-sm text-gray-300"
          >
            {reason}
          </div>
        ))}
      </div>
      <SupportPanel support={recommendation.support} />
    </article>
  );
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; detail?: string }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || payload?.detail || "Request failed");
  }

  return payload as T;
}

export default function InsightsClient({ initialMatches }: { initialMatches: Match[] }) {
  const searchParams = useSearchParams();
  const matchIdFromUrl = searchParams.get("matchId");

  const [activeTab, setActiveTab] = useState<TabId>(matchIdFromUrl ? "live" : "manual");
  const [metadata, setMetadata] = useState<InsightsMetadata | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  const [manualForm, setManualForm] = useState<ManualFormState>(DEFAULT_MANUAL_STATE);
  const [manualResult, setManualResult] = useState<InsightsAdvisorResponse | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const [liveMatchId, setLiveMatchId] = useState(matchIdFromUrl || initialMatches[0]?.id || "");
  const [liveResult, setLiveResult] = useState<LiveAdvisorResponse | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const [evaluation, setEvaluation] = useState<InsightsEvaluationResponse | null>(null);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);

  const [playerQuery, setPlayerQuery] = useState("");
  const deferredPlayerQuery = useDeferredValue(playerQuery);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [playerExplorer, setPlayerExplorer] = useState<PlayerExplorerResponse | null>(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const availableTeams = metadata
    ? manualForm.matchGender === "female"
      ? metadata.teamsByGender.female
      : metadata.teamsByGender.male
    : [];

  const playerMatches = metadata
    ? metadata.players
        .filter((player) => matchesPlayerQuery(player, deferredPlayerQuery))
        .slice(0, 10)
    : [];

  const selectedLiveMatch =
    initialMatches.find((match) => match.id === liveMatchId) || initialMatches[0] || null;

  useEffect(() => {
    async function loadMetadata() {
      setMetadataLoading(true);
      setMetadataError(null);

      try {
        const payload = await readJson<InsightsMetadata>("/api/insights/metadata");
        startTransition(() => {
          setMetadata(payload);
          setSelectedPlayer((current) => current || payload.players[0] || "");
        });
      } catch (error) {
        setMetadataError(error instanceof Error ? error.message : "Metadata could not be loaded.");
      } finally {
        setMetadataLoading(false);
      }
    }

    void loadMetadata();
  }, []);

  useEffect(() => {
    if (!metadata || manualForm.battingTeam || manualForm.bowlingTeam) {
      return;
    }

    const teams = manualForm.matchGender === "female" ? metadata.teamsByGender.female : metadata.teamsByGender.male;
    const battingTeam = teams[0] || "";
    const bowlingTeam = teams.find((team) => team !== battingTeam) || teams[1] || battingTeam;

    startTransition(() => {
      setManualForm((current) => ({
        ...current,
        battingTeam,
        bowlingTeam,
      }));
    });
  }, [manualForm.battingTeam, manualForm.bowlingTeam, manualForm.matchGender, metadata]);

  useEffect(() => {
    if (!metadata) {
      return;
    }

    const teams = manualForm.matchGender === "female" ? metadata.teamsByGender.female : metadata.teamsByGender.male;
    if (teams.length === 0) {
      return;
    }

    if (!teams.includes(manualForm.battingTeam) || !teams.includes(manualForm.bowlingTeam)) {
      const battingTeam = teams.includes(manualForm.battingTeam) ? manualForm.battingTeam : teams[0];
      const bowlingTeam =
        teams.includes(manualForm.bowlingTeam) && manualForm.bowlingTeam !== battingTeam
          ? manualForm.bowlingTeam
          : teams.find((team) => team !== battingTeam) || battingTeam;

      startTransition(() => {
        setManualForm((current) => ({
          ...current,
          battingTeam,
          bowlingTeam,
        }));
      });
    }
  }, [manualForm.battingTeam, manualForm.bowlingTeam, manualForm.matchGender, metadata]);

  useEffect(() => {
    if (matchIdFromUrl) {
      setActiveTab("live");
      setLiveMatchId(matchIdFromUrl);
      setLiveResult(null);
    }
  }, [matchIdFromUrl]);

  async function runManualAdvisor() {
    setManualLoading(true);
    setManualError(null);

    try {
      const payload = await readJson<InsightsAdvisorResponse>("/api/insights/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runs: manualForm.runs,
          wickets: manualForm.wickets,
          overs: manualForm.overs,
          innings: manualForm.innings,
          target: manualForm.innings === 2 ? manualForm.target : null,
          batting_team: manualForm.battingTeam || null,
          bowling_team: manualForm.bowlingTeam || null,
          match_gender: manualForm.matchGender,
          strategy: manualForm.strategy,
          top_n: manualForm.topN,
        }),
      });

      startTransition(() => {
        setManualResult(payload);
      });
    } catch (error) {
      setManualError(error instanceof Error ? error.message : "Manual advisor failed.");
    } finally {
      setManualLoading(false);
    }
  }

  async function runLiveAdvisor(targetMatchId = liveMatchId) {
    if (!targetMatchId) {
      setLiveError("Choose a T20 match first.");
      return;
    }

    setLiveLoading(true);
    setLiveError(null);

    try {
      const payload = await readJson<LiveAdvisorResponse>(
        `/api/insights/live?matchId=${encodeURIComponent(targetMatchId)}&strategy=${encodeURIComponent(
          manualForm.strategy
        )}&topN=${manualForm.topN}`
      );

      startTransition(() => {
        setLiveResult(payload);
      });
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Live advisor failed.");
    } finally {
      setLiveLoading(false);
    }
  }

  async function runEvaluation() {
    setEvaluationLoading(true);
    setEvaluationError(null);

    try {
      const payload = await readJson<InsightsEvaluationResponse>("/api/insights/evaluation");
      startTransition(() => {
        setEvaluation(payload);
      });
    } catch (error) {
      setEvaluationError(error instanceof Error ? error.message : "Evaluation could not be loaded.");
    } finally {
      setEvaluationLoading(false);
    }
  }

  async function runPlayerExplorer(player = selectedPlayer) {
    if (!player) {
      setPlayerError("Select a player first.");
      return;
    }

    setPlayerLoading(true);
    setPlayerError(null);

    try {
      const payload = await readJson<PlayerExplorerResponse>(
        `/api/insights/player?name=${encodeURIComponent(player)}`
      );
      startTransition(() => {
        setSelectedPlayer(player);
        setPlayerExplorer(payload);
      });
    } catch (error) {
      setPlayerError(error instanceof Error ? error.message : "Player explorer failed.");
    } finally {
      setPlayerLoading(false);
    }
  }

  const runManualAdvisorEffect = useEffectEvent(() => {
    void runManualAdvisor();
  });

  const runLiveAdvisorEffect = useEffectEvent((targetMatchId: string) => {
    void runLiveAdvisor(targetMatchId);
  });

  const runPlayerExplorerEffect = useEffectEvent((player: string) => {
    void runPlayerExplorer(player);
  });

  useEffect(() => {
    if (metadata && !manualResult && !manualLoading && !manualError && manualForm.battingTeam) {
      runManualAdvisorEffect();
    }
  }, [manualError, manualForm.battingTeam, manualLoading, manualResult, metadata]);

  useEffect(() => {
    if (activeTab === "live" && liveMatchId && !liveResult && !liveLoading && !liveError) {
      runLiveAdvisorEffect(liveMatchId);
    }
  }, [activeTab, liveError, liveLoading, liveMatchId, liveResult]);

  useEffect(() => {
    if (activeTab === "evaluation" && !evaluation && !evaluationLoading && !evaluationError) {
      void runEvaluation();
    }
  }, [activeTab, evaluation, evaluationError, evaluationLoading]);

  useEffect(() => {
    if (activeTab === "player" && selectedPlayer && !playerExplorer && !playerLoading && !playerError) {
      runPlayerExplorerEffect(selectedPlayer);
    }
  }, [activeTab, playerError, playerExplorer, playerLoading, selectedPlayer]);

  return (
    <div className="bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.08),transparent_40%),linear-gradient(180deg,#060606,#0a0a0a)]">
      <section className="relative overflow-hidden border-b border-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-18">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-cg-green/20 bg-cg-green/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.26em] text-cg-green">
              <BrainCircuit size={14} />
              Integrated T20 Decision Support
            </div>
            <h1 className="mt-6 text-4xl sm:text-5xl font-black tracking-tight text-white">
              Capstone T20 intelligence, now inside CricGeek.
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-8 text-gray-300 sm:text-lg">
              Manual situation advice, live match translation, model evaluation, and player situation profiles are now part of the same product surface as your scores, commentary, and match pages.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                label="Artifacts"
                value={metadata ? String(metadata.artifactStatus.aggregatedRows) : metadataLoading ? "..." : "0"}
                detail="Situation-profile rows currently available in the integrated capstone dataset."
              />
              <StatCard
                label="Players"
                value={metadata ? String(metadata.playerCount) : metadataLoading ? "..." : "0"}
                detail="Batters with searchable explorer profiles and recommendation eligibility."
              />
              <StatCard
                label="T20 Matches"
                value={String(initialMatches.length)}
                detail="Started T20 fixtures from CricGeek that can feed the live advisor."
              />
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-3xl border p-5 text-left transition-all ${
                activeTab === tab.id
                  ? "border-cg-green/40 bg-cg-green/10 shadow-[0_20px_60px_rgba(34,197,94,0.08)]"
                  : "border-gray-800 bg-white/[0.02] hover:border-gray-700 hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-gray-800 bg-black/30 p-3 text-cg-green">
                  <tab.icon size={18} />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{tab.label}</p>
                  <p className="mt-1 text-xs text-gray-400">{tab.blurb}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {metadataError ? (
          <div className="mt-6 rounded-3xl border border-red-500/20 bg-red-500/10 px-5 py-4 text-sm text-red-200">
            {metadataError}
          </div>
        ) : null}

        {activeTab === "manual" ? (
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[360px,1fr]">
            <div className="rounded-3xl border border-gray-800 bg-white/[0.03] p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-cg-green/20 bg-cg-green/10 p-3 text-cg-green">
                  <Target size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white">Manual Match Situation</h2>
                  <p className="text-sm text-gray-400">Use cricket over notation like 16.2.</p>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                    Match Gender
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {[
                      { value: "male", label: "Men's T20" },
                      { value: "female", label: "Women's T20" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        onClick={() =>
                          setManualForm((current) => ({
                            ...current,
                            matchGender: option.value as ManualFormState["matchGender"],
                          }))
                        }
                        className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
                          manualForm.matchGender === option.value
                            ? "border-cg-green/40 bg-cg-green/10 text-cg-green"
                            : "border-gray-800 bg-black/20 text-gray-300"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                      Batting Team
                    </label>
                    <select
                      value={manualForm.battingTeam}
                      onChange={(event) =>
                        setManualForm((current) => ({ ...current, battingTeam: event.target.value }))
                      }
                      className="mt-2 w-full rounded-2xl border border-gray-800 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                    >
                      {availableTeams.map((team) => (
                        <option key={team} value={team}>
                          {team}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                      Bowling Team
                    </label>
                    <select
                      value={manualForm.bowlingTeam}
                      onChange={(event) =>
                        setManualForm((current) => ({ ...current, bowlingTeam: event.target.value }))
                      }
                      className="mt-2 w-full rounded-2xl border border-gray-800 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                    >
                      {availableTeams.map((team) => (
                        <option key={team} value={team}>
                          {team}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                      Innings
                    </label>
                    <select
                      value={manualForm.innings}
                      onChange={(event) =>
                        setManualForm((current) => ({ ...current, innings: Number(event.target.value) }))
                      }
                      className="mt-2 w-full rounded-2xl border border-gray-800 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                    >
                      <option value={1}>1st</option>
                      <option value={2}>2nd</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                      Strategy
                    </label>
                    <select
                      value={manualForm.strategy}
                      onChange={(event) =>
                        setManualForm((current) => ({
                          ...current,
                          strategy: event.target.value as ManualFormState["strategy"],
                        }))
                      }
                      className="mt-2 w-full rounded-2xl border border-gray-800 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                    >
                      <option value="balanced">Balanced</option>
                      <option value="batting_first">Bat First Bias</option>
                      <option value="aggressive">Aggressive</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                      Over
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="20"
                      value={manualForm.overs}
                      onChange={(event) =>
                        setManualForm((current) => ({ ...current, overs: Number(event.target.value) }))
                      }
                      className="mt-2 w-full rounded-2xl border border-gray-800 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                      Runs
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="300"
                      value={manualForm.runs}
                      onChange={(event) =>
                        setManualForm((current) => ({ ...current, runs: Number(event.target.value) }))
                      }
                      className="mt-2 w-full rounded-2xl border border-gray-800 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                      Wickets
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={manualForm.wickets}
                      onChange={(event) =>
                        setManualForm((current) => ({ ...current, wickets: Number(event.target.value) }))
                      }
                      className="mt-2 w-full rounded-2xl border border-gray-800 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                    />
                  </div>
                </div>

                {manualForm.innings === 2 ? (
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                      Target
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="400"
                      value={manualForm.target}
                      onChange={(event) =>
                        setManualForm((current) => ({ ...current, target: Number(event.target.value) }))
                      }
                      className="mt-2 w-full rounded-2xl border border-gray-800 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                    />
                  </div>
                ) : null}

                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                    Top Recommendations
                  </label>
                  <input
                    type="range"
                    min="3"
                    max="8"
                    value={manualForm.topN}
                    onChange={(event) =>
                      setManualForm((current) => ({ ...current, topN: Number(event.target.value) }))
                    }
                    className="mt-3 w-full accent-cg-green"
                  />
                  <p className="mt-2 text-sm text-gray-400">{manualForm.topN} ranked players and bowlers</p>
                </div>

                <button
                  onClick={() => void runManualAdvisor()}
                  disabled={manualLoading || metadataLoading}
                  className="w-full rounded-2xl bg-cg-green px-5 py-3 text-sm font-bold text-black transition hover:bg-cg-green-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {manualLoading ? "Running advisor..." : "Run Manual Advisor"}
                </button>

                {manualError ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {manualError}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-6">
              {manualResult ? (
                <>
                  <div className="rounded-3xl border border-gray-800 bg-white/[0.03] p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cg-green">
                          Situation Read
                        </p>
                        <h2 className="mt-3 text-3xl font-black text-white">
                          {manualResult.situation.rawDisplay}
                        </h2>
                        <p className="mt-3 text-sm leading-7 text-gray-300">
                          {manualResult.situation.battingLabel} for batting and {manualResult.situation.bowlingLabel} for bowling.
                          The batting model used a {manualResult.situation.battingContext} match while the bowling engine used a {manualResult.situation.bowlingContext} comparison set.
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:min-w-[260px]">
                        <StatCard
                          label="Current RR"
                          value={formatNumber(manualResult.situation.currentRunRate)}
                        />
                        <StatCard
                          label="Required RR"
                          value={formatNumber(manualResult.situation.requiredRunRate)}
                        />
                      </div>
                    </div>

                    {manualResult.warnings.length > 0 ? (
                      <div className="mt-5 space-y-2">
                        {manualResult.warnings.map((warning) => (
                          <div
                            key={warning}
                            className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100"
                          >
                            {warning}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Sparkles size={18} className="text-cg-green" />
                      <h3 className="text-xl font-black text-white">Batting Recommendations</h3>
                    </div>
                    {manualResult.battingRecommendations.map((recommendation, index) => (
                      <RecommendationCard
                        key={`${recommendation.player}-${recommendation.phase}-${index}`}
                        recommendation={recommendation}
                        rank={index + 1}
                      />
                    ))}
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Flame size={18} className="text-amber-300" />
                      <h3 className="text-xl font-black text-white">Bowling Recommendations</h3>
                    </div>
                    {manualResult.bowlingRecommendations.map((recommendation, index) => (
                      <BowlingCard
                        key={`${recommendation.player}-${index}`}
                        recommendation={recommendation}
                        rank={index + 1}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded-3xl border border-dashed border-gray-800 bg-white/[0.02] p-12 text-center">
                  <p className="text-lg font-semibold text-white">Run the advisor to see the integrated capstone output.</p>
                  <p className="mt-2 text-sm text-gray-400">
                    The right panel will render the batting and bowling suggestions for your custom T20 state.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === "live" ? (
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[360px,1fr]">
            <div className="rounded-3xl border border-gray-800 bg-white/[0.03] p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-cg-green/20 bg-cg-green/10 p-3 text-cg-green">
                  <Activity size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white">Live Match Advisor</h2>
                  <p className="text-sm text-gray-400">Uses the current CricGeek score state, not an external scrape.</p>
                </div>
              </div>

              <div className="mt-6">
                <label className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                  Started T20 Match
                </label>
                <select
                  value={liveMatchId}
                  onChange={(event) => {
                    setLiveMatchId(event.target.value);
                    setLiveResult(null);
                    setLiveError(null);
                  }}
                  className="mt-2 w-full rounded-2xl border border-gray-800 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                >
                  {initialMatches.length === 0 ? (
                    <option value="">No started T20 matches available</option>
                  ) : (
                    initialMatches.map((match) => (
                      <option key={match.id} value={match.id}>
                        {match.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {selectedLiveMatch ? (
                <div className="mt-5 rounded-3xl border border-gray-800 bg-black/20 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cg-green">Selected Match</p>
                  <h3 className="mt-3 text-lg font-bold text-white">{selectedLiveMatch.name}</h3>
                  <p className="mt-2 text-sm text-gray-400">{selectedLiveMatch.venue}</p>
                  <p className="mt-3 text-sm text-gray-300">{selectedLiveMatch.status}</p>
                  <div className="mt-4 space-y-2">
                    {selectedLiveMatch.score.map((score) => (
                      <div
                        key={score.inning}
                        className="flex items-center justify-between rounded-2xl border border-gray-800 bg-white/[0.03] px-4 py-3 text-sm"
                      >
                        <span className="text-gray-300">{score.inning}</span>
                        <span className="font-semibold text-white">
                          {score.r}/{score.w} ({score.o} ov)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <button
                onClick={() => void runLiveAdvisor()}
                disabled={liveLoading || !liveMatchId}
                className="mt-6 w-full rounded-2xl bg-cg-green px-5 py-3 text-sm font-bold text-black transition hover:bg-cg-green-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {liveLoading ? "Reading live context..." : "Load Live Advisor"}
              </button>

              {liveError ? (
                <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {liveError}
                </div>
              ) : null}
            </div>

            <div className="space-y-6">
              {liveResult ? (
                <>
                  <div className="rounded-3xl border border-gray-800 bg-white/[0.03] p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cg-green">
                          Live Match Read
                        </p>
                        <h2 className="mt-3 text-3xl font-black text-white">{liveResult.match.name}</h2>
                        <p className="mt-3 text-sm leading-7 text-gray-300">
                          {liveResult.situation.rawDisplay} · {liveResult.situation.battingLabel}
                        </p>
                      </div>
                      <Link
                        href={`/matches/${liveResult.match.id}`}
                        className="inline-flex items-center gap-2 rounded-2xl border border-gray-700 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white hover:bg-white/[0.08]"
                      >
                        Open Match Centre <ArrowRight size={15} />
                      </Link>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <StatCard label="Batting Team" value={liveResult.sourceContext.battingTeam} />
                      <StatCard label="Bowling Team" value={liveResult.sourceContext.bowlingTeam} />
                      <StatCard
                        label="Required RR"
                        value={formatNumber(liveResult.situation.requiredRunRate)}
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Sparkles size={18} className="text-cg-green" />
                      <h3 className="text-xl font-black text-white">Batting Recommendations</h3>
                    </div>
                    {liveResult.battingRecommendations.map((recommendation, index) => (
                      <RecommendationCard
                        key={`${recommendation.player}-${index}`}
                        recommendation={recommendation}
                        rank={index + 1}
                      />
                    ))}
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Flame size={18} className="text-amber-300" />
                      <h3 className="text-xl font-black text-white">Bowling Recommendations</h3>
                    </div>
                    {liveResult.bowlingRecommendations.map((recommendation, index) => (
                      <BowlingCard
                        key={`${recommendation.player}-${index}`}
                        recommendation={recommendation}
                        rank={index + 1}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded-3xl border border-dashed border-gray-800 bg-white/[0.02] p-12 text-center">
                  <p className="text-lg font-semibold text-white">Pick a started T20 match to translate CricGeek score state into advisor output.</p>
                  <p className="mt-2 text-sm text-gray-400">
                    This replaces the old external URL workflow with native match context.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === "evaluation" ? (
          <div className="mt-8 space-y-6">
            <div className="rounded-3xl border border-gray-800 bg-white/[0.03] p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cg-green">
                    Backtesting
                  </p>
                  <h2 className="mt-3 text-3xl font-black text-white">Model evaluation and calibration</h2>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-gray-300">
                    These metrics compare recommendation quality, coverage, calibration, and held-out lift versus the career-average baseline across sampled historical T20 situations from the integrated capstone artifacts.
                  </p>
                </div>
                <button
                  onClick={() => void runEvaluation()}
                  disabled={evaluationLoading}
                  className="rounded-2xl border border-gray-700 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {evaluationLoading ? "Refreshing..." : "Refresh Evaluation"}
                </button>
              </div>

              {evaluationError ? (
                <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {evaluationError}
                </div>
              ) : null}
            </div>

            {evaluation ? (
              <>
                {evaluation.summary.warning ? (
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                    {evaluation.summary.warning}
                  </div>
                ) : null}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    label="Top-1 Accuracy"
                    value={`${evaluation.summary.top1Accuracy.toFixed(1)}%`}
                    detail={formatInterval(evaluation.summary.top1Interval)}
                  />
                  <StatCard
                    label="Top-3 Accuracy"
                    value={`${evaluation.summary.top3Accuracy.toFixed(1)}%`}
                    detail={formatInterval(evaluation.summary.top3Interval)}
                  />
                  <StatCard
                    label="Coverage"
                    value={`${evaluation.summary.coverage.toFixed(1)}%`}
                    detail={formatInterval(evaluation.summary.coverageInterval)}
                  />
                  <StatCard
                    label="Held-out Lift"
                    value={`${evaluation.summary.improvementPct.toFixed(2)}%`}
                    detail={`${evaluation.summary.confidenceTier || "low"} confidence · ${evaluation.summary.sampleSituations} sampled situations`}
                  />
                </div>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                  <div className="rounded-3xl border border-gray-800 bg-white/[0.03] p-6">
                    <h3 className="text-xl font-black text-white">Calibration Snapshot</h3>
                    <p className="mt-2 text-sm text-gray-400">
                      Largest predicted-versus-actual gaps across sampled situations.
                    </p>
                    <div className="mt-5 overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="text-left text-gray-500">
                          <tr>
                            <th className="pb-3 pr-4">Situation</th>
                            <th className="pb-3 pr-4">Predicted</th>
                            <th className="pb-3 pr-4">Actual</th>
                            <th className="pb-3">Gap</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {evaluation.calibration.slice(0, 10).map((row) => (
                            <tr key={`${row.situation_label}-${row.calibrationGap}`}>
                              <td className="py-3 pr-4 text-gray-200">{row.situation_label}</td>
                              <td className="py-3 pr-4 text-gray-300">{row.mean_predicted.toFixed(2)}</td>
                              <td className="py-3 pr-4 text-gray-300">{row.mean_actual.toFixed(2)}</td>
                              <td className="py-3 font-semibold text-white">{row.calibrationGap.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-gray-800 bg-white/[0.03] p-6">
                    <h3 className="text-xl font-black text-white">Hard Situations</h3>
                    <p className="mt-2 text-sm text-gray-400">
                      Historical contexts where the actual best player ranked lower in the recommendation order.
                    </p>
                    <div className="mt-5 overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="text-left text-gray-500">
                          <tr>
                            <th className="pb-3 pr-4">Situation</th>
                            <th className="pb-3 pr-4">Rank</th>
                            <th className="pb-3 pr-4">Top-1</th>
                            <th className="pb-3">Top-3</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {evaluation.situations.slice(0, 10).map((row, index) => (
                            <tr key={`${row.situation_label}-${index}`}>
                              <td className="py-3 pr-4 text-gray-200">{String(row.situation_label || "Unknown")}</td>
                              <td className="py-3 pr-4 text-gray-300">{String(row.rank_of_best ?? "NA")}</td>
                              <td className="py-3 pr-4 text-gray-300">{row.p1_hit ? "Yes" : "No"}</td>
                              <td className="py-3 text-gray-300">{row.p3_hit ? "Yes" : "No"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-3xl border border-dashed border-gray-800 bg-white/[0.02] p-12 text-center">
                <p className="text-lg font-semibold text-white">Evaluation data is loading on demand.</p>
                <p className="mt-2 text-sm text-gray-400">
                  Open this tab or refresh it to compute the integrated capstone backtest metrics.
                </p>
              </div>
            )}
          </div>
        ) : null}

        {activeTab === "player" ? (
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[360px,1fr]">
            <div className="rounded-3xl border border-gray-800 bg-white/[0.03] p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-cg-green/20 bg-cg-green/10 p-3 text-cg-green">
                  <Search size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white">Player Explorer</h2>
                  <p className="text-sm text-gray-400">Search by batter name from the integrated capstone profiles.</p>
                </div>
              </div>

              <div className="mt-6">
                <label className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                  Search Player
                </label>
                <input
                  type="text"
                  value={playerQuery}
                  onChange={(event) => setPlayerQuery(event.target.value)}
                  placeholder="Type a batter name"
                  className="mt-2 w-full rounded-2xl border border-gray-800 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                />
                <div className="mt-4 space-y-2">
                  {playerMatches.map((player) => (
                    <button
                      key={player}
                      onClick={() => {
                        setPlayerQuery(player);
                        void runPlayerExplorer(player);
                      }}
                      className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                        selectedPlayer === player
                          ? "border-cg-green/40 bg-cg-green/10 text-cg-green"
                          : "border-gray-800 bg-black/20 text-gray-200 hover:border-gray-700"
                      }`}
                    >
                      {player}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => void runPlayerExplorer(playerQuery || selectedPlayer)}
                disabled={playerLoading || (!playerQuery && !selectedPlayer)}
                className="mt-6 w-full rounded-2xl bg-cg-green px-5 py-3 text-sm font-bold text-black transition hover:bg-cg-green-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {playerLoading ? "Loading profile..." : "Open Player Profile"}
              </button>

              {playerError ? (
                <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {playerError}
                </div>
              ) : null}
            </div>

            <div className="space-y-6">
              {playerExplorer ? (
                <>
                  <div className="rounded-3xl border border-gray-800 bg-white/[0.03] p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cg-green">
                          Player Situation Profile
                        </p>
                        <h2 className="mt-3 text-3xl font-black text-white">
                          {playerExplorer.summary.player}
                        </h2>
                        <p className="mt-3 text-sm leading-7 text-gray-300">
                          {playerExplorer.summary.team || "Team unavailable"} · strongest phase{" "}
                          {playerExplorer.summary.strongestPhase || "not yet established"}.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-gray-800 bg-black/20 px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                          Recorded dismissal rate
                        </p>
                        <p className="mt-2 text-2xl font-black text-white">
                          {formatPct(playerExplorer.summary.dismissalRate)}
                        </p>
                        {playerExplorer.summary.dismissalSupport?.warning ? (
                          <p className="mt-2 max-w-xs text-xs text-amber-200">
                            {playerExplorer.summary.dismissalSupport.warning}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <SupportPanel support={playerExplorer.summary.support} />

                    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <StatCard
                        label="Situations"
                        value={String(playerExplorer.summary.situations)}
                        detail={playerExplorer.summary.support ? `${playerExplorer.summary.support.confidenceTier} confidence` : undefined}
                      />
                      <StatCard
                        label="Avg xRuns"
                        value={formatNumber(playerExplorer.summary.avgExpectedRuns)}
                        detail={formatInterval(playerExplorer.summary.support?.uncertainty)}
                      />
                      <StatCard label="Entries" value={String(playerExplorer.summary.totalEntries)} />
                      <StatCard
                        label="Avg Sit. SR"
                        value={formatNumber(playerExplorer.summary.avgSituationStrikeRate)}
                      />
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                      {(["Powerplay", "Middle", "Death"] as const).map((phase) => (
                        <div
                          key={phase}
                          className="rounded-2xl border border-gray-800 bg-black/20 p-4"
                        >
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                            {phase} PDI
                          </p>
                          <p className="mt-3 text-2xl font-black text-white">
                            {formatNumber(playerExplorer.summary.pdiByPhase[phase], 2)}
                          </p>
                          {playerExplorer.summary.phaseSupport?.[phase] ? (
                            <p className="mt-2 text-xs text-gray-400">
                              n={playerExplorer.summary.phaseSupport[phase]?.sampleSize} · {playerExplorer.summary.phaseSupport[phase]?.confidenceTier} confidence
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-gray-800 bg-white/[0.03] p-6">
                    <h3 className="text-xl font-black text-white">Situation Breakdown</h3>
                    <p className="mt-2 text-sm text-gray-400">
                      Ordered by expected runs first, then historical entry volume.
                    </p>
                    <div className="mt-5 overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="text-left text-gray-500">
                          <tr>
                            <th className="pb-3 pr-4">Situation</th>
                            <th className="pb-3 pr-4">Innings</th>
                            <th className="pb-3 pr-4">Entries</th>
                            <th className="pb-3 pr-4">Avg Runs</th>
                            <th className="pb-3 pr-4">SR</th>
                            <th className="pb-3 pr-4">Dismissal</th>
                            <th className="pb-3">Confidence</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {playerExplorer.profiles.slice(0, 18).map((profile) => (
                            <tr key={`${profile.situation_label}-${profile.innings_type}`}>
                              <td className="py-3 pr-4 text-gray-200">{profile.situation_label}</td>
                              <td className="py-3 pr-4 text-gray-300">{profile.innings_type || "NA"}</td>
                              <td className="py-3 pr-4 text-gray-300">{String(profile.entry_count ?? "NA")}</td>
                              <td className="py-3 pr-4 text-gray-300">
                                {formatNumber(profile.avg_runs_after_entry)}
                              </td>
                              <td className="py-3 pr-4 text-gray-300">
                                {formatNumber(profile.avg_strike_rate_after_entry)}
                              </td>
                              <td className="py-3 text-gray-300">
                                {formatPct(profile.dismissal_probability)}
                              </td>
                              <td className="py-3 text-gray-300">
                                {profile.support ? `${profile.support.confidenceTier} · n=${profile.support.sampleSize}` : "NA"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-3xl border border-dashed border-gray-800 bg-white/[0.02] p-12 text-center">
                  <p className="text-lg font-semibold text-white">Search for a batter to load the integrated player explorer.</p>
                  <p className="mt-2 text-sm text-gray-400">
                    The explorer uses the capstone situation profiles now served inside CricGeek.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="mt-10 rounded-3xl border border-gray-800 bg-[linear-gradient(160deg,rgba(12,12,12,0.92),rgba(15,32,22,0.85))] p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cg-green">Native Integration</p>
              <h2 className="mt-3 text-2xl font-black text-white">This is now part of the main CricGeek flow.</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-gray-300">
                Live recommendations can be opened from a match page with a `matchId`, and the same backend now serves capstone-style evaluation and player exploration without leaving the product.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {selectedLiveMatch ? (
                <Link
                  href={`/matches/${selectedLiveMatch.id}`}
                  className="inline-flex items-center gap-2 rounded-2xl bg-cg-green px-4 py-3 text-sm font-bold text-black hover:bg-cg-green-dark"
                >
                  Open Match Centre <ArrowRight size={15} />
                </Link>
              ) : null}
              <button
                onClick={() => setActiveTab("manual")}
                className="inline-flex items-center gap-2 rounded-2xl border border-gray-700 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white hover:bg-white/[0.08]"
              >
                Start Manual Scenario <ShieldCheck size={15} />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
