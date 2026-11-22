# Builds the Chrome Web Store upload: dist\calendar-templates-<version>.zip
# The store rejects a "key" field in manifest.json, so it is removed from the packaged copy
# (the unpacked dev copy keeps it, for a stable extension ID).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$files = @('background.js', 'config.js', 'lib.js', 'content.js', 'options.html', 'options.js', 'icons\16.png', 'icons\32.png', 'icons\48.png', 'icons\128.png')

$manifestText = [System.IO.File]::ReadAllText((Join-Path $root 'manifest.json'))
$version = [regex]::Match($manifestText, '"version"\s*:\s*"([^"]+)"').Groups[1].Value
if (-not $version) { throw 'No version in manifest.json' }
$stripped = [regex]::Replace($manifestText, '\r?\n\s*"key"\s*:\s*"[^"]*",', '')
if ($stripped -match '"key"\s*:') { throw 'Could not remove the key field' }

$stage = Join-Path $env:TEMP ('ct-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $stage 'icons') -Force | Out-Null
foreach ($f in $files) { Copy-Item (Join-Path $root $f) (Join-Path $stage $f) }
[System.IO.File]::WriteAllText((Join-Path $stage 'manifest.json'), $stripped, (New-Object System.Text.UTF8Encoding($false)))

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$zip = Join-Path $dist ("calendar-templates-$version.zip")
if (Test-Path $zip) { Remove-Item $zip -Force }
# Write entries by hand: .NET Framework's CreateFromDirectory stores "icons\x.png" with a
# backslash, which Chrome does not read as a folder.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem $stage -Recurse -File | ForEach-Object {
    $name = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $name, [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $archive.Dispose() }
Remove-Item $stage -Recurse -Force
Write-Output "Built $zip"
