$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore,WindowsBase
$projectDir = Split-Path -Parent $PSScriptRoot
$assetDir = Join-Path $projectDir 'assets'
New-Item -ItemType Directory -Force -Path $assetDir | Out-Null
$svg = New-Object Xml.XmlDocument
$svg.XmlResolver = $null
$svg.Load((Join-Path $projectDir 'logo.svg'))
$ns = New-Object Xml.XmlNamespaceManager($svg.NameTable)
$ns.AddNamespace('s', 'http://www.w3.org/2000/svg')
$metadata = $svg.SelectSingleNode('/s:svg/s:metadata', $ns)
if ($metadata) { [void]$metadata.ParentNode.RemoveChild($metadata) }
$svg.Save((Join-Path $assetDir 'logo.svg'))
$path = $svg.SelectSingleNode('/s:svg/s:path', $ns)
$circle = $svg.SelectSingleNode('/s:svg/s:circle', $ns)
if (-not $path -or -not $circle -or $svg.SelectNodes('/s:svg/s:path', $ns).Count -ne 1) { throw 'Unexpected SVG structure.' }
$geometry = [Windows.Media.Geometry]::Parse($path.GetAttribute('d'))
$culture = [Globalization.CultureInfo]::InvariantCulture
$cx = [double]::Parse($circle.GetAttribute('cx'), $culture)
$cy = [double]::Parse($circle.GetAttribute('cy'), $culture)
$radius = [double]::Parse($circle.GetAttribute('r'), $culture)
$brush = New-Object Windows.Media.SolidColorBrush([Windows.Media.ColorConverter]::ConvertFromString('#413189'))
$pen = New-Object Windows.Media.Pen($brush, 3)
$bounds = $geometry.Bounds
$circleBounds = New-Object Windows.Rect(($cx-$radius-1.5), ($cy-$radius-1.5), (2*$radius+3), (2*$radius+3))
$bounds.Union($circleBounds)
foreach ($size in @(16,32,48,64,80,128,256)) {
    # Trim only empty canvas for small icons, preserving all artwork and its aspect ratio.
    $scale = ($size * 0.84) / [Math]::Max($bounds.Width, $bounds.Height)
    $matrix = New-Object Windows.Media.Matrix($scale,0,0,$scale,(($size-$bounds.Width*$scale)/2-$bounds.X*$scale),(($size-$bounds.Height*$scale)/2-$bounds.Y*$scale))
    $visual = New-Object Windows.Media.DrawingVisual
    $drawing = $visual.RenderOpen()
    $drawing.PushTransform((New-Object Windows.Media.MatrixTransform($matrix)))
    $drawing.DrawGeometry($brush, $null, $geometry)
    $drawing.DrawEllipse($null, $pen, (New-Object Windows.Point($cx,$cy)), $radius, $radius)
    $drawing.Pop(); $drawing.Close()
    $bitmap = New-Object Windows.Media.Imaging.RenderTargetBitmap($size,$size,96,96,[Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($visual)
    $encoder = New-Object Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $stream = [IO.File]::Create((Join-Path $assetDir "icon-$size.png"))
    try { $encoder.Save($stream) } finally { $stream.Dispose() }
}
Write-Output 'Rendered supplied logo: SVG plus seven PNG icon sizes.'
