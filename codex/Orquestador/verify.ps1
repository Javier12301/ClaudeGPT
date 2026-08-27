[CmdletBinding()]
param([switch]$Global)

$ErrorActionPreference = 'Stop'
$KitRoot = $PSScriptRoot
$CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$SkillsHome = Join-Path $env:USERPROFILE '.agents\skills'
$Failures = New-Object System.Collections.Generic.List[string]

function Check {
    param([bool]$Condition, [string]$Message)
    if ($Condition) { Write-Host "[OK] $Message" -ForegroundColor Green }
    else { Write-Host "[FAIL] $Message" -ForegroundColor Red; $Failures.Add($Message) }
}

function Get-McpServerSection {
    param([string]$Content, [string]$ServerName)
    $escapedName = [regex]::Escape($ServerName)
    $pattern = "(?ms)^\[mcp_servers\.$escapedName\][^\S\r\n]*\r?\n(.*?)(?=^\[|\z)"
    $match = [regex]::Match($Content, $pattern)
    if ($match.Success) { return $match.Groups[1].Value }
    return $null
}

$agentNames = @('explorador', 'tester-tdd', 'constructor', 'reviewer', 'security-reviewer', 'docs-researcher', 'verifier', 'e2e-browser', 'browser-diagnostics')
# Todos los roles van en danger-full-access. Bajo [windows] sandbox = "elevated" ni
# workspace-write ni read-only pueden lanzar procesos hijo: Codex muere con error 1920
# (los que escriben al tocar el repo, los lectores al invocar git o rg). La barrera de
# los roles lectores pasa a ser el prompt + agents.enabled=false, igual que verifier.
$skillNames = @('constructor', 'revisor-completo')
$base = if ($Global) { $CodexHome } else { Join-Path $KitRoot '.codex' }
$skillsBase = if ($Global) { $SkillsHome } else { Join-Path $KitRoot '.agents\skills' }

