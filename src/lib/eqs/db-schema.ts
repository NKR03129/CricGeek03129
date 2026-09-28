/**
 * Applies the EQS / Voice schema (spec section 11).
 *
 * The DDL itself lives in `db-ddl.ts`; `prisma/eqs_migration.sql` is generated from
 * it, and the same tables are declared in `prisma/schema.prisma` so the ORM can read
 * them.
 *
 * Why apply DDL at runtime: it lets a freshly cloned checkout start scoring without
 * a separate migration step, which is the difference between "works after setup" and
 * "works after setup plus tribal knowledge". Set `EQS_AUTO_MIGRATE=false` once the
 * SQL has been applied by hand.
 */

import { prisma } from "@/lib/db";
import { EQS_DDL_STATEMENTS, EQS_SCHEMA_VERSION } from "@/lib/eqs/db-ddl";

export { EQS_DDL_STATEMENTS, EQS_SCHEMA_VERSION };

let bootstrapPromise: Promise<boolean> | null = null;

function autoMigrateEnabled() {
  return process.env.EQS_AUTO_MIGRATE !== "false";
}

/**
 * Creates the EQS tables if they are missing. Runs at most once per process and
 * never throws: persistence is best-effort so a schema problem degrades auditability
 * rather than breaking scoring.
 */
export function ensureEqsTables(): Promise<boolean> {
  if (!autoMigrateEnabled()) return Promise.resolve(true);

  if (!bootstrapPromise) {
    const attempt = (async () => {
      for (const statement of EQS_DDL_STATEMENTS) {
        await prisma.$executeRawUnsafe(statement);
      }
      return true;
    })().catch((error) => {
      console.error("[eqs] Schema bootstrap failed; EQS results will not be persisted.", error);
      // Clear the memo so a later request can retry, e.g. after the DB comes back up.
      if (bootstrapPromise === attempt) bootstrapPromise = null;
      return false;
    });

    bootstrapPromise = attempt;
  }

  return bootstrapPromise;
}

export function resetEqsSchemaBootstrap() {
  bootstrapPromise = null;
}
