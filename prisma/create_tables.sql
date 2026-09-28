-- CricGeek MySQL Schema
-- Run: mysql -u root -proot < prisma/create_tables.sql

CREATE DATABASE IF NOT EXISTS cricgeek;
USE cricgeek;

CREATE TABLE IF NOT EXISTS `User` (
  `id`            VARCHAR(30) NOT NULL,
  `name`          VARCHAR(100) NOT NULL,
  `email`         VARCHAR(255) NOT NULL,
  `phone`         VARCHAR(20) NULL,
  `password`      VARCHAR(255) NOT NULL,
  `emailVerified` BOOLEAN NOT NULL DEFAULT false,
  `phoneVerified` BOOLEAN NOT NULL DEFAULT false,
  `role`          VARCHAR(20) NOT NULL DEFAULT 'user',
  `avatar`        VARCHAR(500) NULL,
  `bio`           TEXT NULL,
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `User_email_key` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Blog` (
  `id`        VARCHAR(30) NOT NULL,
  `title`     VARCHAR(200) NOT NULL,
  `content`   LONGTEXT NOT NULL,
  `excerpt`   TEXT NULL,
  `slug`      VARCHAR(300) NOT NULL,
  `status`    VARCHAR(20) NOT NULL DEFAULT 'pending',
  `authorId`  VARCHAR(30) NOT NULL,
  `tags`      VARCHAR(500) NULL,
  `views`     INT NOT NULL DEFAULT 0,
  `matchTag`  VARCHAR(100) NULL,
  `runs`      INT NOT NULL DEFAULT 0,
  `mentionedPlayers` JSON NULL,
  `mentionedTeams` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Blog_slug_key` (`slug`),
  INDEX `Blog_authorId_idx` (`authorId`),
  CONSTRAINT `Blog_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Comment` (
  `id`        VARCHAR(30) NOT NULL,
  `content`   TEXT NOT NULL,
  `blogId`    VARCHAR(30) NOT NULL,
  `authorId`  VARCHAR(30) NOT NULL,
  `parentId`  VARCHAR(30) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `Comment_blogId_idx` (`blogId`),
  INDEX `Comment_blogId_createdAt_idx` (`blogId`, `createdAt`),
  INDEX `Comment_authorId_idx` (`authorId`),
  INDEX `Comment_parentId_idx` (`parentId`),
  CONSTRAINT `Comment_blogId_fkey` FOREIGN KEY (`blogId`) REFERENCES `Blog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Comment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Comment_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Comment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Report` (
  `id`        VARCHAR(30) NOT NULL,
  `reason`    VARCHAR(200) NOT NULL,
  `details`   TEXT NULL,
  `blogId`    VARCHAR(30) NOT NULL,
  `userId`    VARCHAR(30) NOT NULL,
  `status`    VARCHAR(20) NOT NULL DEFAULT 'pending',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `Report_blogId_idx` (`blogId`),
  INDEX `Report_userId_idx` (`userId`),
  CONSTRAINT `Report_blogId_fkey` FOREIGN KEY (`blogId`) REFERENCES `Blog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Report_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Contest` (
  `id`          VARCHAR(30) NOT NULL,
  `title`       VARCHAR(200) NOT NULL,
  `description` TEXT NOT NULL,
  `rules`       TEXT NULL,
  `startDate`   DATETIME(3) NOT NULL,
  `endDate`     DATETIME(3) NOT NULL,
  `status`      VARCHAR(20) NOT NULL DEFAULT 'upcoming',
  `prize`       VARCHAR(200) NULL,
  `shortBlogMaxWords` INT NOT NULL DEFAULT 350,
  `allowAdminOverride` BOOLEAN NOT NULL DEFAULT true,
  `announcementTitle` VARCHAR(200) NULL,
  `announcementBody` TEXT NULL,
  `announcementPublishedAt` DATETIME(3) NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ContestSubmission` (
  `id`                 VARCHAR(30) NOT NULL,
  `contestId`          VARCHAR(30) NOT NULL,
  `blogId`             VARCHAR(30) NOT NULL,
  `authorId`           VARCHAR(30) NOT NULL,
  `aiScoreSnapshot`    DOUBLE NOT NULL DEFAULT 0,
  `finalScore`         DOUBLE NOT NULL DEFAULT 0,
  `adminOverrideScore` DOUBLE NULL,
  `ranking`            INT NULL,
  `winnerPosition`     INT NULL,
  `awardedPrize`       VARCHAR(200) NULL,
  `notes`              TEXT NULL,
  `createdAt`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ContestSubmission_blogId_key` (`blogId`),
  UNIQUE INDEX `ContestSubmission_contestId_authorId_key` (`contestId`, `authorId`),
  INDEX `ContestSubmission_contestId_finalScore_idx` (`contestId`, `finalScore`),
  INDEX `ContestSubmission_contestId_ranking_idx` (`contestId`, `ranking`),
  CONSTRAINT `ContestSubmission_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ContestSubmission_blogId_fkey` FOREIGN KEY (`blogId`) REFERENCES `Blog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ContestSubmission_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `FeaturedContent` (
  `id`          VARCHAR(30) NOT NULL,
  `title`       VARCHAR(200) NOT NULL,
  `description` TEXT NULL,
  `imageUrl`    VARCHAR(500) NULL,
  `linkUrl`     VARCHAR(500) NOT NULL,
  `type`        VARCHAR(30) NOT NULL,
  `priority`    INT NOT NULL DEFAULT 0,
  `active`      BOOLEAN NOT NULL DEFAULT true,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `WriterProfile` (
  `id`            VARCHAR(30) NOT NULL,
  `userId`        VARCHAR(30) NOT NULL,
  `averageBQS`    DOUBLE NOT NULL DEFAULT 0,
  `totalBlogs`    INT NOT NULL DEFAULT 0,
  `totalViews`    INT NOT NULL DEFAULT 0,
  `totalComments` INT NOT NULL DEFAULT 0,
  `bcs`           DOUBLE NOT NULL DEFAULT 0,
  `archetype`     VARCHAR(30) NOT NULL DEFAULT 'rookie',
  `level`         INT NOT NULL DEFAULT 1,
  `xp`            INT NOT NULL DEFAULT 0,
  `streak`        INT NOT NULL DEFAULT 0,
  `bestBQS`       DOUBLE NOT NULL DEFAULT 0,
  `featuredCount` INT NOT NULL DEFAULT 0,
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `WriterProfile_userId_key` (`userId`),
  CONSTRAINT `WriterProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `BlogScore` (
  `id`                  VARCHAR(30) NOT NULL,
  `blogId`              VARCHAR(30) NOT NULL,
  `bqs`                 DOUBLE NOT NULL DEFAULT 0,
  `toneScore`           DOUBLE NOT NULL DEFAULT 0,
  `negativityScore`     DOUBLE NOT NULL DEFAULT 0,
  `toxicityScore`       DOUBLE NOT NULL DEFAULT 0,
  `originalityScore`    DOUBLE NOT NULL DEFAULT 0,
  `coherenceScore`      DOUBLE NOT NULL DEFAULT 0,
  `archetypeLabel`      VARCHAR(30) NOT NULL DEFAULT 'unknown',
  `archetypeConfidence` DOUBLE NOT NULL DEFAULT 0,
  `entitiesFound`       INT NOT NULL DEFAULT 0,
  `statsFound`          INT NOT NULL DEFAULT 0,
  `statsVerified`       INT NOT NULL DEFAULT 0,
  `statAccuracy`        DOUBLE NOT NULL DEFAULT 0,
  `constructiveness`    DOUBLE NOT NULL DEFAULT 0,
  `evidencePresence`    DOUBLE NOT NULL DEFAULT 0,
  `counterAcknowledge`  DOUBLE NOT NULL DEFAULT 0,
  `positionClarity`     DOUBLE NOT NULL DEFAULT 0,
  `infoDensity`         DOUBLE NOT NULL DEFAULT 0,
  `repetitionPenalty`   DOUBLE NOT NULL DEFAULT 0,
  `completeness`        DOUBLE NOT NULL DEFAULT 0,
  `paragraphScores`     JSON NULL,
  `explanationJson`     JSON NULL,
  `factCheckJson`       JSON NULL,
  `toxicityPenaltyApplied` BOOLEAN NOT NULL DEFAULT false,
  `toxicityPenaltyOverride` BOOLEAN NOT NULL DEFAULT false,
  `scoreVersion`        VARCHAR(40) NOT NULL DEFAULT 'qwen3.5-v1',
  `wordCount`           INT NOT NULL DEFAULT 0,
  `lexicalDiversity`    DOUBLE NOT NULL DEFAULT 0,
  `sentenceVariety`     DOUBLE NOT NULL DEFAULT 0,
  `processingStatus`    VARCHAR(20) NOT NULL DEFAULT 'pending',
  `processingTimeMs`    INT NOT NULL DEFAULT 0,
  `createdAt`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`           DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `BlogScore_blogId_key` (`blogId`),
  CONSTRAINT `BlogScore_blogId_fkey` FOREIGN KEY (`blogId`) REFERENCES `Blog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `WriterDNA` (
  `id`          VARCHAR(30) NOT NULL,
  `userId`      VARCHAR(30) NOT NULL,
  `analyst`     DOUBLE NOT NULL DEFAULT 25,
  `storyteller` DOUBLE NOT NULL DEFAULT 25,
  `debater`     DOUBLE NOT NULL DEFAULT 25,
  `fan`         DOUBLE NOT NULL DEFAULT 25,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `WriterDNA_userId_key` (`userId`),
  CONSTRAINT `WriterDNA_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `WriterBadge` (
  `id`          VARCHAR(30) NOT NULL,
  `userId`      VARCHAR(30) NOT NULL,
  `badge`       VARCHAR(50) NOT NULL,
  `title`       VARCHAR(100) NOT NULL,
  `description` TEXT NOT NULL,
  `tier`        VARCHAR(20) NOT NULL DEFAULT 'bronze',
  `iconUrl`     VARCHAR(500) NULL,
  `earnedAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `WriterBadge_userId_badge_key` (`userId`, `badge`),
  CONSTRAINT `WriterBadge_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `WriterAchievement` (
  `id`          VARCHAR(30) NOT NULL,
  `userId`      VARCHAR(30) NOT NULL,
  `achievement` VARCHAR(50) NOT NULL,
  `title`       VARCHAR(100) NOT NULL,
  `description` TEXT NOT NULL,
  `milestone`   INT NOT NULL DEFAULT 0,
  `earnedAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `WriterAchievement_userId_achievement_key` (`userId`, `achievement`),
  CONSTRAINT `WriterAchievement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `BlogReaction` (
  `id`        VARCHAR(30) NOT NULL,
  `blogId`    VARCHAR(30) NOT NULL,
  `userId`    VARCHAR(30) NOT NULL,
  `type`      VARCHAR(30) NOT NULL DEFAULT 'cricket_ball',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `BlogReaction_blogId_userId_key` (`blogId`, `userId`),
  INDEX `BlogReaction_userId_createdAt_idx` (`userId`, `createdAt`),
  CONSTRAINT `BlogReaction_blogId_fkey` FOREIGN KEY (`blogId`) REFERENCES `Blog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `BlogReaction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SavedBlog` (
  `id`        VARCHAR(30) NOT NULL,
  `blogId`    VARCHAR(30) NOT NULL,
  `userId`    VARCHAR(30) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `SavedBlog_blogId_userId_key` (`blogId`, `userId`),
  INDEX `SavedBlog_userId_createdAt_idx` (`userId`, `createdAt`),
  CONSTRAINT `SavedBlog_blogId_fkey` FOREIGN KEY (`blogId`) REFERENCES `Blog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SavedBlog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `WriterFollow` (
  `id`         VARCHAR(30) NOT NULL,
  `followerId` VARCHAR(30) NOT NULL,
  `writerId`   VARCHAR(30) NOT NULL,
  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `WriterFollow_followerId_writerId_key` (`followerId`, `writerId`),
  INDEX `WriterFollow_writerId_createdAt_idx` (`writerId`, `createdAt`),
  CONSTRAINT `WriterFollow_followerId_fkey` FOREIGN KEY (`followerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `WriterFollow_writerId_fkey` FOREIGN KEY (`writerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `UserFeedPreference` (
  `id`                 VARCHAR(30) NOT NULL,
  `userId`             VARCHAR(30) NOT NULL,
  `favoriteTags`       JSON NULL,
  `favoriteTeams`      JSON NULL,
  `favoritePlayers`    JSON NULL,
  `favoriteWriters`    JSON NULL,
  `favoriteMatchTypes` JSON NULL,
  `createdAt`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `UserFeedPreference_userId_key` (`userId`),
  CONSTRAINT `UserFeedPreference_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