Check (Test-Path (Join-Path $base 'config.toml')) 'config.toml presente'
if (Test-Path (Join-Path $base 'config.toml')) {
    $cfg = Get-Content -LiteralPath (Join-Path $base 'config.toml') -Raw
    Check ($cfg -match '(?m)^sandbox_mode\s*=\s*"danger-full-access"\s*$') 'config.toml en danger-full-access'
    Check ($cfg -match '(?m)^approval_policy\s*=\s*"never"\s*$')          'config.toml con approval_policy never'
}
$agentsInstructionsPath = if ($Global) { Join-Path $CodexHome 'AGENTS.md' } else { Join-Path $KitRoot 'AGENTS.md' }
Check (Test-Path $agentsInstructionsPath) 'AGENTS.md efectivo presente'
if (Test-Path $agentsInstructionsPath) {
    $agentsInstructions = Get-Content -LiteralPath $agentsInstructionsPath -Raw
    $safeCustomRoleSpawn = ($agentsInstructions -match '(?i)fork_turns') -and `
        ($agentsInstructions -match '(?i)\bnone\b') -and `
        ($agentsInstructions -match '(?i)historial\s+completo|full-history') -and `
        ($agentsInstructions -match '(?i)rol\s+personalizado|agente\s+personalizado')
    Check $safeCustomRoleSpawn 'AGENTS.md exige fork_turns acotado para roles personalizados'
}
foreach ($name in $agentNames) {
    $path = Join-Path $base "agents\$name.toml"
    Check (Test-Path $path) "agente $name presente"
    if (Test-Path $path) {
        $content = Get-Content -LiteralPath $path -Raw
        Check ($content -match '(?ms)^\[agents\]\s*enabled\s*=\s*false') "$name no puede lanzar agentes"

        # El -s de la linea de comandos le gana al config global, asi que este es el
        # nivel que decide: codex-run.ps1 lee sandbox_mode de aca (Get-RoleConfig).
        Check ($content -match '(?m)^sandbox_mode\s*=\s*"danger-full-access"\s*$') "$name en sandbox danger-full-access"

        $expectedMcpServers = @('context7', 'serena', 'playwright', 'chrome-devtools')
        $actualMcpServers = @([regex]::Matches($content, '(?m)^\[mcp_servers\.([^\]]+)\]\s*$') | ForEach-Object { $_.Groups[1].Value })
        Check (($actualMcpServers.Count -eq $expectedMcpServers.Count) -and (@($actualMcpServers | Sort-Object) -join '|') -eq (@($expectedMcpServers | Sort-Object) -join '|')) "$name declara exactamente los MCP esperados"

        $context7 = Get-McpServerSection $content 'context7'
        Check (($null -ne $context7) -and ($context7 -match '(?m)^url\s*=\s*"https://mcp\.context7\.com/mcp"\s*$')) "$name configura el transporte de context7"

        $serena = Get-McpServerSection $content 'serena'
        Check (($null -ne $serena) -and ($serena -match '(?m)^command\s*=\s*"serena"\s*$') -and ($serena -match '(?m)^args\s*=\s*\[\s*"start-mcp-server"\s*,\s*"--project-from-cwd"\s*,\s*"--context=codex"\s*\]\s*$') -and ($serena -match '(?m)^startup_timeout_sec\s*=\s*20\s*$')) "$name configura el transporte de serena"

        $playwright = Get-McpServerSection $content 'playwright'
        Check (($null -ne $playwright) -and ($playwright -match '(?m)^command\s*=\s*"cmd"\s*$') -and ($playwright -match '(?m)^args\s*=\s*\[\s*"/c"\s*,\s*"npx"\s*,\s*"-y"\s*,\s*"@playwright/mcp@latest"\s*\]\s*$') -and ($playwright -match '(?m)^startup_timeout_sec\s*=\s*60\s*$')) "$name configura el transporte de playwright"

        $chromeDevtools = Get-McpServerSection $content 'chrome-devtools'
        Check (($null -ne $chromeDevtools) -and ($chromeDevtools -match '(?m)^command\s*=\s*"cmd"\s*$') -and ($chromeDevtools -match '(?m)^args\s*=\s*\[\s*"/c"\s*,\s*"npx"\s*,\s*"-y"\s*,\s*"chrome-devtools-mcp@latest"\s*,\s*"--slim"\s*,\s*"--headless"\s*\]\s*$') -and ($chromeDevtools -match '(?m)^startup_timeout_sec\s*=\s*60\s*$')) "$name configura el transporte de chrome-devtools"

        foreach ($server in $expectedMcpServers) {
            $section = Get-McpServerSection $content $server
            $expectedEnabled = (($name -eq 'docs-researcher' -and $server -eq 'context7') -or ($name -eq 'e2e-browser' -and $server -eq 'playwright') -or ($name -eq 'browser-diagnostics' -and $server -eq 'chrome-devtools'))
            Check (($null -ne $section) -and ($section -match "(?m)^enabled\s*=\s*$($expectedEnabled.ToString().ToLowerInvariant())\s*$")) "$name/$server respeta la matriz enabled"
        }
    }
}

foreach ($name in $skillNames) {
    $path = Join-Path $skillsBase "$name\SKILL.md"
    Check (Test-Path $path) "skill $name presente"
    if (Test-Path $path) {
        $content = Get-Content -LiteralPath $path -Raw
        Check ($content -match "(?ms)^---\s*name:\s*$([regex]::Escape($name))\s*description:.+?---") "frontmatter de $name válido"
    }
}

$rulePath = Join-Path $base 'rules\orquestador.rules'
Check (Test-Path $rulePath) 'rule de Git presente'
if ((Test-Path $rulePath) -and (Get-Command codex -ErrorAction SilentlyContinue)) {
    $push = & codex execpolicy check --rules $rulePath -- git push origin main 2>&1 | Out-String
    Check ($push -match 'forbidden') 'git push resuelve como forbidden'
    $commit = & codex execpolicy check --rules $rulePath -- git commit -m test 2>&1 | Out-String
    Check ($commit -match 'prompt') 'git commit resuelve como prompt'
}

$hookPath = if ($Global) { Join-Path $CodexHome 'hooks\orquestador-git-guard.ps1' } else { Join-Path $KitRoot '.codex\hooks\git-guard.ps1' }
Check (Test-Path $hookPath) 'hook Git presente'
if (Test-Path $hookPath) {
    $blocked = '{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}' | & powershell -NoProfile -ExecutionPolicy Bypass -File $hookPath | Out-String
    Check ($blocked -match '"permissionDecision":"deny"') 'hook bloquea git push'
    $allowed = '{"tool_name":"Bash","tool_input":{"command":"git status"}}' | & powershell -NoProfile -ExecutionPolicy Bypass -File $hookPath | Out-String
    Check ($allowed.Trim() -eq '{}') 'hook permite git status'
}

if ($Global -and (Get-Command codex -ErrorAction SilentlyContinue)) {
    $doctor = & codex doctor --json 2>&1 | Out-String
    Check ($LASTEXITCODE -eq 0) 'codex doctor finaliza correctamente'
    $doctorWarnings = @()
    try {
        $doctorJson = $doctor | ConvertFrom-Json -ErrorAction Stop
        foreach ($property in @('startup_warnings', 'startupWarnings')) {
            if ($null -ne $doctorJson.$property) { $doctorWarnings += @($doctorJson.$property) }
        }
        $configLoad = $doctorJson.checks.'config.load'
        if (($null -ne $configLoad) -and ($null -ne $configLoad.details.'startup warning')) {
            $doctorWarnings += @($configLoad.details.'startup warning')
        }
    }
    catch {
        Check $false 'codex doctor --json devuelve JSON valido'
    }
    $startupWarningText = $doctorWarnings | Out-String
    Check ($startupWarningText -notmatch '(?i)malformed agent role|invalid transport') 'codex doctor no reporta roles malformados ni transportes invalidos'
}

if ($Failures.Count -gt 0) {
    throw "Fallaron $($Failures.Count) verificaciones."
}

Write-Host 'Verificación completada.' -ForegroundColor Green
