[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Failures = New-Object System.Collections.Generic.List[string]
$Checks = 0

function Check {
    param([bool]$Condition, [string]$Message)
    $script:Checks++
    if ($Condition) { Write-Host "[OK] $Message" -ForegroundColor Green }
    else { Write-Host "[FAIL] $Message" -ForegroundColor Red; $Failures.Add($Message) }
}

$previousCodexHome = $env:CODEX_HOME
$testRoot = Join-Path $env:TEMP ("test-codex-run-" + [guid]::NewGuid().ToString('N'))
$env:CODEX_HOME = $testRoot # CodexHome is resolved while codex-run.ps1 is dot-sourced.

try {
    . (Join-Path $PSScriptRoot '..\scripts\codex-run.ps1')

    # ------------------------- degradacion sin codex instalado (en proceso) ---
    # Get-CodexCommand debe devolver null en vez de tirar cuando codex no esta
    # en el PATH: hoy hace throw a nivel de script y mata -BudgetOnly, -QuotaCache
    # y hasta el dot-source de esta misma suite.
    $previousPathForNoCodex = $env:PATH
    $env:PATH = 'C:\Windows\System32'
    try {
        $threw = $false
        $cmdResult = 'unset'
        try { $cmdResult = Get-CodexCommand } catch { $threw = $true }
        Check ((-not $threw) -and ($null -eq $cmdResult)) 'Get-CodexCommand devuelve null en vez de tirar cuando codex no esta en el PATH'
    } finally {
        $env:PATH = $previousPathForNoCodex
    }

    # Get-CodexQuota no debe intentar lanzar el proceso cuando CodexCmd es null.
    # Proxy observable: hoy Process.Start con FileName vacio tira una excepcion
    # .NET que SI queda registrada en $Error aunque el catch la absorba; con el
    # guard nuevo la funcion vuelve antes de tocar ProcessStartInfo y $Error
    # queda limpio.
    $previousCodexCmdForQuota = $script:CodexCmd
    $script:CodexCmd = $null
    $Error.Clear()
    $quotaResult = 'unset'
    $quotaThrew = $false
    try { $quotaResult = Get-CodexQuota } catch { $quotaThrew = $true }
    Check ((-not $quotaThrew) -and ($null -eq $quotaResult)) 'Get-CodexQuota devuelve null cuando CodexCmd es null'
    Check ($Error.Count -eq 0) 'Get-CodexQuota no intenta lanzar el proceso cuando CodexCmd es null'
    $script:CodexCmd = $previousCodexCmdForQuota

    Check ((ConvertTo-CmdArg '') -eq '""') 'ConvertTo-CmdArg quotes an empty argument'
    Check ((ConvertTo-CmdArg 'abc') -eq 'abc') 'ConvertTo-CmdArg leaves a simple argument unquoted'
    Check ((ConvertTo-CmdArg 'a b') -eq '"a b"') 'ConvertTo-CmdArg quotes an argument with whitespace'
    Check ((ConvertTo-CmdArg 'a"b') -eq '"a\"b"') 'ConvertTo-CmdArg escapes an internal double quote'
    Check ((ConvertTo-CmdArg 'a b\') -eq '"a b\\"') 'ConvertTo-CmdArg doubles trailing backslashes before the closing quote'
    Check ((ConvertTo-CmdArg 'a\"b') -eq '"a\\\"b"') 'ConvertTo-CmdArg doubles backslashes before an internal double quote'

    Check ($null -eq (Get-FreePercent $null)) 'Get-FreePercent returns null without a response'
    $noUsage = '{"rateLimits":{"primary":{}}}' | ConvertFrom-Json
    Check ($null -eq (Get-FreePercent $noUsage)) 'Get-FreePercent returns null without usedPercent'
    $primaryOnly = '{"rateLimits":{"primary":{"usedPercent":30}}}' | ConvertFrom-Json
    Check ((Get-FreePercent $primaryOnly) -eq 70) 'Get-FreePercent calculates free capacity from primary'
    $twoWindows = '{"rateLimits":{"primary":{"usedPercent":30},"secondary":{"usedPercent":80}}}' | ConvertFrom-Json
    Check ((Get-FreePercent $twoWindows) -eq 20) 'Get-FreePercent selects the tightest primary or secondary window'
    $limitIdWins = '{"rateLimits":{"primary":{"usedPercent":30}},"rateLimitsByLimitId":{"other":{"secondary":{"usedPercent":90}}}}' | ConvertFrom-Json
    Check ((Get-FreePercent $limitIdWins) -eq 10) 'Get-FreePercent selects the tightest window across limit IDs'

    $script:TestCodexQuota = $null
    $script:TestClaudeQuota = $null
    function Get-CodexQuota { return $script:TestCodexQuota }
    function Get-ClaudeQuota { return $script:TestClaudeQuota }

    # ------------------------- degradacion sin codex instalado: veredicto ---
    # Rama propia y distinta del WARN "no se pudo leer la cuota": el NO-GO por
    # falta de binario tiene que ganarle incluso a una cuota que leeria GO, para
    # probar que la prioridad es la correcta y no una coincidencia con el mock.
    $previousCodexCmdForVerdict = $script:CodexCmd
    $script:CodexCmd = $null
    $script:TestCodexQuota = '{"rateLimits":{"primary":{"usedPercent":10}}}' | ConvertFrom-Json
    $script:TestClaudeQuota = '{"five_hour":{"utilization":10}}' | ConvertFrom-Json
    $vSinCodexFresco = Get-CodexVerdict
    Check ($vSinCodexFresco.Decision -eq 'NO-GO') 'Get-CodexVerdict da NO-GO cuando codex no esta instalado, aunque la cuota (mockeada) fuera GO'
    Check ($vSinCodexFresco.Reason -match 'instalado') 'Get-CodexVerdict explica el NO-GO por codex no instalado, distinto del WARN de cuota ilegible'

    Add-CapacityState $vSinCodexFresco
    Check ($vSinCodexFresco.State -eq 'CLAUDE-LEAD') 'Sin codex instalado y Claude fresco: Add-CapacityState enruta a CLAUDE-LEAD'

    $script:TestClaudeQuota = '{"five_hour":{"utilization":95}}' | ConvertFrom-Json
    $vSinCodexCritico = Get-CodexVerdict
    Add-CapacityState $vSinCodexCritico
    Check ($vSinCodexCritico.State -eq 'SURVIVAL') 'Sin codex instalado y Claude critico: Add-CapacityState enruta a SURVIVAL'

    $script:TestClaudeQuota = $null
    $script:CodexCmd = $previousCodexCmdForVerdict

    $script:TestCodexQuota = '{"rateLimits":{"spendControlReached":true,"primary":{"usedPercent":0}}}' | ConvertFrom-Json
    Check ((Get-BudgetVerdict).Decision -eq 'NO-GO') 'Get-BudgetVerdict rejects reached spend control'
    $script:TestCodexQuota = '{"rateLimits":{"primary":{"usedPercent":95}}}' | ConvertFrom-Json
    Check ((Get-BudgetVerdict).Decision -eq 'NO-GO') 'Get-BudgetVerdict rejects free capacity below the minimum'
    $script:TestCodexQuota = '{"rateLimits":{"primary":{"usedPercent":85}}}' | ConvertFrom-Json
    Check ((Get-BudgetVerdict).Decision -eq 'WARN') 'Get-BudgetVerdict warns at 15 percent free'
    $script:TestCodexQuota = '{"rateLimits":{"primary":{"usedPercent":70}}}' | ConvertFrom-Json
    $verdict = Get-BudgetVerdict
    Check (($verdict.Decision -eq 'GO') -and (-not $verdict.AllowHeavy)) 'Get-BudgetVerdict allows only direct work at 30 percent free'
    $script:TestCodexQuota = '{"rateLimits":{"primary":{"usedPercent":40}}}' | ConvertFrom-Json
    $verdict = Get-BudgetVerdict
    Check (($verdict.Decision -eq 'GO') -and $verdict.AllowHeavy) 'Get-BudgetVerdict allows heavy work at 60 percent free'
    # Bordes exactos de los tres umbrales. Sin estos, mover un umbral unos puntos
    # no rompe ningun test: los casos redondos de arriba quedan demasiado lejos.
    foreach ($edge in @(
        @{ Used = 90;   Decision = 'WARN';  Heavy = $false; Name = 'exactamente 10 por ciento libre' },
        @{ Used = 90.5; Decision = 'NO-GO'; Heavy = $false; Name = 'apenas por debajo de 10 por ciento libre' },
        @{ Used = 80;   Decision = 'GO';    Heavy = $false; Name = 'exactamente 20 por ciento libre' },
        @{ Used = 80.5; Decision = 'WARN';  Heavy = $false; Name = 'apenas por debajo de 20 por ciento libre' },
        @{ Used = 60;   Decision = 'GO';    Heavy = $true;  Name = 'exactamente 40 por ciento libre' },
        @{ Used = 60.5; Decision = 'GO';    Heavy = $false; Name = 'apenas por debajo de 40 por ciento libre' }
    )) {
        $script:TestCodexQuota = ('{"rateLimits":{"primary":{"usedPercent":' + $edge.Used + '}}}') | ConvertFrom-Json
        $v = Get-BudgetVerdict
        Check (($v.Decision -eq $edge.Decision) -and ([bool]$v.AllowHeavy -eq $edge.Heavy)) `
              ("Get-BudgetVerdict en el borde: " + $edge.Name + " -> " + $edge.Decision)
    }

    $script:TestCodexQuota = $null
    Check ((Get-BudgetVerdict).Decision -eq 'WARN') 'Get-BudgetVerdict warns when Codex quota is unavailable'
    $script:TestCodexQuota = '{"rateLimits":{"primary":{"usedPercent":40}}}' | ConvertFrom-Json
    $script:TestClaudeQuota = '{"five_hour":{"utilization":90}}' | ConvertFrom-Json
    Check ((Get-BudgetVerdict).Reason -match 'empujar trabajo a Codex') 'Get-BudgetVerdict recommends Codex under Claude five-hour pressure'
    $script:TestClaudeQuota = $null

    # ------------------------------------------- capa 2: estado de capacidad ---
    # Los checks de arriba fijan la capa 1 (veredicto de Codex) y no se tocan:
    # son la prueba de que agregar el estado no la movio.

    function Get-StateFor {
        param([double]$CodexUsed, $FiveHour, $SevenDay, [switch]$NoCodex)
        $script:TestCodexQuota = if ($NoCodex) { $null } else {
            ('{"rateLimits":{"primary":{"usedPercent":' + $CodexUsed + '}}}') | ConvertFrom-Json
        }
        $script:TestClaudeQuota = if ($null -eq $FiveHour) { $null } else {
            $sd = if ($null -eq $SevenDay) { 'null' } else { '{"utilization":' + $SevenDay + '}' }
            ('{"five_hour":{"utilization":' + $FiveHour + '},"seven_day":' + $sd + '}') | ConvertFrom-Json
        }
        return Get-BudgetVerdict
    }

    # Las 8 reglas de precedencia en su caso central.
    # Codex usado 30 => 70% libre => GO normal. Usado 85 => 15% => WARN.
    # Usado 95 => 5% => NO-GO.
    foreach ($case in @(
        @{ Cx = 30; H5 = 20; State = 'BALANCED';        Name = 'regla 8: ambos con margen' },
        @{ Cx = 30; H5 = 60; State = 'CODEX-PREFERRED'; Name = 'regla 6: Claude presionado y Codex GO' },
        @{ Cx = 30; H5 = 75; State = 'SONNET-LEAD';     Name = 'regla 5: Claude apretado y Codex GO' },
        @{ Cx = 30; H5 = 95; State = 'SONNET-LEAD';     Name = 'regla 4: Claude critico y Codex GO' },
        @{ Cx = 95; H5 = 20; State = 'CLAUDE-LEAD';     Name = 'regla 3: Codex NO-GO' },
        @{ Cx = 95; H5 = 95; State = 'SURVIVAL';        Name = 'regla 2: Claude critico y Codex NO-GO' },
        @{ Cx = 85; H5 = 95; State = 'SURVIVAL';        Name = 'regla 2: Claude critico y Codex WARN' },
        @{ Cx = 85; H5 = 20; State = 'CLAUDE-LEAD';     Name = 'regla 7: Codex WARN sin Claude critico' }
    )) {
        $v = Get-StateFor -CodexUsed $case.Cx -FiveHour $case.H5 -SevenDay 10
        Check ($v.State -eq $case.State) ("Estado - " + $case.Name + " -> " + $case.State)
    }

    # Precedencia real: los pares donde dos reglas podrian aplicar y el orden decide.
    $v = Get-StateFor -CodexUsed 95 -FiveHour 95 -SevenDay 10
    Check ($v.State -eq 'SURVIVAL') 'Precedencia: critico + NO-GO da SURVIVAL (regla 2, no la 3)'
    $v = Get-StateFor -CodexUsed 30 -FiveHour 95 -SevenDay 10
    Check ($v.State -eq 'SONNET-LEAD') 'Precedencia: critico + GO da SONNET-LEAD (regla 4, no la 2)'
    $v = Get-StateFor -CodexUsed 85 -FiveHour 60 -SevenDay 10
    Check ($v.State -eq 'CLAUDE-LEAD') 'Precedencia: presionado + WARN da CLAUDE-LEAD (regla 7, no la 6)'
    $v = Get-StateFor -CodexUsed 85 -FiveHour 75 -SevenDay 10
    Check ($v.State -eq 'CLAUDE-LEAD') 'Precedencia: apretado + WARN da CLAUDE-LEAD (regla 7, no la 5)'

    # Las dos capas se componen: el estado dice quien ejecuta, AllowHeavy sigue
    # vetando el volumen. Codex usado 70 => 30% libre => GO acotado.
    $v = Get-StateFor -CodexUsed 70 -FiveHour 60 -SevenDay 10
    Check (($v.State -eq 'CODEX-PREFERRED') -and (-not $v.AllowHeavy)) `
          'Composicion: presionado + GO acotado da CODEX-PREFERRED sin AllowHeavy'
    Check ($v.StateReason -match 'acotado') 'Composicion: el estado acotado se explica en StateReason'

    # Bordes exactos de los umbrales de nivel. Sin esto, mover 50/70/85 unos
    # puntos no rompe ningun test: los casos redondos quedan demasiado lejos.
    foreach ($edge in @(
        @{ H5 = 49.5; Level = 'fresco';     State = 'BALANCED';        Name = 'apenas por debajo de 50' },
        @{ H5 = 50;   Level = 'presionado'; State = 'CODEX-PREFERRED'; Name = 'exactamente 50' },
        @{ H5 = 69.5; Level = 'presionado'; State = 'CODEX-PREFERRED'; Name = 'apenas por debajo de 70' },
        @{ H5 = 70;   Level = 'apretado';   State = 'SONNET-LEAD';     Name = 'exactamente 70' },
        @{ H5 = 84.5; Level = 'apretado';   State = 'SONNET-LEAD';     Name = 'apenas por debajo de 85' },
        @{ H5 = 85;   Level = 'critico';    State = 'SONNET-LEAD';     Name = 'exactamente 85' }
    )) {
        $v = Get-StateFor -CodexUsed 30 -FiveHour $edge.H5 -SevenDay 10
        Check (($v.ClaudeLevel -eq $edge.Level) -and ($v.State -eq $edge.State)) `
              ("Borde de nivel: " + $edge.Name + " -> " + $edge.Level)
    }

    # Gate de 7 dias: sube el piso a presionado con la ventana de 5h fresca.
    $v = Get-StateFor -CodexUsed 30 -FiveHour 10 -SevenDay 80
    Check ($v.State -eq 'BALANCED') 'Gate 7d: exactamente 80 todavia no fuerza el piso'
    $v = Get-StateFor -CodexUsed 30 -FiveHour 10 -SevenDay 80.5
    Check (($v.ClaudeLevel -eq 'presionado') -and ($v.State -eq 'CODEX-PREFERRED')) `
          'Gate 7d: por encima de 80 fuerza CODEX-PREFERRED con 5h fresca'
    # El gate sube el piso, nunca lo baja.
    $v = Get-StateFor -CodexUsed 30 -FiveHour 90 -SevenDay 95
    Check ($v.ClaudeLevel -eq 'critico') 'Gate 7d: no degrada un nivel ya mas alto'

    # Regla 1: sin dato de Claude nunca se infiere un estado, ni siquiera con
    # Codex en NO-GO. Este check fija que la degradacion se evalua primera.
    $v = Get-StateFor -CodexUsed 95 -FiveHour $null
    Check (($v.State -eq 'BALANCED') -and ($null -eq $v.ClaudeLevel)) `
          'Regla 1: sin cuota de Claude degrada a BALANCED, no a CLAUDE-LEAD'
    Check ($v.StateReason -match 'statusline') 'Regla 1: la razon nombra la statusline'
    $v = Get-StateFor -NoCodex -FiveHour $null
    Check ($v.State -eq 'BALANCED') 'Regla 1: sin ninguna de las dos cuotas degrada a BALANCED'

    $script:TestCodexQuota = $null
    $script:TestClaudeQuota = $null

    $sessionDir = Join-Path $testRoot 'sessions\test'
    New-Item -ItemType Directory -Force -Path $sessionDir | Out-Null
    foreach ($case in @(
        @{ Id = 'small'; Bytes = 10KB; Verdict = 'REUSE-OK' },
        @{ Id = 'medium'; Bytes = 500KB; Verdict = 'REUSE-IF-DIRECT' },
        @{ Id = 'large'; Bytes = 1300KB; Verdict = 'REUSE-DENIED' }
    )) {
        $path = Join-Path $sessionDir ("rollout-$($case.Id).jsonl")
        [System.IO.File]::WriteAllBytes($path, (New-Object byte[] $case.Bytes))
        Check ((Get-SessionDetail $case.Id).Verdict -eq $case.Verdict) "Get-SessionDetail returns $($case.Verdict) for a $($case.Id) rollout"
    }
    Check ($null -eq (Get-SessionDetail 'missing')) 'Get-SessionDetail returns null for an unknown rollout'

    $script:TestModelCatalog = @(
        [pscustomobject]@{ slug = 'rank-1'; default_reasoning_level = 'high'; supported_reasoning_levels = @([pscustomobject]@{ effort = 'high' }) },
        [pscustomobject]@{ slug = 'rank-2'; default_reasoning_level = 'medium'; supported_reasoning_levels = @([pscustomobject]@{ effort = 'medium' }) },
        [pscustomobject]@{ slug = 'rank-3'; default_reasoning_level = 'low'; supported_reasoning_levels = @([pscustomobject]@{ effort = 'low' }) }
    )
    function Get-ModelCatalog { return $script:TestModelCatalog }
    Check ((Resolve-Model -Tier lead -Effort $null).Slug -eq 'rank-1') 'Resolve-Model selects rank 1 for lead'
    Check ((Resolve-Model -Tier worker -Effort $null).Slug -eq 'rank-2') 'Resolve-Model selects rank 2 for worker'
    Check ((Resolve-Model -Tier cheap -Effort $null).Slug -eq 'rank-3') 'Resolve-Model selects rank 3 for cheap'
    $script:TestModelCatalog = @($script:TestModelCatalog[0])
    Check ((Resolve-Model -Tier lead -Effort $null).Slug -eq 'rank-1') 'Resolve-Model keeps the only model for lead'
    Check ((Resolve-Model -Tier worker -Effort $null).Slug -eq 'rank-1') 'Resolve-Model degrades worker to the only model'
    Check ((Resolve-Model -Tier cheap -Effort $null).Slug -eq 'rank-1') 'Resolve-Model degrades cheap to the only model'
    Check ((Resolve-Model -Tier lead -Effort low).Effort -eq 'high') 'Resolve-Model falls back to the default unsupported effort'
    Check ((Resolve-Model -Tier lead -Effort high).Effort -eq 'high') 'Resolve-Model preserves a supported effort'

    $scriptText = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\scripts\codex-run.ps1') -Raw
    $roleDeclaration = [regex]::Match($scriptText, '(?s)\[ValidateSet\((.*?)\)\]\s*\[string\]\$Role')
    $roles = @([regex]::Matches($roleDeclaration.Groups[1].Value, "'([^']+)'") | ForEach-Object { $_.Groups[1].Value })
    foreach ($role in $roles) {
        Check ($RoleTier.ContainsKey($role) -and $RoleSchema.ContainsKey($role)) "Role $role has tier and schema mappings"
    }
    Check (@($RoleSchema.Values | Where-Object { $_ -notin @('impl', 'review', 'docs') }).Count -eq 0) 'Role schemas use only impl, review, or docs'

    foreach ($kind in @('impl', 'review', 'docs')) {
        $schema = New-SchemaFile $kind
        try {
            $validJson = $true
            try { $null = Get-Content -LiteralPath $schema -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $validJson = $false }
            $firstByteIsNotBom = ([System.IO.File]::ReadAllBytes($schema))[0] -ne 0xEF
            Check ($validJson -and $firstByteIsNotBom) "New-SchemaFile creates parseable BOM-free $kind JSON"
        } finally {
            Remove-Item -LiteralPath $schema -ErrorAction SilentlyContinue
        }
    }

    # ------------------- degradacion sin codex instalado: proceso real ---
    # El throw de Get-CodexCommand pasa a nivel de script, ANTES de que exista
    # ninguna funcion que mockear: solo se puede probar en un proceso hijo con
    # el PATH limpio. Confirma que ni el dot-source ni -BudgetOnly ni
    # -QuotaCache revientan cuando no hay codex.
    $codexRunScript = (Join-Path $PSScriptRoot '..\scripts\codex-run.ps1')
    # Los sub-tests de esta seccion levantan procesos hijo cuyo stderr, al
    # mezclarse con 2>&1 bajo ErrorActionPreference=Stop, terminaria esta
    # misma suite. Los aislamos con Continue y restauramos despues.
    #
    # Los hijos van con -File, no con -Command "& script": es como los invoca de
    # verdad Claude Code (settings.json, la statusline y la Fase 0.5 del SKILL),
    # y es la unica forma en que `exit N` del script llega al codigo de salida
    # del proceso. Con -Command el codigo se pierde y el test mentiria.
    # El PATH se limpia en ESTE proceso y el hijo lo hereda; por eso hay que
    # resolver el ejecutable del host antes de limpiarlo, o deja de encontrarse.
    $psExe       = (Get-Process -Id $PID).Path
    $previousEap = $ErrorActionPreference
    $previousPath = $env:PATH
    $ErrorActionPreference = 'Continue'
    try {
        $env:PATH = 'C:\Windows\System32'

        $dotSourceOut  = & $psExe -NoProfile -ExecutionPolicy Bypass -Command ". '$codexRunScript'" 2>&1
        $dotSourceExit = $LASTEXITCODE
        Check ($dotSourceExit -eq 0) 'Dot-sourcear codex-run.ps1 sin codex en el PATH no tira excepcion'
        Check (($dotSourceOut -join "`n") -notmatch 'No se encontro el ejecutable') 'Dot-source sin codex no emite el mensaje de throw viejo'

        $budgetOnlyOut  = & $psExe -NoProfile -ExecutionPolicy Bypass -File $codexRunScript -BudgetOnly 2>&1
        $budgetOnlyExit = $LASTEXITCODE
        $budgetOnlyText = ($budgetOnlyOut -join "`n")
        Check ($budgetOnlyExit -eq 2) '-BudgetOnly sin codex en el PATH sale con codigo 2 (NO-GO)'
        Check ($budgetOnlyText -match 'NO-GO') '-BudgetOnly sin codex en el PATH informa NO-GO'
        Check ($budgetOnlyText -match 'Presupuesto') '-BudgetOnly sin codex en el PATH imprime el presupuesto igual'
        Check ($budgetOnlyText -notmatch 'Exception|ScriptHalted') '-BudgetOnly sin codex en el PATH no tira excepcion'

        # Un rol si necesita el binario: tiene que decirlo y salir 5, no reventar.
        $roleOut  = & $psExe -NoProfile -ExecutionPolicy Bypass -File $codexRunScript -Role constructor -Prompt 'nada' 2>&1
        $roleExit = $LASTEXITCODE
        Check ($roleExit -eq 5) '-Role sin codex en el PATH sale con codigo 5, no con una excepcion'
        Check ((($roleOut -join "`n")) -match 'instalado') '-Role sin codex explica que falta el binario'

        $quotaCacheTemp = Join-Path $testRoot 'quotacache-temp'
        New-Item -ItemType Directory -Force -Path $quotaCacheTemp | Out-Null
        $previousTemp = $env:TEMP
        $env:TEMP = $quotaCacheTemp
        try {
            & $psExe -NoProfile -ExecutionPolicy Bypass -File $codexRunScript -QuotaCache 2>&1 | Out-Null
            $quotaCacheExit = $LASTEXITCODE
        } finally { $env:TEMP = $previousTemp }
        $quotaCacheFile = Join-Path $quotaCacheTemp 'claude/codex-usage-cache.json'
        Check ($quotaCacheExit -eq 0) '-QuotaCache sin codex en el PATH sale con codigo 0'
        Check (Test-Path $quotaCacheFile) '-QuotaCache sin codex en el PATH escribe igual el archivo de cache'
        if (Test-Path $quotaCacheFile) {
            $cacheJson = Get-Content -LiteralPath $quotaCacheFile -Raw -Encoding UTF8 | ConvertFrom-Json
            Check ($null -eq $cacheJson.free_pct) '-QuotaCache sin codex en el PATH escribe free_pct nulo'
        }
    } finally {
        $ErrorActionPreference = $previousEap
        $env:PATH = $previousPath
    }
}
finally {
    if (Test-Path $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
    $env:CODEX_HOME = $previousCodexHome
}

Write-Host ("{0} OK, {1} FAIL" -f ($Checks - $Failures.Count), $Failures.Count)
if ($Failures.Count -gt 0) { exit 1 }
