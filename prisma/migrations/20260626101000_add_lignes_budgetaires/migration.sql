-- Lignes budgetaires V1: budget global entreprise avec controle souple.

CREATE TABLE `lignes_budgetaires` (
  `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid` CHAR(36) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `libelle` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `exercice` INTEGER NOT NULL,
  `devise` VARCHAR(10) NOT NULL DEFAULT 'FCFA',
  `montant_initial` DECIMAL(18,2) NOT NULL,
  `montant_engage` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `montant_paye` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `controle_mode` VARCHAR(20) NOT NULL DEFAULT 'SOUPLE',
  `scope_type` VARCHAR(30) NOT NULL DEFAULT 'GLOBAL',
  `scope_id` INTEGER UNSIGNED NULL,
  `statut` VARCHAR(30) NOT NULL DEFAULT 'active',
  `created_by_id` INTEGER UNSIGNED NULL,
  `updated_by_id` INTEGER UNSIGNED NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `deleted_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uk_lignes_budgetaires_uuid` (`uuid`),
  UNIQUE INDEX `uk_lignes_budgetaires_code` (`code`),
  INDEX `idx_lb_created_by` (`created_by_id`),
  INDEX `idx_lb_updated_by` (`updated_by_id`),
  INDEX `idx_lb_exercice` (`exercice`),
  INDEX `idx_lb_statut` (`statut`),
  INDEX `idx_lb_scope` (`scope_type`, `scope_id`),
  INDEX `idx_lb_deleted` (`deleted_at`),
  CONSTRAINT `fk_lb_created_by` FOREIGN KEY (`created_by_id`) REFERENCES `agents` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_lb_updated_by` FOREIGN KEY (`updated_by_id`) REFERENCES `agents` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `mouvements_budgetaires` (
  `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid` CHAR(36) NOT NULL,
  `ligne_budgetaire_id` INTEGER UNSIGNED NOT NULL,
  `demande_id` INTEGER UNSIGNED NULL,
  `paiement_id` INTEGER UNSIGNED NULL,
  `type_mouvement` VARCHAR(50) NOT NULL,
  `sens` VARCHAR(10) NOT NULL,
  `montant` DECIMAL(18,2) NOT NULL,
  `solde_avant` DECIMAL(18,2) NULL,
  `solde_apres` DECIMAL(18,2) NULL,
  `commentaire` TEXT NULL,
  `created_by_id` INTEGER UNSIGNED NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uk_mouvements_budgetaires_uuid` (`uuid`),
  INDEX `idx_mb_ligne_budgetaire` (`ligne_budgetaire_id`),
  INDEX `idx_mb_demande` (`demande_id`),
  INDEX `idx_mb_paiement` (`paiement_id`),
  INDEX `idx_mb_created_by` (`created_by_id`),
  INDEX `idx_mb_type` (`type_mouvement`),
  INDEX `idx_mb_created_at` (`created_at`),
  CONSTRAINT `fk_mb_ligne_budgetaire` FOREIGN KEY (`ligne_budgetaire_id`) REFERENCES `lignes_budgetaires` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_mb_demande` FOREIGN KEY (`demande_id`) REFERENCES `demandes_paiement` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_mb_paiement` FOREIGN KEY (`paiement_id`) REFERENCES `paiements` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_mb_created_by` FOREIGN KEY (`created_by_id`) REFERENCES `agents` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `demandes_paiement`
  ADD COLUMN `ligne_budgetaire_id` INTEGER UNSIGNED NULL,
  ADD COLUMN `ligne_budgetaire_assignee_par_id` INTEGER UNSIGNED NULL,
  ADD COLUMN `ligne_budgetaire_assignee_at` DATETIME(0) NULL,
  ADD COLUMN `budget_depassement_montant` DECIMAL(18,2) NULL,
  ADD COLUMN `budget_warning_snapshot` JSON NULL;

ALTER TABLE `demandes_paiement`
  ADD INDEX `idx_demande_ligne_budgetaire` (`ligne_budgetaire_id`),
  ADD INDEX `idx_demande_budget_assignee_par` (`ligne_budgetaire_assignee_par_id`),
  ADD CONSTRAINT `fk_demande_ligne_budgetaire` FOREIGN KEY (`ligne_budgetaire_id`) REFERENCES `lignes_budgetaires` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_demande_budget_assignee_par` FOREIGN KEY (`ligne_budgetaire_assignee_par_id`) REFERENCES `agents` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `paiements`
  ADD COLUMN `ligne_budgetaire_id` INTEGER UNSIGNED NULL,
  ADD COLUMN `ligne_budgetaire_changee_par_daf` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `paiements`
  ADD INDEX `idx_paiement_ligne_budgetaire` (`ligne_budgetaire_id`),
  ADD CONSTRAINT `fk_paiement_ligne_budgetaire` FOREIGN KEY (`ligne_budgetaire_id`) REFERENCES `lignes_budgetaires` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Permissions budgetaires.
INSERT INTO `permissions` (`uuid`, `code`, `label`, `is_active`, `deleted_at`)
SELECT UUID(), 'BUDGET_LINE_CREATE', 'Budget Line Create', 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'BUDGET_LINE_CREATE');

