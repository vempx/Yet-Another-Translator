param([switch]$Check)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
$original = -join (0x3400..0x9fff | ForEach-Object { [char]$_ })
$converted = [Microsoft.VisualBasic.Strings]::StrConv($original, [Microsoft.VisualBasic.VbStrConv]::SimplifiedChinese, 2052)
$from = [System.Text.StringBuilder]::new()
$to = [System.Text.StringBuilder]::new()
for ($i = 0; $i -lt $original.Length; $i++) {
    $value = [int][char]$converted[$i]
    if ($original[$i] -cne $converted[$i] -and $value -ge 0x3400 -and $value -le 0x9fff) {
        [void]$from.Append($original[$i]); [void]$to.Append($converted[$i])
    }
}
$target = Join-Path $PSScriptRoot '../YetAnotherTranslator.plugin.js'
$source = [IO.File]::ReadAllText($target)
$next = [regex]::Replace($source, '(?m)^const HAN_LOOKUP_FROM = .*;$', 'const HAN_LOOKUP_FROM = ' + (ConvertTo-Json -InputObject $from.ToString() -Compress) + ';')
$next = [regex]::Replace($next, '(?m)^const HAN_LOOKUP_TO = .*;$', 'const HAN_LOOKUP_TO = ' + (ConvertTo-Json -InputObject $to.ToString() -Compress) + ';')
if ($Check) { if ($source -cne $next) { throw 'Han lookup table differs from this Windows conversion table.' } }
else { [IO.File]::WriteAllText($target, $next, [Text.UTF8Encoding]::new($false)) }
Write-Output "Validated $($from.Length) lookup-only Han variants."
