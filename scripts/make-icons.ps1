# Regenerates the PWA icon set from code so the binary assets are reproducible.
#   powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
#
# The mark is the Qurra artwork: an ogee arch over a mosque silhouette, crescent
# moon and an open Mushaf on a rehl, inside its deep-green squircle. The source
# artwork lives at scripts\assets\icon-source.png; it is cropped to the squircle
# and set into the app's rounded-square frame (112/512 radius) on the artwork's
# own cream field, so every generated icon uses the program's border.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'public\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Source artwork (committed) and the squircle bounds inside it.
$SrcPath = Join-Path $root 'scripts\assets\icon-source.png'
$SrcX = 167
$SrcY = 147
$SrcW = 963
$SrcH = 963

# Frame geometry, on the same 512 grid the old mark used.
$FrameInset = 0      # 0 = the squircle fills the tile edge to edge, like the
                     # big global apps; the cream corners are the program's
                     # rounded-square border showing through.
$FrameRadius = 112   # the app's rounded-square radius (22% of 512)

# Palette (kept in sync with public\icon.svg).
$Cream     = [System.Drawing.Color]::FromArgb(255, 252, 249, 244)   # #FCF9F4
$CreamEnd  = [System.Drawing.Color]::FromArgb(255, 243, 238, 228)   # #F3EEE4
$Ink       = [System.Drawing.Color]::FromArgb(255, 23, 69, 58)      # #17453A
$Gold      = [System.Drawing.Color]::FromArgb(255, 201, 174, 116)   # #C9AE74
$Muted     = [System.Drawing.Color]::FromArgb(255, 107, 127, 118)   # #6B7F76
$ShadowRGB = @(13, 48, 42)                                          # artwork green

function Add-RoundedRect {
    param(
        [System.Drawing.Drawing2D.GraphicsPath]$Path,
        [double]$X, [double]$Y, [double]$W, [double]$H, [double]$R
    )
    $r = [Math]::Min($R, [Math]::Min($W, $H) / 2)
    $d = [float]($r * 2)
    $Path.AddArc([float]$X, [float]$Y, $d, $d, 180, 90)
    $Path.AddArc([float]($X + $W - $d), [float]$Y, $d, $d, 270, 90)
    $Path.AddArc([float]($X + $W - $d), [float]($Y + $H - $d), $d, $d, 0, 90)
    $Path.AddArc([float]$X, [float]($Y + $H - $d), $d, $d, 90, 90)
    $Path.CloseFigure()
}

function New-GradientBrush {
    param(
        [double]$X, [double]$Y, [double]$W, [double]$H,
        [System.Drawing.Color[]]$Colors,
        [System.Drawing.Drawing2D.LinearGradientMode]$Mode = [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
    )
    $rect = New-Object System.Drawing.RectangleF([float]$X, [float]$Y, [float]$W, [float]$H)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $Colors[0], $Colors[$Colors.Count - 1], $Mode)
    if ($Colors.Count -gt 2) {
        $blend = New-Object System.Drawing.Drawing2D.ColorBlend($Colors.Count)
        $blend.Colors = $Colors
        $positions = New-Object 'System.Single[]' $Colors.Count
        for ($i = 0; $i -lt $Colors.Count; $i++) { $positions[$i] = [float]($i / ($Colors.Count - 1)) }
        $blend.Positions = $positions
        $brush.InterpolationColors = $blend
    }
    return $brush
}