INSERT INTO `permissions` (`uuid`, `code`, `label`, `is_active`, `deleted_at`)
SELECT UUID(), 'BUDGET_LINE_UPDATE', 'Budget Line Update', 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'BUDGET_LINE_UPDATE');

INSERT INTO `permissions` (`uuid`, `code`, `label`, `is_active`, `deleted_at`)
SELECT UUID(), 'BUDGET_LINE_LIST', 'Budget Line List', 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'BUDGET_LINE_LIST');

INSERT INTO `permissions` (`uuid`, `code`, `label`, `is_active`, `deleted_at`)
SELECT UUID(), 'BUDGET_LINE_GET', 'Budget Line Get', 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'BUDGET_LINE_GET');

INSERT INTO `permissions` (`uuid`, `code`, `label`, `is_active`, `deleted_at`)
SELECT UUID(), 'BUDGET_LINE_USE', 'Budget Line Use', 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'BUDGET_LINE_USE');

INSERT INTO `permissions` (`uuid`, `code`, `label`, `is_active`, `deleted_at`)
SELECT UUID(), 'BUDGET_LINE_DELETE', 'Budget Line Delete', 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'BUDGET_LINE_DELETE');

INSERT INTO `role_permissions` (`uuid`, `role_id`, `permission_id`, `deleted_at`)
SELECT UUID(), r.id, p.id, NULL
FROM `roles` r
JOIN `permissions` p ON p.`code` IN ('BUDGET_LINE_CREATE', 'BUDGET_LINE_UPDATE', 'BUDGET_LINE_LIST', 'BUDGET_LINE_GET', 'BUDGET_LINE_USE')
WHERE r.`name` IN ('DAF', 'ADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` rp
    WHERE rp.`role_id` = r.`id` AND rp.`permission_id` = p.`id`
  );

INSERT INTO `role_permissions` (`uuid`, `role_id`, `permission_id`, `deleted_at`)
SELECT UUID(), r.id, p.id, NULL
FROM `roles` r
JOIN `permissions` p ON p.`code` IN ('BUDGET_LINE_LIST', 'BUDGET_LINE_GET', 'BUDGET_LINE_USE')
WHERE r.`name` = 'COMPTABLE'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` rp
    WHERE rp.`role_id` = r.`id` AND rp.`permission_id` = p.`id`
  );

INSERT INTO `role_permissions` (`uuid`, `role_id`, `permission_id`, `deleted_at`)
SELECT UUID(), r.id, p.id, NULL
FROM `roles` r
JOIN `permissions` p ON p.`code` = 'BUDGET_LINE_DELETE'
WHERE r.`name` = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` rp
    WHERE rp.`role_id` = r.`id` AND rp.`permission_id` = p.`id`
  );
