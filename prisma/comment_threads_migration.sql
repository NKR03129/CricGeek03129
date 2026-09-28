ALTER TABLE `Comment`
  ADD COLUMN `parentId` VARCHAR(30) NULL AFTER `authorId`,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER `createdAt`;

CREATE INDEX `Comment_parentId_idx` ON `Comment` (`parentId`);
CREATE INDEX `Comment_blogId_createdAt_idx` ON `Comment` (`blogId`, `createdAt`);

ALTER TABLE `Comment`
  ADD CONSTRAINT `Comment_parentId_fkey`
  FOREIGN KEY (`parentId`) REFERENCES `Comment`(`id`)
  ON DELETE CASCADE
  ON UPDATE CASCADE;
