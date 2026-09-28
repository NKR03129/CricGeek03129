"use client";

import { useState, type ReactNode } from "react";
import type { PostMatchEdaCard } from "@/types/cricket";
import type { MetricConfidenceTier, MetricUncertainty } from "@/types/metrics";
import { cn } from "@/lib/utils";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

interface EdaCardsProps {
  cards: PostMatchEdaCard[];
}

function ToneIcon({ tone }: { tone?: string }) {
  if (tone === "good") return <TrendingUp size={12} className="text-emerald-400 flex-shrink-0" />;
  if (tone === "warning") return <TrendingDown size={12} className="text-amber-400 flex-shrink-0" />;
  return <Minus size={12} className="text-gray-600 flex-shrink-0" />;
}

function ProbabilityGauge({ value, ci95 }: { value: number; ci95?: [number, number] }) {
  const pct = Math.max(0, Math.min(100, value));
  const color =
    pct >= 65
      ? "from-emerald-500 to-emerald-400"
      : pct <= 35
        ? "from-amber-500 to-amber-400"
        : "from-violet-500 to-violet-400";

  return (
    <div className="mt-3 space-y-1.5">
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {ci95 ? (
        <div className="flex items-center justify-between text-[10px] text-gray-600">
          <span>{ci95[0]}%</span>
          <span className="text-gray-500">95% CI</span>
          <span>{ci95[1]}%</span>
        </div>
      ) : null}
    </div>
  );
}

function MeterBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
      <div className={cn("h-full rounded-full transition-all duration-700", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function RiskRing({ risk }: { risk: number }) {
  const r = 16;
  const circ = 2 * Math.PI * r;
  const dash = (risk / 100) * circ;
  const color = risk >= 40 ? "#f59e0b" : risk >= 20 ? "#8b5cf6" : "#10b981";

  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="flex-shrink-0">
      <circle cx="20" cy="20" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 20 20)"
        style={{ transition: "stroke-dasharray 0.7s ease" }}
      />
      <text x="20" y="24" textAnchor="middle" fontSize="9" fontWeight="bold" fill={color}>
        {risk}%
      </text>
    </svg>
  );
}

