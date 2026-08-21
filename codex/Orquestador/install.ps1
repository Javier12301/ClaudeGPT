[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$WithSerena,
    [switch]$WithSecurity
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$KitRoot = $PSScriptRoot
$CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$SkillsHome = Join-Path $env:USERPROFILE '.agents\skills'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupRoot = Join-Path $CodexHome "orquestador-backups\$Stamp"

function Assert-Command {
    param([string]$Name, [switch]$Optional)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        if ($Optional) { return $false }
        throw "Falta '$Name' en PATH. Consultá INSTALL.md."
    }
    return $true
}

function Backup-ItemIfPresent {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $resolvedPath = [IO.Path]::GetFullPath($Path)
    $resolvedCodexHome = [IO.Path]::GetFullPath($CodexHome).TrimEnd('\')
    $resolvedAgentsHome = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.agents')).TrimEnd('\')
    if ($resolvedPath.StartsWith($resolvedCodexHome + '\', [StringComparison]::OrdinalIgnoreCase)) {
        $relative = Join-Path 'codex' $resolvedPath.Substring($resolvedCodexHome.Length).TrimStart('\')
    } elseif ($resolvedPath.StartsWith($resolvedAgentsHome + '\', [StringComparison]::OrdinalIgnoreCase)) {
        $relative = Join-Path 'agents' $resolvedPath.Substring($resolvedAgentsHome.Length).TrimStart('\')
    } else {
        $relative = Split-Path $resolvedPath -Leaf
    }
    if (-not $relative) { $relative = Split-Path $Path -Leaf }
    $destination = Join-Path $BackupRoot $relative
    if ($PSCmdlet.ShouldProcess($Path, "Respaldar en $destination")) {
        New-Item -ItemType Directory -Force (Split-Path $destination -Parent) | Out-Null
        Copy-Item -LiteralPath $Path -Destination $destination -Recurse -Force
    }
}

function Copy-OwnedFile {
    param([string]$Source, [string]$Destination)
    if ($PSCmdlet.ShouldProcess($Destination, "Instalar desde $Source")) {
        New-Item -ItemType Directory -Force (Split-Path $Destination -Parent) | Out-Null
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
    }
}

function Set-TopLevelTomlKey {
    param(
        [System.Collections.Generic.List[string]]$Lines,
        [string]$Key,
        [string]$Value
    )
    $sectionStart = $Lines.Count
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i] -match '^\s*\[') { $sectionStart = $i; break }
    }
    for ($i = 0; $i -lt $sectionStart; $i++) {
        if ($Lines[$i] -match ('^\s*' + [regex]::Escape($Key) + '\s*=')) {
            $Lines[$i] = "$Key = $Value"
            return
        }
    }
    $Lines.Insert($sectionStart, "$Key = $Value")
}

function Set-TomlSectionKey {
    param(
        [System.Collections.Generic.List[string]]$Lines,
        [string]$Section,
        [string]$Key,
        [string]$Value
    )
    $header = "[$Section]"
    $start = -1
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i].Trim() -eq $header) { $start = $i; break }
    }
    if ($start -lt 0) {
        if ($Lines.Count -gt 0 -and $Lines[$Lines.Count - 1] -ne '') { $Lines.Add('') }
        $Lines.Add($header)
        $Lines.Add("$Key = $Value")
        return
    }
    $end = $Lines.Count
    for ($i = $start + 1; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i] -match '^\s*\[') { $end = $i; break }
    }
    for ($i = $start + 1; $i -lt $end; $i++) {
        if ($Lines[$i] -match ('^\s*' + [regex]::Escape($Key) + '\s*=')) {
            $Lines[$i] = "$Key = $Value"
            return
        }
    }
    $Lines.Insert($end, "$Key = $Value")
}

