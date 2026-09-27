import { prisma } from "@/lib/db";

type EmbeddingRow = {
  blogId: string;
  title: string | null;
  embeddingJson: string;
};

type BlogRow = {
  id: string;
  title: string;
  content: string;
};

export type InternalOriginalityMatch = {
  maxSimilarity: number;
  threshold: number;
  flagged: boolean;
  matchedBlogId: string | null;
  matchedTitle: string | null;
};

const EMBEDDING_DIMENSIONS = 192;
const DEFAULT_THRESHOLD = 0.85;
const DEFAULT_CANDIDATE_LIMIT = 120;

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Operation aborted", "AbortError");
  }
}

function tokenize(text: string) {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

function hashToken(token: string) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

export function createEmbedding(text: string) {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  const tokens = tokenize(text);

  if (!tokens.length) return vector;

  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % EMBEDDING_DIMENSIONS;
    vector[index] += 1;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;

  return vector.map((value) => Number((value / norm).toFixed(6)));
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || !right.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }

  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

async function ensureEmbeddingTable() {
  await prisma.$executeRawUnsafe(`
    IF OBJECT_ID(N'dbo.ExpressionEmbedding', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.ExpressionEmbedding (
        blogId VARCHAR(30) NOT NULL PRIMARY KEY,
        title NVARCHAR(200) NULL,
        embeddingJson NVARCHAR(MAX) NOT NULL,
        createdAt DATETIME2 NOT NULL CONSTRAINT DF_ExpressionEmbedding_createdAt DEFAULT SYSUTCDATETIME(),
        updatedAt DATETIME2 NOT NULL CONSTRAINT DF_ExpressionEmbedding_updatedAt DEFAULT SYSUTCDATETIME()
      );

      CREATE INDEX IX_ExpressionEmbedding_updatedAt ON dbo.ExpressionEmbedding(updatedAt DESC);
    END
  `);
}

export async function upsertExpressionEmbedding(input: { blogId: string; title?: string | null; content: string }) {
  await ensureEmbeddingTable();
  const embedding = createEmbedding(input.content);
  const embeddingJson = JSON.stringify(embedding);

  await prisma.$executeRawUnsafe(
    `
      MERGE dbo.ExpressionEmbedding AS target
      USING (SELECT @P1 AS blogId, @P2 AS title, @P3 AS embeddingJson) AS source
      ON target.blogId = source.blogId
      WHEN MATCHED THEN
        UPDATE SET title = source.title, embeddingJson = source.embeddingJson, updatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (blogId, title, embeddingJson)
        VALUES (source.blogId, source.title, source.embeddingJson);
    `,
    input.blogId,
    input.title || null,
    embeddingJson,
  );
}

export async function backfillMissingExpressionEmbeddings(limit = 120) {
  await ensureEmbeddingTable();

  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT TOP (${Math.max(1, Math.min(limit, 500))})
        b.id,
        b.title,
        b.content
      FROM Blog b
      LEFT JOIN dbo.ExpressionEmbedding e ON e.blogId = b.id
      WHERE b.status = 'approved' AND e.blogId IS NULL
      ORDER BY b.createdAt DESC
    `,
  )) as BlogRow[];

  for (const row of rows) {
    await upsertExpressionEmbedding({ blogId: row.id, title: row.title, content: row.content });
  }

  return rows.length;
}

export async function assessInternalOriginality(input: { content: string; excludeBlogId?: string | null; signal?: AbortSignal }) {
  throwIfAborted(input.signal);
  await ensureEmbeddingTable();
  throwIfAborted(input.signal);

  const threshold = Number(process.env.INTERNAL_DUPLICATE_THRESHOLD || DEFAULT_THRESHOLD);
  const candidateLimit = Math.max(
    50,
    Math.min(Number(process.env.INTERNAL_ORIGINALITY_CANDIDATES || DEFAULT_CANDIDATE_LIMIT), 5000),
  );
  const currentEmbedding = createEmbedding(input.content);
  throwIfAborted(input.signal);

  const rows = (await prisma.$queryRawUnsafe(
    `
      SET LOCK_TIMEOUT 2000;
      SELECT TOP (${candidateLimit}) blogId, title, embeddingJson
      FROM dbo.ExpressionEmbedding
      ORDER BY updatedAt DESC
    `,
  )) as EmbeddingRow[];

  let maxSimilarity = 0;
  let matchedBlogId: string | null = null;
  let matchedTitle: string | null = null;

  for (const row of rows) {
    throwIfAborted(input.signal);
    if (input.excludeBlogId && row.blogId === input.excludeBlogId) continue;

    let parsed: number[] | null = null;
    try {
      const value = JSON.parse(row.embeddingJson);
      if (Array.isArray(value) && value.length === EMBEDDING_DIMENSIONS) {
        parsed = value.map((item) => (typeof item === "number" ? item : 0));
      }
    } catch {
      parsed = null;
    }

    if (!parsed) continue;

    const score = cosineSimilarity(currentEmbedding, parsed);
    if (score > maxSimilarity) {
      maxSimilarity = score;
      matchedBlogId = row.blogId;
      matchedTitle = row.title || null;
    }
  }

  const response: InternalOriginalityMatch = {
    maxSimilarity: Number(maxSimilarity.toFixed(4)),
    threshold,
    flagged: maxSimilarity >= threshold,
    matchedBlogId,
    matchedTitle,
  };

  return response;
}
