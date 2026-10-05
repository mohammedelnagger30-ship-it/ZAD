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

# Draws a refined Quranic app mark: open pages + crescent + light, suitable for
# a professional Islamic learning and worship app.
function New-Mark {
    param([int]$Size, [double]$Scale = 1.0)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $bmp.SetResolution(96, 96)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $rect = New-Object System.Drawing.RectangleF(0, 0, $Size, $Size)
    $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect, $BgTop, $BgBottom, [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $g.FillRectangle($grad, $rect)

    $w = $Size * $Scale
    $off = ($Size - $w) / 2
    $g.TranslateTransform([float]$off, [float]$off)
    $g.ScaleTransform([float]($w / 100), [float]($w / 100))

    $glowPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(140, 245, 214, 120), [float]1.2)
    $g.DrawArc($glowPen, 65, 12, 38, 38, 0, 360)

    $crescent = New-Object System.Drawing.Drawing2D.GraphicsPath
    $crescent.AddEllipse(60, 14, 30, 30)
    $crescent.AddEllipse(70, 19, 22, 22)
    $crescent.FillMode = [System.Drawing.Drawing2D.FillMode]::Alternate
    $g.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 247, 231, 178))), $crescent)

    $leftPage = New-Object System.Drawing.Drawing2D.GraphicsPath
    $leftPage.AddPolygon([System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(15, 68)),
        (New-Object System.Drawing.PointF(47, 38)),
        (New-Object System.Drawing.PointF(47, 79)),
        (New-Object System.Drawing.PointF(15, 87))))
    $g.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 246, 241, 229))), $leftPage)

    $rightPage = New-Object System.Drawing.Drawing2D.GraphicsPath
    $rightPage.AddPolygon([System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(85, 68)),
        (New-Object System.Drawing.PointF(53, 38)),
        (New-Object System.Drawing.PointF(53, 79)),
        (New-Object System.Drawing.PointF(85, 87))))
    $g.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 253, 247, 238))), $rightPage)

    $g.DrawLine((New-Object System.Drawing.Pen($Gold, [float]3.4)), 50, 36, 50, 84)

    $goldBook = New-Object System.Drawing.Drawing2D.GraphicsPath
    $goldBook.AddPolygon([System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(28, 46)),
        (New-Object System.Drawing.PointF(41, 38)),
        (New-Object System.Drawing.PointF(41, 74)),
        (New-Object System.Drawing.PointF(28, 68))))
    $g.FillPath((New-Object System.Drawing.SolidBrush($GoldSoft)), $goldBook)

    $goldBook2 = New-Object System.Drawing.Drawing2D.GraphicsPath
    $goldBook2.AddPolygon([System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(72, 46)),
        (New-Object System.Drawing.PointF(59, 38)),
        (New-Object System.Drawing.PointF(59, 74)),
        (New-Object System.Drawing.PointF(72, 68))))
    $g.FillPath((New-Object System.Drawing.SolidBrush($GoldSoft)), $goldBook2)

    $highlight = New-Object System.Drawing.Drawing2D.GraphicsPath
    $highlight.AddPolygon([System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(20, 27)),
        (New-Object System.Drawing.PointF(24, 33)),
        (New-Object System.Drawing.PointF(30, 35)),
        (New-Object System.Drawing.PointF(24, 38)),
        (New-Object System.Drawing.PointF(20, 44)),
        (New-Object System.Drawing.PointF(16, 38)),
        (New-Object System.Drawing.PointF(10, 35)),
        (New-Object System.Drawing.PointF(16, 33))))
    $g.FillPath((New-Object System.Drawing.SolidBrush($GoldSoft)), $highlight)

    $frame = New-Object System.Drawing.Drawing2D.GraphicsPath
    $frame.AddArc(12, 10, 14, 14, 180, 90)
    $frame.AddArc(74, 10, 14, 14, 270, 90)
    $frame.AddArc(74, 76, 14, 14, 0, 90)
    $frame.AddArc(12, 76, 14, 14, 90, 90)
    $frame.CloseFigure()
    $framePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 212, 175, 87), [float]1.0)
    $g.DrawPath($framePen, $frame)

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
        $g, 'نور زاد',
        $titleFont, (New-Object System.Drawing.Point(490, 214)), $white,
        [System.Windows.Forms.TextFormatFlags]::NoPadding)

    $subtitle = 'Quran, prayer & daily worship'
    [System.Windows.Forms.TextRenderer]::DrawText(
        $g, $subtitle, $subFont, (New-Object System.Drawing.Point(492, 336)), $muted,
        [System.Windows.Forms.TextFormatFlags]::NoPadding)

    [System.Windows.Forms.TextRenderer]::DrawText(
        $g, 'Nour ZAD', $latinFont,
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