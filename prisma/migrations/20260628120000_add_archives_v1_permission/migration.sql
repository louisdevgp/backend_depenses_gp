INSERT INTO `permissions` (`uuid`, `code`, `label`, `is_active`, `deleted_at`)
SELECT UUID(), 'ARCHIVES_V1_VIEW', 'Archives V1 View', 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'ARCHIVES_V1_VIEW');

INSERT INTO `role_permissions` (`uuid`, `role_id`, `permission_id`, `deleted_at`)
SELECT UUID(), r.id, p.id, NULL
FROM `roles` r
JOIN `permissions` p ON p.`code` = 'ARCHIVES_V1_VIEW'
WHERE r.`name` = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` rp
    WHERE rp.`role_id` = r.`id` AND rp.`permission_id` = p.`id`
  );
