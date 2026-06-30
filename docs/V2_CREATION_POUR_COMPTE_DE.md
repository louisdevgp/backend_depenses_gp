# V2 - Creation de demande pour le compte de

## Objectif

Permettre a un utilisateur autorise de creer une demande au nom d'un autre agent, sans confondre cette action avec une delegation de validation.

## Regle V1 a conserver

En V1, une delegation sert uniquement a agir sur une action existante :

- validation ;
- paiement si le role delegue le permet ;
- visa reception ;
- consultation des taches deleguees.

La delegation ne doit jamais modifier le circuit d'une nouvelle demande creee par le delegue.

Exemple V1 :

- Kevin est `DEMANDEUR`.
- Dimitri lui delegue temporairement le role `DAF`.
- Si Kevin cree une demande, le circuit reste celui de Kevin.
- Kevin peut seulement agir sur les validations DAF ou Dimitri est le validateur principal.

## Besoin V2

Cas cible :

- Kevin saisit une demande pour Dimitri.
- Dimitri reste le demandeur metier.
- Kevin est seulement l'auteur de saisie.
- Le circuit est calcule sur Dimitri, pas sur Kevin.

## Modele propose

Ajouter deux notions distinctes :

- `demandeur_id` : agent au nom duquel la demande est creee.
- `created_by_id` : agent qui a saisi la demande.

Si `created_by_id` est absent sur les anciennes demandes, considerer que :

- `created_by_id = demandeur_id`.

## Droits proposes

Nouvelle permission :

- `DEMANDE_CREATE_FOR_AGENT`

Scopes possibles :

- `GLOBAL` : peut creer pour tout agent actif.
- `DIRECTION` : peut creer pour les agents de sa direction.
- `DEPARTEMENT` : peut creer pour les agents de son departement.
- `SERVICE` : peut creer pour les agents de son service.

## Regles metier

- Le createur doit avoir `DEMANDE_CREATE_FOR_AGENT`.
- L'agent cible doit etre actif et rattache a une organisation valide.
- Le circuit de validation est calcule avec le role principal et le rattachement de l'agent cible.
- Les roles delegues du createur sont ignores pour le calcul du circuit.
- L'historique doit afficher : `Creee par X pour Y`.
- Les notifications de creation doivent aller au premier validateur du circuit de Y.
- Y doit voir la demande dans ses demandes.
- X doit pouvoir consulter la demande qu'il a saisie, au moins en lecture.

## Impacts backend

- Migration : ajouter `created_by_id` sur `demandes_paiement`.
- Service creation : accepter `demandeur_id` optionnel si permission autorisee.
- Audit : tracer createur et demandeur.
- Permissions : ajouter `DEMANDE_CREATE_FOR_AGENT`.
- Scopes : appliquer la portee sur l'agent cible.
- Tests : verifier que la delegation n'influence jamais le flow de creation.

## Impacts frontend

- Sur la page `Nouvelle demande`, afficher un select `Demandeur pour le compte de` uniquement si la permission est presente.
- Charger uniquement les agents autorises par scope.
- Afficher clairement le demandeur final avant soumission.
- Dans le detail demande, afficher :
  - demandeur ;
  - saisi par.

## Tests V2 obligatoires

- Demandeur simple cree pour lui-meme.
- Demandeur avec delegation DAF cree pour lui-meme : le flow reste celui du demandeur.
- Utilisateur autorise cree pour un DAF : le flow est `DGA > DG`.
- Utilisateur autorise cree pour un Directeur : le flow est `DAF > DGA > DG`.
- Utilisateur hors scope tente de creer pour un agent non autorise : refus.
- Utilisateur sans permission force l'API avec `demandeur_id` : refus.
- Notification envoyee au bon premier validateur.
