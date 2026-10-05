$ErrorActionPreference = 'Stop'

$repo = 'mohammedelnagger30-ship-it/ZAD'
$appDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'android\app'
$keystorePath = Join-Path $appDir 'zad-release.jks'
$propertiesPath = Join-Path $appDir 'keystore.properties'
$root = Split-Path -Parent $PSScriptRoot
$environmentPath = Join-Path $root '.env.local'

if (-not (Test-Path -LiteralPath $keystorePath) -or -not (Test-Path -LiteralPath $propertiesPath)) {
    throw 'Release key files are missing. Run scripts\create-release-key.ps1 first.'
}
if (-not (Test-Path -LiteralPath $environmentPath)) {
    throw '.env.local is missing; configure Supabase before uploading release secrets.'
}

gh auth status --hostname github.com
if ($LASTEXITCODE -ne 0) { throw 'Sign in to GitHub CLI first with gh auth login.' }

$properties = Get-Content -LiteralPath $propertiesPath -Raw | ConvertFrom-Json
$environment = Get-Content -LiteralPath $environmentPath
$supabaseUrl = ($environment | Where-Object { $_ -match '^VITE_SUPABASE_URL=' } | Select-Object -First 1) -replace '^VITE_SUPABASE_URL=', ''
$supabaseKey = ($environment | Where-Object { $_ -match '^VITE_SUPABASE_ANON_KEY=' } | Select-Object -First 1) -replace '^VITE_SUPABASE_ANON_KEY=', ''
if (-not $supabaseUrl -or -not $supabaseKey) { throw 'Supabase URL and anon key are required in .env.local.' }

$supabaseUrl | gh variable set SUPABASE_URL --repo $repo
if ($LASTEXITCODE -ne 0) { throw 'Could not upload the Supabase URL variable.' }
$supabaseKey | gh secret set SUPABASE_ANON_KEY --repo $repo
if ($LASTEXITCODE -ne 0) { throw 'Could not upload the Supabase anon key secret.' }

$keystoreBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keystorePath))
$keystoreBase64 | gh secret set ZAD_KEYSTORE_BASE64 --repo $repo
if ($LASTEXITCODE -ne 0) { throw 'Could not upload the release keystore secret.' }
$properties.storePassword | gh secret set ZAD_KEYSTORE_PASSWORD --repo $repo
if ($LASTEXITCODE -ne 0) { throw 'Could not upload the keystore password secret.' }
$properties.keyAlias | gh secret set ZAD_KEY_ALIAS --repo $repo
if ($LASTEXITCODE -ne 0) { throw 'Could not upload the key alias secret.' }
$properties.keyPassword | gh secret set ZAD_KEY_PASSWORD --repo $repo
if ($LASTEXITCODE -ne 0) { throw 'Could not upload the key password secret.' }

'Uploaded release signing secrets and Supabase build configuration to GitHub. Secret values were not displayed.'
