$ErrorActionPreference = 'Stop'

& python (Join-Path $PSScriptRoot 'build-android-brand.py')
if ($LASTEXITCODE -ne 0) {
    throw 'Brand artwork generation failed.'
}
