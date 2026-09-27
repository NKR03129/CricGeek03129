SET @has_fact_check_json = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'BlogScore'
    AND COLUMN_NAME = 'factCheckJson'
);

SET @ddl = IF(
  @has_fact_check_json = 0,
  'ALTER TABLE `BlogScore` ADD COLUMN `factCheckJson` JSON NULL AFTER `explanationJson`',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