function Merge-CodexConfig {
    $configPath = Join-Path $CodexHome 'config.toml'
    Backup-ItemIfPresent $configPath
    $lines = New-Object 'System.Collections.Generic.List[string]'
    if (Test-Path -LiteralPath $configPath) {
        foreach ($line in ([IO.File]::ReadAllText($configPath) -split '\r?\n')) { $lines.Add($line) }
    }

    Set-TopLevelTomlKey $lines 'model' '"gpt-5.6-sol"'
    Set-TopLevelTomlKey $lines 'model_reasoning_effort' '"medium"'
    Set-TopLevelTomlKey $lines 'sandbox_mode' '"workspace-write"'
    Set-TopLevelTomlKey $lines 'approval_policy' '"on-request"'
    Set-TomlSectionKey $lines 'agents' 'enabled' 'true'
    Set-TomlSectionKey $lines 'agents' 'max_concurrent_threads_per_session' '4'
    Set-TomlSectionKey $lines 'agents' 'default_subagent_model' '"gpt-5.6-terra"'
    Set-TomlSectionKey $lines 'agents' 'default_subagent_reasoning_effort' '"medium"'
    Set-TomlSectionKey $lines 'windows' 'sandbox' '"elevated"'
    Set-TomlSectionKey $lines 'sandbox_workspace_write' 'network_access' 'false'
    Set-TomlSectionKey $lines 'tui' 'status_line' '["model-with-reasoning", "context-remaining", "rate-limits", "git-branch"]'
    Set-TomlSectionKey $lines 'mcp_servers.context7' 'url' '"https://mcp.context7.com/mcp"'
    Set-TomlSectionKey $lines 'mcp_servers.context7' 'enabled' 'true'
    Set-TomlSectionKey $lines 'mcp_servers.serena' 'command' '"serena"'
    Set-TomlSectionKey $lines 'mcp_servers.serena' 'args' '["start-mcp-server", "--project-from-cwd", "--context=codex"]'
    Set-TomlSectionKey $lines 'mcp_servers.serena' 'startup_timeout_sec' '20'
    Set-TomlSectionKey $lines 'mcp_servers.serena' 'enabled' 'false'
    Set-TomlSectionKey $lines 'mcp_servers.playwright' 'command' '"cmd"'
    Set-TomlSectionKey $lines 'mcp_servers.playwright' 'args' '["/c", "npx", "-y", "@playwright/mcp@latest"]'
    Set-TomlSectionKey $lines 'mcp_servers.playwright' 'startup_timeout_sec' '60'
    Set-TomlSectionKey $lines 'mcp_servers.playwright' 'enabled' 'false'
    Set-TomlSectionKey $lines 'mcp_servers.chrome-devtools' 'command' '"cmd"'
    Set-TomlSectionKey $lines 'mcp_servers.chrome-devtools' 'args' '["/c", "npx", "-y", "chrome-devtools-mcp@latest", "--slim", "--headless"]'
    Set-TomlSectionKey $lines 'mcp_servers.chrome-devtools' 'startup_timeout_sec' '60'
    Set-TomlSectionKey $lines 'mcp_servers.chrome-devtools' 'enabled' 'false'

    if ($PSCmdlet.ShouldProcess($configPath, 'Fusionar configuración del Orquestador')) {
        New-Item -ItemType Directory -Force $CodexHome | Out-Null
        [IO.File]::WriteAllText($configPath, (($lines -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine), $Utf8NoBom)
    }
}

function Merge-AgentsGuidance {
    $target = Join-Path $CodexHome 'AGENTS.md'
    Backup-ItemIfPresent $target
    $existing = if (Test-Path -LiteralPath $target) { [IO.File]::ReadAllText($target) } else { '' }
    $existing = [regex]::Replace($existing, '(?s)\r?\n?<!-- ORQUESTADOR:START -->.*?<!-- ORQUESTADOR:END -->\r?\n?', '')
    $managed = [IO.File]::ReadAllText((Join-Path $KitRoot 'AGENTS.md')).Trim()
    $result = ($existing.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + '<!-- ORQUESTADOR:START -->' + [Environment]::NewLine + $managed + [Environment]::NewLine + '<!-- ORQUESTADOR:END -->' + [Environment]::NewLine).TrimStart()
    if ($PSCmdlet.ShouldProcess($target, 'Fusionar instrucciones globales')) {
        [IO.File]::WriteAllText($target, $result, $Utf8NoBom)
    }
}

function Merge-Hooks {
    $target = Join-Path $CodexHome 'hooks.json'
    Backup-ItemIfPresent $target
    if (Test-Path -LiteralPath $target) {
        $document = [IO.File]::ReadAllText($target) | ConvertFrom-Json
    } else {
        $document = [pscustomobject]@{ description = 'User-level Codex hooks'; hooks = [pscustomobject]@{} }
    }
    if (-not $document.hooks) { $document | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) -Force }
    $groups = @()
    if ($document.hooks.PreToolUse) { $groups = @($document.hooks.PreToolUse) }
    $groups = @($groups | Where-Object {
        $commands = @($_.hooks | ForEach-Object { [string]$_.commandWindows + [string]$_.command })
        -not (($commands -join ' ') -match 'orquestador-git-guard\.ps1')
    })
    $guardGroup = [pscustomobject]@{
        matcher = '^Bash$'
        hooks = @([pscustomobject]@{
            type = 'command'
            commandWindows = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "& (Join-Path $env:USERPROFILE ''.codex\hooks\orquestador-git-guard.ps1'')"'
            command = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "& (Join-Path $env:USERPROFILE ''.codex\hooks\orquestador-git-guard.ps1'')"'
            timeout = 5
            statusMessage = 'Validando política Git'
        })
    }
    $groups += $guardGroup
    $document.hooks | Add-Member -NotePropertyName PreToolUse -NotePropertyValue $groups -Force
    if ($PSCmdlet.ShouldProcess($target, 'Fusionar hook de política Git')) {
        [IO.File]::WriteAllText($target, (($document | ConvertTo-Json -Depth 20) + [Environment]::NewLine), $Utf8NoBom)
    }
}

