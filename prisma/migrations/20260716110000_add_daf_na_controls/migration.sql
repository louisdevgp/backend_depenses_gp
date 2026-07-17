ALTER TABLE `demandes_paiement`
  ADD COLUMN `budget_prevu_reponse` VARCHAR(10) NULL,
  ADD COLUMN `budget_disponible_reponse` VARCHAR(10) NULL,
  ADD COLUMN `paiement_immediat_reponse` VARCHAR(10) NULL,
  ADD COLUMN `validation_oci_reponse` VARCHAR(10) NULL,
  ADD COLUMN `ligne_budgetaire_reponse` VARCHAR(10) NULL,
  ADD COLUMN `daf_controle_commentaires` JSON NULL;

UPDATE `demandes_paiement`
SET
  `budget_prevu_reponse` = CASE
    WHEN `budget_prevu` = 1 THEN 'OUI'
    WHEN `budget_prevu` = 0 THEN 'NON'
    ELSE NULL
  END,
  `budget_disponible_reponse` = CASE
    WHEN `budget_disponible` = 1 THEN 'OUI'
    WHEN `budget_disponible` = 0 THEN 'NON'
    ELSE NULL
  END,
  `paiement_immediat_reponse` = CASE
    WHEN `paiement_immediat` = 1 THEN 'OUI'
    WHEN `paiement_immediat` = 0 THEN 'NON'
    ELSE NULL
  END,
  `validation_oci_reponse` = CASE
    WHEN `validation_oci` = 1 THEN 'OUI'
    WHEN `validation_oci` = 0 THEN 'NON'
    ELSE NULL
  END,
  `ligne_budgetaire_reponse` = CASE
    WHEN `ligne_budgetaire_id` IS NOT NULL THEN 'OUI'
    ELSE NULL
  END
WHERE
  `budget_prevu_reponse` IS NULL
  AND `budget_disponible_reponse` IS NULL
  AND `paiement_immediat_reponse` IS NULL
  AND `validation_oci_reponse` IS NULL
  AND `ligne_budgetaire_reponse` IS NULL;
