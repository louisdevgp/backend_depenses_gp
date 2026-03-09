-- CreateTable
CREATE TABLE `agent_reporting_lines` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `agent_id` INTEGER UNSIGNED NOT NULL,
    `manager_id` INTEGER UNSIGNED NULL,
    `start_at` DATETIME(0) NOT NULL,
    `end_at` DATETIME(0) NULL,
    `created_by_id` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_arl_uuid`(`uuid`),
    INDEX `fk_arl_created_by`(`created_by_id`),
    INDEX `idx_arl_active`(`end_at`),
    INDEX `idx_arl_agent`(`agent_id`, `start_at`),
    INDEX `idx_arl_manager`(`manager_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agents` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `matricule` VARCHAR(50) NULL,
    `nom` VARCHAR(100) NOT NULL,
    `prenom` VARCHAR(100) NOT NULL,
    `direction_id` INTEGER UNSIGNED NULL,
    `departement_id` INTEGER UNSIGNED NULL,
    `service_id` INTEGER UNSIGNED NULL,
    `manager_id` INTEGER UNSIGNED NULL,
    `role_id` INTEGER UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_agents_uuid`(`uuid`),
    UNIQUE INDEX `uk_agents_matricule`(`matricule`),
    INDEX `idx_agent_deleted`(`deleted_at`),
    INDEX `idx_agent_departement`(`departement_id`),
    INDEX `idx_agent_direction`(`direction_id`),
    INDEX `idx_agent_manager`(`manager_id`),
    INDEX `idx_agent_role`(`role_id`),
    INDEX `idx_agent_service`(`service_id`),
    INDEX `idx_agent_user`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `user_id` INTEGER UNSIGNED NULL,
    `entity_type` VARCHAR(50) NOT NULL,
    `entity_id` INTEGER UNSIGNED NOT NULL,
    `action` VARCHAR(50) NOT NULL,
    `old_value` JSON NULL,
    `new_value` JSON NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_audit_logs_uuid`(`uuid`),
    INDEX `idx_audit_entity`(`entity_type`, `entity_id`),
    INDEX `idx_audit_user`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bon_commande_items` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `bon_commande_id` INTEGER UNSIGNED NOT NULL,
    `designation` VARCHAR(255) NOT NULL,
    `quantite` DECIMAL(18, 2) NOT NULL DEFAULT 1.00,
    `prix_unitaire` DECIMAL(18, 2) NULL,
    `unite` VARCHAR(30) NULL,
    `total_ligne` DECIMAL(18, 2) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_bci_uuid`(`uuid`),
    INDEX `idx_bci_bc`(`bon_commande_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bons_commande` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `demande_id` INTEGER UNSIGNED NOT NULL,
    `numero` VARCHAR(50) NOT NULL,
    `fournisseur_id` INTEGER UNSIGNED NULL,
    `statut` VARCHAR(30) NOT NULL DEFAULT 'brouillon',
    `date_commande` DATE NULL,
    `created_by_id` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_bc_uuid`(`uuid`),
    UNIQUE INDEX `uk_bc_numero`(`numero`),
    INDEX `idx_bc_created_by`(`created_by_id`),
    INDEX `idx_bc_demande`(`demande_id`),
    INDEX `idx_bc_fournisseur`(`fournisseur_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conditions_paiement` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `demande_id` INTEGER UNSIGNED NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `pourcentage` DECIMAL(5, 2) NULL,
    `montant_prevu` DECIMAL(18, 2) NULL,
    `date_echeance` DATE NULL,
    `condition_texte` VARCHAR(255) NULL,
    `statut` VARCHAR(30) NOT NULL DEFAULT 'prevu',
    `paiement_id` INTEGER UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `source` VARCHAR(20) NOT NULL DEFAULT 'DEMANDEUR',

    UNIQUE INDEX `uk_cp_uuid`(`uuid`),
    INDEX `idx_cp_demande`(`demande_id`),
    INDEX `idx_cp_demande_source`(`demande_id`, `source`),
    INDEX `idx_cp_paiement`(`paiement_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `delegations` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `principal_id` INTEGER UNSIGNED NOT NULL,
    `delegate_id` INTEGER UNSIGNED NOT NULL,
    `role_name` VARCHAR(50) NOT NULL,
    `scope` VARCHAR(100) NULL,
    `start_at` DATETIME(0) NOT NULL,
    `end_at` DATETIME(0) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `created_by_id` INTEGER UNSIGNED NOT NULL,

    UNIQUE INDEX `uk_delegations_uuid`(`uuid`),
    INDEX `idx_deleg_active`(`is_active`, `start_at`, `end_at`),
    INDEX `idx_deleg_creator`(`created_by_id`),
    INDEX `idx_deleg_delegate`(`delegate_id`),
    INDEX `idx_deleg_principal`(`principal_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `demande_items` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `demande_id` INTEGER UNSIGNED NOT NULL,
    `designation` VARCHAR(255) NOT NULL,
    `quantite` DECIMAL(18, 2) NOT NULL DEFAULT 1.00,
    `prix_unitaire` DECIMAL(18, 2) NULL,
    `unite` VARCHAR(30) NULL,
    `specifications` TEXT NULL,
    `total_ligne` DECIMAL(18, 2) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_di_uuid`(`uuid`),
    INDEX `idx_di_demande`(`demande_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `demandes_paiement` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `motif` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `montant` DECIMAL(18, 2) NOT NULL,
    `devise` VARCHAR(10) NULL,
    `taux_change` DECIMAL(18, 6) NULL,
    `montant_base` DECIMAL(18, 2) NULL,
    `beneficiaire` VARCHAR(255) NOT NULL,
    `fournisseur_id` INTEGER UNSIGNED NULL,
    `remarque` TEXT NULL,
    `demandeur_id` INTEGER UNSIGNED NOT NULL,
    `direction_id` INTEGER UNSIGNED NULL,
    `departement_id` INTEGER UNSIGNED NULL,
    `service_id` INTEGER UNSIGNED NULL,
    `statut` VARCHAR(50) NOT NULL DEFAULT 'draft',
    `budget_prevu` BOOLEAN NULL,
    `budget_disponible` BOOLEAN NULL,
    `paiement_immediat` BOOLEAN NULL,
    `ajournee` BOOLEAN NOT NULL DEFAULT false,
    `ajournee_le` DATETIME(0) NULL,
    `ajournee_par_id` INTEGER UNSIGNED NULL,
    `prochaine_revue_le` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `deleted_at` DATETIME(0) NULL,
    `validation_flow_id` INTEGER UNSIGNED NULL,
    `daf_critere4` VARCHAR(50) NULL,
    `montant_net` DECIMAL(18, 2) NULL,
    `remise_type` VARCHAR(20) NULL,
    `remise_valeur` DECIMAL(18, 2) NULL,

    UNIQUE INDEX `uk_demandes_uuid`(`uuid`),
    INDEX `fk_demande_ajournee_par`(`ajournee_par_id`),
    INDEX `fk_demande_departement`(`departement_id`),
    INDEX `idx_demande_deleted`(`deleted_at`),
    INDEX `idx_demande_demandeur`(`demandeur_id`),
    INDEX `idx_demande_direction_dept`(`direction_id`, `departement_id`),
    INDEX `idx_demande_flow`(`validation_flow_id`),
    INDEX `idx_demande_fournisseur`(`fournisseur_id`),
    INDEX `idx_demande_service`(`service_id`),
    INDEX `idx_demande_statut`(`statut`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departements` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `direction_id` INTEGER UNSIGNED NOT NULL,
    `nom` VARCHAR(150) NOT NULL,
    `code` VARCHAR(50) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_departements_uuid`(`uuid`),
    UNIQUE INDEX `uk_departements_code`(`code`),
    INDEX `idx_dept_deleted`(`deleted_at`),
    INDEX `idx_dept_direction`(`direction_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `directions` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `nom` VARCHAR(150) NOT NULL,
    `code` VARCHAR(50) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_directions_uuid`(`uuid`),
    UNIQUE INDEX `uk_directions_code`(`code`),
    INDEX `idx_directions_deleted`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `documents` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `demande_id` INTEGER UNSIGNED NULL,
    `reception_id` INTEGER UNSIGNED NULL,
    `paiement_id` INTEGER UNSIGNED NULL,
    `bon_commande_id` INTEGER UNSIGNED NULL,
    `type_document` VARCHAR(50) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `nom_fichier` VARCHAR(255) NOT NULL,
    `format` VARCHAR(20) NULL,
    `taille` BIGINT NULL,
    `upload_by_id` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_documents_uuid`(`uuid`),
    INDEX `idx_docs_bc`(`bon_commande_id`),
    INDEX `idx_docs_demande`(`demande_id`),
    INDEX `idx_docs_paiement`(`paiement_id`),
    INDEX `idx_docs_reception`(`reception_id`),
    INDEX `idx_docs_type`(`type_document`),
    INDEX `idx_docs_upload_by`(`upload_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fournisseur_contacts` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `fournisseur_id` INTEGER UNSIGNED NOT NULL,
    `nom` VARCHAR(150) NOT NULL,
    `prenom` VARCHAR(150) NULL,
    `fonction` VARCHAR(150) NULL,
    `telephone` VARCHAR(50) NULL,
    `email` VARCHAR(191) NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_fc_uuid`(`uuid`),
    INDEX `idx_fc_fournisseur`(`fournisseur_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fournisseurs` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `nom` VARCHAR(255) NOT NULL,
    `rccm` VARCHAR(100) NULL,
    `nif` VARCHAR(100) NULL,
    `telephone` VARCHAR(50) NULL,
    `email` VARCHAR(191) NULL,
    `adresse` VARCHAR(500) NULL,
    `ville` VARCHAR(100) NULL,
    `pays` VARCHAR(100) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_fournisseurs_uuid`(`uuid`),
    INDEX `idx_fournisseurs_active`(`is_active`),
    INDEX `idx_fournisseurs_deleted`(`deleted_at`),
    INDEX `idx_fournisseurs_nom`(`nom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `type` VARCHAR(100) NOT NULL,
    `demande_id` INTEGER UNSIGNED NULL,
    `message` TEXT NOT NULL,
    `channel` VARCHAR(50) NOT NULL DEFAULT 'email',
    `sent_by_email` BOOLEAN NOT NULL DEFAULT false,
    `email_sent_at` DATETIME(0) NULL,
    `sent_by_whatsapp` BOOLEAN NOT NULL DEFAULT false,
    `whatsapp_sent_at` DATETIME(0) NULL,
    `meta` JSON NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `read_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_notifications_uuid`(`uuid`),
    INDEX `idx_notif_demande`(`demande_id`),
    INDEX `idx_notif_type`(`type`),
    INDEX `idx_notif_user`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paiements` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `demande_id` INTEGER UNSIGNED NOT NULL,
    `type_paiement` VARCHAR(50) NOT NULL,
    `montant` DECIMAL(18, 2) NOT NULL,
    `date_paiement` DATETIME(0) NOT NULL,
    `moyen_paiement` VARCHAR(50) NOT NULL,
    `reference_piece` VARCHAR(100) NULL,
    `compte_debite` VARCHAR(100) NULL,
    `commentaire` TEXT NULL,
    `comptable_id` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `conditions_source` VARCHAR(20) NULL,

    UNIQUE INDEX `uk_paiements_uuid`(`uuid`),
    INDEX `idx_paiement_comptable`(`comptable_id`),
    INDEX `idx_paiement_demande`(`demande_id`),
    INDEX `idx_paiement_demande_source`(`demande_id`, `conditions_source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receptions` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `demande_id` INTEGER UNSIGNED NOT NULL,
    `bon_commande_id` INTEGER UNSIGNED NULL,
    `fournisseur` VARCHAR(255) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `reference_facture` VARCHAR(100) NULL,
    `montant` DECIMAL(18, 2) NULL,
    `date_reception` DATE NOT NULL,
    `conforme` BOOLEAN NOT NULL,
    `observations` TEXT NULL,
    `recu_par_id` INTEGER UNSIGNED NOT NULL,
    `visa_directeur_id` INTEGER UNSIGNED NULL,
    `visa_daf_id` INTEGER UNSIGNED NULL,
    `signature_daf_url` VARCHAR(500) NULL,
    `signature_directeur_url` VARCHAR(500) NULL,
    `signature_recu_par_url` VARCHAR(500) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `visa_daf_commentaire` TEXT NULL,
    `visa_directeur_commentaire` TEXT NULL,
    `paiement_id` INTEGER UNSIGNED NULL,
    `phase` ENUM('AVANT_PAIEMENT', 'APRES_PAIEMENT') NOT NULL DEFAULT 'APRES_PAIEMENT',

    UNIQUE INDEX `uk_receptions_uuid`(`uuid`),
    INDEX `idx_reception_bc`(`bon_commande_id`),
    INDEX `idx_reception_demande`(`demande_id`),
    INDEX `idx_reception_paiement`(`paiement_id`),
    INDEX `idx_reception_recu_par`(`recu_par_id`),
    INDEX `idx_reception_visa_daf`(`visa_daf_id`),
    INDEX `idx_reception_visa_directeur`(`visa_directeur_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `description` TEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_roles_uuid`(`uuid`),
    UNIQUE INDEX `uk_roles_name`(`name`),
    INDEX `idx_roles_active`(`is_active`),
    INDEX `idx_roles_deleted`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `label` VARCHAR(150) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_permissions_uuid`(`uuid`),
    UNIQUE INDEX `uk_permissions_code`(`code`),
    INDEX `idx_permissions_active`(`is_active`),
    INDEX `idx_permissions_deleted`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `role_id` INTEGER UNSIGNED NOT NULL,
    `permission_id` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_role_permissions_uuid`(`uuid`),
    INDEX `idx_rp_role`(`role_id`),
    INDEX `idx_rp_permission`(`permission_id`),
    INDEX `idx_rp_deleted`(`deleted_at`),
    UNIQUE INDEX `uk_role_permission_pair`(`role_id`, `permission_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `services` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `departement_id` INTEGER UNSIGNED NOT NULL,
    `nom` VARCHAR(150) NOT NULL,
    `code` VARCHAR(50) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_services_uuid`(`uuid`),
    UNIQUE INDEX `uk_services_code`(`code`),
    INDEX `idx_service_deleted`(`deleted_at`),
    INDEX `idx_service_dept`(`departement_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `user_id` INTEGER UNSIGNED NOT NULL,
    `role_id` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_ur_role`(`role_id`),
    PRIMARY KEY (`user_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_permissions` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `permission_id` INTEGER UNSIGNED NOT NULL,
    `is_allowed` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_user_permissions_uuid`(`uuid`),
    INDEX `idx_up_user`(`user_id`),
    INDEX `idx_up_permission`(`permission_id`),
    INDEX `idx_up_deleted`(`deleted_at`),
    UNIQUE INDEX `uk_user_permission_pair`(`user_id`, `permission_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_permission_scopes` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `permission_id` INTEGER UNSIGNED NOT NULL,
    `scope_type` ENUM('GLOBAL', 'DIRECTION', 'DEPARTEMENT', 'SERVICE') NOT NULL DEFAULT 'GLOBAL',
    `scope_id` INTEGER UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_user_permission_scopes_uuid`(`uuid`),
    INDEX `idx_ups_user`(`user_id`),
    INDEX `idx_ups_permission`(`permission_id`),
    INDEX `idx_ups_scope`(`scope_type`, `scope_id`),
    INDEX `idx_ups_deleted`(`deleted_at`),
    UNIQUE INDEX `uk_user_permission_scope`(`user_id`, `permission_id`, `scope_type`, `scope_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `token_hash` VARCHAR(255) NOT NULL,
    `expires_at` DATETIME(0) NOT NULL,
    `used_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_prt_uuid`(`uuid`),
    INDEX `idx_prt_user`(`user_id`),
    INDEX `idx_prt_expires`(`expires_at`),
    INDEX `idx_prt_used`(`used_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `nom` VARCHAR(100) NULL,
    `prenom` VARCHAR(100) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `email_verified_at` DATETIME(0) NULL,
    `last_login_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_users_uuid`(`uuid`),
    UNIQUE INDEX `uk_users_email`(`email`),
    INDEX `idx_users_active`(`is_active`),
    INDEX `idx_users_deleted`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `validation_flow_steps` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `flow_id` INTEGER UNSIGNED NOT NULL,
    `step_order` INTEGER NOT NULL,
    `role_name` VARCHAR(50) NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_vfs_uuid`(`uuid`),
    INDEX `idx_vfs_flow`(`flow_id`),
    UNIQUE INDEX `uk_vfs_unique`(`flow_id`, `step_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `validation_flows` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `label` VARCHAR(150) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_vf_uuid`(`uuid`),
    UNIQUE INDEX `uk_vf_code`(`code`),
    INDEX `idx_vf_active`(`is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `validation_steps` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `demande_id` INTEGER UNSIGNED NOT NULL,
    `level` INTEGER NOT NULL,
    `role_name` VARCHAR(50) NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'en_attente',
    `validator_id` INTEGER UNSIGNED NULL,
    `validated_by_id` INTEGER UNSIGNED NULL,
    `commentaire` TEXT NULL,
    `signature_url` VARCHAR(500) NULL,
    `validated_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_vs_uuid`(`uuid`),
    INDEX `idx_vs_demande`(`demande_id`),
    INDEX `idx_vs_level`(`level`),
    INDEX `idx_vs_status`(`status`),
    INDEX `idx_vs_validated_by`(`validated_by_id`),
    INDEX `idx_vs_validator`(`validator_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agent_reporting_lines` ADD CONSTRAINT `fk_arl_agent` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_reporting_lines` ADD CONSTRAINT `fk_arl_created_by` FOREIGN KEY (`created_by_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_reporting_lines` ADD CONSTRAINT `fk_arl_manager` FOREIGN KEY (`manager_id`) REFERENCES `agents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agents` ADD CONSTRAINT `fk_agent_departement` FOREIGN KEY (`departement_id`) REFERENCES `departements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agents` ADD CONSTRAINT `fk_agent_direction` FOREIGN KEY (`direction_id`) REFERENCES `directions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agents` ADD CONSTRAINT `fk_agent_manager` FOREIGN KEY (`manager_id`) REFERENCES `agents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agents` ADD CONSTRAINT `fk_agent_role` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agents` ADD CONSTRAINT `fk_agent_service` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agents` ADD CONSTRAINT `fk_agent_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `fk_audit_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bon_commande_items` ADD CONSTRAINT `fk_bci_bc` FOREIGN KEY (`bon_commande_id`) REFERENCES `bons_commande`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bons_commande` ADD CONSTRAINT `fk_bc_created_by` FOREIGN KEY (`created_by_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bons_commande` ADD CONSTRAINT `fk_bc_demande` FOREIGN KEY (`demande_id`) REFERENCES `demandes_paiement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bons_commande` ADD CONSTRAINT `fk_bc_fournisseur` FOREIGN KEY (`fournisseur_id`) REFERENCES `fournisseurs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conditions_paiement` ADD CONSTRAINT `fk_cp_demande` FOREIGN KEY (`demande_id`) REFERENCES `demandes_paiement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conditions_paiement` ADD CONSTRAINT `fk_cp_paiement` FOREIGN KEY (`paiement_id`) REFERENCES `paiements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delegations` ADD CONSTRAINT `fk_deleg_creator` FOREIGN KEY (`created_by_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delegations` ADD CONSTRAINT `fk_deleg_delegate` FOREIGN KEY (`delegate_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delegations` ADD CONSTRAINT `fk_deleg_principal` FOREIGN KEY (`principal_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demande_items` ADD CONSTRAINT `fk_di_demande` FOREIGN KEY (`demande_id`) REFERENCES `demandes_paiement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demandes_paiement` ADD CONSTRAINT `fk_demande_ajournee_par` FOREIGN KEY (`ajournee_par_id`) REFERENCES `agents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demandes_paiement` ADD CONSTRAINT `fk_demande_demandeur` FOREIGN KEY (`demandeur_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demandes_paiement` ADD CONSTRAINT `fk_demande_departement` FOREIGN KEY (`departement_id`) REFERENCES `departements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demandes_paiement` ADD CONSTRAINT `fk_demande_direction` FOREIGN KEY (`direction_id`) REFERENCES `directions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demandes_paiement` ADD CONSTRAINT `fk_demande_flow` FOREIGN KEY (`validation_flow_id`) REFERENCES `validation_flows`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demandes_paiement` ADD CONSTRAINT `fk_demande_fournisseur` FOREIGN KEY (`fournisseur_id`) REFERENCES `fournisseurs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demandes_paiement` ADD CONSTRAINT `fk_demande_service` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `departements` ADD CONSTRAINT `fk_departement_direction` FOREIGN KEY (`direction_id`) REFERENCES `directions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `fk_docs_bc` FOREIGN KEY (`bon_commande_id`) REFERENCES `bons_commande`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `fk_docs_demande` FOREIGN KEY (`demande_id`) REFERENCES `demandes_paiement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `fk_docs_paiement` FOREIGN KEY (`paiement_id`) REFERENCES `paiements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `fk_docs_reception` FOREIGN KEY (`reception_id`) REFERENCES `receptions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `fk_docs_upload_by` FOREIGN KEY (`upload_by_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fournisseur_contacts` ADD CONSTRAINT `fk_fc_fournisseur` FOREIGN KEY (`fournisseur_id`) REFERENCES `fournisseurs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `fk_notif_demande` FOREIGN KEY (`demande_id`) REFERENCES `demandes_paiement`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `fk_notif_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paiements` ADD CONSTRAINT `fk_paiement_comptable` FOREIGN KEY (`comptable_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paiements` ADD CONSTRAINT `fk_paiement_demande` FOREIGN KEY (`demande_id`) REFERENCES `demandes_paiement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receptions` ADD CONSTRAINT `fk_reception_bc` FOREIGN KEY (`bon_commande_id`) REFERENCES `bons_commande`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receptions` ADD CONSTRAINT `fk_reception_demande` FOREIGN KEY (`demande_id`) REFERENCES `demandes_paiement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receptions` ADD CONSTRAINT `fk_reception_recu_par` FOREIGN KEY (`recu_par_id`) REFERENCES `agents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receptions` ADD CONSTRAINT `fk_reception_visa_daf` FOREIGN KEY (`visa_daf_id`) REFERENCES `agents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receptions` ADD CONSTRAINT `fk_reception_visa_directeur` FOREIGN KEY (`visa_directeur_id`) REFERENCES `agents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receptions` ADD CONSTRAINT `receptions_paiement_id_fkey` FOREIGN KEY (`paiement_id`) REFERENCES `paiements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `services` ADD CONSTRAINT `fk_service_departement` FOREIGN KEY (`departement_id`) REFERENCES `departements`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `fk_ur_role` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `fk_ur_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `validation_flow_steps` ADD CONSTRAINT `fk_vfs_flow` FOREIGN KEY (`flow_id`) REFERENCES `validation_flows`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `validation_steps` ADD CONSTRAINT `fk_vs_demande` FOREIGN KEY (`demande_id`) REFERENCES `demandes_paiement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `validation_steps` ADD CONSTRAINT `fk_vs_validated_by` FOREIGN KEY (`validated_by_id`) REFERENCES `agents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `validation_steps` ADD CONSTRAINT `fk_vs_validator` FOREIGN KEY (`validator_id`) REFERENCES `agents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

