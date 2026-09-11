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
$previousClaudeHome = $env:CLAUDE_HOME
$env:CLAUDE_HOME = $tmp
try {

# settings previos del usuario: claves propias, un git-guard ya registrado y un
# hook propio que no se puede perder.
@'
{
  "miClavePropia": "no me toques",
  "model": "sonnet",
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

# El hook de metricas vive en dos eventos: PreToolUse sobre Agent y PostToolUse
# sobre Agent|Bash. El merge tiene que instalar los dos, no solo el primero.
$mPre  = @($d.hooks.PreToolUse  | Where-Object { (@($_.hooks | ForEach-Object { [string]$_.command }) -join ' ') -match 'orq-metrics' })
$mPost = @($d.hooks.PostToolUse | Where-Object { (@($_.hooks | ForEach-Object { [string]$_.command }) -join ' ') -match 'orq-metrics' })
T ($mPre.Count -eq 1)  'instala orq-metrics en PreToolUse'
T ($mPost.Count -eq 1) 'instala orq-metrics en PostToolUse'
T ($mPost[0].matcher -match 'Bash') 'el PostToolUse de metricas matchea Bash'

T ($d.model -eq 'sonnet')      'NO pisa el model que ya eligio el usuario'
T ($d.effortLevel -eq 'medium') 'siembra effortLevel cuando falta'

T ($d.enabledPlugins.'miPlugin@x' -eq $true)    'preserva un plugin propio'
T ($d.enabledPlugins.'engram@engram' -eq $true) 'agrega los plugins del kit'

# Idempotencia: reinstalar no acumula nada.
& $Installer -SkipStatusLine 2>&1 | Out-Null
$d2 = Get-Content (Join-Path $tmp 'settings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$g2 = @($d2.hooks.PreToolUse | Where-Object { (@($_.hooks | ForEach-Object { [string]$_.command }) -join ' ') -match 'git-guard' })
T ($g2.Count -eq 1) 'reinstalar no duplica el hook'
$m2 = @($d2.hooks.PostToolUse | Where-Object { (@($_.hooks | ForEach-Object { [string]$_.command }) -join ' ') -match 'orq-metrics' })
T ($m2.Count -eq 1) 'reinstalar no duplica el hook de metricas'
T (@($d2.permissions.deny).Count -eq @($d.permissions.deny).Count) 'reinstalar no duplica los deny'
T ((Get-ChildItem (Join-Path $tmp 'orquestador-backups') -Directory).Count -eq 2) 'cada corrida deja su respaldo'

T ($d2.model -eq 'sonnet') 'reinstalar no revierte el model del usuario'

# verify.ps1 punta a punta contra el CLAUDE_HOME temporal. No importa el veredicto
# --faltan la statusline y los MCPs a proposito-- sino que corra entero sin tirar.
# Un cmdlet que se evapora (paso con Get-FileHash cuando pwsh 7 sombreo el
# PSModulePath de 5.1) rompe el instalador entero y ningun otro check lo ve.
# En proceso hijo: Check usa Write-Host, que va al host y no al stream de salida,
# asi que un `& script` desde aca no captura una sola linea.
# Ademas hay que bajar a Continue: el stderr del hijo mezclado con 2>&1 bajo
# ErrorActionPreference=Stop mata esta suite en vez de dar un FAIL legible.
$psExe = (Get-Process -Id $PID).Path
$verifyText = & {
    $ErrorActionPreference = 'Continue'
    (& $psExe -NoProfile -ExecutionPolicy Bypass `
       -File (Join-Path $PSScriptRoot '../verify.ps1') 2>&1 | Out-String)
}
T ($verifyText -notmatch 'no se reconoce|is not recognized|CommandNotFoundException') `
  'verify.ps1 corre entero sin cmdlets faltantes'
T ($verifyText -match 'al dia respecto del repo') 'verify.ps1 evalua la deteccion de deriva'

# --- maquina virgen -----------------------------------------------------------
#
# Es el camino real de instalar en otra computadora, y NO es el mismo que
# reinstalar encima: no hay settings.json que fusionar, no hay directorios
# creados, y un archivo nuevo del kit que el instalador no copie no lo detecta
# ningun test de merge.
$virgin = Join-Path $env:TEMP ("claude-virgin-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $virgin | Out-Null
$env:CLAUDE_HOME = $virgin
try {
    & $Installer -SkipStatusLine 2>&1 | Out-Null

    foreach ($rel in @(
        'skills/orquestador/SKILL.md',
        'skills/orquestador/references/routing.md',
        'skills/orquestador/references/codex.md',
        'skills/orquestador/references/docs-matrix.md',
        'skills/orquestador/references/capsule.md',
        'skills/orquestador/references/retro.md',
        'skills/brainstorming/SKILL.md',
        'skills/documentacion/SKILL.md',
        'agents/explorador.md', 'agents/tester.md', 'agents/constructor.md',
        'hooks/git-guard.ps1', 'hooks/orq-metrics.ps1',
        'scripts/codex-run.ps1', 'statusline-wrapper.ps1', 'settings.json'
    )) {
        T (Test-Path (Join-Path $virgin $rel)) "virgen: instala $rel"
    }

    # Todo reference del repo tiene que llegar, no solo los que estan listados
    # arriba: si se agrega uno nuevo y el instalador no lo copia, esto lo caza.
    $repoRefs = @(Get-ChildItem (Join-Path $PSScriptRoot '../skills/orquestador/references') -Filter '*.md')
    $instRefs = @(Get-ChildItem (Join-Path $virgin 'skills/orquestador/references') -Filter '*.md' -ErrorAction SilentlyContinue)
    T ($repoRefs.Count -gt 0 -and $repoRefs.Count -eq $instRefs.Count) `
      "virgen: llegan los $($repoRefs.Count) references del repo"

    $vd = Get-Content (Join-Path $virgin 'settings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    T ($vd.permissions.deny -contains 'Bash(git push:*)') 'virgen: siembra el deny de git push'
    T ($vd.permissions.defaultMode -eq 'bypassPermissions') 'virgen: siembra defaultMode'
    T ($vd.model -eq 'opus') 'virgen: siembra el model del kit cuando no hay uno elegido'
    $vPost = @($vd.hooks.PostToolUse | Where-Object {
        (@($_.hooks | ForEach-Object { [string]$_.command }) -join ' ') -match 'orq-metrics'
    })
    T ($vPost.Count -eq 1) 'virgen: registra el hook de metricas en PostToolUse'
}
finally {
    $env:CLAUDE_HOME = $tmp
    if (Test-Path $virgin) { Remove-Item -Recurse -Force $virgin }
}
}
finally {
    $env:CLAUDE_HOME = $previousClaudeHome
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
}

if (-not $ok) { Write-Host "`nmerge de settings CON FALLAS" -ForegroundColor Red; exit 1 }
Write-Host "`nmerge de settings OK" -ForegroundColor Green
