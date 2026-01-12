# Planning BACK (API + DB)

Objectif: aligner l’implémentation sur la procédure d’achat Green Pay (Demande → Validations → BC → Réception → Paiement), avec la possibilité de payer **avant** ou **après** réception.

## 0) Baseline (pré-requis)
- [x] Vérifier la DB (DATABASE_URL), Prisma, seed, et `/api/health`
- [x] Vérifier login + `/auth/me` (token, roles, userId)
- [x] Mettre un jeu de données minimal (roles + flows + users/agents)
- [x] Configurer l'envoi email (SMTP) + test de connectivité: `npm run mail:check`
	- Office365 (recommandé): `MAIL_HOST=smtp.office365.com`, `MAIL_PORT=587`, `MAIL_SECURE=false`, `MAIL_REQUIRE_TLS=true`
	- `FRONTEND_URL` est utilisé pour générer des liens cliquables dans les emails

## 1) Correctifs bloquants (stabilité)
- [x] Corriger la route contacts fournisseur (`/fournisseurs/:id/contacts`)
- [x] Corriger le controller Réceptions (import Prisma + résolution agentId fiable)
- [x] Éviter la création d’un second PrismaClient dans le controller Paiements
- [ ] Vérifier / harmoniser les chemins d’API appelés par le front (BC, validations, documents, paiements, réceptions)

## 2) Rôles, permissions et sécurité (best practices)
- [x] Définir les rôles officiels (au minimum: DEMANDEUR, RESPONSABLE, DIRECTEUR, DAF, DGA, DG, COMPTABLE, ADMIN)
- [x] Renforcer les guards par route (ex: qui peut créer BC, visa directeur/DAF, payer, etc.)
- [ ] S’assurer que le token contient `userId` (et idéalement `agentId`), et documenter le payload JWT

## 3) Circuit de validation (selon rôle du demandeur)
- [x] Aligner le circuit de validation: RESPONSABLE → DIRECTEUR → DAF → DGA → DG (DG & DGA = approbation finale)
- [x] Vérifier la résolution hiérarchique (manager_id / manager du manager) pour RESPONSABLE/DIRECTEUR
- [x] Ajouter fallback si hiérarchie incomplète: chercher un RESPONSABLE/DIRECTEUR dans le même service/département/direction
- [ ] Pré-requis DATA: s'assurer que chaque demandeur a un manager actif (Directeur) (table `agent_reporting_lines` ou champ `agents.manager_id`) ET qu'un DIRECTEUR existe par direction
- [x] Sélectionner le flow selon le rôle du demandeur (codes DB):
	- DEMANDEUR/COMPTABLE → `FLOW_DEMANDEUR_LAMBDA`
	- RESPONSABLE → `FLOW_RESPONSABLE`
	- DIRECTEUR → `FLOW_DIRECTEUR`
	- DAF → `FLOW_DAF`
	- DGA → `FLOW_DGA`
	- DG → `FLOW_DG`
- [x] Ajouter un garde-fou: empêcher l’édition de la demande après la 1ère validation (si c’est la règle)
	- Note cas spécial (DB): `FLOW_DG` = DG → DGA, et DGA est résolu comme valideur global (entité indépendante, pas de rattachement hiérarchique requis).

## 4) Bon de commande (BC)
- [x] Interdire la création d’un BC tant que la demande n’est pas totalement approuvée
- [x] Ajouter une règle d’accès: BC créable par le demandeur ou rôles privilégiés; annulation réservée (routes)
- [ ] Procédure: le BC est signé par le DAF puis par le DGA ou le DG avant envoi au fournisseur
- [ ] Statuts BC: définir un mini-cycle (brouillon → emis → annule) si nécessaire

## 5) Réception (avant ou après paiement)
- [x] Autoriser la création d’une réception à partir de `demande_id` **ou** `paiement_id`
- [x] Ajuster le statut de demande: `receptionnee` si réception sans paiement, `cloture` si paiement déjà présent
- [x] Enregistrer aussi `reference_facture`, `montant`, `observations` lors de la création (si fournis)
- [ ] Vérifier les visas (directeur/DAF): restreindre l’action selon rôles + délégations
- [ ] Lier/valider les documents de réception (facture définitive, bon de livraison, etc.)

Note procédure: la réception est renseignée par le service demandeur, visée par le DIRECTEUR, puis visée par le DAF avant archivage comptabilité.

## 6) Paiement (avant ou après réception)
- [x] Ajuster le statut de demande: `cloture` si une réception existe déjà, sinon `paye`
- [x] Règle: si `fournisseur_id` est renseigné ⇒ `beneficiaire` = nom fournisseur
- [ ] Valider la logique “paiement avant réception” vs “paiement après réception” (les 2 autorisés)
- [ ] Implémenter/valider les “conditions de paiement” (échéances, 30 jours) si requis

Note procédure: le timing de règlement (immédiat / à la réception / 30 jours) est apprécié par le DAF ou la Direction Générale.

## 7) Documents + notifications + audit (traçabilité)
- [ ] Normaliser `type_document` (devis, proforma, BC, BL, réception, facture définitive, pièce paiement)
- [ ] Définir les pièces obligatoires par étape (procédure)

- [x] Baseline notifications email: enregistrement DB transactionnel, email envoyé après commit (non bloquant)
- [x] Emails “pro” par action (HTML + bouton + lien profond vers l’écran concerné)
	- Base URL: `FRONTEND_URL` (ex: `https://...`)
	- Outil debug SMTP: `npm run mail:check` (utilise `MAIL_TEST_TO` pour envoyer un email de test)