Assert-Command codex | Out-Null
Assert-Command git | Out-Null
Assert-Command powershell | Out-Null

if (Assert-Command engram -Optional) {
    $pluginList = (& codex plugin list 2>&1 | Out-String)
    $engramPluginEnabled = $pluginList -match '(?m)^engram@engram\s+installed, enabled\b'
    if ($engramPluginEnabled) {
        Write-Host 'Engram ya está instalado y habilitado como plugin nativo; no se repite setup.'
    } elseif ($PSCmdlet.ShouldProcess('Engram', 'Configurar integración con Codex')) {
        & engram setup codex
    }
} else {
    Write-Warning 'Engram no está instalado; el resto del kit se instalará, pero la memoria quedará inactiva.'
}

if ($WithSerena -and -not (Assert-Command serena -Optional)) {
    Assert-Command uv | Out-Null
    if ($PSCmdlet.ShouldProcess('Serena', 'Instalar con uv tool install')) { & uv tool install serena-agent }
}

New-Item -ItemType Directory -Force $CodexHome, $SkillsHome | Out-Null
Merge-CodexConfig
Merge-AgentsGuidance
Merge-Hooks

$agentSource = Join-Path $KitRoot '.codex\agents'
$agentTarget = Join-Path $CodexHome 'agents'
foreach ($file in Get-ChildItem -LiteralPath $agentSource -Filter '*.toml') {
    $destination = Join-Path $agentTarget $file.Name
    Backup-ItemIfPresent $destination
    Copy-OwnedFile $file.FullName $destination
}

if ($WithSerena) {
    foreach ($name in @('explorador.toml', 'reviewer.toml')) {
        $path = Join-Path $agentTarget $name
        if ($PSCmdlet.ShouldProcess($path, 'Habilitar Serena para este agente')) {
            $content = [IO.File]::ReadAllText($path)
            $content = [regex]::Replace($content, '(?ms)(\[mcp_servers\.serena\]\s*)enabled\s*=\s*false', '${1}enabled = true')
            [IO.File]::WriteAllText($path, $content, $Utf8NoBom)
        }
    }
}

foreach ($skillName in @('constructor', 'revisor-completo')) {
    $source = Join-Path $KitRoot ".agents\skills\$skillName"
    $destination = Join-Path $SkillsHome $skillName
    Backup-ItemIfPresent $destination
    if ($PSCmdlet.ShouldProcess($destination, "Instalar skill $skillName")) {
        New-Item -ItemType Directory -Force $SkillsHome | Out-Null
        Copy-Item -LiteralPath $source -Destination $SkillsHome -Recurse -Force
    }
}

Copy-OwnedFile (Join-Path $KitRoot '.codex\rules\orquestador.rules') (Join-Path $CodexHome 'rules\orquestador.rules')
Copy-OwnedFile (Join-Path $KitRoot '.codex\hooks\git-guard.ps1') (Join-Path $CodexHome 'hooks\orquestador-git-guard.ps1')

if ($WithSecurity) {
    if ($PSCmdlet.ShouldProcess('codex-security@openai-curated', 'Instalar plugin')) {
        & codex plugin add codex-security@openai-curated
    }
}

Write-Host "Orquestador instalado en $CodexHome"
Write-Host 'Abrí una sesión nueva de Codex, revisá /hooks y ejecutá .\verify.ps1 -Global.'
