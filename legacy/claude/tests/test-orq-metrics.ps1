<#
  Tests de hooks/orq-metrics.ps1.

  Lo que importa verificar es exactamente lo que puede romper el trabajo real:
  que clasifique bien, que registre lo que dice registrar, y sobre todo que
  NUNCA tire ni bloquee, porque corre en PostToolUse sobre cada Bash.
#>
$ErrorActionPreference = 'Stop'

$Hook = Join-Path $PSScriptRoot '..\hooks\orq-metrics.ps1'
$Hook = (Resolve-Path -LiteralPath $Hook).ProviderPath

$script:Ok = 0
$script:Fail = 0

function Test-Case([string]$name, [scriptblock]$body) {
    try {
        & $body
        Write-Host "[OK] $name"
        $script:Ok++
    } catch {
        Write-Host "[FAIL] $name -> $($_.Exception.Message)"
        $script:Fail++
    }
}

function Assert([bool]$cond, [string]$msg) {
    if (-not $cond) { throw $msg }
}

function New-Sandbox {
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) ("orqm-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    return $dir
}

# Invoca el hook como lo invoca Claude Code: JSON por stdin.
function Invoke-Hook([string]$json) {
    $tmp = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
    try {
        # PowerShell 5.1 no tiene redireccion de stdin ('<'), asi que el evento
        # se le pasa al hook via cmd, que es lo mas parecido a como lo invoca
        # Claude Code.
        $out = & cmd /c "powershell -NoProfile -ExecutionPolicy Bypass -File `"$Hook`" < `"$tmp`"" 2>&1
        return @{ Out = ($out -join "`n"); Code = $LASTEXITCODE }
    } finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

function Get-Entries([string]$root) {
    $path = Join-Path $root '.orquestador\decisions.jsonl'
    # La coma es necesaria: `return` desenvuelve un array de un solo elemento y
    # `.Count` quedaria vacio justo en el caso de una sola entrada.
    if (-not (Test-Path -LiteralPath $path)) { return ,@() }
    return ,@(Get-Content -LiteralPath $path |
              Where-Object { $_.Trim() } |
              ForEach-Object { $_ | ConvertFrom-Json })
}

# --- clasificacion de comandos ----------------------------------------------
#
# El hook se prueba de punta a punta por proceso, no por dot-source: ejecuta al
# cargarse, y ademas asi se verifica el exit code, que es la mitad del contrato.

Test-Case 'suite completa se clasifica full' {
    $root = New-Sandbox
    $ev = @{ hook_event_name = 'PostToolUse'; tool_name = 'Bash'; cwd = $root
             session_id = 's1'; tool_input = @{ command = 'npm test' } } | ConvertTo-Json -Depth 5 -Compress
    $r = Invoke-Hook $ev
    Assert ($r.Code -eq 0) "exit fue $($r.Code)"
    $e = Get-Entries $root
    Assert ($e.Count -eq 1) "esperaba 1 entrada, hubo $($e.Count)"
    Assert ($e[0].event -eq 'test_run') "event fue $($e[0].event)"
    Assert ($e[0].scope -eq 'full') "scope fue $($e[0].scope)"
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Test-Case 'pytest con archivo se clasifica targeted' {
    $root = New-Sandbox
    $ev = @{ hook_event_name = 'PostToolUse'; tool_name = 'Bash'; cwd = $root
             session_id = 's1'; tool_input = @{ command = './.venv/Scripts/python.exe -m pytest tests/test_extractor.py' } } |
          ConvertTo-Json -Depth 5 -Compress
    $r = Invoke-Hook $ev
    $e = Get-Entries $root
    Assert ($e.Count -eq 1) "esperaba 1 entrada, hubo $($e.Count)"
    Assert ($e[0].scope -eq 'targeted') "scope fue $($e[0].scope)"
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Test-Case 'pytest con -k se clasifica targeted' {
    $root = New-Sandbox
    $ev = @{ hook_event_name = 'PostToolUse'; tool_name = 'Bash'; cwd = $root
             session_id = 's1'; tool_input = @{ command = 'pytest -k impuestos' } } | ConvertTo-Json -Depth 5 -Compress
    Invoke-Hook $ev | Out-Null
    $e = Get-Entries $root
    Assert ($e.Count -eq 1) "esperaba 1 entrada, hubo $($e.Count)"
    Assert ($e[0].scope -eq 'targeted') "scope fue $($e[0].scope)"
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Test-Case 'un comando que no corre tests no registra nada' {
    $root = New-Sandbox
    $ev = @{ hook_event_name = 'PostToolUse'; tool_name = 'Bash'; cwd = $root
             session_id = 's1'; tool_input = @{ command = 'git status' } } | ConvertTo-Json -Depth 5 -Compress
    $r = Invoke-Hook $ev
    Assert ($r.Code -eq 0) "exit fue $($r.Code)"
    Assert ((Get-Entries $root).Count -eq 0) 'no deberia haber registrado nada'
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Test-Case 'el nombre del proyecto no se confunde con un runner' {
    $root = New-Sandbox
    $ev = @{ hook_event_name = 'PostToolUse'; tool_name = 'Bash'; cwd = $root
             session_id = 's1'; tool_input = @{ command = 'cat docs/testing-guide.md' } } | ConvertTo-Json -Depth 5 -Compress
    Invoke-Hook $ev | Out-Null
    Assert ((Get-Entries $root).Count -eq 0) 'un path que contiene "test" no es una corrida'
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

# --- spawns de subagentes ---------------------------------------------------

Test-Case 'PreToolUse sobre Agent registra el rol' {
    $root = New-Sandbox
    $ev = @{ hook_event_name = 'PreToolUse'; tool_name = 'Agent'; cwd = $root; session_id = 's1'
             tool_input = @{ subagent_type = 'tester'; description = 'RED de impuestos' } } |
          ConvertTo-Json -Depth 5 -Compress
    Invoke-Hook $ev | Out-Null
    $e = Get-Entries $root
    Assert ($e.Count -eq 1) "esperaba 1 entrada, hubo $($e.Count)"
    Assert ($e[0].event -eq 'spawn_start') "event fue $($e[0].event)"
    Assert ($e[0].agent -eq 'tester') "agent fue $($e[0].agent)"
    Assert ($e[0].task -eq 'RED de impuestos') "task fue $($e[0].task)"
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Test-Case 'un Agent sin subagent_type cae en general-purpose' {
    $root = New-Sandbox
    $ev = @{ hook_event_name = 'PreToolUse'; tool_name = 'Agent'; cwd = $root; session_id = 's1'
             tool_input = @{ description = 'algo' } } | ConvertTo-Json -Depth 5 -Compress
    Invoke-Hook $ev | Out-Null
    $e = Get-Entries $root
    Assert ($e[0].agent -eq 'general-purpose') "agent fue $($e[0].agent)"
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Test-Case 'start y end quedan como dos entradas emparejables' {
    $root = New-Sandbox
    $pre = @{ hook_event_name = 'PreToolUse'; tool_name = 'Agent'; cwd = $root; session_id = 's1'
              tool_input = @{ subagent_type = 'constructor'; description = 'x' } } | ConvertTo-Json -Depth 5 -Compress
    $post = @{ hook_event_name = 'PostToolUse'; tool_name = 'Agent'; cwd = $root; session_id = 's1'
               tool_input = @{ subagent_type = 'constructor'; description = 'x' } } | ConvertTo-Json -Depth 5 -Compress
    Invoke-Hook $pre | Out-Null
    Invoke-Hook $post | Out-Null
    $e = Get-Entries $root
    Assert ($e.Count -eq 2) "esperaba 2 entradas, hubo $($e.Count)"
    Assert ($e[0].event -eq 'spawn_start' -and $e[1].event -eq 'spawn_end') 'orden incorrecto'
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

# --- el invariante que mas importa: no romper nada --------------------------

Test-Case 'JSON malformado no tira y sale con 0' {
    $r = Invoke-Hook '{ esto no es json'
    Assert ($r.Code -eq 0) "exit fue $($r.Code)"
    Assert ($r.Out -match '\{\}') "no emitio {} : $($r.Out)"
}

Test-Case 'stdin vacio no tira y sale con 0' {
    $r = Invoke-Hook ''
    Assert ($r.Code -eq 0) "exit fue $($r.Code)"
}

Test-Case 'un evento sin tool_input no tira' {
    $root = New-Sandbox
    $ev = @{ hook_event_name = 'PostToolUse'; tool_name = 'Bash'; cwd = $root; session_id = 's1' } |
          ConvertTo-Json -Depth 5 -Compress
    $r = Invoke-Hook $ev
    Assert ($r.Code -eq 0) "exit fue $($r.Code)"
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Test-Case 'un cwd inexistente no tira' {
    $ev = @{ hook_event_name = 'PostToolUse'; tool_name = 'Bash'
             cwd = 'Z:\no\existe\nada'; session_id = 's1'
             tool_input = @{ command = 'npm test' } } | ConvertTo-Json -Depth 5 -Compress
    $r = Invoke-Hook $ev
    Assert ($r.Code -eq 0) "exit fue $($r.Code)"
}

Test-Case 'una herramienta ajena se ignora en silencio' {
    $root = New-Sandbox
    $ev = @{ hook_event_name = 'PostToolUse'; tool_name = 'Read'; cwd = $root; session_id = 's1'
             tool_input = @{ file_path = 'x.md' } } | ConvertTo-Json -Depth 5 -Compress
    $r = Invoke-Hook $ev
    Assert ($r.Code -eq 0) "exit fue $($r.Code)"
    Assert ((Get-Entries $root).Count -eq 0) 'no deberia registrar herramientas ajenas'
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

# --- reporte ----------------------------------------------------------------

Test-Case 'el reporte corre sobre un log mixto sin tirar' {
    $root = New-Sandbox
    New-Item -ItemType Directory -Force -Path (Join-Path $root '.orquestador') | Out-Null
    $log = Join-Path $root '.orquestador\decisions.jsonl'
    @(
        '{"ts":"2026-08-28T10:00:00.0000000-03:00","event":"spawn_start","agent":"tester","task":"x"}',
        '{"ts":"2026-08-28T10:03:00.0000000-03:00","event":"spawn_end","agent":"tester","task":"x"}',
        '{"ts":"2026-08-28T10:05:00.0000000-03:00","event":"test_run","scope":"full","command":"npm test"}',
        '{"ts":"2026-08-28T10:06:00.0000000-03:00","task":"y","role":"reviewer","findings":3,"reused":false}',
        'linea basura que no es json'
    ) | Set-Content -LiteralPath $log -Encoding UTF8

    $out = (& powershell -NoProfile -ExecutionPolicy Bypass -File $Hook -Report -Repo $root 2>&1) -join "`n"
    Assert ($LASTEXITCODE -eq 0) "exit fue $LASTEXITCODE"
    Assert ($out -match 'delegaciones Claude\s+1') "no conto el spawn: $out"
    Assert ($out -match 'delegaciones Codex\s+1') "no conto la delegacion Codex: $out"
    Assert ($out -match 'suites completas\s+1') "no conto la suite: $out"
    Assert ($out -match '180 s prom') "no calculo la duracion: $out"
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

# --- resultado y duracion de las corridas -----------------------------------

Test-Case 'una corrida con fallas se marca RED' {
    $root = New-Sandbox
    $ev = @{ hook_event_name = 'PostToolUse'; tool_name = 'Bash'; cwd = $root; session_id = 's1'
             duration_ms = 94000
             tool_input = @{ command = 'npm test' }
             tool_response = @{ stdout = 'Tests: 3 failed, 641 passed'; stderr = '' } } |
          ConvertTo-Json -Depth 5 -Compress
    Invoke-Hook $ev | Out-Null
    $e = Get-Entries $root
    Assert ($e[0].result -eq 'RED') "result fue $($e[0].result)"
    Assert ($e[0].duration_s -eq 94) "duration_s fue $($e[0].duration_s)"
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Test-Case 'una corrida limpia se marca GREEN' {
    $root = New-Sandbox
    $ev = @{ hook_event_name = 'PostToolUse'; tool_name = 'Bash'; cwd = $root; session_id = 's1'
             tool_input = @{ command = 'npm test' }
             tool_response = @{ stdout = 'Tests: 644 passed, 0 failed'; stderr = '' } } |
          ConvertTo-Json -Depth 5 -Compress
    Invoke-Hook $ev | Out-Null
    $e = Get-Entries $root
    Assert ($e[0].result -eq 'GREEN') "un '0 failed' no puede leerse como RED, fue $($e[0].result)"
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Test-Case 'el fallo tambien se detecta en stderr' {
    $root = New-Sandbox
    $ev = @{ hook_event_name = 'PostToolUse'; tool_name = 'Bash'; cwd = $root; session_id = 's1'
             tool_input = @{ command = 'pytest tests/test_x.py' }
             tool_response = @{ stdout = ''; stderr = 'FAILED tests/test_x.py::test_total' } } |
          ConvertTo-Json -Depth 5 -Compress
    Invoke-Hook $ev | Out-Null
    $e = Get-Entries $root
    Assert ($e[0].result -eq 'RED') "result fue $($e[0].result)"
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Test-Case 'el spawn usa duration_ms del payload' {
    $root = New-Sandbox
    $ev = @{ hook_event_name = 'PostToolUse'; tool_name = 'Agent'; cwd = $root; session_id = 's1'
             duration_ms = 312000; tool_use_id = 'toolu_x'
             tool_input = @{ subagent_type = 'tester'; description = 'x' } } |
          ConvertTo-Json -Depth 5 -Compress
    Invoke-Hook $ev | Out-Null
    $e = Get-Entries $root
    Assert ($e[0].duration_s -eq 312) "duration_s fue $($e[0].duration_s)"
    Assert ($e[0].tool_use_id -eq 'toolu_x') "tool_use_id fue $($e[0].tool_use_id)"
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

# --- fricciones y feedback --------------------------------------------------

Test-Case '-Note registra una friccion' {
    $root = New-Sandbox
    & powershell -NoProfile -ExecutionPolicy Bypass -File $Hook -Note 'rework' `
        -Detail 'el tester eligio la fuente de datos sin preguntar' -Phase 'test' -Repo $root 2>&1 | Out-Null
    Assert ($LASTEXITCODE -eq 0) "exit fue $LASTEXITCODE"
    $e = Get-Entries $root
    Assert ($e.Count -eq 1) "esperaba 1 entrada, hubo $($e.Count)"
    Assert ($e[0].event -eq 'friction') "event fue $($e[0].event)"
    Assert ($e[0].kind -eq 'rework') "kind fue $($e[0].kind)"
    Assert ($e[0].phase -eq 'test') "phase fue $($e[0].phase)"
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Test-Case '-Note rechaza una categoria inventada' {
    $root = New-Sandbox
    # La evidencia es que no escribio nada: un fallo de binding de parametros no
    # propaga $LASTEXITCODE, asi que el exit code no sirve para verificar esto.
    # El stderr del hijo se baja a Continue: con 'Stop' se vuelve terminante aca
    # y el test se cae en el arrange en vez de evaluar el assert.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $err = (& powershell -NoProfile -ExecutionPolicy Bypass -File $Hook -Note 'cualquier-cosa' -Repo $root 2>&1) -join ' '
    $ErrorActionPreference = $prev
    Assert ($err -match 'validar|validate') "esperaba un error de validacion, hubo: $err"
    Assert ((Get-Entries $root).Count -eq 0) 'una categoria fuera del set no puede registrarse'
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Test-Case '-Feedback arma el informe con numeros y fricciones' {
    $root = New-Sandbox
    New-Item -ItemType Directory -Force -Path (Join-Path $root '.orquestador') | Out-Null
    @(
        '{"ts":"2026-08-28T10:00:00.0000000-03:00","event":"spawn_end","agent":"tester","task":"RED impuestos","duration_s":660}',
        '{"ts":"2026-08-28T10:15:00.0000000-03:00","event":"test_run","scope":"full","result":"RED","command":"npm test","duration_s":120}',
        '{"ts":"2026-08-28T10:20:00.0000000-03:00","event":"friction","kind":"rework","phase":"test","detail":"tabla leia el snapshot congelado"}',
        '{"ts":"2026-08-28T10:30:00.0000000-03:00","task":"refactor","role":"constructor","findings":0}'
    ) | Set-Content -LiteralPath (Join-Path $root '.orquestador\decisions.jsonl') -Encoding UTF8

    $out = (& powershell -NoProfile -ExecutionPolicy Bypass -File $Hook -Feedback -Repo $root 2>&1) -join "`n"
    Assert ($LASTEXITCODE -eq 0) "exit fue $LASTEXITCODE"
    Assert ($out -match '1 a subagentes Claude, 1 a Codex') "no conto las delegaciones: $out"
    Assert ($out -match '11 min')     "no sumo el tiempo de espera: $out"
    Assert ($out -match 'rework')     "no listo la friccion: $out"
    Assert ($out -match 'tabla leia el snapshot congelado') "no mostro el detalle: $out"
    Assert ($out -match 'Lo que el log no sabe') "falta la seccion de limites: $out"
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Test-Case '-Feedback sin fricciones lo dice en vez de declarar exito' {
    $root = New-Sandbox
    New-Item -ItemType Directory -Force -Path (Join-Path $root '.orquestador') | Out-Null
    '{"ts":"2026-08-28T10:00:00.0000000-03:00","event":"spawn_end","agent":"tester","task":"x","duration_s":10}' |
        Set-Content -LiteralPath (Join-Path $root '.orquestador\decisions.jsonl') -Encoding UTF8
    $out = (& powershell -NoProfile -ExecutionPolicy Bypass -File $Hook -Feedback -Repo $root 2>&1) -join "`n"
    Assert ($out -match 'no se anotaron las fricciones|No se registro ninguna friccion') `
           "un log sin fricciones no es prueba de que no las hubo: $out"
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Test-Case 'el reporte sobre un repo sin log no tira' {
    $root = New-Sandbox
    $out = (& powershell -NoProfile -ExecutionPolicy Bypass -File $Hook -Report -Repo $root 2>&1) -join "`n"
    Assert ($LASTEXITCODE -eq 0) "exit fue $LASTEXITCODE"
    Assert ($out -match 'Sin datos|Sin entradas') "salida inesperada: $out"
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$script:Ok OK, $script:Fail FAIL"
if ($script:Fail -gt 0) { exit 1 }