function parseNumericValue(v: string): number | null {
  const n = parseFloat(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function formatInterval(interval?: MetricUncertainty | null) {
  if (!interval) return null;
  const unit = interval.unit ?? "";
  const decimals = interval.decimals ?? 0;
  return `${interval.label} ${interval.lower.toFixed(decimals)}–${interval.upper.toFixed(decimals)}${unit}`;
}

function confidenceBadgeClass(confidence?: MetricConfidenceTier) {
  if (confidence === "high") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
  if (confidence === "medium") return "border-amber-400/25 bg-amber-400/10 text-amber-100";
  return "border-red-400/25 bg-red-400/10 text-red-100";
}

function InsightText({
  text,
  className = "mt-2 text-xs leading-relaxed text-gray-400",
}: {
  text: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const longText = text.length > 150;

  return (
    <div className="space-y-2">
      <p
        title={text}
        className={cn(className, !expanded && longText && "line-clamp-4")}
        style={{ overflowWrap: "anywhere" }}
      >
        {text}
      </p>
      {longText ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-[11px] font-semibold text-violet-300 transition-colors hover:text-violet-200"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}

function CardFrame({
  card,
  className,
  children,
}: {
  card: PostMatchEdaCard;
  className: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(className, card.quality?.suppressed && "opacity-70")}>
      {children}
      <QualityStrip card={card} />
    </div>
  );
}

function QualityStrip({ card }: { card: PostMatchEdaCard }) {
  const quality = card.quality;
  const intervalLabel = formatInterval(quality?.uncertainty);
  if (!quality && !card.subValue) return null;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
        {quality?.sampleSize !== undefined && quality?.sampleSize !== null ? (
          <span className="rounded-full border border-gray-700 bg-black/20 px-2 py-1 text-gray-300">
            n={quality.sampleSize}
          </span>
        ) : null}
        {quality?.confidence ? (
          <span className={cn("rounded-full border px-2 py-1", confidenceBadgeClass(quality.confidence))}>
            {quality.confidence} confidence
          </span>
        ) : null}
        {quality?.provenance ? (
          <span className="rounded-full border border-gray-700 bg-black/20 px-2 py-1 text-gray-400">
            {quality.provenance}
          </span>
        ) : null}
      </div>
      {card.subValue ? <p className="text-[11px] text-gray-500">{card.subValue}</p> : null}
      {intervalLabel ? <p className="text-[11px] text-gray-500">{intervalLabel}</p> : null}
      {quality?.readiness ? (
        <div className="space-y-2 rounded-xl border border-sky-500/15 bg-sky-500/[0.06] px-3 py-3">
          <div className="flex items-center justify-between gap-3 text-[11px] text-sky-100">
            <span>Collecting enough live data…</span>
            <span>
              {quality.readiness.current}/{quality.readiness.required} {quality.readiness.unit}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/20">
            <div
              className="h-full rounded-full bg-sky-400 transition-all duration-500"
              style={{
                width: `${Math.min(100, (quality.readiness.current / Math.max(quality.readiness.required, 1)) * 100)}%`,
              }}
            />
          </div>
          <p className="text-[11px] text-sky-100/90">{quality.readiness.label}</p>
        </div>
      ) : null}
      {quality?.warning ? (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[11px] text-amber-100">
          {quality.warning}
        </p>
      ) : null}
    </div>
  );
}

function WinProbabilityCard({ card }: { card: PostMatchEdaCard }) {
  const prob = parseNumericValue(card.value) ?? 50;
  const interval = card.quality?.uncertainty;
  const ci95 = interval ? [interval.lower, interval.upper] as [number, number] : undefined;

  return (
    <CardFrame
      card={card}
      className="rounded-xl border border-violet-500/25 bg-gradient-to-br from-[#1a1035]/80 to-[#0f0b22]/80 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-400/80">{card.label}</p>
        <ToneIcon tone={card.tone} />
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-3xl font-black text-white">{card.value}</p>
        {ci95 ? <span className="text-[11px] text-gray-500">±{Math.round((ci95[1] - ci95[0]) / 2)}%</span> : null}
      </div>
      <ProbabilityGauge value={prob} ci95={ci95} />
      <InsightText text={card.insight} className="mt-3 text-xs leading-relaxed text-gray-400" />
    </CardFrame>
  );
}

function ResourceCard({ card }: { card: PostMatchEdaCard }) {
  const val = parseNumericValue(card.value) ?? 0;
  const color = val >= 50 ? "bg-emerald-500" : val >= 25 ? "bg-violet-500" : "bg-amber-500";

  return (
    <CardFrame card={card} className="rounded-xl border border-gray-800 bg-cg-dark-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{card.label}</p>
        <ToneIcon tone={card.tone} />
      </div>
      <p className="mt-2 text-2xl font-black text-white">{card.value}</p>
      <MeterBar value={val} color={color} />
      <InsightText text={card.insight} />
    </CardFrame>
  );
}

function CascadeRiskCard({ card }: { card: PostMatchEdaCard }) {
  const risk = parseNumericValue(card.value) ?? 0;

  return (
    <CardFrame
      card={card}
      className={cn(
        "rounded-xl border p-4",
        risk >= 40 ? "border-amber-500/25 bg-amber-500/5" : "border-gray-800 bg-cg-dark-2"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{card.label}</p>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <RiskRing risk={risk} />
        <div>
          <p className="text-xl font-black text-white">{card.value}</p>
          <p className="text-[10px] text-gray-500">next 3 overs</p>
        </div>
      </div>
      <InsightText text={card.insight} />
    </CardFrame>
  );
}

function MomentumCard({ card }: { card: PostMatchEdaCard }) {
  const raw = card.value.replace("/100", "").trim();
  const val = parseNumericValue(raw) ?? 50;
  const delta = val - 50;
  const barColor =
    val >= 60
      ? "bg-gradient-to-r from-emerald-600 to-emerald-400"
      : val <= 40
        ? "bg-gradient-to-r from-amber-600 to-amber-400"
        : "bg-gradient-to-r from-violet-600 to-violet-400";

  return (
    <CardFrame card={card} className="rounded-xl border border-gray-800 bg-cg-dark-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{card.label}</p>
        {delta > 5 ? (
          <TrendingUp size={12} className="text-emerald-400 flex-shrink-0" />
        ) : delta < -5 ? (
          <TrendingDown size={12} className="text-amber-400 flex-shrink-0" />
        ) : (
          <Minus size={12} className="text-gray-600 flex-shrink-0" />
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-2xl font-black text-white">{val}</p>
        <span className="text-xs text-gray-500">/100</span>
        {Math.abs(delta) > 3 ? (
          <span className={cn("text-xs font-semibold", delta > 0 ? "text-emerald-400" : "text-amber-400")}>
            {delta > 0 ? "+" : ""}
            {delta.toFixed(0)}
          </span>
        ) : null}
      </div>
      <div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        {delta >= 0 ? (
          <div className={cn("absolute h-full rounded-r-full", barColor)} style={{ left: "50%", width: `${Math.min(50, delta)}%` }} />
        ) : (
          <div className={cn("absolute h-full rounded-l-full", barColor)} style={{ right: "50%", width: `${Math.min(50, -delta)}%` }} />
        )}
        <div className="absolute h-full w-px bg-white/20" style={{ left: "50%" }} />
      </div>
      <InsightText text={card.insight} />
    </CardFrame>
  );
}

function DeathForecastCard({ card }: { card: PostMatchEdaCard }) {
  const isInDeath = card.value === "In death overs";

  return (
    <CardFrame
      card={card}
      className={cn(
        "rounded-xl border p-4",
        card.tone === "good" ? "border-emerald-500/20 bg-emerald-500/5" : "border-gray-800 bg-cg-dark-2"
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{card.label}</p>
      <div className="mt-2 flex items-baseline gap-1">
        <p className={cn("text-2xl font-black", isInDeath ? "text-gray-400" : "text-white")}>{card.value}</p>
        {!isInDeath ? <span className="text-sm text-gray-500">runs</span> : null}
      </div>
      <InsightText text={card.insight} />
    </CardFrame>
  );
}

function RpiCard({ card }: { card: PostMatchEdaCard }) {
  const val = parseNumericValue(card.value) ?? 50;
  const color = val >= 60 ? "bg-emerald-500" : val <= 40 ? "bg-amber-500" : "bg-violet-500";

  return (
    <CardFrame
      card={card}
      className={cn(
        "rounded-xl border p-4",
        val >= 60 ? "border-emerald-500/20 bg-emerald-500/5" : val <= 40 ? "border-amber-500/20 bg-amber-500/5" : "border-gray-800 bg-cg-dark-2"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{card.label}</p>
        <ToneIcon tone={card.tone} />
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <p className="text-2xl font-black text-white">{val}</p>
        <span className="text-xs text-gray-500">/100</span>
      </div>
      <MeterBar value={val} color={color} />
      <InsightText text={card.insight} />
    </CardFrame>
  );
}

function DefaultCard({ card }: { card: PostMatchEdaCard }) {
  return (
    <CardFrame
      card={card}
      className={cn(
        "rounded-xl border p-4",
        card.tone === "good" && "border-emerald-500/20 bg-emerald-500/5",
        card.tone === "warning" && "border-amber-500/20 bg-amber-500/5",
        (!card.tone || card.tone === "neutral") && "border-gray-800 bg-cg-dark-2"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{card.label}</p>
        <ToneIcon tone={card.tone} />
      </div>
      <p className="mt-2 text-2xl font-black text-white">{card.value}</p>
      <InsightText text={card.insight} />
    </CardFrame>
  );
}

export default function EdaCards({ cards }: EdaCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => {
        switch (card.id) {
          case "win-probability":
            return <WinProbabilityCard key={card.id} card={card} />;
          case "dls-resources":
            return <ResourceCard key={card.id} card={card} />;
          case "rpi":
            return <RpiCard key={card.id} card={card} />;
          case "entropy-momentum":
            return <MomentumCard key={card.id} card={card} />;
          case "cascade-risk":
            return <CascadeRiskCard key={card.id} card={card} />;
          case "death-forecast":
            return <DeathForecastCard key={card.id} card={card} />;
          default:
            return <DefaultCard key={card.id} card={card} />;
        }
      })}
    </div>
  );
}
