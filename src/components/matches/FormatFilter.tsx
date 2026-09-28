"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const FORMATS = ["All", "T20", "T20I", "ODI", "ODI-W", "Test", "FC"] as const;
type Format = (typeof FORMATS)[number];

interface FormatFilterProps {
  selected: Format;
  onChange: (f: Format) => void;
}

export default function FormatFilter({ selected, onChange }: FormatFilterProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {FORMATS.map((f) => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
            selected === f
              ? "bg-cg-green text-black"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
          )}
        >
          {f}
        </button>
      ))}
    </div>
  );
}
