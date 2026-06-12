-- Restore the agents table from the latest project database dump.
CREATE TABLE IF NOT EXISTS `agents` (
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

INSERT IGNORE INTO `agents`
  (`id`, `uuid`, `user_id`, `matricule`, `nom`, `prenom`, `direction_id`, `departement_id`, `service_id`, `manager_id`, `role_id`, `created_at`, `updated_at`, `deleted_at`)
VALUES
  (1, '46082b83-1443-4238-b224-8481372810d9', 2, 'DT001', 'KOUAME', 'KOYE LOUIS CELESTIN', 4, 1, 1, 3, 2, '2026-01-07 10:55:29', '2026-01-07 11:57:33', NULL),
  (2, 'b621b553-3ac1-449f-9f78-7dea81904f01', 3, 'DT002', 'NONWANON', 'SIDOINE', 4, NULL, NULL, NULL, 4, '2026-01-07 11:05:34', '2026-01-07 11:41:10', NULL),
  (3, '11bc746d-5cef-4fcd-94fe-89579cc5f08c', 4, 'DT003', 'GANLONON', 'KEVIN', 4, 1, NULL, 2, 3, '2026-01-07 11:07:27', '2026-01-07 11:57:40', NULL),
  (4, 'a7f26daf-5ac0-4404-b365-9a370ca58172', 5, 'DG001', 'TRABOULSI', 'ANOUAR', 1, NULL, NULL, NULL, 7, '2026-01-07 11:09:46', '2026-01-27 17:30:37', NULL),
  (5, '920feefc-d211-4889-8ec8-8ce167c5fe7c', 6, 'DGA001', 'ABDOULAYE', 'DIALLO', 2, NULL, NULL, NULL, 6, '2026-01-07 11:12:57', '2026-03-02 16:16:49', NULL),
  (6, 'c6e1bf59-60be-4f17-b266-b4651b3b126a', 7, 'DAF001', 'YAO', 'DIMITRI', 3, NULL, NULL, NULL, 5, '2026-01-07 11:14:07', '2026-02-23 21:30:44', NULL),
  (7, '53f13480-a88e-4aac-b7f9-fc290c485e68', 8, 'DAF002', 'KOFFI', 'HYPOLITE', 3, 2, NULL, NULL, 8, '2026-01-07 11:16:13', '2026-02-21 23:18:35', NULL),
  (23, '471428c7-de95-4c37-b3dd-ffa13204986d', 1, 'ADMIN-001', 'ADMINISTRATEUR', 'SYSTEME', NULL, NULL, NULL, NULL, NULL, '2026-01-15 21:53:10', '2026-01-15 21:53:10', NULL),
  (24, 'b0b998dd-a6e2-452a-a616-5d8a1af0569a', 25, NULL, 'Assistante', 'Technique', NULL, NULL, NULL, 2, 9, '2026-01-26 14:51:59', '2026-01-28 20:53:13', '2026-01-28 20:53:14'),
  (25, '5a523f1b-3dd5-4a1d-a3b8-16e69214346e', 17, NULL, 'Admin', 'GP', NULL, NULL, NULL, NULL, 1, '2026-01-26 21:16:09', '2026-01-26 21:16:09', NULL),
  (26, 'fa884c2f-ad6f-41a0-a590-d490da9fd7cf', 18, NULL, 'Demandeur', 'GP', NULL, NULL, NULL, NULL, 2, '2026-01-26 21:16:09', '2026-01-26 21:16:09', NULL),
  (27, 'fdce32cc-56a7-4de1-9a0a-fe90fb5086e3', 19, NULL, 'Responsable', 'GP', NULL, NULL, NULL, NULL, 3, '2026-01-26 21:16:09', '2026-01-26 21:16:09', NULL),
  (28, 'f3556ff8-c73b-46eb-896d-0c5fc4074525', 20, NULL, 'Directeur', 'GP', NULL, NULL, NULL, NULL, 4, '2026-01-26 21:16:09', '2026-01-26 21:16:09', NULL),
  (29, '28eada20-374f-40b2-8d79-c36b3ef1ea57', 21, NULL, 'DAF', 'GP', NULL, NULL, NULL, NULL, 5, '2026-01-26 21:16:09', '2026-02-23 19:51:15', '2026-02-23 19:51:15'),
  (30, '5a785b86-a423-4805-ac4e-f64dd3004e6f', 22, NULL, 'DGA', 'GP', NULL, NULL, NULL, NULL, 6, '2026-01-26 21:16:09', '2026-02-23 19:51:17', '2026-02-23 19:51:18'),
  (31, 'f61ced52-b671-4a07-bb83-4fa99f7478cd', 23, NULL, 'DG', 'GP', NULL, NULL, NULL, NULL, 7, '2026-01-26 21:16:09', '2026-02-23 19:51:19', '2026-02-23 19:51:19'),
  (32, '070a6bdc-117a-468b-8ec6-fed1eebb7707', 24, NULL, 'Comptable', 'GP', NULL, NULL, NULL, NULL, 8, '2026-01-26 21:16:09', '2026-01-26 21:16:09', NULL),
  (33, 'db07d869-df71-41ef-bdfb-f212b03733bd', 25, 'AT-001', 'YAO', 'ORNELLA', 4, NULL, NULL, NULL, 9, '2026-01-28 20:40:29', '2026-02-25 21:11:55', NULL),
  (34, 'c0bf7454-d7e7-4cb8-a38d-04be2011eafa', 26, 'AT-009', 'AMON', 'DORCAS', 4, NULL, NULL, 2, 2, '2026-02-12 12:02:52', '2026-02-25 20:31:17', NULL),
  (35, 'bedbf014-8c6c-4716-9bbf-cc6543d0a8a4', 27, 'DAF-005', 'KOUAKOU', 'ANDREA', 3, 2, 4, 7, 2, '2026-02-21 18:49:29', '2026-02-25 13:35:52', NULL),
  (36, 'db0597cf-0822-4a8b-aabc-17555bcf17de', 28, NULL, 'Administrateur', 'Systeme', NULL, NULL, NULL, NULL, 1, '2026-02-25 19:23:52', '2026-02-25 19:23:52', NULL),
  (37, '9b57328a-655b-4a50-88ce-3c3dd37abb6a', 33, 'DCM-004', 'KOUASSI', 'YVANN', 6, 7, NULL, 38, 3, '2026-03-31 14:47:23', '2026-03-31 14:51:07', NULL),
  (38, 'f4848330-585d-435c-8e78-b5ae8ec13dd5', 29, 'DCM-001', 'GOKOU', 'GERARD', 6, NULL, NULL, NULL, 4, '2026-03-31 14:48:42', '2026-03-31 14:48:42', NULL),
  (39, 'f350f2b4-c995-495b-8de0-3302bcc19845', 32, NULL, 'BLAI', 'MAXIME', 6, 6, NULL, 38, 3, '2026-03-31 14:49:22', '2026-03-31 15:21:50', NULL),
  (40, '9ffaaeab-be6a-4524-8d5d-249586a81f67', 30, 'DCM-005', 'DOUZOUO', 'DAVID', 6, 4, NULL, 38, 3, '2026-03-31 14:49:59', '2026-03-31 14:50:07', NULL),
  (41, '948c6172-2b2f-440d-bdb9-2f2343069135', 31, 'DCM-006', 'ZOUKOU', 'OLIVIER', 6, 5, NULL, 38, 3, '2026-03-31 14:50:28', '2026-03-31 14:50:33', NULL);

ALTER TABLE `agents`
  ADD CONSTRAINT `fk_agent_departement`
    FOREIGN KEY (`departement_id`) REFERENCES `departements`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_agent_direction`
    FOREIGN KEY (`direction_id`) REFERENCES `directions`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_agent_manager`
    FOREIGN KEY (`manager_id`) REFERENCES `agents`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_agent_role`
    FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_agent_service`
    FOREIGN KEY (`service_id`) REFERENCES `services`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_agent_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
