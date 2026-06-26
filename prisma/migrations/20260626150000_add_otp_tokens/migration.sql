ALTER TABLE `users` ADD COLUMN `otp_last_verified_at` DATETIME(0) NULL DEFAULT NULL;
ALTER TABLE `users` ADD INDEX `idx_users_otp_verified` (`otp_last_verified_at`);

CREATE TABLE `otp_tokens` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid` CHAR(36) NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME(0) NOT NULL,
  `used_at` DATETIME(0) NULL DEFAULT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_otp_uuid` (`uuid`),
  INDEX `idx_otp_user` (`user_id`),
  INDEX `idx_otp_expires` (`expires_at`),
  CONSTRAINT `fk_otp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
