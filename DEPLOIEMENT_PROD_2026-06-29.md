# Deploiement production - 2026-06-29

## 1. Code a recuperer

Backend :

```bash
git pull origin main
npm install
npx prisma migrate deploy
npx prisma generate
npm run seed:permissions
npm start
```

Frontend, si la production le gere separement :

```bash
git pull origin Main
npm install
npm run build
```

La fonctionnalite Archives V1 necessite le backend et le frontend a jour.

## 2. Variables d'environnement backend

Base principale :

```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/gp_achats"
```

Archive V1 sur le meme serveur MySQL :

```env
V1_ARCHIVE_DB="devgp_gp"
```

Archive V1 sur un autre serveur :

```env
V1_ARCHIVE_DATABASE_URL="mysql://ARCHIVE_USER:ARCHIVE_PASSWORD@ARCHIVE_HOST:3306/devgp_gp"
```

Regle : `V1_ARCHIVE_DATABASE_URL` prend le dessus sur `V1_ARCHIVE_DB`.

Variables minimum a verifier :

```env
HOST=0.0.0.0
PORT=9000
FRONTEND_URL="https://URL_FRONT_PROD"
JWT_ACCESS_SECRET="..."
JWT_REFRESH_SECRET="..."
MAIL_HOST="..."
MAIL_PORT=587
MAIL_SECURE=false
MAIL_REQUIRE_TLS=true
MAIL_USER="..."
MAIL_PASS="..."
MAIL_FROM_EMAIL="..."
MAIL_FROM_NAME="DEPENSES - GREENPAY"
FIRMA_API_KEY="..."
FIRMA_API_BASE="https://api.firma.dev/functions/v1/signing-request-api"
FIRMA_WEBHOOK_SECRET="..."
```

## 3. Base propre a importer

Fichier genere localement :

```text
backups/gp_achats_prod_seed_clean_20260629_004403.sql
```

Contenu conserve :

- utilisateurs ;
- agents ;
- roles ;
- permissions ;
- permissions utilisateurs ;
- directions ;
- departements ;
- services ;
- validation flows ;
- validation flow steps.

Contenu vide :

- demandes ;
- documents ;
- validations ;
- paiements ;
- receptions ;
- notifications ;
- signatures ;
- OTP ;
- delegations ;
- bons de commande.

Import production :

```bash
mysql -u USER -p gp_achats < backups/gp_achats_prod_seed_clean_20260629_004403.sql
```

Attention : ce fichier contient les `DROP TABLE` / `CREATE TABLE` du dump. Il faut l'utiliser sur une base cible que l'on accepte de remplacer.

## 4. Archive V1 a importer

Si la base archive V1 s'appelle `devgp_gp` en production :

```bash
mysql -u USER -p -e "CREATE DATABASE IF NOT EXISTS devgp_gp CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"
mysql -u USER -p devgp_gp < devgp_gp_bak.sql
```

Puis dans `.env` :

```env
V1_ARCHIVE_DB="devgp_gp"
```

ou si serveur separe :

```env
V1_ARCHIVE_DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/devgp_gp"
```

## 5. Verification apres deploiement

Backend :

```bash
curl https://URL_API_PROD/api/health
```

Application :

- se connecter en admin ;
- verifier le menu `Demandes > Archives V1` ;
- verifier qu'un non-admin sans `ARCHIVES_V1_VIEW` ne voit pas le menu ;
- verifier une creation de demande simple ;
- verifier une validation ;
- verifier l'envoi de mail ;
- verifier l'upload local des documents ;
- verifier Firma si active.
