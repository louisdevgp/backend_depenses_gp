ALTER TABLE demandes_paiement
  ADD COLUMN IF NOT EXISTS acheteur_id INT UNSIGNED NULL AFTER demandeur_id;

SET @sql_add_idx = (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'demandes_paiement'
        AND index_name = 'idx_demande_acheteur'
    ),
    'SELECT 1',
    'CREATE INDEX idx_demande_acheteur ON demandes_paiement(acheteur_id)'
  )
);
PREPARE stmt_add_idx FROM @sql_add_idx;
EXECUTE stmt_add_idx;
DEALLOCATE PREPARE stmt_add_idx;

SET @sql_add_fk = (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = DATABASE()
        AND table_name = 'demandes_paiement'
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name = 'fk_demande_acheteur'
    ),
    'SELECT 1',
    'ALTER TABLE demandes_paiement ADD CONSTRAINT fk_demande_acheteur FOREIGN KEY (acheteur_id) REFERENCES agents(id) ON DELETE SET NULL ON UPDATE RESTRICT'
  )
);
PREPARE stmt_add_fk FROM @sql_add_fk;
EXECUTE stmt_add_fk;
DEALLOCATE PREPARE stmt_add_fk;
