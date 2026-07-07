ALTER TABLE `lignes_budgetaires`
  ADD COLUMN `mois` TINYINT NOT NULL DEFAULT 1 AFTER `exercice`;

CREATE INDEX `idx_lb_periode` ON `lignes_budgetaires` (`exercice`, `mois`);