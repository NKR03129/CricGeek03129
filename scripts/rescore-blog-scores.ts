import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runScoringPipeline } from "@/lib/scoring";

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
    all: flags.has("--all"),
    blogId: typeof flags.get("--blogId") === "string" ? String(flags.get("--blogId")) : null,
    slug: typeof flags.get("--slug") === "string" ? String(flags.get("--slug")) : null,
    title: typeof flags.get("--title") === "string" ? String(flags.get("--title")) : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.all && !args.blogId && !args.slug && !args.title) {
    console.error("Usage: npx tsx scripts/rescore-blog-scores.ts --blogId <id> | --slug <slug> | --title <title> | --all");
    process.exit(1);
  }

  const blogs = await prisma.blog.findMany({
    where: args.all
      ? {}
      : {
          ...(args.blogId ? { id: args.blogId } : {}),
          ...(args.slug ? { slug: args.slug } : {}),
          ...(args.title ? { title: args.title } : {}),
        },
    select: {
      id: true,
      title: true,
      slug: true,
      content: true,
      matchTag: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (blogs.length === 0) {
    console.error("No matching blogs found.");
    process.exit(1);
  }

  for (const blog of blogs) {
    console.log(`Rescoring ${blog.slug}...`);
    const result = await runScoringPipeline({
      title: blog.title,
      content: blog.content,
      matchId: blog.matchTag,
    });
    const directStats = result.factCheck.directStats;
    const paragraphScoresJson = result.paragraphScores as unknown as Prisma.InputJsonValue;
    const explanationJson = result.explanation as unknown as Prisma.InputJsonValue;
    const factCheckJson = result.factCheck as unknown as Prisma.InputJsonValue;

    await prisma.blogScore.upsert({
      where: { blogId: blog.id },
      create: {
        blogId: blog.id,
        bqs: result.bqs,
        toneScore: result.modelScores.toneScore,
        negativityScore: result.modelScores.negativityScore,
        toxicityScore: result.modelScores.toxicityScore,
        originalityScore: result.modelScores.originalityScore,
        coherenceScore: result.modelScores.coherenceScore,
        archetypeLabel: result.modelScores.archetypeLabel,
        archetypeConfidence: result.modelScores.archetypeConfidence,
        entitiesFound: result.nerResult.entities.length,
        statsFound: directStats.claimsFound,
        statsVerified: directStats.claimsVerified,
        statAccuracy: result.statAccuracy,
        constructiveness: result.ruleEngine.constructiveness,
        evidencePresence: result.ruleEngine.evidencePresence,
        counterAcknowledge: result.ruleEngine.counterAcknowledge,
        positionClarity: result.ruleEngine.positionClarity,
        infoDensity: result.ruleEngine.infoDensity,
        repetitionPenalty: result.ruleEngine.repetitionPenalty,
        completeness: result.ruleEngine.completeness,
        paragraphScores: paragraphScoresJson,
        explanationJson,
        factCheckJson,
        toxicityPenaltyApplied: result.ruleEngine.toxicityPenaltyApplied,
        toxicityPenaltyOverride: result.ruleEngine.toxicityPenaltyOverride,
        scoreVersion: result.scoreVersion,
        wordCount: result.preProcess.wordCount,
        lexicalDiversity: result.preProcess.lexicalDiversity,
        sentenceVariety: result.preProcess.sentenceVariety,
        processingStatus: "completed",
        processingTimeMs: result.processingTimeMs,
      },
      update: {
        bqs: result.bqs,
        toneScore: result.modelScores.toneScore,
        negativityScore: result.modelScores.negativityScore,
        toxicityScore: result.modelScores.toxicityScore,
        originalityScore: result.modelScores.originalityScore,
        coherenceScore: result.modelScores.coherenceScore,
        archetypeLabel: result.modelScores.archetypeLabel,
        archetypeConfidence: result.modelScores.archetypeConfidence,
        entitiesFound: result.nerResult.entities.length,
        statsFound: directStats.claimsFound,
        statsVerified: directStats.claimsVerified,
        statAccuracy: result.statAccuracy,
        constructiveness: result.ruleEngine.constructiveness,
        evidencePresence: result.ruleEngine.evidencePresence,
        counterAcknowledge: result.ruleEngine.counterAcknowledge,
        positionClarity: result.ruleEngine.positionClarity,
        infoDensity: result.ruleEngine.infoDensity,
        repetitionPenalty: result.ruleEngine.repetitionPenalty,
        completeness: result.ruleEngine.completeness,
        paragraphScores: paragraphScoresJson,
        explanationJson,
        factCheckJson,
        toxicityPenaltyApplied: result.ruleEngine.toxicityPenaltyApplied,
        toxicityPenaltyOverride: result.ruleEngine.toxicityPenaltyOverride,
        scoreVersion: result.scoreVersion,
        wordCount: result.preProcess.wordCount,
        lexicalDiversity: result.preProcess.lexicalDiversity,
        sentenceVariety: result.preProcess.sentenceVariety,
        processingStatus: "completed",
        processingTimeMs: result.processingTimeMs,
      },
    });

    console.log(
      `Done: ${blog.slug} -> ${result.modelScores.archetypeLabel} (${result.scoreVersion}, BQS ${result.bqs})`
    );
  }
}

main()
  .catch((error) => {
    console.error("Rescore failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
