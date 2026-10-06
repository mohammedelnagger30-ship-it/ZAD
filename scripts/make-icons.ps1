# Regenerates the PWA icon set from code so the binary assets are reproducible.
#   powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
#
# The mark is a closed Mushaf: dark-green cover, gold double frame, central
# medallion, spine bands and cream page edges. Geometry lives in a 512x512
# coordinate space and mirrors public\icon.svg exactly, so the SVG favicon and
# every generated PNG stay pixel-comparable.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'public\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Palette (kept in sync with public\icon.svg).
# "Sakinah" calm scheme: white/gray field, soft cover, champagne ornament.
# Low chroma + gentle contrast = serene; every accent still lands in the ranges
# scripts\check-icons.ps1 classifies as green field / gold mark.
$BgTop     = [System.Drawing.Color]::FromArgb(255, 245, 245, 245)   # #F5F5F5
$BgMid     = [System.Drawing.Color]::FromArgb(255, 232, 232, 232)     # #E8E8E8
$BgBottom  = [System.Drawing.Color]::FromArgb(255, 220, 220, 220)     # #DCDCDC
$CoverTop  = [System.Drawing.Color]::FromArgb(255, 46, 111, 95)    # #2E6F5F
$CoverMid  = [System.Drawing.Color]::FromArgb(255, 36, 90, 75)     # #245A4B
$CoverBot  = [System.Drawing.Color]::FromArgb(255, 26, 69, 59)     # #1A453B
$SpineTop  = [System.Drawing.Color]::FromArgb(255, 25, 66, 56)     # #194238
$SpineBot  = [System.Drawing.Color]::FromArgb(255, 16, 49, 42)     # #10312A
$GoldLight = [System.Drawing.Color]::FromArgb(255, 239, 228, 184)  # #EFE4B8
$Gold      = [System.Drawing.Color]::FromArgb(255, 201, 174, 116)  # #C9AE74
$GoldDark  = [System.Drawing.Color]::FromArgb(255, 158, 132, 80)   # #9E8450
$GoldSoft  = [System.Drawing.Color]::FromArgb(255, 217, 200, 140)  # #D9C88C
$PagesTop  = [System.Drawing.Color]::FromArgb(255, 233, 226, 210)  # #E9E2D2
$PagesBot  = [System.Drawing.Color]::FromArgb(255, 246, 241, 229)  # #F6F1E5
$PageLine  = [System.Drawing.Color]::FromArgb(190, 201, 191, 169)  # #C9BFA9 @75%
$Ink       = [System.Drawing.Color]::FromArgb(255, 14, 51, 44)     # #0E332C
$Shadow    = [System.Drawing.Color]::FromArgb(255, 5, 19, 15)      # #05130F

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

