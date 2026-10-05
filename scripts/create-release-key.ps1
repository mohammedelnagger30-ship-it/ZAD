$ErrorActionPreference = 'Stop'

$appDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'android\app'
$keystorePath = Join-Path $appDir 'zad-release.jks'
$propertiesPath = Join-Path $appDir 'keystore.properties'
$keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'

if (-not (Test-Path -LiteralPath $keytool)) {
    throw 'JDK keytool was not found. Install JDK 17 and set JAVA_HOME.'
}
if ((Test-Path -LiteralPath $keystorePath) -or (Test-Path -LiteralPath $propertiesPath)) {
    throw 'A release key already exists. Do not overwrite it; Android updates must keep the same signing key.'
}

$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 36
$random.GetBytes($bytes)
$random.Dispose()
$password = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'B')
$alias = 'zad-release'

& $keytool -genkeypair `
    -keystore $keystorePath `
    -storetype PKCS12 `
    -storepass $password `
    -keypass $password `
    -alias $alias `
    -keyalg RSA `
    -keysize 3072 `
    -validity 10000 `
    -dname 'CN=ZAD Android App'
if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $keystorePath -Force -ErrorAction SilentlyContinue
    throw 'Could not create the Android release signing key.'
}

$properties = [ordered]@{
    storeFile = 'zad-release.jks'
    storePassword = $password
    keyAlias = $alias
    keyPassword = $password
}
$properties | ConvertTo-Json | Set-Content -LiteralPath $propertiesPath -Encoding UTF8
Write-Output 'Created the local Android release key. Keep android\app\zad-release.jks and keystore.properties backed up securely; neither is tracked by Git.'
