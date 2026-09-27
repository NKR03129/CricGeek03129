type CommentaryBadge = {
  label: string;
  bgClass: string;
  textClass: string;
};

const EMPHASIS_PATTERN =
  /(^[A-Z][A-Za-z.' -]{1,40}:)|\b(FOUR|SIX|WICKET|CAUGHT|BOWLED|LBW|RUN OUT|NO BALL|WIDE|DOT BALL|FREE HIT|FIFTY|HUNDRED|timeout|Timeout|Six|Four|Wicket|Out|out|caught|bowled|lbw|run out|\d+(?:\.\d+)?\s*(?:ks|km\/h|mph|runs?|wickets?|overs?|balls?|off \d+|for \d+))\b/g;

function renderPlainSegment(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let partIndex = 0;

  while ((match = EMPHASIS_PATTERN.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }

    parts.push(
      <strong key={`${keyPrefix}-strong-${partIndex}`} className="font-semibold text-white">
        {match[0]}
      </strong>
    );
    partIndex += 1;
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts;
}

export function renderCommentaryText(text: string): React.ReactNode[] {
  const segments = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  const nodes: React.ReactNode[] = [];

  segments.forEach((segment, index) => {
    if (segment.startsWith("**") && segment.endsWith("**")) {
      nodes.push(
        <strong key={`md-bold-${index}`} className="font-semibold text-white">
          {segment.slice(2, -2)}
        </strong>
      );
      return;
    }

    nodes.push(...renderPlainSegment(segment, `seg-${index}`));
  });

  return nodes;
}

export function inferCommentaryBadge(text: string): CommentaryBadge | null {
  const lower = text.toLowerCase();

  if (/\bwide\b/.test(lower)) {
    return { label: "Wd", bgClass: "bg-amber-500/20 border border-amber-400/30", textClass: "text-amber-200" };
  }
  if (/\bno ball\b/.test(lower)) {
    return { label: "Nb", bgClass: "bg-orange-500/20 border border-orange-400/30", textClass: "text-orange-200" };
  }
  if (/\bsix\b/.test(lower) || /\b6\b/.test(text)) {
    return { label: "6", bgClass: "bg-violet-600", textClass: "text-white" };
  }
  if (/\bfour\b/.test(lower) || /\b4\b/.test(text)) {
    return { label: "4", bgClass: "bg-cg-green", textClass: "text-black" };
  }
  if (/\bwicket\b|bowled|caught|lbw|run out\b/i.test(text)) {
    return { label: "W", bgClass: "bg-red-600", textClass: "text-white" };
  }

  return null;
}

export function inferRunContribution(text: string): number {
  const lower = text.toLowerCase();

  if (/\bsix\b/.test(lower)) return 6;
  if (/\bfour\b/.test(lower)) return 4;
  if (/\bthree runs?\b/.test(lower)) return 3;
  if (/\btwo runs?\b/.test(lower)) return 2;
  if (/\bone run\b/.test(lower) || /\bsingle\b/.test(lower)) return 1;
  if (/\bwide\b/.test(lower) || /\bno ball\b/.test(lower)) return 1;

  const explicit = text.match(/\b([1-6])\b/);
  if (explicit) {
    return Number(explicit[1]);
  }

  return 0;
}

export function formatCommentaryTimestamp(iso: string, includeDate = false): string {
  return new Date(iso).toLocaleString("en-IN", {
    ...(includeDate ? { day: "2-digit", month: "short" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function getOverGroupLabel(overText: string | null): string | null {
  if (!overText) return null;
  const trimmed = overText.trim();
  const integerPart = trimmed.split(".")[0];
  return integerPart || trimmed;
}

