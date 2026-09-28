const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 5050);
const OLLAMA_UPSTREAM = process.env.OLLAMA_UPSTREAM || "http://127.0.0.1:11434";
const OLLAMA_SHARED_SECRET = process.env.OLLAMA_SHARED_SECRET || "";
const REQUEST_TIMEOUT_MS = 120_000;
const ALLOWED_PATHS = new Set(["/api/tags", "/api/generate", "/api/chat"]);

if (!OLLAMA_SHARED_SECRET) {
  console.error("Missing OLLAMA_SHARED_SECRET. Set it in ollama-proxy/.env before starting.");
  process.exit(1);
}

const app = express();

app.use(express.json({ limit: "10mb" }));

app.use((error, _req, res, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  return next(error);
});

app.use((req, res, next) => {
  if (!ALLOWED_PATHS.has(req.path)) {
    return res.status(404).json({ error: "Route not found" });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Only GET and POST are supported" });
  }

  const expected = `Bearer ${OLLAMA_SHARED_SECRET}`;
  const authorization = req.header("authorization");

  if (authorization !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
});

app.all("/api/tags", forwardToOllama);
app.all("/api/generate", forwardToOllama);
app.all("/api/chat", forwardToOllama);

app.use((_req, res) => {
  return res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`Ollama auth proxy listening on http://127.0.0.1:${PORT}`);
  console.log(`Forwarding allowed requests to ${OLLAMA_UPSTREAM}`);
});

async function forwardToOllama(req, res) {
  const upstreamUrl = `${OLLAMA_UPSTREAM}${req.path}`;
  const headers = { Accept: "application/json" };
  const requestInit = {
    method: req.method,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };

  if (req.method === "POST") {
    headers["Content-Type"] = "application/json";
    requestInit.body = JSON.stringify(req.body ?? {});
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl, requestInit);
    const contentType = upstreamResponse.headers.get("content-type") || "application/json";
    const responseText = await upstreamResponse.text();

    res.status(upstreamResponse.status);
    res.setHeader("Content-Type", contentType);
    return res.send(responseText);
  } catch (error) {
    const message =
      error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
        ? "Upstream Ollama request timed out"
        : "Failed to reach local Ollama upstream";

    console.error(`[proxy] ${req.method} ${req.path} failed:`, error);
    return res.status(502).json({
      error: message,
      upstream: upstreamUrl,
    });
  }
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const contents = fs.readFileSync(filePath, "utf8");

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
