INSERT INTO `permissions` (`uuid`, `code`, `label`, `is_active`, `deleted_at`)
SELECT UUID(), 'DEMANDE_DAF_FIELDS_VIEW', 'Voir champs DAF demandes', 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'DEMANDE_DAF_FIELDS_VIEW');

UPDATE `permissions`
SET `label` = 'Voir champs DAF demandes', `is_active` = 1, `deleted_at` = NULL
WHERE `code` = 'DEMANDE_DAF_FIELDS_VIEW';

UPDATE `role_permissions` rp
JOIN `roles` r ON r.`id` = rp.`role_id`
JOIN `permissions` p ON p.`id` = rp.`permission_id`
SET rp.`deleted_at` = NULL
WHERE r.`name` IN ('DAF', 'ADMIN')
  AND p.`code` = 'DEMANDE_DAF_FIELDS_VIEW';

INSERT INTO `role_permissions` (`uuid`, `role_id`, `permission_id`, `deleted_at`)
SELECT UUID(), r.`id`, p.`id`, NULL
FROM `roles` r
JOIN `permissions` p ON p.`code` = 'DEMANDE_DAF_FIELDS_VIEW'
WHERE r.`name` IN ('DAF', 'ADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` rp
    WHERE rp.`role_id` = r.`id`
      AND rp.`permission_id` = p.`id`
  );
