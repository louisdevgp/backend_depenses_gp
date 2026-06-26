-- Foreign keys from InnoDB tables cannot reference a MyISAM parent table.
SET @previous_foreign_key_checks = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;
ALTER TABLE `agents` ENGINE=InnoDB;
SET FOREIGN_KEY_CHECKS = @previous_foreign_key_checks;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'agents'
      AND CONSTRAINT_NAME = 'fk_agent_departement'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE `agents` ADD CONSTRAINT `fk_agent_departement` FOREIGN KEY (`departement_id`) REFERENCES `departements` (`id`) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE statement FROM @sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'agents'
      AND CONSTRAINT_NAME = 'fk_agent_direction'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE `agents` ADD CONSTRAINT `fk_agent_direction` FOREIGN KEY (`direction_id`) REFERENCES `directions` (`id`) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE statement FROM @sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'agents'
      AND CONSTRAINT_NAME = 'fk_agent_manager'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE `agents` ADD CONSTRAINT `fk_agent_manager` FOREIGN KEY (`manager_id`) REFERENCES `agents` (`id`) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE statement FROM @sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'agents'
      AND CONSTRAINT_NAME = 'fk_agent_role'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE `agents` ADD CONSTRAINT `fk_agent_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE statement FROM @sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'agents'
      AND CONSTRAINT_NAME = 'fk_agent_service'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE `agents` ADD CONSTRAINT `fk_agent_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE statement FROM @sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'agents'
      AND CONSTRAINT_NAME = 'fk_agent_user'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE `agents` ADD CONSTRAINT `fk_agent_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE'
);
PREPARE statement FROM @sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;
