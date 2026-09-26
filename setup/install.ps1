# Instalador de ClaudeGPT para Windows.
# Verifica Node, instala Codex CLI en la versión estable verificada, copia la
# config base de Codex si no existe e imprime los comandos /plugin a correr.
#
# Uso: powershell -ExecutionPolicy Bypass -File setup\install.ps1 [-DryRun]

param([switch]$DryRun)

$ErrorActionPreference = 'Stop'

# Versión estable verificada en Windows. Subirla solo después de probar una
# versión nueva en uso real sin que se abran ventanas de consola; si reaparecen,
# volver de inmediato a la última estable.
$CODEX_VERSION_WINDOWS = '0.157.1'

$NODE_MIN_MAJOR = 18
$CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

Step 'Verificando Node y npm'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node no está instalado. Instalá Node $NODE_MIN_MAJOR+ (https://nodejs.org) y volvé a correr." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail 'npm no está en el PATH.' }
$nodeVersion = (& node --version).TrimStart('v')
if ([int]($nodeVersion.Split('.')[0]) -lt $NODE_MIN_MAJOR) { Fail "Node $nodeVersion es viejo; hace falta $NODE_MIN_MAJOR+." }
Write-Host "    node $nodeVersion"

Step "Config de Codex en $CodexHome"
$target = Join-Path $CodexHome 'config.toml'
if (Test-Path $target) {
  Write-Host '    config.toml ya existe: no se toca'
} elseif ($DryRun) {
  Write-Host "    [dry-run] copiar setup\codex-config.toml -> $target"
} else {
  New-Item -ItemType Directory -Force -Path $CodexHome | Out-Null
  Copy-Item (Join-Path $PSScriptRoot 'codex-config.toml') $target
  Write-Host "    copiado $target"
}

# En PowerShell 5.1, con ErrorActionPreference=Stop, cualquier línea de stderr de
# un ejecutable nativo (warnings de codex o npm) corta el script. Las llamadas
# nativas corren con Continue y se juzgan por $LASTEXITCODE.
$ErrorActionPreference = 'Continue'

Step "Codex CLI $CODEX_VERSION_WINDOWS"
$current = $null
if (Get-Command codex -ErrorAction SilentlyContinue) {
  $out = (& codex --version 2>$null | Out-String)
  if ($out -match '(\d+\.\d+\.\d+)') { $current = $Matches[1] }
}
if ($current -eq $CODEX_VERSION_WINDOWS) {
  Write-Host "    ya instalado ($current)"
} elseif ($DryRun) {
  Write-Host "    [dry-run] npm install -g @openai/codex@$CODEX_VERSION_WINDOWS (actual: $(if ($current) { $current } else { 'ninguna' }))"
} else {
  & npm install -g "@openai/codex@$CODEX_VERSION_WINDOWS"
  if ($LASTEXITCODE -ne 0) { Fail 'npm install falló.' }
}

Write-Host ''
Step 'Listo. Falta, en este orden:'
Write-Host @"
  1. En una terminal:   codex login        (cuenta ChatGPT; si ya lo hiciste, saltealo)
  2. Dentro de Claude Code:
       /plugin marketplace add openai/codex-plugin-cc
       /plugin install codex@openai-codex
       /plugin marketplace add Javier12301/ClaudeGPT
       /plugin install claudegpt@claudegpt
       /plugin install claudegpt-notify@claudegpt     (opcional)
       /reload-plugins
       /codex:setup
  3. Probar:   /claudegpt:orquestador <requerimiento>
No actives el review gate de Codex (/codex:setup --enable-review-gate): el orquestador decide cuándo revisar.
"@
