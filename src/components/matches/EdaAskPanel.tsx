"use client";

import { useState } from "react";
import { BrainCircuit, ExternalLink, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EdaAskResponse, EdaAskRoute, EdaSourceReference } from "@/types/eda";

type EdaAskPanelProps = {
  matchId?: string;
  team?: string;
  tournament?: string;
  title?: string;
  description?: string;
  suggestions?: string[];
  className?: string;
};

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

function formatRouteLabel(route: EdaAskRoute) {
  switch (route) {
    case "hybrid":
      return "Structured + news + retrieval";
    case "structured_plus_news":
      return "Structured + news";
    case "structured_plus_rag":
      return "Structured + retrieval";
    case "news_only":
      return "News-backed";
    case "rag_only":
      return "Retrieval-backed";
    default:
      return "Structured";
  }
}

function formatSourceLabel(type: EdaSourceReference["type"]) {
  switch (type) {
    case "historical_warehouse":
      return "Warehouse";
    case "sportmonks":
      return "SportMonks";
    case "application":
      return "App";
    case "llm":
      return "LLM";
    default:
      return type.replace(/_/g, " ");
  }
}

function isExternalUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

export default function EdaAskPanel({
  matchId,
  team,
  tournament,
  title = "Ask CricGeek",
  description = "Hybrid answers grounded in match data, linked CricGeek coverage, recent cricket news, and optional internal retrieval.",
  suggestions = [],
  className,
}: EdaAskPanelProps) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<EdaAskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const quickPrompts = [...new Set(suggestions.map((item) => item.trim()).filter(Boolean))].slice(0, 4);

  async function submit(nextQuestion?: string) {
    const prompt = (nextQuestion ?? question).trim();
    if (!prompt || loading) return;

    if (nextQuestion) {
      setQuestion(prompt);
    }

    setLoading(true);
    setError(null);

    try {
      const payload = await readJson<EdaAskResponse>("/api/eda/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: prompt,
          matchId: matchId ?? null,
          team: team ?? null,
          tournament: tournament ?? null,
        }),
      });

      setResult(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to answer that question right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={cn("rounded-xl border border-gray-800 bg-cg-dark-2 p-5", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-cg-green/20 bg-cg-green/10 text-cg-green">
              <BrainCircuit size={16} />
            </span>
            <h2 className="text-lg font-bold text-white">{title}</h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-gray-400">{description}</p>
        </div>
        {result ? (
          <div className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-gray-300">
            {formatRouteLabel(result.route)} | Confidence {Math.round(result.confidence.score)}%
          </div>
        ) : null}
      </div>

      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="eda-question">
            Ask a cricket intelligence question
          </label>
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-gray-500" />
            <input
              id="eda-question"
              type="text"
              value={question}
              maxLength={280}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about venue bias, tactical swing points, form, or what decided the match"
              className="w-full rounded-lg border border-gray-700 bg-cg-dark pl-10 pr-4 py-3 text-sm text-white outline-none transition focus:border-cg-green/40"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-cg-green px-4 py-3 text-sm font-semibold text-black transition hover:bg-cg-green-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <BrainCircuit size={16} />}
            {loading ? "Thinking..." : "Ask"}
          </button>
        </div>
      </form>

      {quickPrompts.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void submit(prompt)}
              disabled={loading}
              className="rounded-full border border-gray-700 bg-cg-dark px-3 py-1.5 text-xs text-gray-300 transition hover:border-cg-green/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-4">
            <p className="whitespace-pre-line text-sm leading-7 text-gray-200">{result.answer}</p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-gray-400">
            <span className="rounded-full bg-white/5 px-3 py-1.5">
              Route {formatRouteLabel(result.route)}
            </span>
            <span className="rounded-full bg-white/5 px-3 py-1.5">
              Confidence {Math.round(result.confidence.score)}% | {result.confidence.label}
            </span>
            <span className="rounded-full bg-white/5 px-3 py-1.5">
              Generated {new Date(result.freshness.generatedAt).toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Kolkata",
              })}
            </span>
          </div>

          {result.contextPreview.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-white">What this answer used</h3>
              <div className="mt-3 space-y-2">
                {result.contextPreview.slice(0, 3).map((item) => (
                  <div key={item} className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3 text-sm text-gray-400">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {result.citations.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-white">Sources</h3>
              <div className="mt-3 space-y-2">
                {result.citations.map((citation) => {
                  const href = citation.url || "";
                  const external = href ? isExternalUrl(href) : false;

                  return (
                    <div key={`${citation.type}-${citation.id}`} className="rounded-lg border border-gray-800 bg-cg-dark px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-gray-400">
                          {formatSourceLabel(citation.type)}
                        </span>
                        <p className="text-sm font-semibold text-white">{citation.title}</p>
                        {href ? (
                          <a
                            href={href}
                            target={external ? "_blank" : undefined}
                            rel={external ? "noreferrer" : undefined}
                            className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200"
                          >
                            Open
                            <ExternalLink size={12} />
                          </a>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-gray-400">{citation.note}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-gray-800 bg-cg-dark px-4 py-4 text-sm text-gray-400">
          Ask a direct question and CricGeek will combine structured match context with recent cricket coverage and any available internal retrieval context.
        </div>
      )}
    </section>
  );
}
