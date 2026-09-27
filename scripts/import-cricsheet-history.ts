import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { buildHistoricalImportBundleFromCricsheet } from "@/lib/historical-warehouse";

function parseArgs(argv: string[]) {
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(token, true);
      continue;
    }

    flags.set(token, next);
    index += 1;
  }

  return {
    dir: typeof flags.get("--dir") === "string" ? String(flags.get("--dir")) : null,
    file: typeof flags.get("--file") === "string" ? String(flags.get("--file")) : null,
    limit: typeof flags.get("--limit") === "string" ? Number.parseInt(String(flags.get("--limit")), 10) : null,
  };
}

async function collectJsonFiles(targetDir: string): Promise<string[]> {
  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectJsonFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

async function importFile(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  const sourceMatchId = path.basename(filePath, ".json");
  const parsed = JSON.parse(raw) as unknown;
  const bundle = buildHistoricalImportBundleFromCricsheet(sourceMatchId, parsed as never);

  if (!bundle) {
    console.warn(`Skipping ${filePath}: could not build import rows.`);
    return false;
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.historicalMatch.upsert({
        where: {
          source_sourceMatchId: {
            source: "cricsheet",
            sourceMatchId,
          },
        },
        create: bundle.match,
        update: {
          startedAt: bundle.match.startedAt,
          season: bundle.match.season,
          matchType: bundle.match.matchType,
          eventName: bundle.match.eventName,
          eventNameKey: bundle.match.eventNameKey,
          venue: bundle.match.venue,
          venueKey: bundle.match.venueKey,
          city: bundle.match.city,
          teamA: bundle.match.teamA,
          teamAKey: bundle.match.teamAKey,
          teamB: bundle.match.teamB,
          teamBKey: bundle.match.teamBKey,
          winner: bundle.match.winner,
          winnerKey: bundle.match.winnerKey,
          resultText: bundle.match.resultText,
          playerOfMatch: bundle.match.playerOfMatch,
          rawInfo: bundle.match.rawInfo,
        },
      });

      await tx.historicalBattingInnings.deleteMany({ where: { matchId: bundle.match.id } });
      await tx.historicalBowlingInnings.deleteMany({ where: { matchId: bundle.match.id } });

      if (bundle.battingRows.length > 0) {
        await tx.historicalBattingInnings.createMany({
          data: bundle.battingRows,
        });
      }

      if (bundle.bowlingRows.length > 0) {
        await tx.historicalBowlingInnings.createMany({
          data: bundle.bowlingRows,
        });
      }

      if (bundle.aliases.length > 0) {
        await tx.historicalPlayerAlias.createMany({
          data: bundle.aliases,
          skipDuplicates: true,
        });
      }
    },
    {
      maxWait: 15_000,
      timeout: 60_000,
    }
  );

  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.dir && !args.file) {
    console.error("Usage: npx tsx scripts/import-cricsheet-history.ts --dir <folder> | --file <match.json> [--limit 500]");
    process.exit(1);
  }

  const files = args.file ? [path.resolve(args.file)] : await collectJsonFiles(path.resolve(args.dir!));
  const limitedFiles = typeof args.limit === "number" && Number.isFinite(args.limit)
    ? files.slice(0, Math.max(0, args.limit))
    : files;

  if (limitedFiles.length === 0) {
    console.error("No JSON files found to import.");
    process.exit(1);
  }

  let imported = 0;
  let skipped = 0;

  for (const filePath of limitedFiles) {
    try {
      const ok = await importFile(filePath);
      if (ok) {
        imported += 1;
        if (imported % 100 === 0) {
          console.log(`Imported ${imported}/${limitedFiles.length} files...`);
        }
      } else {
        skipped += 1;
      }
    } catch (error) {
      skipped += 1;
      console.warn(`Failed to import ${filePath}:`, error);
    }
  }

  console.log(`Historical warehouse import complete. Imported: ${imported}. Skipped: ${skipped}.`);
}

main()
  .catch((error) => {
    console.error("Historical warehouse import failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
