# Regenerates the PWA icon set from code so the binary assets are reproducible.
#   powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'public\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$BgTop    = [System.Drawing.Color]::FromArgb(255, 23, 100, 71)  # #176447
$BgBottom = [System.Drawing.Color]::FromArgb(255, 11, 36, 26)   # #0b241a
$Gold     = [System.Drawing.Color]::FromArgb(255, 212, 175, 55) # #d4af37
$GoldSoft = [System.Drawing.Color]::FromArgb(255, 240, 214, 130)

# Draws a standalone ZAD monogram on a refined emerald tile.
function New-Mark {
    param([int]$Size, [double]$Scale = 1.0)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $bmp.SetResolution(96, 96)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # --- background: vertical gradient, full bleed (maskable-safe) ---
    $rect = New-Object System.Drawing.RectangleF(0, 0, $Size, $Size)
    $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect, $BgTop, $BgBottom, [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $g.FillRectangle($grad, $rect)

    $w = $Size * $Scale
    $off = ($Size - $w) / 2
    $g.TranslateTransform([float]$off, [float]$off)
    $g.ScaleTransform([float]($w / 100), [float]($w / 100))

    # --- quiet inset frame ---
    $frame = New-Object System.Drawing.Drawing2D.GraphicsPath
    $frame.AddArc(10, 10, 12, 12, 180, 90)
    $frame.AddArc(78, 10, 12, 12, 270, 90)
    $frame.AddArc(78, 78, 12, 12, 0, 90)
    $frame.AddArc(10, 78, 12, 12, 90, 90)
    $frame.CloseFigure()
    $framePen = New-Object System.Drawing.Pen(
        [System.Drawing.Color]::FromArgb(115, 212, 175, 87), [float]0.8)
    $g.DrawPath($framePen, $frame)

    # --- bold, custom Z monogram ---
    $monogram = New-Object System.Drawing.Drawing2D.GraphicsPath
    $monogram.AddPolygon([System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(29, 30)),
        (New-Object System.Drawing.PointF(71, 30)),
        (New-Object System.Drawing.PointF(71, 38)),
        (New-Object System.Drawing.PointF(43, 62)),
        (New-Object System.Drawing.PointF(71, 62)),
        (New-Object System.Drawing.PointF(71, 70)),
        (New-Object System.Drawing.PointF(29, 70)),
        (New-Object System.Drawing.PointF(29, 62)),
        (New-Object System.Drawing.PointF(57, 38)),
        (New-Object System.Drawing.PointF(29, 38))))
    $g.FillPath((New-Object System.Drawing.SolidBrush(
        [System.Drawing.Color]::FromArgb(255, 255, 249, 234))), $monogram)
    $accentPen = New-Object System.Drawing.Pen($Gold, [float]4.8)
    $accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($accentPen, 57, 38, 43, 62)

    # --- small gold glint ---
    $glint = New-Object System.Drawing.Drawing2D.GraphicsPath
    $glint.AddPolygon([System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(75, 22)),
        (New-Object System.Drawing.PointF(77, 27)),
        (New-Object System.Drawing.PointF(82, 29)),
        (New-Object System.Drawing.PointF(77, 31)),
        (New-Object System.Drawing.PointF(75, 36)),
        (New-Object System.Drawing.PointF(73, 31)),
        (New-Object System.Drawing.PointF(68, 29)),
        (New-Object System.Drawing.PointF(73, 27))))
    $g.FillPath((New-Object System.Drawing.SolidBrush($GoldSoft)), $glint)

    $g.Dispose()
    return $bmp
}

function Save-Icon {
    param([int]$Size, [string]$Name)
    $bmp = New-Mark -Size $Size -Scale 1.0
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
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $rect = New-Object System.Drawing.RectangleF(0, 0, $w, $h)
    $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect, $BgTop, $BgBottom, [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $g.FillRectangle($grad, $rect)

    $mark = New-Mark -Size 380 -Scale 1.0
    $g.DrawImage($mark, 60, ($h - 380) / 2, 380, 380)
    $mark.Dispose()

    # TextRenderer (GDI/Uniscribe) shapes Arabic correctly; Graphics.DrawString does not.
    $white = [System.Drawing.Color]::FromArgb(255, 248, 250, 248)
    $muted = [System.Drawing.Color]::FromArgb(220, 212, 175, 55)
    $titleFont = New-Object System.Drawing.Font('Segoe UI', 84, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $subFont   = New-Object System.Drawing.Font('Segoe UI', 34, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $latinFont = New-Object System.Drawing.Font('Segoe UI', 28, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

    [System.Windows.Forms.TextRenderer]::DrawText(
        $g, [string][char]0x0632 + [string][char]0x0627 + [string][char]0x062F,
        $titleFont, (New-Object System.Drawing.Point(490, 214)), $white,
        [System.Windows.Forms.TextFormatFlags]::NoPadding)

    $subtitle = 'Quran, prayer & daily worship'
    [System.Windows.Forms.TextRenderer]::DrawText(
        $g, $subtitle, $subFont, (New-Object System.Drawing.Point(492, 336)), $muted,
        [System.Windows.Forms.TextFormatFlags]::NoPadding)

    [System.Windows.Forms.TextRenderer]::DrawText(
        $g, 'ZAD - Quran & daily worship', $latinFont,
        (New-Object System.Drawing.Point(492, 402)),
        [System.Drawing.Color]::FromArgb(180, 248, 250, 248),
        [System.Windows.Forms.TextFormatFlags]::NoPadding)

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

Add-Type -AssemblyName System.Windows.Forms
"Writing icons to public\icons\"
Save-Icon -Size 512 -Name 'icon-512.png'
Save-Icon -Size 192 -Name 'icon-192.png'
Save-AndroidLauncherIcons
Save-OgImage
'done'