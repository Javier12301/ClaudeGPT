# Wrapper para daniel3303/ClaudeCodeStatusLine.
#
# El script upstream formatea horas y montos con la cultura del sistema. En un
# Windows en español eso produce "11:00 p. m." (con espacio duro U+00A0),
# "sáb ago 22" y "$31,66" — y PowerShell 5.1 los emite en el codepage OEM, con
# lo cual los acentos y el espacio duro salen como "?".
#
# Fijar cultura invariante + salida UTF-8 arregla las tres cosas de una, y deja
# el clon intacto para que `git pull` siga funcionando.

$ErrorActionPreference = 'Continue'

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$inv = [System.Globalization.CultureInfo]::InvariantCulture
[System.Threading.Thread]::CurrentThread.CurrentCulture   = $inv
[System.Threading.Thread]::CurrentThread.CurrentUICulture = $inv

$stdin = [Console]::In.ReadToEnd()
# 6>&1 no es decoracion: el script upstream termina en `Write-Host -NoNewline`, que en
# PS 5.1 escribe al stream de informacion y NO al pipeline. Sin redirigirlo, $line queda
# vacio y la linea llega a la consola por fuera de este script -- imposible editarla.
# -Width alto y explicito: Out-String corta a lo ancho de la consola por defecto y
# parte la statusline en varias lineas con CRLF en el medio.
$line = ($stdin | & (Join-Path $PSScriptRoot 'statusline/statusline.ps1') 6>&1 |
         Out-String -Width 4096).TrimEnd()

# Segmento de version de la CLI (` | v2.1.245` naranja). El upstream lo emite al final,
# pero cuando hay update disponible agrega otra linea despues: por eso el patron se ancla
# a la forma exacta del segmento y no al fin de cadena. Se saca aca y no en el clon para
# que `git pull` sobre ClaudeCodeStatusLine siga funcionando.
$line = $line -replace ' \x1b\[2m\|\x1b\[0m \x1b\[38;2;255;176;85mv[0-9][^\x1b]*\x1b\[0m', ''

# Segmento de cuota de Codex. Se lee de un cache con TTL 60s y el refresco se
# dispara desacoplado: el RPC contra `codex app-server` tarda 1-2s y la
# statusline se renderiza en cada turno, no puede esperarlo.
$dir = Join-Path $(if ($env:TEMP) { $env:TEMP } else { [IO.Path]::GetTempPath() }) 'claude'
$cache = Join-Path $dir 'codex-usage-cache.json'
$stale = -not (Test-Path $cache) -or
         ((Get-Date) - (Get-Item $cache).LastWriteTime).TotalSeconds -ge 60
if ($stale) {
    $refresh = Join-Path $PSScriptRoot 'scripts/codex-run.ps1'
    if (Test-Path $refresh) {
        # $IsWindows no existe en PS 5.1 (vale $null); fuera de Windows no hay
        # powershell.exe ni -ExecutionPolicy, y -WindowStyle tira error.
        $opts = if ($null -eq $IsWindows -or $IsWindows) {
            @{ FilePath = 'powershell'; WindowStyle = 'Hidden'
               ArgumentList = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$refresh,'-QuotaCache') }
        } else {
            @{ FilePath = 'pwsh'
               ArgumentList = @('-NoProfile','-File',$refresh,'-QuotaCache') }
        }
        Start-Process @opts
    }
}

# Colores del upstream (statusline.ps1). Se duplican en vez de dot-sourcear el clon,
# porque dot-sourcearlo ejecutaria el script entero. `e es PS7+: [char]0x1b es PS 5.1.
$e     = [char]0x1b
$dimC  = "$e[2m"
$reset = "$e[0m"

$seg = ''
if (Test-Path $cache) {
    try {
        $cx = Get-Content $cache -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -ne $cx.free_pct) {
            # free_pct es cuota DISPONIBLE, no usada: los umbrales de Get-UsageColor del
            # upstream van espejados (verde = queda mucho).
            $pct = [int][math]::Round([double]$cx.free_pct)
            $c = if     ($pct -ge 50) { "$e[38;2;0;160;0m" }
                 elseif ($pct -ge 30) { "$e[38;2;230;200;0m" }
                 elseif ($pct -ge 10) { "$e[38;2;255;176;85m" }
                 else                 { "$e[38;2;255;85;85m" }
            $seg = " $dimC|$reset ${dimC}CX$reset $c$pct%$reset"
        }
    } catch { }
}
# Senal de vida de Codex. El wrapper borra este archivo al terminar la corrida,
# asi que su sola presencia significa "corriendo". El corte por frescura cubre el
# caso de una corrida matada sin cleanup, que si no dejaria el segmento pegado.
$act = Join-Path $dir 'codex-activity.json'
if (Test-Path $act) {
    try {
        if (((Get-Date) - (Get-Item $act).LastWriteTime).TotalSeconds -lt 90) {
            $a  = Get-Content $act -Raw -Encoding UTF8 | ConvertFrom-Json
            $el = [timespan]::FromSeconds([int]((Get-Date) - [datetime]$a.started).TotalSeconds)
            $t  = if ($el.TotalMinutes -ge 1) { '{0}m{1:00}s' -f [int]$el.TotalMinutes, $el.Seconds }
                  else { '{0}s' -f $el.Seconds }
            # Sin emoji a proposito: este wrapper existe porque PS 5.1 emite en
            # codepage OEM y rompia los acentos. 'CX>' es ASCII y no puede fallar.
            $seg += " | CX> $($a.role) $t $($a.last_event)"
        }
    } catch { }
}

# El seg va al final de la PRIMERA linea: el upstream puede agregar una segunda con el
# aviso de update, y la cuota pegada ahi abajo no se lee.
$lines = @($line -split "`r?`n")
$lines[0] = $lines[0].TrimEnd() + $seg
($lines -join "`n")
