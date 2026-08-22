<#
.SYNOPSIS
  Puente Claude Code -> Codex para el Orquestador Hibrido.

.DESCRIPTION
  Unico punto de entrada por el que el Orquestador de Claude delega trabajo a
  Codex. Resuelve modelos por tier (nunca por slug hardcodeado), chequea la cuota
  de ambos proveedores antes de gastar nada, ejecuta `codex exec` con contrato de
  salida forzado por JSON Schema, y devuelve un resumen compacto.

  La salida es ASCII a proposito: PowerShell 5.1 emite en el codepage OEM y los
  acentos salen como '?'. Mismo motivo que statusline-wrapper.ps1.

.EXAMPLE
  .\codex-run.ps1 -BudgetOnly
  .\codex-run.ps1 -Role constructor -PromptFile spec.md -Repo C:\proj -Task "reset password"
  .\codex-run.ps1 -Resume 01a01bad-xxxx -Prompt "Falta exportar resetToken. Corregilo."
  .\codex-run.ps1 -SessionInfo 01a01bad-xxxx

.NOTES
  Exit codes: 0 ok | 2 NO-GO cuota | 3 REUSE-DENIED | 4 fallo de Codex
              5 sin autenticar | 6 error de uso
#>
[CmdletBinding()]
param(
    [ValidateSet('constructor','tester-tdd','explorador','reviewer','security-reviewer','verifier','docs-researcher')]
    [string]$Role,

    [string]$Prompt,
    [string]$PromptFile,
    [string]$Repo = (Get-Location).Path,
    [string]$Task = '',

    # Solo para el log de decisiones. -Phase ubica la delegacion en el pipeline;
    # -RetryOf lleva el session id del intento anterior y registra UNICAMENTE
    # reintentos por RED logico: una falla de sandbox, red o tooling no es un
    # retry. Ver docs/SYSTEM.md BR-008.
    [ValidateSet('explore','contract','test','construct','verify','review','docs')]
    [string]$Phase = '',
    [string]$RetryOf = '',

    [string]$Resume,
    [string]$SessionInfo,

    [switch]$BudgetOnly,
    [switch]$QuotaCache,
    [switch]$Ephemeral,

    # Minimo de cuota libre exigido a Codex para delegar.
    [int]$MinFreePercent = 10
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Normalizamos el repo a ruta Windows absoluta: Git Bash puede pasar /c/... y
# el rollout de codex siempre guarda la forma nativa.
try { $Repo = (Resolve-Path -LiteralPath $Repo -ErrorAction Stop).ProviderPath } catch {}

# --- politica (ver README.md 4.2 y 5.3) ---
$REUSE_FREE_KB    = 400     # por debajo: reusar sin dudar
$REUSE_LIMIT_KB   = 1200    # por encima: sesion nueva obligatoria
$RPC_TIMEOUT_MS   = 15000
$MAX_OUTPUT_LINES = 20

# Umbrales del veredicto de Codex (capa 1: "se puede usar Codex, y para que").
# Ver docs/SYSTEM.md BR-001 y BR-002.
$CODEX_WARN_FREE  = 20      # por debajo: solo si el usuario lo pide
$CODEX_HEAVY_FREE = 40      # desde aca: implementacion voluminosa permitida

# Umbrales del estado de capacidad de Claude (capa 2: "quien lidera y quien
# ejecuta"). Ver docs/SYSTEM.md BR-003.
$CLAUDE_PREFER_5H  = 50     # desde aca Codex ejecuta por defecto
$CLAUDE_HANDOFF_5H = 70     # desde aca se recomienda /model sonnet
$CLAUDE_PRESSURE   = 85     # desde aca la ventana esta en estado critico
$CLAUDE_WEEK_GATE  = 80     # 7d por encima: el nivel no baja de 'presionado'

# Tier por rol. El slug real sale del catalogo vivo, nunca se hardcodea.
$RoleTier = @{
    'constructor'       = 'worker'
    'tester-tdd'        = 'worker'
    'explorador'        = 'cheap'
    'reviewer'          = 'worker'
    'security-reviewer' = 'worker'
    'verifier'          = 'cheap'
    'docs-researcher'   = 'cheap'
}
$RoleSchema = @{
    'constructor'       = 'impl'
    'tester-tdd'        = 'impl'
    'verifier'          = 'impl'
    'explorador'        = 'review'
    'reviewer'          = 'review'
    'security-reviewer' = 'review'
    'docs-researcher'   = 'docs'
}

function Get-CodexCommand {
    foreach ($n in @('codex.cmd','codex.exe','codex')) {
        $c = Get-Command $n -ErrorAction SilentlyContinue
        if ($c) { return $c.Source }
    }
    throw "No se encontro el ejecutable de codex en el PATH."
}
$CodexCmd  = Get-CodexCommand
$CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }

