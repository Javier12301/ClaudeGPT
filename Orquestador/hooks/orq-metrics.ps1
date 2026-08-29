<#
.SYNOPSIS
  Observabilidad de la orquestacion del lado Claude.

.DESCRIPTION
  Registra en el mismo .orquestador/decisions.jsonl que ya escribe codex-run.ps1
  lo que el wrapper no puede ver: los spawns de subagentes Claude y las corridas
  de suites de test.

  El punto de instrumentacion es el par PreToolUse/PostToolUse sobre la
  herramienta Agent. SubagentStop NO sirve: su payload solo trae session_id,
  transcript_path, cwd y reason, sin rol ni duracion.

  Invariante: un fallo del hook nunca interrumpe el trabajo. Ante cualquier
  error escribe nada, emite '{}' y sale con 0. Mismo contrato que git-guard.ps1.

.EXAMPLE
  # Como hook (lee el evento por stdin):
  .\orq-metrics.ps1

  # Como reporte:
  .\orq-metrics.ps1 -Report
  .\orq-metrics.ps1 -Report -Repo C:\proj
#>
[CmdletBinding()]
param(
    [switch]$Report,
    [switch]$Feedback,

    # Registra un evento de friccion que ningun hook puede inferir. Lo llama el
    # orquestador en el momento en que la friccion ocurre, no en una retro al
    # final: a esa altura ya se olvido cual era.
    [ValidateSet('rework','review-defect','predictable-needs-info','wasted-verify','wrong-route','env-gotcha')]
    [string]$Note,
    [string]$Detail = '',
    [string]$Phase = '',

    [string]$Repo = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

# Comandos que corren tests. Se busca el runner, no el proyecto: alcanza para
# separar "corri algo" de "no corri nada", que es lo unico que se mide aca.
$TestRunnerPattern = '(?i)(?:^|[\s;&|(])(?:npm\s+(?:run\s+)?test|npx\s+(?:jest|vitest|playwright)|yarn\s+test|pnpm\s+(?:run\s+)?test|jest|vitest|pytest|py\.test|python\s+-m\s+pytest|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+(?:test|verify)|gradle\s+test|rspec|phpunit|Invoke-Pester)\b'

# Un comando de test es 'targeted' si nombra un archivo, un directorio, o usa
# un flag de seleccion. Sin nada de eso, corre la suite entera.
$TargetedPattern = '(?i)(?:-k\s|-t\s|--test(?:-name-pattern|PathPattern|NamePattern)?[\s=]|--filter[\s=]|--grep[\s=]|--run[\s=]|--spec[\s=]|-Path\s|::|\.(?:test|spec)\.[jt]sx?\b|test_[\w-]+\.py\b|[\w/\\.-]+_test\.go\b|[\w/\\.-]+\.(?:py|rb|php|cs|java|kt)\b)'

# Firmas de fallo en la salida de un runner. No hay exit code en el payload
# --se verifico contra un evento real--, asi que la senal es el texto. Se busca
# el resumen del runner, no la palabra 'fail' suelta, que aparece en cualquier
# log. Un falso negativo aca solo pierde una metrica; nunca rompe nada.
$FailurePattern = '(?im)^\s*(?:FAILED|FAIL\b|ERROR:)|\b(\d+)\s+(?:failed|failing|failures?|errors?)\b|Tests?\s+failed|assertion\s+failed|\bFAILURES\b'
# "0 failed" / "0 failures" es un GREEN que contiene la palabra: se descarta.
$ZeroFailPattern = '(?i)\b0\s+(?:failed|failing|failures?|errors?)\b'

function Get-LogPath([string]$root) {
    $dir = Join-Path $root '.orquestador'
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    return (Join-Path $dir 'decisions.jsonl')
}

function Write-Metric($entry, [string]$root) {
    $line = ($entry | ConvertTo-Json -Depth 6 -Compress) + "`n"
    [System.IO.File]::AppendAllText((Get-LogPath $root), $line,
                                    (New-Object System.Text.UTF8Encoding($false)))
}

function Get-TestScope([string]$command) {
    if ([string]::IsNullOrWhiteSpace($command)) { return $null }
    if ($command -notmatch $TestRunnerPattern) { return $null }
    if ($command -match $TargetedPattern) { return 'targeted' }
    return 'full'
}

function Test-OutputFailed([string]$text) {
    if ([string]::IsNullOrWhiteSpace($text)) { return $false }
    # Se saca "0 failed" antes de buscar el patron de fallo, si no todo GREEN
    # que reporta su contador cae como RED.
    $clean = [regex]::Replace($text, $ZeroFailPattern, '')
    return [bool]($clean -match $FailurePattern)
}

# --- lectura y agregacion ---------------------------------------------------

function Read-Rows([string]$root) {
    $path = Get-LogPath $root
    if (-not (Test-Path -LiteralPath $path)) { return ,@() }
    $rows = @()
    foreach ($line in (Get-Content -LiteralPath $path)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $rows += ($line | ConvertFrom-Json) } catch { }
    }
    return ,$rows
}

