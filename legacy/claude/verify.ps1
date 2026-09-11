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
$KitRoot    = $PSScriptRoot
$ClaudeHome = if ($env:CLAUDE_HOME) { $env:CLAUDE_HOME } else { Join-Path $HOME '.claude' }
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

# Deteccion de deriva: el instalador copia estos archivos tal cual, asi que un
# hash distinto significa exactamente una cosa -- lo instalado quedo atras del
# repo. Es todo el mecanismo de "actualizar": no hay archivo de version que
# mantener sincronizado a mano.
#
# SHA256 por .NET y no Get-FileHash: ese cmdlet vive en Microsoft.PowerShell.Utility,
# y instalar pwsh 7 antepone sus modulos al PSModulePath de la maquina. PowerShell
# 5.1 termina resolviendo la Utility de 7.x y Get-FileHash deja de existir. .NET no
# pasa por el autoload de modulos, asi que no hay nada que sombrear.
function Get-Sha256 {
    param([string]$Path)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        try { return [BitConverter]::ToString($sha.ComputeHash($stream)) } finally { $stream.Dispose() }
    } finally { $sha.Dispose() }
}

function Compare-Installed {
    param([string]$RepoPath, [string]$InstalledPath, [string]$Label)
    if (-not (Test-Path -LiteralPath $InstalledPath)) { return }   # la ausencia ya la reporta su propio Check
    Check ((Get-Sha256 $RepoPath) -eq (Get-Sha256 $InstalledPath)) "$Label al dia respecto del repo"
}