# Draws the framed artwork in a 512x512 space, scaled to $Size.
function New-Mark {
    param([int]$Size)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $bmp.SetResolution(96, 96)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $k = $Size / 512.0
    $inset = [int][Math]::Round($FrameInset * $k)
    $inner = $Size - 2 * $inset

    # Cream field — the program's background colour behind the frame. Solid so
    # the mark composites seamlessly onto the og-image's cream background.
    $g.FillRectangle((New-Object System.Drawing.SolidBrush($Cream)), 0, 0, $Size, $Size)

    # Soft contact shadow under the squircle (fades to nothing at the path edge).
    # Only meaningful when the mark is inset from the icon edge.
    if ($FrameInset -gt 0) {
        $pad = [Math]::Max(4, [int]($Size / 80.0))
        $shPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        Add-RoundedRect -Path $shPath -X $inset -Y $inset -W ($inner + 2 * $pad) -H ($inner + $pad) -R ($inner * 0.30)
        $shBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($shPath)
        $shBrush.CenterColor = [System.Drawing.Color]::FromArgb(150, $ShadowRGB[0], $ShadowRGB[1], $ShadowRGB[2])
        $edge = New-Object 'System.Drawing.Color[]' $shPath.PointCount
        for ($i = 0; $i -lt $shPath.PointCount; $i++) { $edge[$i] = [System.Drawing.Color]::FromArgb(0, $ShadowRGB[0], $ShadowRGB[1], $ShadowRGB[2]) }
        $shBrush.SurroundColors = $edge
        $g.FillPath($shBrush, $shPath)
    }

    # The artwork, cropped to its squircle and set into the frame.
    $srcRect = New-Object System.Drawing.Rectangle($SrcX, $SrcY, $SrcW, $SrcH)
    $dstRect = New-Object System.Drawing.Rectangle($inset, $inset, $inner, $inner)
    $g.DrawImage((Get-SourceImage), $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

    $g.Dispose()
    return $bmp
}

$script:SourceImage = $null
function Get-SourceImage {
    if ($null -eq $script:SourceImage) {
        if (-not (Test-Path $SrcPath)) { throw "missing source artwork: $SrcPath" }
        $script:SourceImage = [System.Drawing.Image]::FromFile($SrcPath)
    }
    return $script:SourceImage
}

function Save-Icon {
    param([int]$Size, [string]$Name)
    $bmp = New-Mark -Size $Size
    $path = Join-Path $outDir $Name
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    "  $Name ($((Get-Item $path).Length) bytes)"
}

function Save-OgImage {
    $w = 1200; $h = 630
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $rect = New-Object System.Drawing.RectangleF(0, 0, $w, $h)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush($Cream)), $rect)

    $markSize = 440
    $mark = New-Mark -Size $markSize
    $g.DrawImage($mark, 70, [int](($h - $markSize) / 2), $markSize, $markSize)
    $mark.Dispose()

    # TextRenderer (GDI/Uniscribe) shapes text correctly; Graphics.DrawString does not.
    $titleFont = New-Object System.Drawing.Font('Segoe UI', 92, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $subFont   = New-Object System.Drawing.Font('Segoe UI', 32, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

    [System.Windows.Forms.TextRenderer]::DrawText(
        $g, 'Qurra',
        $titleFont, (New-Object System.Drawing.Point(576, 188)), $Ink,
        [System.Windows.Forms.TextFormatFlags]::NoPadding)

    $rulePen = New-Object System.Drawing.Pen($Gold, [float]5)
    $g.DrawLine($rulePen, 578, 326, 1010, 326)

    [System.Windows.Forms.TextRenderer]::DrawText(
        $g, 'Quran, prayer & daily worship', $subFont,
        (New-Object System.Drawing.Point(578, 360)), $Muted,
        [System.Windows.Forms.TextFormatFlags]::NoPadding -bor [System.Windows.Forms.TextFormatFlags]::NoPrefix)

    $g.Dispose()
    $path = Join-Path $outDir 'og-image.png'
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    "  og-image.png ($((Get-Item $path).Length) bytes)"
}

function Save-AndroidLauncherIcons {
    $sourcePath = Join-Path $outDir 'icon-512.png'
    $androidResDir = Join-Path $root 'android\app\src\main\res'
    $densitySizes = @{
        'mipmap-mdpi' = 48
        'mipmap-hdpi' = 72
        'mipmap-xhdpi' = 96
        'mipmap-xxhdpi' = 144
        'mipmap-xxxhdpi' = 192
    }
    $source = [System.Drawing.Image]::FromFile($sourcePath)
    try {
        foreach ($entry in $densitySizes.GetEnumerator()) {
            $directory = Join-Path $androidResDir $entry.Key
            New-Item -ItemType Directory -Force -Path $directory | Out-Null
            $size = [int]$entry.Value
            $bitmap = New-Object System.Drawing.Bitmap($size, $size)
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($source, 0, 0, $size, $size)
            $graphics.Dispose()
            foreach ($name in @('ic_launcher.png', 'ic_launcher_round.png')) {
                $path = Join-Path $directory $name
                $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
                "  android\$($entry.Key)\$name ($((Get-Item $path).Length) bytes)"
            }
            $bitmap.Dispose()
        }
    } finally {
        $source.Dispose()
    }
}

# Adaptive icon: cream background layer + the same framed artwork as a bitmap
# foreground. The foreground's cream corners are exactly the background colour,
# so every launcher mask (circle, squircle, rounded square) stays seamless.
function Save-AndroidAdaptiveLayers {
    $androidResDir = Join-Path $root 'android\app\src\main\res'

    $fgDir = Join-Path $androidResDir 'drawable-nodpi'
    New-Item -ItemType Directory -Force -Path $fgDir | Out-Null
    $fg = New-Mark -Size 432
    $fgPath = Join-Path $fgDir 'ic_launcher_foreground.png'
    $fg.Save($fgPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $fg.Dispose()
    "  android\drawable-nodpi\ic_launcher_foreground.png ($((Get-Item $fgPath).Length) bytes)"

    # The vector foregrounds drawn the old Mushaf mark; the bitmap replaces both.
    foreach ($rel in @('drawable\ic_launcher_foreground.xml', 'drawable-v24\ic_launcher_foreground.xml')) {
        $p = Join-Path $androidResDir $rel
        if (Test-Path $p) { Remove-Item $p -Force; "  removed android\$rel" }
    }

    # Background layer colour = the artwork's cream field.
    $bgPath = Join-Path $androidResDir 'values\ic_launcher_background.xml'
    $bgXml = @"
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#FCF9F4</color>
</resources>
"@
    # UTF-8 without BOM (aapt2 chokes on a leading BOM in resource XML).
    [System.IO.File]::WriteAllText($bgPath, $bgXml, (New-Object System.Text.UTF8Encoding($false)))
    "  android\values\ic_launcher_background.xml (#FCF9F4)"
}

Add-Type -AssemblyName System.Windows.Forms

# public\icon.svg: the same artwork, embedded as a PNG so the favicon and the
# in-app logo are pixel-identical to the launcher icon (no drift between the
# vector and raster marks).
function Save-SvgIcon {
    $pngPath = Join-Path $outDir 'icon-192.png'
    $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($pngPath))
    $svg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>قُرّة Qurra</title>
  <image href="data:image/png;base64,$b64" x="0" y="0" width="512" height="512"/>
</svg>
"@
    $svgPath = Join-Path $root 'public\icon.svg'
    [System.IO.File]::WriteAllText($svgPath, $svg, (New-Object System.Text.UTF8Encoding($false)))
    "  icon.svg ($((Get-Item $svgPath).Length) bytes)"
}

"Writing icons to public\icons\"
Save-Icon -Size 512 -Name 'icon-512.png'
Save-Icon -Size 192 -Name 'icon-192.png'
Save-SvgIcon
Save-AndroidLauncherIcons
Save-AndroidAdaptiveLayers
Save-OgImage
if ($script:SourceImage) { $script:SourceImage.Dispose() }
'done'