# Duraciones por agente. Se usa duration_s del propio evento cuando esta (es
# exacto, viene del payload); si falta se cae a emparejar FIFO con el
# spawn_start abierto mas viejo, que con spawns paralelos del mismo tipo es
# aproximado.
function Get-Durations($rows) {
    $durations = @{}
    $open = @{}
    foreach ($r in ($rows | Where-Object { $_.event -in @('spawn_start','spawn_end') })) {
        $a = [string]$r.agent
        if (-not $open.ContainsKey($a)) { $open[$a] = [System.Collections.ArrayList]::new() }
        if (-not $durations.ContainsKey($a)) { $durations[$a] = @() }

        if ($r.event -eq 'spawn_start') {
            [void]$open[$a].Add([string]$r.ts)
            continue
        }
        if ($null -ne $r.duration_s) {
            $durations[$a] += [double]$r.duration_s
            if ($open[$a].Count) { $open[$a].RemoveAt(0) }
            continue
        }
        if ($open[$a].Count) {
            try {
                $d = ([datetime]$r.ts - [datetime]$open[$a][0]).TotalSeconds
                if ($d -ge 0) { $durations[$a] += $d }
            } catch { }
            $open[$a].RemoveAt(0)
        }
    }
    return $durations
}

# --- modo reporte -----------------------------------------------------------

