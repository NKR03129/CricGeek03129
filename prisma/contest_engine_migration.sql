ALTER TABLE `Contest`
  ADD COLUMN `shortBlogMaxWords` INT NOT NULL DEFAULT 350,
  ADD COLUMN `allowAdminOverride` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `announcementTitle` VARCHAR(200) NULL,
  ADD COLUMN `announcementBody` TEXT NULL,
  ADD COLUMN `announcementPublishedAt` DATETIME(3) NULL;

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
