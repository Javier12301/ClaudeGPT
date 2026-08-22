<#
    Verifica que Merge-Settings de install.ps1 fusione settings.json sin destruir
    lo del usuario y sin acumular al reinstalar. Corre contra un CLAUDE_HOME
    temporal: nunca toca la instalacion real.

    Mismo patron sin dependencias que test-codex-run.ps1.
#>
$ErrorActionPreference = 'Stop'
$Installer = Join-Path $PSScriptRoot '..\install.ps1'
$tmp = Join-Path $env:TEMP ("claude-merge-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tmp | Out-Null
$env:CLAUDE_HOME = $tmp

# settings previos del usuario: claves propias, un git-guard ya registrado y un
# hook propio que no se puede perder.
@'
{
  "miClavePropia": "no me toques",
  "permissions": {
    "deny": ["Bash(rm -rf:*)"],
    "allow": ["Bash(npm test:*)"],
    "defaultMode": "acceptEdits"
  },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "powershell -File ~/.claude/hooks/git-guard.ps1" } ] },
      { "matcher": "Write", "hooks": [ { "type": "command", "command": "mi-hook-propio.ps1" } ] }
    ]
  },
  "enabledPlugins": { "miPlugin@x": true }
}
'@ | Set-Content -LiteralPath (Join-Path $tmp 'settings.json') -Encoding UTF8

& $Installer -SkipStatusLine 2>&1 | Out-Null

$d = Get-Content (Join-Path $tmp 'settings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$ok = $true
function T($c, $m) {
    if ($c) { Write-Host "[OK] $m" -ForegroundColor Green }
    else { Write-Host "[FAIL] $m" -ForegroundColor Red; $script:ok = $false }
}

T ($d.miClavePropia -eq 'no me toques')               'preserva una clave propia del usuario'
T ($d.permissions.deny -contains 'Bash(rm -rf:*)')    'preserva un deny propio'
T ($d.permissions.deny -contains 'Bash(git push:*)')  'agrega el deny de git push'
T ($d.permissions.allow -contains 'Bash(npm test:*)') 'preserva un allow propio'
T ($d.permissions.defaultMode -eq 'acceptEdits')      'NO pisa un defaultMode ya elegido'
T ($d.includeCoAuthoredBy -eq $false)                 'impone includeCoAuthoredBy=false'
T ($d.statusLine.command -match 'statusline-wrapper') 'impone la statusline del kit'

$guards = @($d.hooks.PreToolUse | Where-Object { (@($_.hooks | ForEach-Object { [string]$_.command }) -join ' ') -match 'git-guard' })
T ($guards.Count -eq 1) 'no duplica el hook git-guard preexistente'
$mine = @($d.hooks.PreToolUse | Where-Object { (@($_.hooks | ForEach-Object { [string]$_.command }) -join ' ') -match 'mi-hook-propio' })
T ($mine.Count -eq 1) 'preserva un hook propio del usuario'

T ($d.enabledPlugins.'miPlugin@x' -eq $true)    'preserva un plugin propio'
T ($d.enabledPlugins.'engram@engram' -eq $true) 'agrega los plugins del kit'

# Idempotencia: reinstalar no acumula nada.
& $Installer -SkipStatusLine 2>&1 | Out-Null
$d2 = Get-Content (Join-Path $tmp 'settings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$g2 = @($d2.hooks.PreToolUse | Where-Object { (@($_.hooks | ForEach-Object { [string]$_.command }) -join ' ') -match 'git-guard' })
T ($g2.Count -eq 1) 'reinstalar no duplica el hook'
T (@($d2.permissions.deny).Count -eq @($d.permissions.deny).Count) 'reinstalar no duplica los deny'
T ((Get-ChildItem (Join-Path $tmp 'orquestador-backups') -Directory).Count -eq 2) 'cada corrida deja su respaldo'

Remove-Item -Recurse -Force $tmp
if (-not $ok) { Write-Host "`nmerge de settings CON FALLAS" -ForegroundColor Red; exit 1 }
Write-Host "`nmerge de settings OK" -ForegroundColor Green
