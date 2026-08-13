# Genera build/icon.ico (256x256, PNG embebido) para el instalador.
Add-Type -AssemblyName System.Drawing

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([System.Drawing.Color]::Transparent)

# Fondo redondeado oscuro
$bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 48
$bgPath.AddArc(0, 0, $r, $r, 180, 90)
$bgPath.AddArc($size - $r, 0, $r, $r, 270, 90)
$bgPath.AddArc($size - $r, $size - $r, $r, $r, 0, 90)
$bgPath.AddArc(0, $size - $r, $r, $r, 90, 90)
$bgPath.CloseFigure()
$bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 13, 17, 23))
$g.FillPath($bg, $bgPath)

# Barra de "pestaña" superior en acento
$accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 217, 119, 87))
$g.FillRectangle($accent, 34, 38, 74, 14)
$dim = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 45, 51, 59))
$g.FillRectangle($dim, 118, 38, 50, 14)
$g.FillRectangle($dim, 178, 38, 44, 14)

# Prompt ">" y cursor
$font = New-Object System.Drawing.Font('Consolas', 96, [System.Drawing.FontStyle]::Bold)
$fg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 230, 237, 243))
$g.DrawString('>', $font, $accent, 32, 84)
$g.FillRectangle($fg, 130, 168, 64, 18)

$g.Dispose()

# PNG en memoria
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$bmp.Dispose()

# Envolver el PNG en un contenedor ICO (formato Vista+: PNG embebido)
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($out)
$w.Write([uint16]0)      # reservado
$w.Write([uint16]1)      # tipo: icono
$w.Write([uint16]1)      # 1 imagen
$w.Write([byte]0)        # ancho 0 = 256
$w.Write([byte]0)        # alto 0 = 256
$w.Write([byte]0)        # sin paleta
$w.Write([byte]0)        # reservado
$w.Write([uint16]1)      # planos
$w.Write([uint16]32)     # bpp
$w.Write([uint32]$png.Length)
$w.Write([uint32]22)     # offset de los datos
$w.Write($png)
$w.Flush()

[System.IO.File]::WriteAllBytes("$PSScriptRoot\icon.ico", $out.ToArray())
Write-Output "icon.ico generado: $((Get-Item "$PSScriptRoot\icon.ico").Length) bytes"
