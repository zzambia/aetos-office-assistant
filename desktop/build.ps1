$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $PSScriptRoot 'release'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$resource = Join-Path $outputDir 'aetos-web.zip'
Compress-Archive -Path (Join-Path $projectDir 'dist\*') -DestinationPath $resource -Force
$version = ([regex]::Match((Get-Content (Join-Path $projectDir 'src\version.js') -Raw), "VERSION\s*=\s*'([^']+)'")).Groups[1].Value
if (-not $version) { throw 'Could not read VERSION from src/version.js' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$binary = Join-Path $outputDir "AETOS-Office-Assistant-$version.exe"
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

function Find-Signtool {
    if ($env:AETOS_SIGNTOOL -and (Test-Path $env:AETOS_SIGNTOOL)) { return $env:AETOS_SIGNTOOL }
    $candidates = New-Object System.Collections.Generic.List[string]
    $sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    if (Test-Path $sdkRoot) {
        Get-ChildItem -Path $sdkRoot -Directory | Sort-Object Name -Descending | ForEach-Object {
            $candidates.Add((Join-Path $_.FullName 'x64\signtool.exe'))
        }
    }
    $candidates.Add((Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\8.1\bin\x64\signtool.exe'))
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

$pfx = $env:AETOS_SIGN_PFX
if ($pfx) {
    if (-not (Test-Path $pfx)) { throw "AETOS_SIGN_PFX points to a missing file: $pfx" }
    $password = $env:AETOS_SIGN_PASSWORD
    if (-not $password) { throw 'AETOS_SIGN_PASSWORD is required when AETOS_SIGN_PFX is set.' }
    $signtool = Find-Signtool
    if (-not $signtool) { throw 'signtool.exe not found. Install the Windows SDK or set AETOS_SIGNTOOL to its path.' }
    $timestamp = if ($env:AETOS_SIGN_TIMESTAMP_URL) { $env:AETOS_SIGN_TIMESTAMP_URL } else { 'http://timestamp.digicert.com' }
    & $signtool sign /f $pfx /p $password /fd SHA256 /tr $timestamp /td SHA256 /d 'AETOS Office Assistant' /v $binary
    if ($LASTEXITCODE -ne 0) { throw 'Authenticode signing failed.' }
    & $signtool verify /pa /v $binary
    if ($LASTEXITCODE -ne 0) { throw 'Authenticode signature verification failed.' }
    Write-Output "Signed and verified: $binary"
} else {
    Write-Output "Not signing $binary (set AETOS_SIGN_PFX and AETOS_SIGN_PASSWORD to sign)."
}

Write-Output $binary
