# Regenerates the Qurra icon set from the artwork so the binary
# assets stay reproducible.
#
#   scripts\assets\icon-source-v2.png   # source artwork (uploaded, 1254px)
#       -- extracted + re-laid on the brand field -->
#   python scripts\prep-icon-v2.py       # -> icon-prepared.png (mark 48%)
#                                           icon-prepared-adaptive.png (32%)
#   powershell -File scripts\make-icons.ps1
#
# The mark is the open Mushaf in warm ivory on a deep-green field
# with a soft glow (the small status-bar icon's exact silhouette).
# The border is the program's rounded square cut as a true squircle
# (superellipse n=5, continuous curvature like iOS/WhatsApp)
# rather than a plain rounded rect, so the corners read as one
# continuous curve at every size.
#
# prep-icon.py is the retired mockup pipeline (icon-source.jpg ->
# icon-prepared.png); icon-prepared.png now comes straight from
# icon-source-v2.png, so this script needs nothing but .NET.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'public\icons'
$srcPath = Join-Path $root 'scripts\assets\icon-prepared.png'
$srcAdaptivePath = Join-Path $root 'scripts\assets\icon-prepared-adaptive.png'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
foreach ($p in @($srcPath, $srcAdaptivePath)) {
    if (-not (Test-Path $p)) {
        throw "missing $p - run: python scripts\prep-icon-v2.py"
    }
}

# Geometry / palette (kept in sync with the app theme).
$SquircleN   = 5.0                              # superellipse exponent = the border curve
$CornerGreen = [System.Drawing.Color]::FromArgb(255, 9, 33, 28)      # #09211C (the artwork's field at the squircle rim)
$DeepGreen   = [System.Drawing.Color]::FromArgb(255, 14, 51, 44)    # #0E332C
$Ivory       = [System.Drawing.Color]::FromArgb(255, 253, 247, 229) # #FDF7E5
$Gold        = [System.Drawing.Color]::FromArgb(255, 201, 174, 116) # #C9AE74
$Sage        = [System.Drawing.Color]::FromArgb(255, 168, 190, 180) # #A8BEB4

$script:SourceImage = $null
function Get-SourceImage {
    if ($null -eq $script:SourceImage) {
        $script:SourceImage = [System.Drawing.Image]::FromFile($srcPath)
    }
    return $script:SourceImage
}

# Adaptive foreground (108dp): the launcher crops it to the inner 72dp, i.e.
# zooms 1.5x, so it uses the artwork whose mark is already scaled to 32% --
# that way the mark measures the same 48% of the icon the user sees.
$script:SourceImageAdaptive = $null
function Get-AdaptiveSourceImage {
    if ($null -eq $script:SourceImageAdaptive) {
        $script:SourceImageAdaptive = [System.Drawing.Image]::FromFile($srcAdaptivePath)
    }
    return $script:SourceImageAdaptive
}

# Adds the squircle (superellipse |x|^n + |y|^n = 1) as a dense polygon.
function Add-Squircle {
    param(
        [System.Drawing.Drawing2D.GraphicsPath]$Path,
        [double]$Cx, [double]$Cy, [double]$Half, [int]$Points = 720
    )
    $exp = 2.0 / $SquircleN
    $px = $Cx + $Half
    $py = $Cy
    $Path.StartFigure()
    for ($i = 0; $i -lt $Points; $i++) {
        $t = 2 * [Math]::PI * $i / $Points
        $ct = [Math]::Cos($t)
        $st = [Math]::Sin($t)
        $sx = if ($ct -ge 0) { 1 } else { -1 }
        $sy = if ($st -ge 0) { 1 } else { -1 }
        $x = $Cx + $Half * $sx * [Math]::Pow([Math]::Abs($ct), $exp)
        $y = $Cy + $Half * $sy * [Math]::Pow([Math]::Abs($st), $exp)
        if ($i -eq 0) {
            $Path.AddLine([float]$x, [float]$y, [float]$x, [float]$y)
        } else {
            $Path.AddLine([float]$px, [float]$py, [float]$x, [float]$y)
        }
        $px = $x
        $py = $y
    }
    $Path.CloseFigure()
}

