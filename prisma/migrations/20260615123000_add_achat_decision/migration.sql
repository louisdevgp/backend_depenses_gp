-- Add an explicit, auditable purchase decision without changing existing statuses.
ALTER TABLE `demandes_paiement`
  ADD COLUMN `achat_requis` BOOLEAN NULL AFTER `acheteur_id`,
  ADD COLUMN `achat_decision_par_id` INTEGER UNSIGNED NULL AFTER `achat_requis`,
  ADD COLUMN `achat_decision_at` DATETIME(0) NULL AFTER `achat_decision_par_id`,
  ADD COLUMN `achat_decision_commentaire` TEXT NULL AFTER `achat_decision_at`;

CREATE INDEX `idx_demande_achat_requis`
  ON `demandes_paiement`(`achat_requis`);

CREATE INDEX `idx_demande_achat_decision_par`
  ON `demandes_paiement`(`achat_decision_par_id`);

ALTER TABLE `demandes_paiement`
  ADD CONSTRAINT `fk_demande_achat_decision_par`
    FOREIGN KEY (`achat_decision_par_id`) REFERENCES `agents`(`id`)
    ON DELETE SET NULL
    ON UPDATE RESTRICT;

-- Preserve known purchases from existing data. Ambiguous rows remain NULL.
UPDATE `demandes_paiement` AS d
SET
  d.`achat_requis` = true,
  d.`achat_decision_par_id` = d.`acheteur_id`,
  d.`achat_decision_at` = d.`updated_at`
WHERE
  d.`statut` = 'achat_effectue'
  OR EXISTS (
    SELECT 1
    FROM `documents` AS doc
    WHERE doc.`demande_id` = d.`id`
      AND (
        doc.`type_document` IN ('preuve_achat', 'facture', 'bon_livraison')
        OR doc.`type_document` LIKE 'preuve_achat:%'
      )
  );
