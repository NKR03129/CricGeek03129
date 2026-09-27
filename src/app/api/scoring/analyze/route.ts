import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recomputeContestLeaderboard } from "@/lib/contest";
import {
  runScoringPipeline,
  calculateDNAUpdate,
  calculateWriterTitle,
  calculateBCS,
  BADGE_DEFINITIONS,
  ACHIEVEMENT_DEFINITIONS,
  DNA_ACHIEVEMENT_DEFINITIONS,
  type WriterDNA,
} from "@/lib/scoring";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { blogId } = await req.json();

    if (!blogId) {
      return NextResponse.json({ error: "blogId is required" }, { status: 400 });
    }

    const blog = await prisma.blog.findUnique({
      where: { id: blogId },
      include: { author: true },
    });

    if (!blog) {
      return NextResponse.json({ error: "Blog not found" }, { status: 404 });
    }

    // Mark as processing
    await prisma.blogScore.upsert({
      where: { blogId },
      create: { blogId, processingStatus: "processing" },
      update: { processingStatus: "processing" },
    });

    // ── Run the 7-step scoring pipeline ─────────────────────────────
    const result = await runScoringPipeline({
      title: blog.title,
      content: blog.content,
      matchId: blog.matchTag,
    });
    const directStats = result.factCheck.directStats;
    const paragraphScoresJson = result.paragraphScores as unknown as Prisma.InputJsonValue;
    const explanationJson = result.explanation as unknown as Prisma.InputJsonValue;
    const factCheckJson = result.factCheck as unknown as Prisma.InputJsonValue;

    // ── Save BlogScore ───────────────────────────────────────────────
    const blogScore = await prisma.blogScore.upsert({
      where: { blogId },
      create: {
        blogId,
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

    // ── Update or create WriterProfile ──────────────────────────────
    const existingProfile = await prisma.writerProfile.findUnique({
      where: { userId: blog.authorId },
    });

    // Recalculate average BQS across all blogs
    const allScores = await prisma.blogScore.findMany({
      where: { blog: { authorId: blog.authorId } },
      select: { bqs: true, statAccuracy: true, infoDensity: true },
    });
    const avgBQS = allScores.reduce((sum, s) => sum + s.bqs, 0) / allScores.length;
    const avgStatAccuracy =
      allScores.reduce((sum, s) => sum + s.statAccuracy, 0) / allScores.length;
    const avgDepth = allScores.reduce((sum, s) => sum + s.infoDensity, 0) / allScores.length;
    const totalBlogs = allScores.length;

    // Streak stays as-is for now (incremented separately via weekly job)
    const streak = existingProfile?.streak ?? 0;
    const consistencyScore = Math.min(100, streak * 15);
    const prevRuns = existingProfile?.totalRuns ?? 0;
    // Normalize community engagement: runs / max(views, 1) normalized to 0-100
    const prevViews = existingProfile?.totalViews ?? 0;
    const communityScore = Math.min(100, (prevRuns / Math.max(prevViews, 1)) * 100);

    const newBCS = calculateBCS(avgBQS, avgDepth, communityScore, consistencyScore, avgStatAccuracy);

    const newXP = (existingProfile?.xp ?? 0) + Math.round(result.bqs / 2);
    const level = Math.floor(newXP / 100) + 1;

    await prisma.writerProfile.upsert({
      where: { userId: blog.authorId },
      create: {
        userId: blog.authorId,
        averageBQS: Math.round(avgBQS * 10) / 10,
        totalBlogs,
        archetype: result.modelScores.archetypeLabel,
        writerTitle: calculateWriterTitle({ analyst: 25, fan: 25, storyteller: 25, debater: 25 }),
        bestBQS: result.bqs,
        bcs: newBCS,
        statAccuracy: avgStatAccuracy,
        xp: newXP,
        level,
      },
      update: {
        totalBlogs,
        averageBQS: Math.round(avgBQS * 10) / 10,
        archetype: result.modelScores.archetypeLabel,
        bestBQS: { set: Math.max(existingProfile?.bestBQS ?? 0, result.bqs) },
        bcs: newBCS,
        statAccuracy: Math.round(avgStatAccuracy * 10) / 10,
        xp: newXP,
        level,
      },
    });

    // ── Update Writer DNA (4-archetype 80/20 EMA) ───────────────────
    const currentDNA = await prisma.writerDNA.upsert({
      where: { userId: blog.authorId },
      create: { userId: blog.authorId },
      update: {},
    });

    const prevDNA: WriterDNA = {
      analyst: currentDNA.analyst,
      fan: currentDNA.fan,
      storyteller: currentDNA.storyteller,
      debater: currentDNA.debater,
    };

    const newDNA = calculateDNAUpdate(prevDNA, result.writerDNASignal, result.bqs);
    const writerTitle = calculateWriterTitle(newDNA);

    await prisma.writerDNA.update({
      where: { userId: blog.authorId },
      data: newDNA,
    });

    // Save updated writerTitle
    await prisma.writerProfile.update({
      where: { userId: blog.authorId },
      data: { writerTitle },
    });

    const contestSubmission = await prisma.contestSubmission.findUnique({
      where: { blogId },
      select: { id: true, contestId: true, adminOverrideScore: true },
    });

    if (contestSubmission) {
      await prisma.contestSubmission.update({
        where: { id: contestSubmission.id },
        data: {
          aiScoreSnapshot: result.bqs,
          finalScore: contestSubmission.adminOverrideScore ?? result.bqs,
        },
      });

      await recomputeContestLeaderboard(contestSubmission.contestId);
    }

    // ── Check Badges ─────────────────────────────────────────────────
    const existingBadges = await prisma.writerBadge.findMany({
      where: { userId: blog.authorId },
    });
    const earnedBadgeIds = existingBadges.map((b) => b.badge);
    const highScores80 = allScores.filter((s) => s.bqs >= 80).length;

    const badgesToAward = BADGE_DEFINITIONS.filter((def) => {
      if (earnedBadgeIds.includes(def.id)) return false;
      if (def.id === "first_blood" || def.id === "bronze_scribe") return totalBlogs >= 1;
      if (def.id === "silver_analyst") return totalBlogs >= 5 && avgBQS >= 55;
      if (def.id === "gold_correspondent") return totalBlogs >= 10 && avgBQS >= 70 && avgStatAccuracy >= 75;
      if (def.id === "diamond_expert") return totalBlogs >= 20 && avgBQS >= 80 && avgStatAccuracy >= 85;
      if (def.id === "five_wickets") return highScores80 >= 5;
      if (def.id === "mr_consistent") return streak >= 4;
      return false;
    });

    for (const def of badgesToAward) {
      await prisma.writerBadge.create({
        data: {
          userId: blog.authorId,
          badge: def.id,
          title: def.title,
          description: def.description,
          tier: def.tier,
        },
      });
    }

    // ── Check Achievements ───────────────────────────────────────────
    const existingAchievements = await prisma.writerAchievement.findMany({
      where: { userId: blog.authorId },
    });
    const earnedAchIds = existingAchievements.map((a) => a.achievement);
    const totalViews = existingProfile?.totalViews ?? 0;

    for (const achDef of ACHIEVEMENT_DEFINITIONS) {
      if (earnedAchIds.includes(achDef.id)) continue;
      let earned = false;
      if (achDef.id.startsWith("blogs_") && totalBlogs >= achDef.milestone) earned = true;
      if (achDef.id.startsWith("bqs_") && avgBQS >= achDef.milestone) earned = true;
      if (achDef.id.startsWith("views_") && totalViews >= achDef.milestone) earned = true;
      if (earned) {
        await prisma.writerAchievement.create({
          data: {
            userId: blog.authorId,
            achievement: achDef.id,
            title: achDef.title,
            description: achDef.description,
            milestone: achDef.milestone,
          },
        });
      }
    }

    // ── Check DNA Achievements ───────────────────────────────────────
    const totalDNA = newDNA.analyst + newDNA.fan + newDNA.storyteller + newDNA.debater;
    for (const dnaAch of DNA_ACHIEVEMENT_DEFINITIONS) {
      if (earnedAchIds.includes(dnaAch.id)) continue;
      if (totalBlogs < dnaAch.minBlogs) continue;
      let earned = false;
      if (dnaAch.archetype === "all") {
        const minVal = Math.min(newDNA.analyst, newDNA.fan, newDNA.storyteller, newDNA.debater);
        const minPct = totalDNA > 0 ? (minVal / totalDNA) * 100 : 0;
        earned = minPct >= dnaAch.threshold;
      } else {
        const archetypeVal = newDNA[dnaAch.archetype as keyof WriterDNA] ?? 0;
        const archetypePct = totalDNA > 0 ? (archetypeVal / totalDNA) * 100 : 0;
        earned = archetypePct >= dnaAch.threshold;
      }
      if (earned) {
        await prisma.writerAchievement.create({
          data: {
            userId: blog.authorId,
            achievement: dnaAch.id,
            title: dnaAch.title,
            description: dnaAch.description,
            milestone: dnaAch.minBlogs,
          },
        });
      }
    }

    return NextResponse.json({
      message: "Scoring completed",
      score: blogScore,
      bqs: result.bqs,
      archetype: result.modelScores.archetypeLabel,
      explanation: result.explanation,
      paragraphScores: result.paragraphScores,
      writerTitle,
      bcs: newBCS,
    });
  } catch (error) {
    console.error("Scoring pipeline error:", error);
    return NextResponse.json({ error: "Scoring pipeline failed" }, { status: 500 });
  }
}
