<#
.SYNOPSIS
    Instala el kit Claude del Orquestador Hibrido en ~/.claude.

.DESCRIPTION
    Clona el patron de codex/Orquestador/install.ps1: respalda antes de pisar,
    soporta -WhatIf y nunca reemplaza un archivo del usuario sin copia previa.

    Lo que NO hace, a proposito: instalar plugins (/plugin install solo corre
    dentro de una sesion de Claude Code) ni MCPs (requieren npx/uv). Los verifica
    y lista los comandos que faltan, en vez de ejecutarlos a ciegas.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Orquestador\install.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    # Omite el clonado de ClaudeCodeStatusLine. La statusline NO es opcional en
    # el entorno hibrido: su cache es de donde el wrapper lee la cuota de Claude.
    [switch]$SkipStatusLine
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom      = New-Object System.Text.UTF8Encoding($false)
$KitRoot        = $PSScriptRoot
$ClaudeHome     = if ($env:CLAUDE_HOME) { $env:CLAUDE_HOME } else { Join-Path $env:USERPROFILE '.claude' }
$Stamp          = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupRoot     = Join-Path $ClaudeHome "orquestador-backups\$Stamp"
$StatusLineRepo = 'https://github.com/daniel3303/ClaudeCodeStatusLine'

function Assert-Command {
    param([string]$Name, [switch]$Optional)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        if ($Optional) { return $false }
        throw "Falta '$Name' en PATH. Consulta INSTALL-HIBRIDO.md."
    }
    return $true
}

