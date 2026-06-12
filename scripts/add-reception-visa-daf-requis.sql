-- Optional DAF visa toggle for receptions
ALTER TABLE `receptions`
  ADD COLUMN `visa_daf_requis` TINYINT(1) NOT NULL DEFAULT 1 AFTER `visa_daf_id`;
