/**
 * Regenerates `prisma/eqs_migration.sql` from `src/lib/eqs/db-ddl.ts`.
 *
 * Run after changing the DDL so the checked-in migration and the runtime bootstrap
 * can never drift apart:
 *
 *   node scripts/generate-eqs-migration.mjs
 *
 * The DDL module is parsed rather than imported so this script needs no TypeScript
 * toolchain and no database connection.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ddlPath = resolve(projectRoot, "src/lib/eqs/db-ddl.ts");
const outputPath = resolve(projectRoot, "prisma/eqs_migration.sql");

const source = readFileSync(ddlPath, "utf8");

const arrayStart = source.indexOf("EQS_DDL_STATEMENTS: string[] = [");
if (arrayStart === -1) {
  throw new Error("Could not find EQS_DDL_STATEMENTS in src/lib/eqs/db-ddl.ts");
}

const versionMatch = source.match(/EQS_SCHEMA_VERSION\s*=\s*"([^"]+)"/);
const schemaVersion = versionMatch ? versionMatch[1] : "unknown";

// Each statement is a backtick template literal with no interpolation, so pulling
// the backtick-delimited spans out is unambiguous.
const body = source.slice(arrayStart);
const statements = [];
let index = 0;

while (index < body.length) {
  const open = body.indexOf("`", index);
  if (open === -1) break;

  const close = body.indexOf("`", open + 1);
  if (close === -1) {
    throw new Error("Unterminated template literal in the DDL array");
  }

  const statement = body.slice(open + 1, close).trim();
  if (statement.length > 0) {
    if (statement.includes("${")) {
      throw new Error(`DDL statements must not interpolate: ${statement.slice(0, 60)}`);
    }
    statements.push(statement);
  }

  index = close + 1;
}

if (statements.length === 0) {
  throw new Error("No DDL statements were extracted");
}

const header = `-- ============================================================================
-- CricGeek EQS / Voice-to-Commentary schema
--
-- GENERATED FILE - DO NOT EDIT BY HAND.
-- Source of truth: src/lib/eqs/db-ddl.ts
-- Regenerate with:  node scripts/generate-eqs-migration.mjs
--
-- Schema version: ${schemaVersion}
-- Statements:     ${statements.length}
-- Target:         Microsoft SQL Server
--
-- Every statement is idempotent, so this file is safe to run more than once.
-- The application also applies these statements at runtime via ensureEqsTables().
-- Once you have applied this file by hand, set EQS_AUTO_MIGRATE=false to skip the
-- runtime check.
-- ============================================================================

`;

const sql = header + statements.map((statement) => `${statement};\nGO\n`).join("\n");

writeFileSync(outputPath, sql, "utf8");
console.log(
  `Wrote ${statements.length} statements (schema ${schemaVersion}) to prisma/eqs_migration.sql`,
);
