param()
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pluginPath = Join-Path $projectRoot 'YetAnotherTranslator.plugin.js'
$pluginText = Get-Content -LiteralPath $pluginPath -Raw -Encoding utf8
$versionMatch = [regex]::Match($pluginText, '@version\s+(\d+\.\d+\.\d+)')
if (-not $versionMatch.Success) { throw 'Plugin version metadata is missing.' }
$version = $versionMatch.Groups[1].Value
$outputFolder = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $outputFolder -Force | Out-Null
$archivePath = Join-Path $outputFolder "Yet-Another-Translator-v$version.zip"
Compress-Archive -LiteralPath $pluginPath -DestinationPath $archivePath -CompressionLevel Optimal -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    if ($archive.Entries.Count -ne 1 -or $archive.Entries[0].FullName -ne 'YetAnotherTranslator.plugin.js') { throw 'Unexpected ZIP contents.' }
    $entryStream = $archive.Entries[0].Open()
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $entryHash = [Convert]::ToHexString($sha.ComputeHash($entryStream)) } finally { $sha.Dispose() }
    } finally { $entryStream.Dispose() }
    $pluginHash = (Get-FileHash -LiteralPath $pluginPath -Algorithm SHA256).Hash
    if ($entryHash -ne $pluginHash) { throw 'The archived plugin differs from the source.' }
} finally { $archive.Dispose() }
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $outputFolder 'SHA256SUMS.txt') -Value "$archiveHash  $([IO.Path]::GetFileName($archivePath))" -Encoding utf8NoBOM
[pscustomobject]@{version=$version; archive=$archivePath; sha256=$archiveHash; pluginSha256=$pluginHash.ToLowerInvariant()}
