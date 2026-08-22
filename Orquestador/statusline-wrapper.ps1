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
$cache = Join-Path $(if ($env:TEMP) { $env:TEMP } else { [IO.Path]::GetTempPath() }) 'claude/codex-usage-cache.json'
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
(($line -join "`n") + $seg)