- [x] Couvrir “email pour chaque action” (soumission, validation, rejet, BC, réception, paiement, docs, visas, etc.)
	- [x] Validations: approve/reject + notification du prochain valideur
	- [x] Demandes: création + update + suppression (soft delete)
	- [x] BC: création + update + annulation + suppression
	- [x] Réceptions: création + visas Directeur/DAF
	- [x] Paiement: création
	- [x] Documents: couvrir aussi `bon_commande_id` / `reception_id` / `paiement_id` (rattaché à la demande)
	- [x] Paiement: update/delete (si exposés au front)
	- [x] Réceptions: update/delete (si exposés au front)
	- [ ] Paiement: docs ajoutés/supprimés après coup (si ce flux existe)
- [ ] Ajouter/renforcer audit_logs sur actions sensibles (approve/reject/visa/pay)

## 8) Génération PDF (Demande / BC / Réception)
- [ ] Définir les modèles PDF (en-tête Green Pay, numéros, signatures/visas, tableaux items)
- [ ] Implémenter des endpoints de génération/téléchargement:
	- [x] Demande: `GET /demandes/:idOrUuid/pdf`
	- [x] Bon de commande: `GET /bons-commande/:idOrUuid/pdf`
	- [x] Réception: `GET /receptions/:idOrUuid/pdf`
- [ ] Sécuriser l’accès (seulement les rôles autorisés + demandeur)
- [ ] Inclure les pièces et métadonnées utiles (fournisseur/bénéficiaire, montants, dates, statuts, visas)
- [ ] Stratégie de stockage: génération à la volée vs sauvegarde en `documents` (à décider)

## 9) Qualité (tests & validation)
- [ ] Ajouter des tests API minimaux sur le flux complet
- [x] Ajouter un script de reset des données transactionnelles (conserver users/agents/flows): `npm run reset:testdata -- --yes`
- [ ] Vérifier cohérence des statuts (demande) et transitions
- [ ] Vérifier erreurs/HTTP codes homogènes (middleware error)

## 10) Matrice procédure ↔ endpoints ↔ rôles (référence tests E2E)

Demande (expression du besoin)
- Créer demande: `POST /api/demandes` → `DEMANDEUR, RESPONSABLE, DIRECTEUR, DAF, DGA, DG, COMPTABLE, ADMIN`
- Liste globale: `GET /api/demandes` → mêmes rôles
- Mes demandes: `GET /api/demandes/my` → authentifié
- Détail demande: `GET /api/demandes/:idOrUuid` → authentifié (contrôle fin côté service si applicable)
- Modifier/Supprimer: `PUT|DELETE /api/demandes/:idOrUuid` → `DEMANDEUR, ADMIN` (avec règles métier côté service)
- PDF: `GET /api/demandes/:idOrUuid/pdf` → `DEMANDEUR, RESPONSABLE, DIRECTEUR, DAF, DGA, DG, COMPTABLE, ADMIN`

Validations (DIRECTEUR → DAF → DGA → DG selon flow)
- Mes validations en attente: `GET /api/validation/pending` → `RESPONSABLE, DIRECTEUR, DAF, DGA, DG, ADMIN` (délégation supportée)
- Approuver/Rejeter: `POST /api/validation/:stepId/approve|reject` → mêmes rôles
- Historique: `GET /api/validation/done` → mêmes rôles
- Par demande: `GET /api/validation/demande/:demandeId` → authentifié

Bon de commande (commande)
- Créer BC: `POST /api/bon-commandes` → `DEMANDEUR, RESPONSABLE, DIRECTEUR, DAF, DGA, DG, ADMIN` (bloqué tant que demande non approuvée)
- Modifier BC: `PUT /api/bon-commandes/:id` → `RESPONSABLE, DIRECTEUR, DAF, DGA, DG, ADMIN`
- Annuler BC: `PATCH /api/bon-commandes/:id/cancel` → `DAF, DGA, DG, ADMIN`
- PDF: `GET /api/bon-commandes/:idOrUuid/pdf` → `DEMANDEUR, RESPONSABLE, DIRECTEUR, DAF, DGA, DG, ADMIN`
- Note procédure: signatures/visas BC (DAF puis DG/DGA) à modéliser si on veut l’imposer techniquement.

Réception (avant ou après paiement)
- Créer réception: `POST /api/receptions` → `DEMANDEUR, RESPONSABLE, DIRECTEUR, DAF, COMPTABLE, ADMIN`
- Visa Directeur: `POST /api/receptions/:id/visa-directeur` → `DIRECTEUR, ADMIN`
- Visa DAF: `POST /api/receptions/:id/visa-daf` → `DAF, ADMIN`
- Liste/détail/PDF: `GET /api/receptions` + `GET /api/receptions/:idOrUuid/pdf` → `DEMANDEUR, RESPONSABLE, DIRECTEUR, DAF, DGA, DG, COMPTABLE, ADMIN`

Paiement
- Créer paiement: `POST /api/paiements/pay` → `DAF, COMPTABLE, ADMIN`
- Liste/détail: `GET /api/paiements/*` → `DAF, COMPTABLE, ADMIN`
- Note procédure: timing (immédiat / réception / 30 jours) géré par décision DAF/DG, pas encore “imposé” par règles techniques strictes.

Documents (devis/proforma, BL, facture, pièces paiement)
- Upload: `POST /api/documents/upload` → authentifié (contrôle fin/ownership à vérifier)
- Lister: `GET /api/documents` → authentifié
- Supprimer: `DELETE /api/documents/:id` → authentifié

Délégations (intérim)
- CRUD délégations: `/api/delegations/*` → `RESPONSABLE, DIRECTEUR, DAF, DGA, DG, ADMIN`
- Règles métier: `ADMIN` non délégable; le rôle de délégation = rôle réel du principal.
