INSERT INTO `permissions` (`uuid`, `code`, `label`, `is_active`, `deleted_at`)
SELECT UUID(), 'BUDGET_DASHBOARD_VIEW', 'Budget Dashboard View', 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'BUDGET_DASHBOARD_VIEW');

INSERT INTO `role_permissions` (`uuid`, `role_id`, `permission_id`, `deleted_at`)
SELECT UUID(), r.id, p.id, NULL
FROM `roles` r
JOIN `permissions` p ON p.`code` = 'BUDGET_DASHBOARD_VIEW'
WHERE r.`name` = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` rp
    WHERE rp.`role_id` = r.`id` AND rp.`permission_id` = p.`id`
  );