function Backup-ItemIfPresent {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $resolved = [IO.Path]::GetFullPath($Path)
    $root     = [IO.Path]::GetFullPath($ClaudeHome).TrimEnd('\')
    $relative = if ($resolved.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
        $resolved.Substring($root.Length).TrimStart('\')
    } else { Split-Path $resolved -Leaf }
    $destination = Join-Path $BackupRoot $relative
    if ($PSCmdlet.ShouldProcess($Path, "Respaldar en $destination")) {
        New-Item -ItemType Directory -Force (Split-Path $destination -Parent) | Out-Null
        Copy-Item -LiteralPath $Path -Destination $destination -Recurse -Force
    }
}

function Copy-OwnedFile {
    param([string]$Source, [string]$Destination)
    Backup-ItemIfPresent $Destination
    if ($PSCmdlet.ShouldProcess($Destination, "Instalar desde $Source")) {
        New-Item -ItemType Directory -Force (Split-Path $Destination -Parent) | Out-Null
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
    }
}

function Set-Prop($Target, [string]$Name, $Value) {
    $Target | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Merge-StringArray($Existing, $Incoming) {
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($v in (@($Existing) + @($Incoming))) {
        if ($null -ne $v -and -not $out.Contains([string]$v)) { $out.Add([string]$v) }
    }
    return $out.ToArray()
}

# Merge de settings.json: agrega lo que falta y fusiona permissions sin duplicar.
# Solo se imponen las claves que son contrato del kit; el resto del archivo del
# usuario queda intacto.
function Merge-Settings {
    $target  = Join-Path $ClaudeHome 'settings.json'
    $snippet = Get-Content -LiteralPath (Join-Path $KitRoot 'settings-snippet.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Backup-ItemIfPresent $target

    $doc = if (Test-Path -LiteralPath $target) {
        Get-Content -LiteralPath $target -Raw -Encoding UTF8 | ConvertFrom-Json
    } else { [pscustomobject]@{} }

    foreach ($k in @('includeCoAuthoredBy', 'statusLine', 'model', 'effortLevel', 'attribution')) {
        if ($snippet.PSObject.Properties.Name -contains $k) { Set-Prop $doc $k $snippet.$k }
    }

    # permissions: deny y allow se fusionan; defaultMode solo si no estaba.
    $perms = if ($doc.PSObject.Properties.Name -contains 'permissions') { $doc.permissions } else { [pscustomobject]@{} }
    Set-Prop $perms 'deny'  (Merge-StringArray $perms.deny  $snippet.permissions.deny)
    Set-Prop $perms 'allow' (Merge-StringArray $perms.allow $snippet.permissions.allow)
    if (-not ($perms.PSObject.Properties.Name -contains 'defaultMode')) {
        Set-Prop $perms 'defaultMode' $snippet.permissions.defaultMode
    }
    Set-Prop $doc 'permissions' $perms

    # hooks.PreToolUse: se saca cualquier git-guard previo antes de agregar el
    # nuestro, para que reinstalar no acumule duplicados.
    $hooks = if ($doc.PSObject.Properties.Name -contains 'hooks') { $doc.hooks } else { [pscustomobject]@{} }
    $groups = @()
    if ($hooks.PreToolUse) { $groups = @($hooks.PreToolUse) }
    $groups = @($groups | Where-Object {
        (@($_.hooks | ForEach-Object { [string]$_.command }) -join ' ') -notmatch 'git-guard\.ps1'
    })
    $groups += @($snippet.hooks.PreToolUse)
    Set-Prop $hooks 'PreToolUse' $groups
    Set-Prop $doc 'hooks' $hooks

    # Plugins y marketplaces se agregan sin sacar los del usuario.
    foreach ($k in @('enabledPlugins', 'extraKnownMarketplaces')) {
        $cur = if ($doc.PSObject.Properties.Name -contains $k) { $doc.$k } else { [pscustomobject]@{} }
        foreach ($p in $snippet.$k.PSObject.Properties) {
            if (-not ($cur.PSObject.Properties.Name -contains $p.Name)) {
                Set-Prop $cur $p.Name $p.Value
            }
        }
        Set-Prop $doc $k $cur
    }

    if ($PSCmdlet.ShouldProcess($target, 'Fusionar settings del Orquestador')) {
        New-Item -ItemType Directory -Force $ClaudeHome | Out-Null
        [IO.File]::WriteAllText($target, (($doc | ConvertTo-Json -Depth 20) + [Environment]::NewLine), $Utf8NoBom)
    }
}

Assert-Command git | Out-Null
Assert-Command powershell | Out-Null
$hasClaude = Assert-Command claude -Optional
if (-not $hasClaude) {
    Write-Warning "'claude' no esta en PATH: el kit se copia igual, pero no se puede verificar la CLI."
}

New-Item -ItemType Directory -Force $ClaudeHome | Out-Null

# --- skills, agents, wrapper y hook ---
foreach ($skill in Get-ChildItem -LiteralPath (Join-Path $KitRoot 'skills') -Directory) {
    $destination = Join-Path $ClaudeHome "skills\$($skill.Name)"
    Backup-ItemIfPresent $destination
    if ($PSCmdlet.ShouldProcess($destination, "Instalar skill $($skill.Name)")) {
        New-Item -ItemType Directory -Force (Join-Path $ClaudeHome 'skills') | Out-Null
        Copy-Item -LiteralPath $skill.FullName -Destination (Join-Path $ClaudeHome 'skills') -Recurse -Force
    }
}
foreach ($agent in Get-ChildItem -LiteralPath (Join-Path $KitRoot 'agents') -Filter '*.md') {
    Copy-OwnedFile $agent.FullName (Join-Path $ClaudeHome "agents\$($agent.Name)")
}
Copy-OwnedFile (Join-Path $KitRoot 'scripts\codex-run.ps1')  (Join-Path $ClaudeHome 'scripts\codex-run.ps1')
Copy-OwnedFile (Join-Path $KitRoot 'hooks\git-guard.ps1')    (Join-Path $ClaudeHome 'hooks\git-guard.ps1')
Copy-OwnedFile (Join-Path $KitRoot 'statusline-wrapper.ps1') (Join-Path $ClaudeHome 'statusline-wrapper.ps1')

Merge-Settings

# --- statusline: obligatoria en el entorno hibrido ---
$statusLineDir = Join-Path $ClaudeHome 'statusline'
if ($SkipStatusLine) {
    Write-Warning 'Statusline omitida: el gate no va a poder leer la cuota de Claude y va a degradar a BALANCED.'
} elseif (Test-Path (Join-Path $statusLineDir 'statusline.ps1')) {
    Write-Host 'Statusline ya presente; no se vuelve a clonar.'
} elseif ($PSCmdlet.ShouldProcess($statusLineDir, "Clonar $StatusLineRepo")) {
    & git clone --depth 1 $StatusLineRepo $statusLineDir
    if ($LASTEXITCODE -ne 0) { Write-Warning "No se pudo clonar la statusline. Clonala a mano en $statusLineDir." }
}

# --- lo que este script deliberadamente NO ejecuta ---
$pending = New-Object System.Collections.Generic.List[string]
$mcpList = if ($hasClaude) { (& claude mcp list 2>&1 | Out-String) } else { '' }
foreach ($mcp in @(
    @{ Name = 'context7'; Cmd = 'claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp@latest' },
    @{ Name = 'serena';   Cmd = 'uv tool install -p 3.13 serena-agent  +  claude mcp add --scope user serena -- serena start-mcp-server --context claude-code --project-from-cwd' }
)) {
    if ($mcpList -notmatch [regex]::Escape($mcp.Name)) { $pending.Add("MCP $($mcp.Name): $($mcp.Cmd)") }
}
$pending.Add('Plugins, desde una sesion de Claude Code: /plugin marketplace add Gentleman-Programming/engram  +  /plugin install engram@engram  +  /plugin marketplace add DietrichGebert/ponytail  +  /plugin install ponytail@ponytail')

Write-Host ''
Write-Host "Kit Claude instalado en $ClaudeHome" -ForegroundColor Green
if (Test-Path $BackupRoot) { Write-Host "Respaldos en $BackupRoot" }
Write-Host ''
Write-Host 'Falta ejecutar a mano (no se hace a ciegas):' -ForegroundColor Yellow
foreach ($p in $pending) { Write-Host "  - $p" }
Write-Host ''
Write-Host 'Verificar con: powershell -NoProfile -ExecutionPolicy Bypass -File .\Orquestador\verify.ps1'
