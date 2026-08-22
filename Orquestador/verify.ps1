<#
.SYNOPSIS
    Verifica la instalacion del kit Claude en ~/.claude.

.DESCRIPTION
    Mismo patron Check que codex/Orquestador/verify.ps1 y que la suite de tests.
    Sin dependencias, PowerShell 5.1.

    La statusline se verifica DURO: su cache es de donde el wrapper lee la cuota
    de Claude. En runtime el gate degrada solo a BALANCED si falta, pero una
    instalacion hibrida sin statusline esta incompleta y hay que decirlo.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Orquestador\verify.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ClaudeHome = if ($env:CLAUDE_HOME) { $env:CLAUDE_HOME } else { Join-Path $env:USERPROFILE '.claude' }
$Failures = New-Object System.Collections.Generic.List[string]
$Warnings = New-Object System.Collections.Generic.List[string]

function Check {
    param([bool]$Condition, [string]$Message)
    if ($Condition) { Write-Host "[OK] $Message" -ForegroundColor Green }
    else { Write-Host "[FAIL] $Message" -ForegroundColor Red; $Failures.Add($Message) }
}

function Warn {
    param([bool]$Condition, [string]$Message)
    if ($Condition) { Write-Host "[OK] $Message" -ForegroundColor Green }
    else { Write-Host "[WARN] $Message" -ForegroundColor Yellow; $Warnings.Add($Message) }
}

# --- skills y agents ---
foreach ($skill in @('orquestador', 'brainstorming', 'documentacion')) {
    Check (Test-Path (Join-Path $ClaudeHome "skills\$skill\SKILL.md")) "skill $skill presente"
}
foreach ($agent in @('explorador', 'tester', 'constructor')) {
    Check (Test-Path (Join-Path $ClaudeHome "agents\$agent.md")) "agent $agent presente"
}

# --- el puente a Codex ---
$wrapper = Join-Path $ClaudeHome 'scripts\codex-run.ps1'
Check (Test-Path $wrapper) 'wrapper codex-run.ps1 presente'
Check (Test-Path (Join-Path $ClaudeHome 'hooks\git-guard.ps1')) 'hook git-guard.ps1 presente'

if (Test-Path $wrapper) {
    $src = Get-Content -LiteralPath $wrapper -Raw
    # El wrapper nunca desarma las protecciones: no es que no las use hoy, es que
    # no pueden aparecer nunca.
    foreach ($flag in @('--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust', '--ignore-rules')) {
        Check ($src -notmatch [regex]::Escape($flag)) "el wrapper no pasa $flag"
    }
    Check ($src -match 'agents\.enabled=false') 'el wrapper fuerza agents.enabled=false'
    # Capacity routing: los estados tienen que estar en la version instalada.
    Check ($src -match 'Add-CapacityState') 'el wrapper instalado tiene la maquina de estados'
    foreach ($state in @('CODEX-PREFERRED', 'SONNET-LEAD', 'CLAUDE-LEAD', 'SURVIVAL')) {
        Check ($src -match [regex]::Escape($state)) "estado $state definido"
    }
}

# --- settings ---
$settings = Join-Path $ClaudeHome 'settings.json'
Check (Test-Path $settings) 'settings.json presente'
if (Test-Path $settings) {
    $doc = Get-Content -LiteralPath $settings -Raw -Encoding UTF8 | ConvertFrom-Json
    $deny = @($doc.permissions.deny) -join ' '
    Check ($deny -match 'git push') 'settings deniega git push'
    Check ($doc.includeCoAuthoredBy -eq $false) 'settings desactiva la atribucion de IA en commits'
    Check ($null -ne $doc.statusLine -and $doc.statusLine.command -match 'statusline-wrapper\.ps1') `
          'settings apunta la statusline al wrapper del kit'
    $hookCmds = @($doc.hooks.PreToolUse | ForEach-Object { $_.hooks | ForEach-Object { [string]$_.command } }) -join ' '
    Check ($hookCmds -match 'git-guard\.ps1') 'settings registra el hook git-guard'
    $guardCount = @($doc.hooks.PreToolUse | Where-Object {
        (@($_.hooks | ForEach-Object { [string]$_.command }) -join ' ') -match 'git-guard\.ps1'
    }).Count
    Check ($guardCount -eq 1) 'el hook git-guard esta registrado una sola vez'
}

# --- statusline: duro, es la fuente de la cuota de Claude ---
Check (Test-Path (Join-Path $ClaudeHome 'statusline-wrapper.ps1')) 'statusline-wrapper.ps1 presente'
Check (Test-Path (Join-Path $ClaudeHome 'statusline\statusline.ps1')) `
      'ClaudeCodeStatusLine clonado (sin el, el gate no lee la cuota de Claude)'

$cache = Join-Path $env:TEMP 'claude\statusline-usage-cache.json'
Warn (Test-Path $cache) 'cache de cuota de Claude presente (se puebla al primer turno de Claude Code)'

# --- integraciones que el instalador no ejecuta ---
if (Get-Command claude -ErrorAction SilentlyContinue) {
    $mcp = (& claude mcp list 2>&1 | Out-String)
    Warn ($mcp -match 'context7') 'MCP context7 configurado'
    Warn ($mcp -match 'serena')   'MCP serena configurado'
} else {
    $Warnings.Add("'claude' no esta en PATH: no se pudieron verificar los MCPs")
    Write-Host "[WARN] 'claude' no esta en PATH: MCPs sin verificar" -ForegroundColor Yellow
}

Warn ($null -ne (Get-Command codex -ErrorAction SilentlyContinue)) `
     'codex en PATH (sin el, el kit corre en modo Claude-solo)'

Write-Host ''
if ($Warnings.Count) { Write-Host "$($Warnings.Count) advertencia(s): la instalacion funciona pero esta incompleta." -ForegroundColor Yellow }
if ($Failures.Count) {
    Write-Host "$($Failures.Count) FALLA(S):" -ForegroundColor Red
    foreach ($f in $Failures) { Write-Host "  - $f" -ForegroundColor Red }
    exit 1
}
Write-Host 'Kit Claude verificado.' -ForegroundColor Green
