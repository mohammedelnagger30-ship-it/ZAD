Add-Type -AssemblyName System.Drawing

# Verifies the generated icons: real PNGs, correct dimensions, and a genuine
# two-tone image rather than a blank or all-black square. The icon is the Qurra
# mark full-bleed on a deep-green field cut to the program's squircle, so it is
# mostly green with a small but real ivory mark; the og-image is that same
# mark on the left of a deep-green field with the name on the right, so it runs
# even greener. The floors below are set near the measured values so a
# washed-out or missing mark fails loudly.
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'public\icons'

$fail = 0
function Test-Icon {
    param([string]$Name, [int]$ExpectW, [int]$ExpectH, [double]$MinGoldPct = 1.5, [double]$MinGreenPct = 45)

    $path = Join-Path $outDir $Name
    if (-not (Test-Path $path)) { "FAIL $Name missing"; $script:fail++; return }

    $bmp = [System.Drawing.Image]::FromFile($path)
    if ($bmp.RawFormat.Guid -ne [System.Drawing.Imaging.ImageFormat]::Png.Guid) {
        "FAIL $Name is not a PNG"; $script:fail++
    }
    if ($bmp.Width -ne $ExpectW -or $bmp.Height -ne $ExpectH) {
        "FAIL $Name is $($bmp.Width)x$($bmp.Height), expected ${ExpectW}x${ExpectH}"; $script:fail++
    }

    # Classify every pixel: green field, ivory/gold accent, or neither.
    $green = 0; $gold = 0; $other = 0
    $bmpNew = New-Object System.Drawing.Bitmap($bmp)
    for ($y = 0; $y -lt $bmpNew.Height; $y += 2) {
        for ($x = 0; $x -lt $bmpNew.Width; $x += 2) {
            $c = $bmpNew.GetPixel($x, $y)
            if ($c.R -lt 70 -and $c.G -lt 120 -and $c.B -lt 100) { $green++ }
            # Warm ivory accent: the Mushaf's pages. Warm because R clearly
            # leads B; the dark green field stays out by its low brightness.
            elseif ($c.R -gt 205 -and $c.G -gt 190 -and $c.B -gt 140 -and ($c.R - $c.B) -ge 12) { $gold++ }
            else { $other++ }
        }
    }
    $bmpNew.Dispose(); $bmp.Dispose()

    $total = $green + $gold + $other
    $goldPct = [math]::Round(100 * $gold / $total, 2)
    $greenPct = [math]::Round(100 * $green / $total, 2)

    if ($goldPct -lt $MinGoldPct) { "FAIL $Name has almost no gold mark ($goldPct%)"; $script:fail++ }
    if ($greenPct -lt $MinGreenPct) { "FAIL $Name lacks its green mark/field ($greenPct%)"; $script:fail++ }

    $ok = if ($goldPct -ge $MinGoldPct -and $greenPct -ge $MinGreenPct) { 'ok  ' } else { 'FAIL' }
    "$ok $Name ${ExpectW}x${ExpectH}  green=$greenPct%  gold=$goldPct%"
}

Test-Icon 'icon-512.png' 512 512
Test-Icon 'icon-192.png' 192 192
Test-Icon 'og-image.png' 1200 630 0.8 60

if ($fail -eq 0) { "`nICON CHECKS PASSED" } else { "`n$fail ICON CHECK(S) FAILED"; exit 1 }