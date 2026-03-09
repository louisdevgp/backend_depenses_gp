$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "== Add validation_stop_role column =="

if (-not (Test-Path ".env")) {
  Write-Warning ".env not found in back/. Make sure DATABASE_URL is set."
}

$schemaPath = Join-Path $root "prisma/schema.prisma"
$schema = Get-Content -Path $schemaPath -Raw
if ($schema -notmatch "validation_stop_role") {
  $pattern = "(?m)^\\s*validation_flow_id\\s+Int\\?[^\\r\\n]*$"
  $m = [regex]::Match($schema, $pattern)
  if ($m.Success) {
    $insertLine = $m.Value + "`r`n    validation_stop_role                             String?               @db.VarChar(20)"
    $schema = $schema.Substring(0, $m.Index) + $insertLine + $schema.Substring($m.Index + $m.Length)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($schemaPath, $schema, $utf8NoBom)
    Write-Host "Added validation_stop_role to schema."
  } else {
    Write-Warning "Could not locate validation_flow_id in schema. Please add validation_stop_role manually."
  }
} else {
  Write-Host "validation_stop_role already present in schema."
}

Write-Host "Applying SQL to database..."
try {
  npx prisma db execute --file scripts/add-validation-stop-role.sql --schema prisma/schema.prisma
} catch {
  Write-Warning ("DB execute failed (column may already exist): " + $_.Exception.Message)
}

Write-Host "Generating Prisma client..."
npx prisma generate

Write-Host "Done."
