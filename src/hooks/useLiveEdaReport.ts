"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { LIVE_EDA_POLL_INTERVAL_SECONDS } from "@/lib/eda/live";
import type { LiveEdaReport } from "@/types/eda";

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

type UseLiveEdaReportOptions = {
  matchId: string;
  enabled: boolean;
  pollIntervalSeconds?: number;
};

export function useLiveEdaReport({
  matchId,
  enabled,
  pollIntervalSeconds = LIVE_EDA_POLL_INTERVAL_SECONDS,
}: UseLiveEdaReportOptions) {
  const [report, setReport] = useState<LiveEdaReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const loadReport = useEffectEvent(async (mode: "initial" | "refresh" = "refresh") => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (mode === "initial" && !report) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const payload = await readJson<LiveEdaReport>(`/api/eda/live?matchId=${encodeURIComponent(matchId)}`, {
        cache: "no-store",
        signal: controller.signal,
      });

      setReport((current) =>
        current?.freshness.generatedAt === payload.freshness.generatedAt &&
        current?.snapshot.runs === payload.snapshot.runs &&
        current?.snapshot.wickets === payload.snapshot.wickets &&
        current?.snapshot.overs === payload.snapshot.overs
          ? current
          : payload
      );
      setError(null);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "Unable to load live intelligence right now.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  });

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      setReport(null);
      setError(null);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    void loadReport("initial");

    const interval = window.setInterval(() => {
      void loadReport("refresh");
    }, pollIntervalSeconds * 1000);

    return () => {
      window.clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [enabled, matchId, pollIntervalSeconds]);

  return {
    report,
    error,
    isLoading,
    isRefreshing,
  };
}
