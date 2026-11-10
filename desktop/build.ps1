$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $PSScriptRoot 'release'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$resource = Join-Path $outputDir 'aetos-web.zip'
Compress-Archive -Path (Join-Path $projectDir 'dist\*') -DestinationPath $resource -Force
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$binary = Join-Path $outputDir 'AETOS-Office-Assistant.exe'
$iconPath = Join-Path $outputDir 'aetos.ico'
$sizes = @(16,32,48,64,128,256)
$frames = @($sizes | ForEach-Object { ,([IO.File]::ReadAllBytes((Join-Path $projectDir "dist\assets\icon-$_.png"))) })
$iconStream = [IO.File]::Create($iconPath)
$iconWriter = New-Object IO.BinaryWriter($iconStream)
try {
    $iconWriter.Write([UInt16]0); $iconWriter.Write([UInt16]1); $iconWriter.Write([UInt16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($i=0; $i -lt $sizes.Count; $i++) {
        $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
        $iconWriter.Write([Byte]$dimension); $iconWriter.Write([Byte]$dimension); $iconWriter.Write([Byte]0); $iconWriter.Write([Byte]0)
        $iconWriter.Write([UInt16]1); $iconWriter.Write([UInt16]32); $iconWriter.Write([UInt32]$frames[$i].Length); $iconWriter.Write([UInt32]$offset)
        $offset += $frames[$i].Length
    }
    foreach ($frame in $frames) { $iconWriter.Write([byte[]]$frame) }
} finally { $iconWriter.Dispose(); $iconStream.Dispose() }
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ "/out:$binary" "/win32icon:$iconPath" /reference:Microsoft.CSharp.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Security.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "/resource:$resource,aetos-web.zip" (Join-Path $PSScriptRoot 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
Write-Output $binary