function Show-Report([string]$root) {
    $path = Get-LogPath $root
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Output "Sin datos en $path"
        return
    }

    $rows = Read-Rows $root
    if ($rows.Count -eq 0) { Write-Output 'Sin entradas legibles.'; return }

    $stamps = $rows | ForEach-Object { try { [datetime]$_.ts } catch { } } | Sort-Object
    $spawnEnd = @($rows | Where-Object { $_.event -eq 'spawn_end' })
    $suites   = @($rows | Where-Object { $_.event -eq 'test_run' })
    # Las delegaciones a Codex son las que escribe el wrapper: no llevan 'event'.
    $codex    = @($rows | Where-Object { -not $_.event -and $_.role })

    Write-Output ''
    Write-Output "Orquestador - metricas de $root"
    Write-Output ('-' * 52)
    if ($stamps.Count -ge 2) {
        $span = $stamps[-1] - $stamps[0]
        Write-Output ("ventana observada        {0:N1} h ({1} entradas)" -f $span.TotalHours, $rows.Count)
    }

    $durations = Get-Durations $rows

    Write-Output ''
    Write-Output "delegaciones Claude      $($spawnEnd.Count)"
    foreach ($g in ($spawnEnd | Group-Object agent | Sort-Object Count -Descending)) {
        $d = $durations[$g.Name]
        $avg = if ($d -and $d.Count) { '{0:N0} s prom' -f (($d | Measure-Object -Average).Average) } else { 'sin duracion' }
        Write-Output ("  {0,-20} {1,3}   {2}" -f $g.Name, $g.Count, $avg)
    }

    Write-Output ''
    Write-Output "delegaciones Codex       $($codex.Count)"
    if ($codex.Count) {
        foreach ($g in ($codex | Group-Object role | Sort-Object Count -Descending)) {
            Write-Output ("  {0,-20} {1,3}" -f $g.Name, $g.Count)
        }
        $needs   = @($codex | Where-Object { $_.status -eq 'NEEDS_INFO' }).Count
        $retries = @($codex | Where-Object { $_.retry_of }).Count
        $clar    = @($codex | Where-Object { $_.clarify_of }).Count
        $reused  = @($codex | Where-Object { $_.reused -eq $true }).Count
        $find    = ($codex | Measure-Object findings -Sum).Sum
        Write-Output ("  NEEDS_INFO {0} | retries {1} | aclaraciones {2} | sesiones reusadas {3} | findings {4}" -f `
            $needs, $retries, $clar, $reused, $find)
    }

    Write-Output ''
    $full = @($suites | Where-Object { $_.scope -eq 'full' }).Count
    $tgt  = @($suites | Where-Object { $_.scope -eq 'targeted' }).Count
    $red  = @($suites | Where-Object { $_.result -eq 'RED' }).Count
    $fullSec = ($suites | Where-Object { $_.scope -eq 'full' -and $null -ne $_.duration_s } |
                Measure-Object duration_s -Sum).Sum
    Write-Output "suites completas         $full$(if ($fullSec) { ' ({0:N0} s en total)' -f $fullSec })"
    Write-Output "suites dirigidas         $tgt"
    Write-Output "corridas en RED          $red de $($suites.Count)"
    if ($full -gt $tgt -and $suites.Count -gt 4) {
        Write-Output '  ^ mas suites completas que dirigidas: revisar la verify ladder por alcance'
    }

    $friction = @($rows | Where-Object { $_.event -eq 'friction' })
    Write-Output ''
    Write-Output "fricciones registradas   $($friction.Count)"
    foreach ($g in ($friction | Group-Object kind | Sort-Object Count -Descending)) {
        Write-Output ("  {0,-24} {1,3}" -f $g.Name, $g.Count)
    }

    Write-Output ''
    Write-Output 'tokens de subagentes     (no observable por hooks: solo del lado Codex)'
    Write-Output ''
}

# --- modo feedback ----------------------------------------------------------
#
# Genera el informe de cierre con la forma de FEEDBACK-ORQUESTADOR.md: los
# numeros salen del log, y las fricciones registradas dicen por que. Lo que el
# log no puede saber lo deja como pregunta abierta en vez de inventarlo.

function Show-Feedback([string]$root) {
    $rows = Read-Rows $root
    if ($rows.Count -eq 0) { Write-Output "Sin datos en $(Get-LogPath $root)"; return }

    $spawns   = @($rows | Where-Object { $_.event -eq 'spawn_end' })
    $suites   = @($rows | Where-Object { $_.event -eq 'test_run' })
    $friction = @($rows | Where-Object { $_.event -eq 'friction' })
    $codex    = @($rows | Where-Object { -not $_.event -and $_.role })
    $durations = Get-Durations $rows

    $waited = 0.0
    foreach ($k in $durations.Keys) { $waited += (($durations[$k]) | Measure-Object -Sum).Sum }
    $suiteSec = ($suites | Where-Object { $null -ne $_.duration_s } | Measure-Object duration_s -Sum).Sum

    Write-Output '# Feedback de sesion'
    Write-Output ''
    Write-Output ('Generado el {0} sobre {1}.' -f (Get-Date).ToString('yyyy-MM-dd HH:mm'), $root)
    Write-Output ''
    Write-Output '## Los numeros'
    Write-Output ''
    Write-Output ("- Delegaciones: {0} a subagentes Claude, {1} a Codex." -f $spawns.Count, $codex.Count)
    if ($waited -gt 0) {
        Write-Output ("- Tiempo esperando agentes: {0:N0} min." -f ($waited / 60))
    }
    Write-Output ("- Suites: {0} completas, {1} dirigidas{2}." -f `
        @($suites | Where-Object { $_.scope -eq 'full' }).Count,
        @($suites | Where-Object { $_.scope -eq 'targeted' }).Count,
        $(if ($suiteSec) { ', {0:N0} min de ejecucion' -f ($suiteSec / 60) } else { '' }))
    Write-Output ("- Corridas en RED: {0} de {1}." -f `
        @($suites | Where-Object { $_.result -eq 'RED' }).Count, $suites.Count)
    if ($codex.Count) {
        Write-Output ("- Codex: {0} NEEDS_INFO, {1} retries, {2} findings." -f `
            @($codex | Where-Object { $_.status -eq 'NEEDS_INFO' }).Count,
            @($codex | Where-Object { $_.retry_of }).Count,
            ($codex | Measure-Object findings -Sum).Sum)
    }

    Write-Output ''
    Write-Output '## Donde se fue el tiempo evitable'
    Write-Output ''
    if ($friction.Count -eq 0) {
        Write-Output 'No se registro ninguna friccion. O la sesion salio limpia, o no se'
        Write-Output 'anotaron las fricciones en el momento (`-Note`), que es lo mas probable'
        Write-Output 'si hubo trabajo descartado o defectos encontrados al revisar el diff.'
    } else {
        foreach ($g in ($friction | Group-Object kind | Sort-Object Count -Descending)) {
            Write-Output ("### {0} ({1})" -f $g.Name, $g.Count)
            foreach ($f in $g.Group) {
                $ph = if ($f.phase) { " [$($f.phase)]" } else { '' }
                Write-Output ("- {0}{1}" -f $(if ($f.detail) { $f.detail } else { '(sin detalle)' }), $ph)
            }
            Write-Output ''
        }
    }

    Write-Output '## Delegaciones, una por una'
    Write-Output ''
    Write-Output '| Agente | Tarea | Duracion |'
    Write-Output '|---|---|---|'
    foreach ($s in $spawns) {
        $d = if ($null -ne $s.duration_s) { '{0:N0} s' -f $s.duration_s } else { '-' }
        Write-Output ("| {0} | {1} | {2} |" -f $s.agent, $s.task, $d)
    }
    foreach ($c in $codex) {
        Write-Output ("| codex:{0} | {1} | - |" -f $c.role, $c.task)
    }

    Write-Output ''
    Write-Output '## Lo que el log no sabe'
    Write-Output ''
    Write-Output '- Cual de estas delegaciones valio lo que costo.'
    Write-Output '- Que defectos encontro la revision del diff y de que familia eran.'
    Write-Output '- Que regla del orquestador los habria evitado.'
    Write-Output ''
    Write-Output 'Eso lo contesta el orquestador al cerrar, y es la parte que sirve.'
    Write-Output ''
}

