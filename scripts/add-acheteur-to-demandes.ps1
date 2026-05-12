$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "== Add acheteur_id to demandes_paiement =="

if (-not (Test-Path ".env")) {
  Write-Warning ".env not found in back/. Make sure DATABASE_URL is set."
}

Write-Host "Applying SQL to database..."
try {
  npx.cmd prisma db execute --file scripts/add-acheteur-to-demandes.sql --schema prisma/schema.prisma
} catch {
  Write-Warning ("DB execute failed (column/FK/index may already exist): " + $_.Exception.Message)
}

Write-Host "Generating Prisma client..."
npx.cmd prisma generate

Write-Host "Done."