function Add-Diamond {
    param(
        [System.Drawing.Drawing2D.GraphicsPath]$Path,
        [double]$Cx, [double]$Cy, [double]$Half
    )
    $Path.StartFigure()
    $Path.AddLine([float]$Cx, [float]($Cy - $Half), [float]($Cx + $Half), [float]$Cy)
    $Path.AddLine([float]($Cx + $Half), [float]$Cy, [float]$Cx, [float]($Cy + $Half))
    $Path.AddLine([float]$Cx, [float]($Cy + $Half), [float]($Cx - $Half), [float]$Cy)
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

function New-GoldBrush {
    param([double]$X, [double]$Y, [double]$W, [double]$H)
    return New-GradientBrush -X $X -Y $Y -W $W -H $H -Colors @($GoldLight, $Gold, $GoldDark)
}

# Draws the Mushaf mark in a 512x512 space, scaled to $Size.
function New-Mark {
    param([int]$Size, [double]$Scale = 1.0)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $bmp.SetResolution(96, 96)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $k = ($Size / 512.0) * $Scale
    $g.ScaleTransform([float]$k, [float]$k)

    # Background: rounded deep-green field.
    $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRect -Path $bgPath -X 0 -Y 0 -W 512 -H 512 -R 112
    $g.FillPath((New-GradientBrush -X 0 -Y 0 -W 512 -H 512 -Colors @($BgTop, $BgMid, $BgBottom)), $bgPath)

    # Sparkles (kept faint — they should whisper, not sparkle).
    $sparkle = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 239, 228, 184))
    foreach ($s in @(
        @(78.0, 74.0, 8.0, 150),
        @(436.0, 80.0, 6.0, 122),
        @(76.0, 438.0, 6.5, 122),
        @(438.0, 442.0, 8.0, 142)
    )) {
        $sparkle.Color = [System.Drawing.Color]::FromArgb([int]$s[3], 239, 228, 184)
        $r = [float]$s[2]
        $g.FillEllipse($sparkle, [float]([double]$s[0] - $r), [float]([double]$s[1] - $r), [float](2 * $r), [float](2 * $r))
    }

    # Soft ground shadow.
    $shadowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $shadowPath.AddEllipse([float]116, [float]414, [float]280, [float]32)
    $shadowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($shadowPath)
    $shadowBrush.CenterColor = [System.Drawing.Color]::FromArgb(112, 5, 19, 15)
    $edge = New-Object 'System.Drawing.Color[]' $shadowPath.PointCount
    for ($i = 0; $i -lt $shadowPath.PointCount; $i++) { $edge[$i] = [System.Drawing.Color]::FromArgb(0, 5, 19, 15) }
    $shadowBrush.SurroundColors = $edge
    $g.FillPath($shadowBrush, $shadowPath)

    # Cast shadow just behind the book (right/bottom rim).
    $castPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRect -Path $castPath -X 134 -Y 112 -W 252 -H 312 -R 16
    $g.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(68, 5, 19, 15))), $castPath)

    # Page block: cream, peeking out on the fore-edge and the bottom.
    $pagesPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRect -Path $pagesPath -X 142 -Y 114 -W 240 -H 300 -R 12
    $g.FillPath((New-GradientBrush -X 142 -Y 114 -W 240 -H 300 -Colors @($PagesTop, $PagesBot)), $pagesPath)

    $pagePen = New-Object System.Drawing.Pen($PageLine, [float]1.4)
    $g.DrawLine($pagePen, [float]375, [float]122, [float]375, [float]406)
    $g.DrawLine($pagePen, [float]379, [float]122, [float]379, [float]406)
    $g.DrawLine($pagePen, [float]150, [float]407, [float]374, [float]407)
    $g.DrawLine($pagePen, [float]150, [float]411, [float]374, [float]411)

    # Cover.
    $coverPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRect -Path $coverPath -X 130 -Y 102 -W 240 -H 300 -R 16
    $g.FillPath((New-GradientBrush -X 130 -Y 102 -W 240 -H 300 -Colors @($CoverTop, $CoverMid, $CoverBot)), $coverPath)

    # Spine (rounded on the left only) + gold headbands.
    $spinePath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $spinePath.StartFigure()
    $spinePath.AddLine([float]146, [float]102, [float]166, [float]102)
    $spinePath.AddLine([float]166, [float]102, [float]166, [float]402)
    $spinePath.AddLine([float]166, [float]402, [float]146, [float]402)
    $spinePath.AddArc([float]130, [float]370, [float]32, [float]32, 90, 90)
    $spinePath.AddLine([float]130, [float]386, [float]130, [float]118)
    $spinePath.AddArc([float]130, [float]102, [float]32, [float]32, 180, 90)
    $spinePath.CloseFigure()
    $g.FillPath((New-GradientBrush -X 130 -Y 102 -W 36 -H 300 -Colors @($SpineTop, $SpineBot) -Mode ([System.Drawing.Drawing2D.LinearGradientMode]::Horizontal)), $spinePath)

    # NOTE: never name a local after a palette colour ($Gold, $Ink, ...) — PowerShell
    # scopes are case-insensitive and dynamically resolved, so the palette entry
    # would resolve to this local for any function called below this point.
    $bandBrush = New-GoldBrush -X 130 -Y 102 -W 240 -H 300
    $g.FillRectangle($bandBrush, [float]130, [float]134, [float]36, [float]9)
    $g.FillRectangle($bandBrush, [float]130, [float]361, [float]36, [float]9)

    # Gold double frame.
    $framePath = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRect -Path $framePath -X 180 -Y 134 -W 176 -H 236 -R 14
    $g.DrawPath((New-Object System.Drawing.Pen((New-GoldBrush -X 180 -Y 134 -W 176 -H 236), [float]5)), $framePath)

    $innerPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRect -Path $innerPath -X 191 -Y 145 -W 154 -H 214 -R 10
    $g.DrawPath((New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(191, 201, 174, 116), [float]1.8)), $innerPath)

    # Corner ornaments.
    foreach ($c in @(@(180.0, 134.0), @(356.0, 134.0), @(180.0, 370.0), @(356.0, 370.0))) {
        $dPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        Add-Diamond -Path $dPath -Cx $c[0] -Cy $c[1] -Half 9
        $g.FillPath((New-GoldBrush -X ($c[0] - 9) -Y ($c[1] - 9) -W 18 -H 18), $dPath)
    }

    # Flourish rules + lozenges.
    $rulePen = New-Object System.Drawing.Pen((New-GoldBrush -X 214 -Y 179 -W 108 -H 14), [float]2.6)
    $rulePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $rulePen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    foreach ($y in @(186.0, 318.0)) {
        $g.DrawLine($rulePen, [float]214, [float]$y, [float]250, [float]$y)
        $g.DrawLine($rulePen, [float]286, [float]$y, [float]322, [float]$y)
        $lozenge = New-Object System.Drawing.Drawing2D.GraphicsPath
        Add-Diamond -Path $lozenge -Cx 268 -Cy $y -Half 7
        $g.FillPath((New-GoldBrush -X 261 -Y ($y - 7) -W 14 -H 14), $lozenge)
    }

    # Central medallion: dark disc, gold rings, 8-point star.
    $g.FillEllipse((New-Object System.Drawing.SolidBrush($Ink)), [float]228, [float]212, [float]80, [float]80)
    $g.DrawEllipse((New-Object System.Drawing.Pen((New-GoldBrush -X 228 -Y 212 -W 80 -H 80), [float]5)), [float]228, [float]212, [float]80, [float]80)
    $g.DrawEllipse((New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(204, 201, 174, 116), [float]1.8)), [float]238, [float]222, [float]60, [float]60)

    $starPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRect -Path $starPath -X 250 -Y 234 -W 36 -H 36 -R 3
    $g.FillPath((New-GoldBrush -X 250 -Y 234 -W 36 -H 36), $starPath)

    $savedState = $g.Save()
    $g.TranslateTransform([float]268, [float]252)
    $g.RotateTransform([float]45)
    $starRotated = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRect -Path $starRotated -X -18 -Y -18 -W 36 -H 36 -R 3
    $g.FillPath((New-GoldBrush -X -18 -Y -18 -W 36 -H 36), $starRotated)
    $g.Restore($savedState)

    $g.FillEllipse((New-Object System.Drawing.SolidBrush($Ink)), [float]257, [float]241, [float]22, [float]22)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush($GoldSoft)), [float]262.5, [float]246.5, [float]11, [float]11)

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
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $rect = New-Object System.Drawing.RectangleF(0, 0, $w, $h)
    $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect, $BgTop, $BgBottom, [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $g.FillRectangle($grad, $rect)

    $mark = New-Mark -Size 380 -Scale 1.0
    $g.DrawImage($mark, 60, ($h - 380) / 2, 380, 380)
    $mark.Dispose()

    # TextRenderer (GDI/Uniscribe) shapes text correctly; Graphics.DrawString does not.
    $white = [System.Drawing.Color]::FromArgb(255, 242, 247, 244)
    $muted = [System.Drawing.Color]::FromArgb(215, 215, 203, 178)
    $titleFont = New-Object System.Drawing.Font('Segoe UI', 92, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $subFont   = New-Object System.Drawing.Font('Segoe UI', 34, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

    [System.Windows.Forms.TextRenderer]::DrawText(
        $g, 'Sakinah',
        $titleFont, (New-Object System.Drawing.Point(494, 196)), $white,
        [System.Windows.Forms.TextFormatFlags]::NoPadding)

    $rulePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 201, 174, 116), [float]5)
    $g.DrawLine($rulePen, 496, 330, 920, 330)

    [System.Windows.Forms.TextRenderer]::DrawText(
        $g, 'Quran, prayer & daily worship', $subFont,
        (New-Object System.Drawing.Point(496, 362)), $muted,
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

Add-Type -AssemblyName System.Windows.Forms
"Writing icons to public\icons\"
Save-Icon -Size 512 -Name 'icon-512.png'
Save-Icon -Size 192 -Name 'icon-192.png'
Save-AndroidLauncherIcons
Save-OgImage
'done'