# Renders the artwork cut to the program's border at $Size.
#   $Shape 'squircle' | 'circle' | 'square'
#   $Fill  'opaque' (deep-green corners - always, so downscaling never fringes)
function New-Mark {
    param(
        [int]$Size,
        [string]$Shape = 'squircle',
        [string]$Fill = 'opaque',
        [switch]$Adaptive
    )
    $ss = 4                                   # supersample then downscale = clean edge
    $H = $Size * $ss

    $hi = [System.Drawing.Bitmap]::new($H, $H)
    $g = [System.Drawing.Graphics]::FromImage($hi)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    if ($Fill -eq 'opaque') {
        $bgBrush = [System.Drawing.SolidBrush]::new($CornerGreen)
        $g.FillRectangle($bgBrush, 0, 0, $H, $H)
    }

    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $half = $H / 2.0
    switch ($Shape) {
        'circle' { $path.AddEllipse([float]0, [float]0, [float]$H, [float]$H) }
        'square' { $path.AddRectangle([System.Drawing.Rectangle]::new(0, 0, $H, $H)) }
        default  { Add-Squircle -Path $path -Cx $half -Cy $half -Half $half }
    }
    $g.SetClip($path)
    $src = if ($Adaptive) { Get-AdaptiveSourceImage } else { Get-SourceImage }
    $g.DrawImage($src,
        [System.Drawing.Rectangle]::new(0, 0, $H, $H),
        [System.Drawing.Rectangle]::new(0, 0, $src.Width, $src.Height),
        [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()

    $out = [System.Drawing.Bitmap]::new($Size, $Size)
    $og = [System.Drawing.Graphics]::FromImage($out)
    $og.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $og.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $og.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $og.DrawImage($hi, 0, 0, $Size, $Size)
    $og.Dispose()
    $hi.Dispose()
    return $out
}

function Save-Png {
    param([System.Drawing.Bitmap]$Bmp, [string]$Path)
    $Bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $Bmp.Dispose()
    "  $($Path.Substring($root.Length + 1)) ($((Get-Item $Path).Length) bytes)"
}

function Save-Icon {
    param([int]$Size, [string]$Name)
    Save-Png -Bmp (New-Mark -Size $Size -Shape 'squircle' -Fill 'opaque') `
             -Path (Join-Path $outDir $Name)
}

# PWA / store preview image: deep-green field, the mark, and the name.
function Save-OgImage {
    $w = 1200
    $h = 630
    $bmp = [System.Drawing.Bitmap]::new($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $rect = [System.Drawing.RectangleF]::new(0, 0, $w, $h)
    $grad = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        $rect, $DeepGreen, $CornerGreen,
        [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
    $g.FillRectangle($grad, $rect)

    # soft glow behind the mark
    $glowPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $glowPath.AddEllipse([float]40, [float]125, [float]460, [float]460)
    $glowBrush = [System.Drawing.Drawing2D.PathGradientBrush]::new($glowPath)
    $glowBrush.CenterColor = [System.Drawing.Color]::FromArgb(120, 70, 170, 138)
    $edge = [System.Drawing.Color[]]::new($glowPath.PointCount)
    for ($i = 0; $i -lt $glowPath.PointCount; $i++) {
        $edge[$i] = [System.Drawing.Color]::FromArgb(0, 70, 170, 138)
    }
    $glowBrush.SurroundColors = $edge
    $g.FillPath($glowBrush, $glowPath)

    $markSize = 440
    $mark = New-Mark -Size $markSize -Shape 'squircle' -Fill 'opaque'
    $g.DrawImage($mark, 60, [int](($h - $markSize) / 2), $markSize, $markSize)
    $mark.Dispose()

    # TextRenderer (GDI/Uniscribe) shapes Arabic correctly; DrawString does not.
    $arFont  = [System.Drawing.Font]::new('Segoe UI', 112,
        [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $latFont = [System.Drawing.Font]::new('Segoe UI', 44,
        [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $tagFont = [System.Drawing.Font]::new('Segoe UI', 30,
        [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

    $flags = [System.Windows.Forms.TextFormatFlags]::NoPadding -bor
             [System.Windows.Forms.TextFormatFlags]::NoPrefix -bor
             [System.Windows.Forms.TextFormatFlags]::RightToLeft

    [System.Windows.Forms.TextRenderer]::DrawText(
        $g, 'قُرّة', $arFont,
        [System.Drawing.Point]::new(566, 140), $Ivory, $flags)

    $rulePen = [System.Drawing.Pen]::new($Gold, [float]5)
    $g.DrawLine($rulePen, 568, 300, 1130, 300)

    [System.Windows.Forms.TextRenderer]::DrawText(
        $g, 'Qurra', $latFont,
        [System.Drawing.Point]::new(568, 330), $Gold,
        [System.Windows.Forms.TextFormatFlags]::NoPadding -bor
        [System.Windows.Forms.TextFormatFlags]::NoPrefix)

    [System.Windows.Forms.TextRenderer]::DrawText(
        $g, 'Quran, prayer and daily worship', $tagFont,
        [System.Drawing.Point]::new(568, 400), $Sage,
        [System.Windows.Forms.TextFormatFlags]::NoPadding -bor
        [System.Windows.Forms.TextFormatFlags]::NoPrefix)

    $g.Dispose()
    Save-Png -Bmp $bmp -Path (Join-Path $outDir 'og-image.png')
}

# Legacy launcher PNGs: pre-cut so old devices and the round variant look right.
function Save-AndroidLauncherIcons {
    $androidResDir = Join-Path $root 'android\app\src\main\res'
    $densitySizes = @{
        'mipmap-mdpi'    = 48
        'mipmap-hdpi'    = 72
        'mipmap-xhdpi'   = 96
        'mipmap-xxhdpi'  = 144
        'mipmap-xxxhdpi' = 192
    }
    foreach ($entry in $densitySizes.GetEnumerator()) {
        $directory = Join-Path $androidResDir $entry.Key
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
        $size = [int]$entry.Value
        Save-Png -Bmp (New-Mark -Size $size -Shape 'squircle' -Fill 'opaque') `
                 -Path (Join-Path $directory 'ic_launcher.png')
        Save-Png -Bmp (New-Mark -Size $size -Shape 'circle' -Fill 'opaque') `
                 -Path (Join-Path $directory 'ic_launcher_round.png')
    }
}

# Notification large icon: the mark full-bleed on its field, square, so the
# system's own round/squircle presentation on the content always sits on the
# brand green. Referenced by every notification as `ic_notification_large`.
function Save-AndroidNotificationIcon {
    $androidResDir = Join-Path $root 'android\app\src\main\res'
    $fgDir = Join-Path $androidResDir 'drawable-nodpi'
    New-Item -ItemType Directory -Force -Path $fgDir | Out-Null
    Save-Png -Bmp (New-Mark -Size 256 -Shape 'square' -Fill 'opaque') `
             -Path (Join-Path $fgDir 'ic_notification_large.png')
}

# Adaptive icon (API 26+): full-bleed foreground the launcher masks itself,
# over a deep-green background layer so every mask stays seamless.
function Save-AndroidAdaptiveLayers {
    $androidResDir = Join-Path $root 'android\app\src\main\res'

    $fgDir = Join-Path $androidResDir 'drawable-nodpi'
    New-Item -ItemType Directory -Force -Path $fgDir | Out-Null
    Save-Png -Bmp (New-Mark -Size 432 -Shape 'square' -Fill 'opaque' -Adaptive) `
             -Path (Join-Path $fgDir 'ic_launcher_foreground.png')

    foreach ($rel in @('drawable\ic_launcher_foreground.xml', 'drawable-v24\ic_launcher_foreground.xml')) {
        $p = Join-Path $androidResDir $rel
        if (Test-Path $p) {
            Remove-Item $p -Force
            "  removed android\$rel"
        }
    }

    $bgXml = @"
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#09211C</color>
</resources>
"@
    $bgPath = Join-Path $androidResDir 'values\ic_launcher_background.xml'
    [System.IO.File]::WriteAllText($bgPath, $bgXml, [System.Text.UTF8Encoding]::new($false))
    "  android\values\ic_launcher_background.xml (#09211C)"
}

# Favicon + in-app logo, pixel-identical to the launcher icon.
function Save-SvgIcon {
    $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes((Join-Path $outDir 'icon-192.png')))
    $svg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>قُرّة Qurra</title>
  <image href="data:image/png;base64,$b64" x="0" y="0" width="512" height="512"/>
</svg>
"@
    $svgPath = Join-Path $root 'public\icon.svg'
    [System.IO.File]::WriteAllText($svgPath, $svg, [System.Text.UTF8Encoding]::new($false))
    "  public\icon.svg ($((Get-Item $svgPath).Length) bytes)"
}

"Writing icons to public\icons\"
Save-Icon -Size 512 -Name 'icon-512.png'
Save-Icon -Size 192 -Name 'icon-192.png'
Save-SvgIcon
Save-AndroidLauncherIcons
Save-AndroidAdaptiveLayers
Save-AndroidNotificationIcon
Save-OgImage
$script:SourceImage.Dispose()
'done'
