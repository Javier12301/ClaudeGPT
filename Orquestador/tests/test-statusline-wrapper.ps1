<#
    Verifica que statusline-wrapper.ps1 saque el segmento de version de la CLI que
    agrega el upstream y coloree el porcentaje de cuota de Codex por umbral.

    Corre contra un clon FALSO de ClaudeCodeStatusLine y un $env:TEMP propio: no
    toca la statusline instalada ni el cache real. Mismo patron sin dependencias
    que test-install-merge.ps1.
#>
$ErrorActionPreference = 'Stop'
$ok = $true
function T($c, $m) {
    if ($c) { Write-Host "[OK] $m" -ForegroundColor Green }
    else { Write-Host "[FAIL] $m" -ForegroundColor Red; $script:ok = $false }
}

$E = [char]0x1b
$tmp = Join-Path $env:TEMP ("claude-statusline-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force (Join-Path $tmp 'statusline') | Out-Null
Copy-Item (Join-Path $PSScriptRoot '..\statusline-wrapper.ps1') $tmp

# Doble del upstream: misma forma de salida (Write-Host -NoNewline, mismos colores,
# segmento de version al final) y el aviso de update en una segunda linea.
@'
$E = [char]0x1b
$dim = "$E[2m"; $reset = "$E[0m"; $orange = "$E[38;2;255;176;85m"
$out = "${E}[38;2;0;153;255mOpus 5${reset} ${dim}|${reset} repo@main ${dim}|${reset} 0/1m (0%) ${dim}|${reset} effort: med ${dim}|${reset} 5h ${E}[38;2;230;200;0m51%${reset} ${dim}@2:40pm${reset} ${dim}|${reset} 7d 13% ${dim}@sat aug 29, 9:00pm${reset} ${dim}|${reset} extra `$32.58/`$50.00"
$out += " ${dim}|${reset} ${orange}v2.1.245${reset}"
$out += "`n${dim}Update available: v1.5.0${reset}"
Write-Host -NoNewline $out
'@ | Set-Content -LiteralPath (Join-Path $tmp 'statusline\statusline.ps1') -Encoding UTF8

# $env:TEMP propio: el wrapper arma el cache como $env:TEMP\claude\...
$fakeTemp = Join-Path $tmp 'fake-temp'
New-Item -ItemType Directory -Force (Join-Path $fakeTemp 'claude') | Out-Null
$cache = Join-Path $fakeTemp 'claude\codex-usage-cache.json'
$psExe = (Get-Process -Id $PID).Path

function Render($freePct) {
    if ($null -eq $freePct) { Remove-Item -Force $cache -ErrorAction SilentlyContinue }
    else { "{""free_pct"":$freePct}" | Set-Content -LiteralPath $cache -Encoding UTF8 }
    & {
        $ErrorActionPreference = 'Continue'
        $prev = $env:TEMP
        $env:TEMP = $fakeTemp
        try {
            ('' | & $psExe -NoProfile -ExecutionPolicy Bypass `
                 -File (Join-Path $tmp 'statusline-wrapper.ps1') 2>&1 | Out-String)
        } finally { $env:TEMP = $prev }
    }
}

try {

$r = Render 87
T ($r -notmatch 'v2\.1\.245')  'saca el segmento de version de la CLI'
T ($r -match 'Opus 5')         'no se come el resto de la linea'
T ($r -match '5h.*51%')        'preserva los porcentajes de Claude'
T ($r -match 'Update available') 'preserva la segunda linea del aviso de update'

# El seg va al final de la PRIMERA linea, no despues del aviso de update.
$first = @($r -split "`r?`n")[0]
T ($first -match 'CX') 'la cuota de Codex queda en la primera linea'
T ($first -match 'Opus 5' -and $first -match 'extra') `
  'no parte la linea larga a lo ancho de la consola'

$green = "$E[38;2;0;160;0m"; $yellow = "$E[38;2;230;200;0m"
$orange = "$E[38;2;255;176;85m"; $red = "$E[38;2;255;85;85m"
T ((Render 87).Contains("${green}87%")) 'free 87% -> verde'
T ((Render 40).Contains("${yellow}40%")) 'free 40% -> amarillo'
T ((Render 20).Contains("${orange}20%")) 'free 20% -> naranja'
T ((Render 5).Contains("${red}5%"))      'free 5% -> rojo'
T ((Render '86.7') -match 'CX.*87%')   'redondea el decimal a entero'

}
finally {
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
}

if (-not $ok) { Write-Host "`nstatusline-wrapper CON FALLAS" -ForegroundColor Red; exit 1 }
Write-Host "`nstatusline-wrapper OK" -ForegroundColor Green
