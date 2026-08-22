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
$line = $stdin | & (Join-Path $PSScriptRoot 'statusline/statusline.ps1')

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

$seg = ''
if (Test-Path $cache) {
    try {
        $cx = Get-Content $cache -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -ne $cx.free_pct) { $seg = ' | CX ' + $cx.free_pct + '%' }
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

(($line -join "`n") + $seg)
