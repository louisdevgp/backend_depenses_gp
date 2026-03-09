param(
  [string]$BaselineName = "000_init",
  [string]$MigrationName = "add-validation-stop-role",
  [switch]$SkipDbPull
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "== Prisma baseline and migration =="

function Write-Utf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

if (-not (Test-Path ".env")) {
  Write-Warning ".env not found in back/. Make sure DATABASE_URL is set."
}

if (-not $SkipDbPull) {
  Write-Host "Pulling schema from database..."
  npx prisma db pull
}

$migrationsDir = Join-Path $root "prisma/migrations"
New-Item -ItemType Directory -Force $migrationsDir | Out-Null

$baselineDir = Join-Path $migrationsDir $BaselineName
if (-not (Test-Path $baselineDir)) {
  Write-Host "Creating baseline migration '$BaselineName'..."
  New-Item -ItemType Directory -Force $baselineDir | Out-Null
  $diff = & npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
  $diffText = ($diff -join "`r`n")
  Write-Utf8NoBom (Join-Path $baselineDir "migration.sql") $diffText
} else {
  Write-Host "Baseline migration '$BaselineName' already exists."
}

if (Test-Path (Join-Path $baselineDir "migration.sql")) {
  $baselineContent = Get-Content -Path (Join-Path $baselineDir "migration.sql") -Raw
  Write-Utf8NoBom (Join-Path $baselineDir "migration.sql") $baselineContent
}

try {
  npx prisma migrate resolve --applied $BaselineName
  Write-Host "Baseline marked as applied."
} catch {
  Write-Warning ("Baseline resolve failed (may already be applied): " + $_.Exception.Message)
}

$schemaPath = Join-Path $root "prisma/schema.prisma"
$schema = Get-Content -Path $schemaPath -Raw
if ($schema -notmatch "validation_stop_role") {
  $pattern = "(?m)^\\s*validation_flow_id\\s+Int\\?[^\\r\\n]*$"
  $m = [regex]::Match($schema, $pattern)
  if ($m.Success) {
    $insertLine = $m.Value + "`r`n    validation_stop_role                             String?               @db.VarChar(20)"
    $schema = $schema.Substring(0, $m.Index) + $insertLine + $schema.Substring($m.Index + $m.Length)
    Write-Utf8NoBom $schemaPath $schema
    Write-Host "Added validation_stop_role to schema."
  } else {
    Write-Warning "Could not locate validation_flow_id in schema. Please add validation_stop_role manually."
  }
} else {
  Write-Host "validation_stop_role already present in schema."
}

Write-Host "Creating migration '$MigrationName' (create-only)..."
npx prisma migrate dev --name $MigrationName --create-only

Write-Host "Applying migrations..."
npx prisma migrate deploy

Write-Host "Generating Prisma client..."
npx prisma generate

Write-Host "Done."
