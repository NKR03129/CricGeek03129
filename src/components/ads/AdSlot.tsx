"use client";

import { useEffect } from "react";

interface AdSlotProps {
  slot: string;
  format?: "auto" | "horizontal" | "vertical" | "rectangle";
  className?: string;
}

export default function AdSlot({ slot, format = "auto", className = "" }: AdSlotProps) {
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;

  useEffect(() => {
    if (clientId) {
      try {
        // @ts-expect-error - adsbygoogle is injected externally
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        // AdSense not loaded
      }
    }
  }, [clientId]);

  if (!clientId) {
    // Placeholder for development
    return (
      <div
        className={`bg-gray-900/50 border border-dashed border-gray-700 rounded-lg flex items-center justify-center text-gray-500 text-xs ${className}`}
        style={{ minHeight: format === "horizontal" ? 90 : format === "rectangle" ? 250 : 100 }}
      >
        <span>Ad Space</span>
      </div>
    );
  }

  return (
    <div className={className}>
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={clientId}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}
