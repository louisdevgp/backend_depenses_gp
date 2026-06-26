-- A document such as an invoice can exist before the purchase is completed.
-- Keep legacy requests pending unless their status already proves a completed purchase.
UPDATE `demandes_paiement`
SET
  `achat_requis` = NULL,
  `achat_decision_par_id` = NULL,
  `achat_decision_at` = NULL,
  `achat_decision_commentaire` = NULL
WHERE
  `achat_requis` = true
  AND `statut` NOT IN ('achat_effectue', 'receptionnee', 'cloture', 'cloturee');