# PowerShell 5.1 corre sobre .NET Framework, que NO tiene ProcessStartInfo.ArgumentList
# (es de .NET Core 2.1+). Hay que armar la linea de comandos a mano con el quoting
# de Windows: comillas dobles alrededor, backslashes duplicados antes de comilla.
function ConvertTo-CmdArg([string]$a) {
    if ($a -eq '') { return '""' }
    if ($a -notmatch '[\s"]') { return $a }
    $s = [regex]::Replace($a, '(\\*)"', '$1$1\"')
    $s = [regex]::Replace($s, '(\\+)$', '$1$1')
    return '"' + $s + '"'
}

function Invoke-CodexCli {
    param([string[]]$CodexArgs, [int]$TimeoutSec = 900, [string]$StdinText)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName  = $CodexCmd
    $psi.Arguments = (($CodexArgs | ForEach-Object { ConvertTo-CmdArg $_ }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.CreateNoWindow = $true
    $useStdin = $PSBoundParameters.ContainsKey('StdinText')
    if ($useStdin) { $psi.RedirectStandardInput = $true }

    $p = [System.Diagnostics.Process]::Start($psi)
    $so = $p.StandardOutput.ReadToEndAsync()
    $se = $p.StandardError.ReadToEndAsync()
    if ($useStdin) {
        # .NET Framework no tiene StandardInputEncoding, y el StreamWriter por
        # defecto usa el codepage OEM: codex rechaza eso como "not valid UTF-8".
        # Escribimos los bytes UTF-8 directo al stream de abajo.
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($StdinText)
        $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        $p.StandardInput.BaseStream.Flush()
        $p.StandardInput.Close()   # EOF explicito: sin esto codex espera para siempre
    }
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        try { $p.Kill() } catch {}
        return @{ ExitCode = 124; Out = ''; Err = "timeout tras $TimeoutSec s" }
    }
    return @{ ExitCode = $p.ExitCode; Out = $so.Result; Err = $se.Result }
}

# ---------------------------------------------------------------- cuotas ---

function Get-CodexQuota {
    # JSON-RPC por stdio contra `codex app-server`, metodo account/rateLimits/read.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName  = $CodexCmd
    $psi.Arguments = 'app-server'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput  = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.CreateNoWindow = $true

    $p = $null
    try {
        $p = [System.Diagnostics.Process]::Start($psi)
        $p.StandardInput.WriteLine('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"codex-run","title":"codex-run","version":"1.0"}}}')
        $p.StandardInput.Flush()
        Start-Sleep -Milliseconds 400
        $p.StandardInput.WriteLine('{"jsonrpc":"2.0","method":"initialized","params":{}}')
        $p.StandardInput.WriteLine('{"jsonrpc":"2.0","id":2,"method":"account/rateLimits/read","params":{}}')
        $p.StandardInput.Flush()

        $sw = [Diagnostics.Stopwatch]::StartNew()
        while ($sw.ElapsedMilliseconds -lt $RPC_TIMEOUT_MS) {
            $remaining = $RPC_TIMEOUT_MS - $sw.ElapsedMilliseconds
            if ($remaining -le 0) { break }
            $t = $p.StandardOutput.ReadLineAsync()
            if (-not $t.Wait([int]$remaining)) { break }
            $line = $t.Result
            if ($null -eq $line) { break }
            try { $msg = $line | ConvertFrom-Json } catch { continue }
            if ($msg.id -eq 2 -and $msg.result) { return $msg.result }
        }
    } catch {
        return $null
    } finally {
        if ($p -and -not $p.HasExited) { try { $p.Kill() } catch {} }
    }
    return $null
}

function Get-ClaudeQuota {
    # La statusline refresca este cache en cada turno (TTL 60s). Ver INSTALL.md 4.5.
    $f = Join-Path $env:TEMP 'claude\statusline-usage-cache.json'
    if (-not (Test-Path $f)) { return $null }
    try { return (Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function Get-FreePercent($res) {
    # Toma la ventana MAS ajustada de todas: primary/secondary de cada limitId.
    # La API puede devolver varios limites a la vez (codex, codex_other, ...);
    # ver account/rateLimits/read en la doc oficial de Codex.
    if (-not $res) { return $null }
    $buckets = @($res.rateLimits)
    if ($res.rateLimitsByLimitId) {
        foreach ($p in $res.rateLimitsByLimitId.PSObject.Properties) { $buckets += $p.Value }
    }
    $used = @()
    foreach ($b in $buckets) {
        if (-not $b) { continue }
        if ($b.primary   -and $null -ne $b.primary.usedPercent)   { $used += [double]$b.primary.usedPercent }
        if ($b.secondary -and $null -ne $b.secondary.usedPercent) { $used += [double]$b.secondary.usedPercent }
    }
    if ($used.Count -eq 0) { return $null }
    return [math]::Round(100 - ($used | Measure-Object -Maximum).Maximum, 1)
}

function Format-Epoch($e) {
    if (-not $e) { return 'n/d' }
    return ([DateTimeOffset]::FromUnixTimeSeconds([long]$e)).LocalDateTime.ToString('yyyy-MM-dd HH:mm')
}

# Capa 1: "se puede usar Codex, y para que". Devuelve GO / WARN / NO-GO.
# No sabe nada del estado de Claude: eso es la capa 2, mas abajo.
function Get-CodexVerdict {
    $res = Get-CodexQuota
    $cx  = if ($res) { $res.rateLimits } else { $null }
    $cl  = Get-ClaudeQuota

    $r = [ordered]@{
        CodexFree = $null; CodexReset = 'n/d'; CodexPlan = 'n/d'
        ClaudeFiveHourUsed = $null; ClaudeSevenDayUsed = $null; ClaudeReset = 'n/d'
        Decision = 'UNKNOWN'; Reason = ''; AllowHeavy = $false
        ClaudeLevel = $null; State = 'UNKNOWN'; StateReason = ''
    }

    if ($cl) {
        $r.ClaudeFiveHourUsed = $cl.five_hour.utilization
        $r.ClaudeSevenDayUsed = $cl.seven_day.utilization
        $r.ClaudeReset        = $cl.five_hour.resets_at
    }

    if (-not $cx) {
        $r.Decision = 'WARN'
        $r.Reason   = 'No se pudo leer la cuota de Codex (app-server sin respuesta). Delegar solo si el usuario lo pide.'
        return $r
    }

    $r.CodexPlan = $cx.planType
    $r.CodexFree = Get-FreePercent $res
    if ($cx.primary) { $r.CodexReset = Format-Epoch $cx.primary.resetsAt }

    if ($cx.spendControlReached -or $cx.rateLimitReachedType) {
        $r.Decision = 'NO-GO'
        $r.Reason   = 'Codex alcanzo su limite de gasto o de rate limit.'
        return $r
    }
    if ($null -eq $r.CodexFree) {
        $r.Decision = 'WARN'
        $r.Reason   = 'Codex no reporto porcentaje de uso.'
        return $r
    }

    $f = $r.CodexFree
    if     ($f -lt $MinFreePercent) { $r.Decision='NO-GO'; $r.Reason="Codex libre $f% (< $MinFreePercent%). Claude-only. Reset: $($r.CodexReset)" }
    elseif ($f -lt $CODEX_WARN_FREE)  { $r.Decision='WARN';  $r.Reason="Codex libre $f%. Solo si el usuario lo pide explicitamente." }
    elseif ($f -lt $CODEX_HEAVY_FREE) { $r.Decision='GO';    $r.Reason="Codex libre $f%. Review/verify/docs si; implementacion voluminosa no." }
    else                              { $r.Decision='GO';    $r.Reason="Codex libre $f%. Delegacion normal."; $r.AllowHeavy = $true }

    if ($null -ne $r.ClaudeFiveHourUsed -and $r.ClaudeFiveHourUsed -gt $CLAUDE_PRESSURE -and $f -gt $CODEX_HEAVY_FREE) {
        $r.Reason += " Claude al $($r.ClaudeFiveHourUsed)% de su ventana de 5h: conviene empujar trabajo a Codex."
    }
    return $r
}

# Nivel de presion de Claude, derivado solo de sus dos ventanas.
# Devuelve $null si no hay dato: quien llame nunca debe inventar un nivel.
function Get-ClaudeLevel($fiveHour, $sevenDay) {
    if ($null -eq $fiveHour) { return $null }

    $level = if     ($fiveHour -ge $CLAUDE_PRESSURE)   { 'critico' }
             elseif ($fiveHour -ge $CLAUDE_HANDOFF_5H) { 'apretado' }
             elseif ($fiveHour -ge $CLAUDE_PREFER_5H)  { 'presionado' }
             else                                      { 'fresco' }

    # Gate de 7 dias: un lunes productivo no puede dejar la semana sin cuota
    # solo porque la ventana corta se reseteo. Sube el piso, nunca lo baja.
    if ($null -ne $sevenDay -and $sevenDay -gt $CLAUDE_WEEK_GATE -and $level -eq 'fresco') {
        $level = 'presionado'
    }
    return $level
}

# Capa 2: "quien lidera y quien ejecuta". Se resuelve evaluando las reglas de
# arriba hacia abajo: la primera que coincide gana. Ver docs/SYSTEM.md BR-003.
function Add-CapacityState($r) {
    $lvl = Get-ClaudeLevel $r.ClaudeFiveHourUsed $r.ClaudeSevenDayUsed
    $r.ClaudeLevel = $lvl

    $codexOut = ($r.Decision -eq 'NO-GO')
    $codexAsk = ($r.Decision -eq 'WARN')   # usable solo si el usuario lo pide

    # 1. Sin dato de Claude no se infiere nada. Va primera a proposito: ninguna
    #    regla posterior puede leer un nivel que no existe.
    if ($null -eq $lvl) {
        $r.State = 'BALANCED'
        $r.StateReason = 'Sin lectura de la cuota de Claude (statusline apagada o cache ilegible): routing por naturaleza de la tarea.'
        return
    }

    if ($lvl -eq 'critico' -and ($codexOut -or $codexAsk)) {
        $r.State = 'SURVIVAL'
        $r.StateReason = 'Claude critico y Codex sin margen: no iniciar trabajo nuevo, cerrar la unidad actual y hacer checkpoint.'
    }
    elseif ($codexOut) {
        $r.State = 'CLAUDE-LEAD'
        $r.StateReason = 'Codex descartado: pipeline Claude, sin ritual multi-provider.'
    }
    # Las reglas 4-6 exigen veredicto GO: un WARN no alcanza para poner a Codex
    # a ejecutar, por mas apretado que este Claude. Cae a la regla 7.
    elseif (-not $codexAsk -and ($lvl -eq 'critico' -or $lvl -eq 'apretado')) {
        $r.State = 'SONNET-LEAD'
        $r.StateReason = "Claude al $($r.ClaudeFiveHourUsed)% de su ventana de 5h: recomendar /model sonnet una vez; Codex ejecuta."
    }
    elseif (-not $codexAsk -and $lvl -eq 'presionado') {
        $r.State = 'CODEX-PREFERRED'
        $r.StateReason = 'Claude planifica y arbitra; ejecucion a Codex.'
    }
    elseif ($codexAsk) {
        $r.State = 'CLAUDE-LEAD'
        $r.StateReason = 'Codex en WARN: pipeline Claude salvo que el usuario pida lo contrario.'
    }
    else {
        $r.State = 'BALANCED'
        $r.StateReason = 'Ambos con margen: reparto por naturaleza de la tarea.'
    }

    # El veredicto sigue vetando el volumen dentro del estado: las dos capas se
    # componen, no se pisan.
    if (-not $r.AllowHeavy -and ($r.State -eq 'CODEX-PREFERRED' -or $r.State -eq 'SONNET-LEAD')) {
        $r.StateReason += ' Codex acotado: sin implementacion voluminosa.'
    }
}

function Get-BudgetVerdict {
    $r = Get-CodexVerdict
    Add-CapacityState $r
    return $r
}

function Show-Budget($v) {
    Write-Output "== Presupuesto =="
    $cf = if ($null -ne $v.CodexFree) { "$($v.CodexFree)% libre" } else { 'n/d' }
    Write-Output ("Codex  : {0} (plan {1}) - reset {2}" -f $cf, $v.CodexPlan, $v.CodexReset)
    $c5 = if ($null -ne $v.ClaudeFiveHourUsed) { "$($v.ClaudeFiveHourUsed)% usado" } else { 'n/d' }
    $c7 = if ($null -ne $v.ClaudeSevenDayUsed) { "$($v.ClaudeSevenDayUsed)% usado" } else { 'n/d' }
    Write-Output ("Claude : 5h {0} | 7d {1} - reset {2}" -f $c5, $c7, $v.ClaudeReset)
    Write-Output ("Estado : {0} - {1}" -f $v.State, $v.StateReason)
    Write-Output ("Decision: {0} - {1}" -f $v.Decision, $v.Reason)
}

# ------------------------------------------------- catalogo de modelos ---

function Get-ModelCatalog {
    $r = Invoke-CodexCli -CodexArgs @('debug','models') -TimeoutSec 60
    if ($r.ExitCode -ne 0) { throw "No se pudo leer el catalogo de modelos: $($r.Err)" }
    $d = $r.Out | ConvertFrom-Json
    $models = if ($d.models) { $d.models } else { $d }
    return @($models | Where-Object { $_.visibility -eq 'list' } | Sort-Object { [int]$_.priority })
}

function Resolve-Model {
    param([string]$Tier, [string]$Effort)
    $cat = Get-ModelCatalog
    if ($cat.Count -eq 0) { throw "El catalogo de modelos vino vacio." }

    # lead=rank1, worker=rank2, cheap=rank3, degradando hacia arriba si faltan.
    $idx = switch ($Tier) { 'lead' { 0 } 'worker' { 1 } 'cheap' { 2 } default { 1 } }
    if ($idx -ge $cat.Count) { $idx = $cat.Count - 1 }
    $m = $cat[$idx]

    $supported = @($m.supported_reasoning_levels | ForEach-Object { $_.effort })
    $eff = $Effort
    if ([string]::IsNullOrWhiteSpace($eff) -or ($supported -notcontains $eff)) {
        if (-not [string]::IsNullOrWhiteSpace($eff)) {
            Write-Verbose "Effort '$eff' no soportado por $($m.slug); se usa el default."
        }
        $eff = $m.default_reasoning_level
    }
    return @{ Slug = $m.slug; Effort = $eff; Tier = $Tier }
}

# --------------------------------------------------------------- roles ---
# El kit Codex sigue siendo la fuente de verdad de las instrucciones de rol.

function Get-RoleConfig([string]$RoleName) {
    $f = Join-Path $CodexHome "agents\$RoleName.toml"
    if (-not (Test-Path $f)) { throw "Falta el rol '$RoleName' en $f. Instalaste el kit Codex?" }
    $raw = Get-Content $f -Raw -Encoding UTF8

    $instr = ''
    $mi = [regex]::Match($raw, 'developer_instructions\s*=\s*"""(.*?)"""', 'Singleline')
    if ($mi.Success) { $instr = $mi.Groups[1].Value.Trim() }

    $effort = 'medium'
    $me = [regex]::Match($raw, '(?m)^\s*model_reasoning_effort\s*=\s*"([^"]+)"')
    if ($me.Success) { $effort = $me.Groups[1].Value }

    $sandbox = 'read-only'
    $ms = [regex]::Match($raw, '(?m)^\s*sandbox_mode\s*=\s*"([^"]+)"')
    if ($ms.Success) { $sandbox = $ms.Groups[1].Value }

    return @{ Instructions = $instr; Effort = $effort; Sandbox = $sandbox }
}

# --------------------------------------------- contratos de salida ---

function New-SchemaFile([string]$Kind) {
    $impl = @'
{"type":"object","additionalProperties":false,
 "required":["files_changed","summary","tests","risks","blocked"],
 "properties":{
   "files_changed":{"type":"array","items":{"type":"string"}},
   "summary":{"type":"string"},
   "tests":{"type":"object","additionalProperties":false,"required":["command","status"],
     "properties":{"command":{"type":"string"},
                   "status":{"type":"string","enum":["GREEN","RED","NOT_RUN"]}}},
   "risks":{"type":"array","items":{"type":"string"}},
   "blocked":{"type":"boolean"}}}
'@
    $review = @'
{"type":"object","additionalProperties":false,
 "required":["findings","coverage_note"],
 "properties":{
   "findings":{"type":"array","items":{"type":"object","additionalProperties":false,
     "required":["severity","file","line","problem","impact","fix"],
     "properties":{"severity":{"type":"string","enum":["P0","P1","P2","P3"]},
                   "file":{"type":"string"},"line":{"type":"integer"},
                   "problem":{"type":"string"},"impact":{"type":"string"},
                   "fix":{"type":"string"}}}},
   "coverage_note":{"type":"string"}}}
'@
    $docs = @'
{"type":"object","additionalProperties":false,
 "required":["conclusion","api_version","source","implication"],
 "properties":{"conclusion":{"type":"string"},"api_version":{"type":"string"},
               "source":{"type":"string"},"implication":{"type":"string"}}}
'@
    $body = switch ($Kind) { 'impl' { $impl } 'review' { $review } 'docs' { $docs } }
    $p = Join-Path $env:TEMP ("codex-schema-$Kind-" + [guid]::NewGuid().ToString('N').Substring(0,8) + ".json")
    # Sin BOM: Set-Content -Encoding UTF8 en PS 5.1 lo agrega y codex rechaza el
    # schema con "not valid JSON: expected value at line 1 column 1".
    [System.IO.File]::WriteAllText($p, $body, (New-Object System.Text.UTF8Encoding($false)))
    return $p
}

# ------------------------------------------------------------ sesiones ---

function Find-RolloutFile([string]$SessionId) {
    $root = Join-Path $CodexHome 'sessions'
    if (-not (Test-Path $root)) { return $null }
    return Get-ChildItem -Path $root -Recurse -Filter "*$SessionId*.jsonl" -ErrorAction SilentlyContinue |
           Select-Object -First 1
}

function Get-SessionDetail([string]$SessionId) {
    $f = Find-RolloutFile $SessionId
    if (-not $f) { return $null }
    $kb = [math]::Round($f.Length / 1KB, 0)
    $turns = 0
    try {
        $turns = @(Select-String -Path $f.FullName -Pattern '"type"\s*:\s*"turn_context"' -AllMatches).Count
    } catch {}
    # Umbral de reuso: ver README.md 5.3.
    $verdict = if ($kb -lt $REUSE_FREE_KB)      { 'REUSE-OK' }
               elseif ($kb -le $REUSE_LIMIT_KB) { 'REUSE-IF-DIRECT' }
               else                             { 'REUSE-DENIED' }
    return @{ Id = $SessionId; Path = $f.FullName; Kb = $kb; Turns = $turns; Verdict = $verdict }
}

function Get-LatestSessionIdForCwd([string]$Cwd) {
    $root = Join-Path $CodexHome 'sessions'
    if (-not (Test-Path $root)) { return $null }
    $candidates = Get-ChildItem -Path $root -Recurse -Filter '*.jsonl' -ErrorAction SilentlyContinue |
                  Sort-Object LastWriteTime -Descending | Select-Object -First 8
    foreach ($c in $candidates) {
        try {
            $first = Get-Content $c.FullName -TotalCount 1 -Encoding UTF8
            $m = $first | ConvertFrom-Json
            if ($m.payload.session_id -and $m.payload.cwd) {
                if ($m.payload.cwd.TrimEnd('\') -ieq $Cwd.TrimEnd('\')) { return $m.payload.session_id }
            }
        } catch {}
    }
    return $null
}

# ------------------------------------------------ log de decisiones ---

function Write-DecisionLog($entry) {
    try {
        $dir = Join-Path $Repo '.orquestador'
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        $line = ($entry | ConvertTo-Json -Depth 6 -Compress) + "`n"
        [System.IO.File]::AppendAllText((Join-Path $dir 'decisions.jsonl'), $line,
                                        (New-Object System.Text.UTF8Encoding($false)))
    } catch {
        Write-Verbose "No se pudo escribir decisions.jsonl: $_"
    }
}

# Dot-sourcear el script carga solo las funciones: es como lo testea
# Orquestador/tests/test-codex-run.ps1 sin invocar a codex.
if ($MyInvocation.InvocationName -eq '.') { return }

# ============================================================== modos ===

if ($QuotaCache) {
    # Cache de cuota para la statusline. El RPC contra app-server tarda 1-2s:
    # jamas debe correr sincronico en el render, por eso se cachea aparte.
    $res = Get-CodexQuota
    $rl  = if ($res) { $res.rateLimits } else { $null }
    $out = [ordered]@{
        ts        = (Get-Date).ToString('o')
        free_pct  = Get-FreePercent $res
        plan      = if ($rl) { $rl.planType } else { $null }
        resets_at = if ($rl -and $rl.primary) { Format-Epoch $rl.primary.resetsAt } else { 'n/d' }
    }
    $dir = Join-Path $env:TEMP 'claude'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [System.IO.File]::WriteAllText((Join-Path $dir 'codex-usage-cache.json'),
                                   ($out | ConvertTo-Json -Compress),
                                   (New-Object System.Text.UTF8Encoding($false)))
    exit 0
}

if ($BudgetOnly) {
    $v = Get-BudgetVerdict
    Show-Budget $v
    if ($VerbosePreference -eq 'Continue') {
        Write-Output ""
        Write-Output "== Modelos (catalogo vivo) =="
        foreach ($t in @('lead','worker','cheap')) {
            $m = Resolve-Model -Tier $t -Effort $null
            Write-Output ("  {0,-7} -> {1} (default {2})" -f $t, $m.Slug, $m.Effort)
        }
    }
    if ($v.Decision -eq 'NO-GO') { exit 2 }
    exit 0
}

if ($SessionInfo) {
    $d = Get-SessionDetail $SessionInfo
    if (-not $d) { Write-Output "Sesion no encontrada: $SessionInfo"; exit 6 }
    Write-Output "== Sesion $($d.Id) =="
    Write-Output ("Rollout  : {0} KB" -f $d.Kb)
    Write-Output ("Turnos   : {0}" -f $d.Turns)
    Write-Output ("Veredicto: {0}  (libre <{1}KB, limite {2}KB)" -f $d.Verdict, $REUSE_FREE_KB, $REUSE_LIMIT_KB)
    exit 0
}

if (-not $Role -and -not $Resume) {
    Write-Output "Uso: -BudgetOnly | -SessionInfo <id> | -Role <rol> -PromptFile <f> | -Resume <id> -Prompt <txt>"
    exit 6
}

# --- prompt ---
if ($PromptFile) {
    if (-not (Test-Path $PromptFile)) { Write-Output "No existe: $PromptFile"; exit 6 }
    $PromptText = Get-Content $PromptFile -Raw -Encoding UTF8
} else {
    $PromptText = $Prompt
}
if ([string]::IsNullOrWhiteSpace($PromptText)) { Write-Output "Falta -Prompt o -PromptFile."; exit 6 }

# --- auth ---
$auth = Invoke-CodexCli -CodexArgs @('login','status') -TimeoutSec 60
# Ojo: `codex login status` escribe en stderr, no en stdout.
if ($auth.ExitCode -ne 0 -or ("$($auth.Out)`n$($auth.Err)" -notmatch 'Logged in')) {
    Write-Output "Codex no esta autenticado. Corre: codex login"
    Write-Output "No se usa API key automaticamente (cambiaria el modelo de facturacion esperado)."
    exit 5
}

# --- cuota ---
$verdict = Get-BudgetVerdict
Show-Budget $verdict
if ($verdict.Decision -eq 'NO-GO') {
    Write-Output ""
    Write-Output "NO-GO: no se invoca a Codex. Seguir Claude-only."
    exit 2
}

# --- reuso de sesion ---
$isResume = -not [string]::IsNullOrWhiteSpace($Resume)
if ($isResume) {
    $d = Get-SessionDetail $Resume
    if (-not $d) {
        Write-Output "REUSE-DENIED: sesion $Resume no encontrada (corrio con --ephemeral?). Arrancar sesion nueva."
        exit 3
    }
    if ($d.Verdict -eq 'REUSE-DENIED') {
        Write-Output ("REUSE-DENIED: la sesion lleva {0} KB (limite {1} KB). Arrancar sesion nueva con spec fresca." -f $d.Kb, $REUSE_LIMIT_KB)
        exit 3
    }
    Write-Output ("Reusando sesion {0} ({1} KB, {2})" -f $Resume, $d.Kb, $d.Verdict)
}

# --- rol y modelo ---
if (-not $Role) { $Role = 'constructor' }
$roleCfg = Get-RoleConfig $Role
$tier    = $RoleTier[$Role]
$model   = Resolve-Model -Tier $tier -Effort $roleCfg.Effort
$schema  = New-SchemaFile $RoleSchema[$Role]
$outFile = Join-Path $env:TEMP ("codex-last-" + [guid]::NewGuid().ToString('N').Substring(0,8) + ".txt")

Write-Output ("Rol: {0} | modelo: {1} ({2}/{3}) | sandbox: {4}" -f $Role, $model.Slug, $tier, $model.Effort, $roleCfg.Sandbox)

# El rol define el comportamiento; el prompt define la tarea concreta.
$fullPrompt = @"
$($roleCfg.Instructions)

Consulta Engram si el area pudo haberse trabajado antes. NO guardes en Engram:
reporta cualquier hallazgo relevante en el campo de riesgos y el Tech Lead decide.

Responde UNICAMENTE con el JSON del esquema pedido. Sin prosa alrededor.

---- TAREA ----
$PromptText
"@

# Ojo: `codex exec resume` NO acepta -C ni -s (hereda cwd y sandbox de la sesion
# original). Solo `codex exec` los admite.
$cxArgs = @()
if ($isResume) { $cxArgs += @('exec','resume',$Resume) }
else           { $cxArgs += @('exec','-C',$Repo,'-s',$roleCfg.Sandbox) }
$cxArgs += @(
    '-m', $model.Slug,
    # Sin comillas: codex parsea el valor como TOML y cae a string literal si falla.
    '-c', "model_reasoning_effort=$($model.Effort)",
    '-c', 'agents.enabled=false',      # un solo Tech Lead: Codex no abre su propio subloop
    '--output-schema', $schema,
    '-o', $outFile,
    '--json',                          # eventos JSONL: de aca sale el session id
    '--skip-git-repo-check'
)
if ($Ephemeral -and -not $isResume) { $cxArgs += '--ephemeral' }
$cxArgs += '-'   # el prompt entra por stdin: evita limites y quoting de la linea de comandos

$run = Invoke-CodexCli -CodexArgs $cxArgs -TimeoutSec 1800 -StdinText $fullPrompt

# --- resultado ---
$rawOut  = ''
$payload = $null
if (Test-Path $outFile) {
    $rawOut = Get-Content $outFile -Raw -Encoding UTF8
    try { $payload = $rawOut | ConvertFrom-Json } catch { }
}

# El id sale de los eventos --json (autoritativo); el escaneo de rollouts por
# cwd queda solo como respaldo.
$sessionId = $Resume
if (-not $sessionId) {
    $m = [regex]::Match($run.Out, '"(?:session_id|sessionId|thread_id|threadId)"\s*:\s*"([0-9a-fA-F-]{36})"')
    if ($m.Success) { $sessionId = $m.Groups[1].Value } else { $sessionId = Get-LatestSessionIdForCwd $Repo }
}
$detail    = if ($sessionId) { Get-SessionDetail $sessionId } else { $null }

Write-Output ""
if ($run.ExitCode -ne 0 -and -not $payload) {
    Write-Output "== Codex FALLO (exit $($run.ExitCode)) =="
    Write-Output (($run.Err -split "`n" | Select-Object -Last 5) -join "`n")
    Write-Output "El trabajo parcial (si lo hay) quedo en el working tree: revisar con git diff."
    exit 4
}

Write-Output "== Resultado ($Role) =="
if ($payload) {
    $keys = $payload.PSObject.Properties.Name
    if ($keys -contains 'files_changed') {
        Write-Output "Archivos:"
        foreach ($f in $payload.files_changed) { Write-Output "  - $f" }
        Write-Output "Cambio: $($payload.summary)"
        Write-Output "Tests : $($payload.tests.status) via $($payload.tests.command)"
        if ($payload.risks -and @($payload.risks).Count -gt 0) {
            Write-Output "Riesgos:"
            foreach ($r in $payload.risks) { Write-Output "  - $r" }
        }
        if ($payload.blocked) { Write-Output "BLOQUEADO: Codex no pudo completar." }
    }
    elseif ($keys -contains 'findings') {
        if (@($payload.findings).Count -eq 0) {
            Write-Output "Sin findings. $($payload.coverage_note)"
        } else {
            foreach ($f in $payload.findings) {
                Write-Output ("[{0}] {1}:{2} - {3} - impacto: {4} - fix: {5}" -f `
                    $f.severity, $f.file, $f.line, $f.problem, $f.impact, $f.fix)
            }
            Write-Output "Cobertura: $($payload.coverage_note)"
        }
    }
    else {
        Write-Output "Conclusion: $($payload.conclusion)"
        Write-Output "Version   : $($payload.api_version)"
        Write-Output "Fuente    : $($payload.source)"
        Write-Output "Implica   : $($payload.implication)"
    }
} else {
    # Sin JSON valido: truncamos duro para no contaminar el contexto de Claude.
    Write-Output "(sin JSON valido; primeras $MAX_OUTPUT_LINES lineas)"
    @($rawOut -split "`n" | Select-Object -First $MAX_OUTPUT_LINES) | ForEach-Object { Write-Output $_ }
    Write-Output "Salida completa en: $outFile"
}

if ($detail) {
    Write-Output ""
    Write-Output ("Sesion: {0} ({1} KB, {2})" -f $detail.Id, $detail.Kb, $detail.Verdict)
}

Write-DecisionLog ([ordered]@{
    ts       = (Get-Date).ToString('o')
    task     = $Task
    role     = $Role
    tier     = $tier
    model    = $model.Slug
    effort   = $model.Effort
    sandbox  = $roleCfg.Sandbox
    reused   = $isResume
    session  = @{ id = $sessionId; rollout_kb = $(if ($detail) { $detail.Kb } else { $null }) }
    codex_free_pct = $verdict.CodexFree
    claude_5h_used = $verdict.ClaudeFiveHourUsed
    claude_7d_used = $verdict.ClaudeSevenDayUsed
    state          = $verdict.State
    phase          = $(if ($Phase)   { $Phase }   else { $null })
    retry_of       = $(if ($RetryOf) { $RetryOf } else { $null })
    exit_code = $run.ExitCode
    blocked   = $(if ($payload -and $payload.PSObject.Properties.Name -contains 'blocked') { [bool]$payload.blocked } else { $false })
    findings  = $(if ($payload -and $payload.PSObject.Properties.Name -contains 'findings') { @($payload.findings).Count } else { $null })
})

Remove-Item $schema -ErrorAction SilentlyContinue
exit 0
