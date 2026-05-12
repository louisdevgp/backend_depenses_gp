-- Add acheteur assignment on demandes
ALTER TABLE `demandes_paiement`
  ADD COLUMN `acheteur_id` INTEGER UNSIGNED NULL AFTER `demandeur_id`;

-- Index for buyer scope filtering
CREATE INDEX `idx_demande_acheteur` ON `demandes_paiement`(`acheteur_id`);

-- FK to agents with nullification when buyer row is deleted
ALTER TABLE `demandes_paiement`
  ADD CONSTRAINT `fk_demande_acheteur`
    FOREIGN KEY (`acheteur_id`) REFERENCES `agents`(`id`)
    ON DELETE SET NULL
    ON UPDATE RESTRICT;
