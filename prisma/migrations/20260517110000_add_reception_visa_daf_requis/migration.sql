-- Optional DAF visa on receptions
ALTER TABLE `receptions`
  ADD COLUMN `visa_daf_requis` BOOLEAN NOT NULL DEFAULT true AFTER `visa_daf_id`;
