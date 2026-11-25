# Builds the Chrome Web Store upload: dist\pricepeel-<version>.zip, containing only what the extension
# needs at runtime (manifest, src, the four icon sizes). Tests, tools, saved API responses and the
# AliExpress app logo are left out.
# Usage: npm run package   (or: powershell -ExecutionPolicy Bypass -File tools\package.ps1)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'manifest.json') | ConvertFrom-Json
$version = $manifest.version

$stage = Join-Path $root 'dist\stage'
$zip = Join-Path $root "dist\pricepeel-$version.zip"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force (Join-Path $stage 'src'), (Join-Path $stage 'icons') | Out-Null

Copy-Item (Join-Path $root 'manifest.json') $stage
Copy-Item (Join-Path $root 'src\*') (Join-Path $stage 'src')
foreach ($size in 16, 32, 48, 128) { Copy-Item (Join-Path $root "icons\icon-$size.png") (Join-Path $stage 'icons') }

# Every file the manifest points at must be in the package.
$referenced = @($manifest.icons.PSObject.Properties.Value) + $manifest.background.service_worker +
  ($manifest.content_scripts | ForEach-Object { $_.js + $_.css }) +
  ($manifest.web_accessible_resources | ForEach-Object { $_.resources })
$missing = $referenced | Where-Object { $_ -and -not (Test-Path (Join-Path $stage $_)) }
if ($missing) { throw "Files referenced by manifest.json are missing from the package: $($missing -join ', ')" }

if (Test-Path $zip) { Remove-Item -Force $zip }
# Build the ZIP directly: Windows PowerShell's Compress-Archive stores paths with backslashes, which
# the ZIP format doesn't allow and the Web Store may reject. Entry names here use forward slashes.
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in Get-ChildItem -Recurse -File $stage) {
    $name = $file.FullName.Substring($stage.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $name, [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $archive.Dispose() }
Remove-Item -Recurse -Force $stage

Write-Output ("Built {0} ({1:N0} KB)" -f $zip, ((Get-Item $zip).Length / 1KB))