# --- modo hook --------------------------------------------------------------

try {
    if ($Note) {
        Write-Metric ([ordered]@{
            ts     = (Get-Date).ToString('o')
            event  = 'friction'
            kind   = $Note
            phase  = $Phase
            detail = $Detail
        }) $Repo
        Write-Output "friccion registrada: $Note"
        exit 0
    }
    if ($Feedback) { Show-Feedback $Repo; exit 0 }
    if ($Report)   { Show-Report $Repo;   exit 0 }

    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { Write-Output '{}'; exit 0 }

    $ev = $raw | ConvertFrom-Json
    $root = if ($ev.cwd) { [string]$ev.cwd } else { $Repo }
    $now = (Get-Date).ToString('o')

    switch ([string]$ev.tool_name) {
        'Agent' {
            $agent = [string]$ev.tool_input.subagent_type
            if ([string]::IsNullOrWhiteSpace($agent)) { $agent = 'general-purpose' }

            if ($ev.hook_event_name -eq 'PreToolUse') {
                Write-Metric ([ordered]@{
                    ts          = $now
                    event       = 'spawn_start'
                    agent       = $agent
                    task        = [string]$ev.tool_input.description
                    isolation   = [string]$ev.tool_input.isolation
                    tool_use_id = [string]$ev.tool_use_id
                    prompt_id   = [string]$ev.prompt_id
                    session     = [string]$ev.session_id
                }) $root
            }
            elseif ($ev.hook_event_name -eq 'PostToolUse') {
                # duration_ms viene en el payload de PostToolUse (verificado
                # contra un evento real de Bash). Cuando esta, la duracion es
                # exacta y el reporte no tiene que emparejar nada.
                $entry = [ordered]@{
                    ts          = $now
                    event       = 'spawn_end'
                    agent       = $agent
                    task        = [string]$ev.tool_input.description
                    tool_use_id = [string]$ev.tool_use_id
                    prompt_id   = [string]$ev.prompt_id
                    session     = [string]$ev.session_id
                }
                if ($null -ne $ev.duration_ms) {
                    $entry['duration_s'] = [math]::Round(([double]$ev.duration_ms) / 1000, 1)
                }
                Write-Metric $entry $root
            }
        }
        'Bash' {
            if ($ev.hook_event_name -eq 'PostToolUse') {
                $scope = Get-TestScope ([string]$ev.tool_input.command)
                if ($scope) {
                    $out = [string]$ev.tool_response.stdout + "`n" + [string]$ev.tool_response.stderr
                    $entry = [ordered]@{
                        ts      = $now
                        event   = 'test_run'
                        scope   = $scope
                        result  = if (Test-OutputFailed $out) { 'RED' } else { 'GREEN' }
                        command = [string]$ev.tool_input.command
                        prompt_id = [string]$ev.prompt_id
                        session = [string]$ev.session_id
                    }
                    if ($null -ne $ev.duration_ms) {
                        $entry['duration_s'] = [math]::Round(([double]$ev.duration_ms) / 1000, 1)
                    }
                    Write-Metric $entry $root
                }
            }
        }
    }

    Write-Output '{}'
    exit 0
}
catch {
    # Un fallo de la metrica jamas debe frenar el trabajo real.
    Write-Output '{}'
    exit 0
}