# --- skills y agents ---
foreach ($skill in @('orquestador', 'brainstorming', 'documentacion')) {
    Check (Test-Path (Join-Path $ClaudeHome "skills/$skill/SKILL.md")) "skill $skill presente"
}
foreach ($agent in @('explorador', 'tester', 'constructor')) {
    Check (Test-Path (Join-Path $ClaudeHome "agents/$agent.md")) "agent $agent presente"
}
# El core de la skill delega el detalle a references/: si no se instalaron, el
# orquestador queda con punteros a archivos que no existen.
foreach ($ref in @('routing', 'codex', 'docs-matrix', 'capsule', 'retro')) {
    Check (Test-Path (Join-Path $ClaudeHome "skills/orquestador/references/$ref.md")) `
          "reference $ref.md presente"
}

# --- el puente a Codex ---
$wrapper = Join-Path $ClaudeHome 'scripts/codex-run.ps1'
Check (Test-Path $wrapper) 'wrapper codex-run.ps1 presente'
Check (Test-Path (Join-Path $ClaudeHome 'hooks/git-guard.ps1')) 'hook git-guard.ps1 presente'

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

# --- deriva: lo instalado contra este repo ---
$pairs = @()
foreach ($skill in Get-ChildItem -LiteralPath (Join-Path $KitRoot 'skills') -Directory) {
    $pairs += @{ Repo = (Join-Path $skill.FullName 'SKILL.md')
                 Inst = (Join-Path $ClaudeHome "skills/$($skill.Name)/SKILL.md")
                 Label = "skill $($skill.Name)" }
}
foreach ($agent in Get-ChildItem -LiteralPath (Join-Path $KitRoot 'agents') -Filter '*.md') {
    $pairs += @{ Repo = $agent.FullName
                 Inst = (Join-Path $ClaudeHome "agents/$($agent.Name)")
                 Label = "agent $($agent.BaseName)" }
}
foreach ($f in @(
    @{ Rel = 'scripts/codex-run.ps1';   Label = 'wrapper codex-run.ps1' },
    @{ Rel = 'hooks/git-guard.ps1';     Label = 'hook git-guard.ps1' },
    @{ Rel = 'hooks/orq-metrics.ps1';   Label = 'hook orq-metrics.ps1' }
)) { $pairs += @{ Repo = (Join-Path $KitRoot $f.Rel); Inst = (Join-Path $ClaudeHome $f.Rel); Label = $f.Label } }
foreach ($ref in (Get-ChildItem -LiteralPath (Join-Path $KitRoot 'skills/orquestador/references') -Filter '*.md' -ErrorAction SilentlyContinue)) {
    $pairs += @{ Repo  = $ref.FullName
                 Inst  = (Join-Path $ClaudeHome "skills/orquestador/references/$($ref.Name)")
                 Label = "reference $($ref.Name)" }
}
$pairs += @{ Repo  = (Join-Path $KitRoot 'statusline-wrapper.ps1')
             Inst  = (Join-Path $ClaudeHome 'statusline-wrapper.ps1')
             Label = 'statusline-wrapper.ps1' }

$driftBefore = $Failures.Count
foreach ($p in $pairs) { Compare-Installed $p.Repo $p.Inst $p.Label }
if ($Failures.Count -gt $driftBefore) {
    Write-Host '       -> hay una version mas nueva en el repo. Actualiza con:' -ForegroundColor Yellow
    Write-Host '          powershell -NoProfile -ExecutionPolicy Bypass -File .\install-hibrido.ps1' -ForegroundColor Yellow
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

    $postCmds = @($doc.hooks.PostToolUse | ForEach-Object { $_.hooks | ForEach-Object { [string]$_.command } }) -join ' '
    Check ($postCmds -match 'orq-metrics\.ps1') 'settings registra el hook de metricas en PostToolUse'
    $metricCount = @(@($doc.hooks.PreToolUse) + @($doc.hooks.PostToolUse) | Where-Object {
        (@($_.hooks | ForEach-Object { [string]$_.command }) -join ' ') -match 'orq-metrics\.ps1'
    }).Count
    Check ($metricCount -eq 2) 'el hook de metricas esta registrado en sus dos eventos, sin duplicados'
}

# --- statusline: duro, es la fuente de la cuota de Claude ---
Check (Test-Path (Join-Path $ClaudeHome 'statusline-wrapper.ps1')) 'statusline-wrapper.ps1 presente'
Check (Test-Path (Join-Path $ClaudeHome 'statusline/statusline.ps1')) `
      'ClaudeCodeStatusLine clonado (sin el, el gate no lee la cuota de Claude)'

$cache = Join-Path $(if ($env:TEMP) { $env:TEMP } else { [IO.Path]::GetTempPath() }) 'claude/statusline-usage-cache.json'
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

# --- plugins: los declara settings.json y Claude Code clona el marketplace al
# arrancar. Verificamos el resultado, no la intencion.
$snippet = Get-Content -LiteralPath (Join-Path $KitRoot 'settings-snippet.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$missingPlugins = @()
foreach ($mk in $snippet.extraKnownMarketplaces.PSObject.Properties.Name) {
    if (-not (Test-Path (Join-Path $ClaudeHome "plugins/marketplaces/$mk"))) { $missingPlugins += $mk }
}
Warn ($missingPlugins.Count -eq 0) 'marketplaces de plugins clonados (engram, ponytail)'
if ($missingPlugins.Count) {
    foreach ($mk in $missingPlugins) {
        $repo = $snippet.extraKnownMarketplaces.$mk.source.repo
        Write-Host "       -> desde una sesion de Claude Code: /plugin marketplace add $repo  +  /plugin install $mk@$mk" -ForegroundColor Yellow
    }
}

Warn ($null -ne (Get-Command codex -ErrorAction SilentlyContinue)) `
     'codex en PATH (sin el, el kit corre en modo Claude-solo)'

# pwsh 7: runtime multiplataforma del kit, y lo que Serena necesita para levantar
# el language server de PowerShell. Sin el, las herramientas de simbolos de
# Serena fallan en cualquier repo que declare ese LS.
Warn ($null -ne (Get-Command pwsh -ErrorAction SilentlyContinue)) `
     'pwsh 7 en PATH (Serena lo necesita para los simbolos de .ps1)'

Write-Host ''
if ($Warnings.Count) { Write-Host "$($Warnings.Count) advertencia(s): la instalacion funciona pero esta incompleta." -ForegroundColor Yellow }
if ($Failures.Count) {
    Write-Host "$($Failures.Count) FALLA(S):" -ForegroundColor Red
    foreach ($f in $Failures) { Write-Host "  - $f" -ForegroundColor Red }
    exit 1
}
Write-Host 'Kit Claude verificado.' -ForegroundColor Green
