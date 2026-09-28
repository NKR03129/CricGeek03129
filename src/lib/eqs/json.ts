/**
 * Tolerant JSON extraction for language-model output.
 *
 * Models sometimes wrap JSON in prose, emit trailing commas, or put raw newlines
 * inside strings. These helpers recover the payload without resorting to `eval`.
 */

export interface RawModelPayload {
  response?: string;
  thinking?: string;
}

/** Pulls every balanced top-level `{...}` block out of a string. */
export function extractJsonObjects(candidate: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(candidate.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}

/** Escapes raw control characters inside strings and drops trailing commas. */
export function normaliseJsonCandidate(candidate: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (const char of candidate) {
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }

    if (char === "\"") {
      output += char;
      inString = !inString;
      continue;
    }

    if (inString) {
      if (char === "\n") {
        output += "\\n";
        continue;
      }

      if (char === "\r") {
        output += "\\r";
        continue;
      }

      if (char === "\t") {
        output += "\\t";
        continue;
      }
    }

    output += char;
  }

  return output.replace(/,\s*([}\]])/g, "$1").trim();
}

/** Parses the first candidate that satisfies `validator`, or returns null. */
export function parseJsonPayload<T>(
  payload: RawModelPayload,
  validator: (value: unknown) => value is T,
): T | null {
  const candidates = [payload.response, payload.thinking]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  for (const candidate of candidates) {
    const possibleJsonObjects = [candidate, ...extractJsonObjects(candidate)];

    for (const possibleJson of possibleJsonObjects) {
      try {
        const parsed = JSON.parse(normaliseJsonCandidate(possibleJson)) as unknown;
        if (validator(parsed)) {
          return parsed;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

/** Convenience wrapper for a single raw string. */
export function parseJsonText<T>(text: string, validator: (value: unknown) => value is T): T | null {
  return parseJsonPayload<T>({ response: text }, validator);
}
