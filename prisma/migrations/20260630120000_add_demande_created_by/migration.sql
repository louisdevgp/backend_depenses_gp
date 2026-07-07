ALTER TABLE demandes_paiement
  ADD COLUMN created_by_id INT UNSIGNED NULL AFTER demandeur_id;

UPDATE demandes_paiement
SET created_by_id = demandeur_id
WHERE created_by_id IS NULL;

ALTER TABLE demandes_paiement
  ADD INDEX idx_demande_created_by (created_by_id),
  ADD CONSTRAINT fk_demande_created_by
    FOREIGN KEY (created_by_id) REFERENCES agents(id)
    ON DELETE SET NULL;
