<#
.SYNOPSIS
    Instala el Orquestador Hibrido: kit Claude siempre, kit Codex si hay sesion.

.DESCRIPTION
    Ramifica segun `codex login status`. Sin Codex autenticado instala solo el
    lado Claude y dice que falta, en vez de fallar: el kit funciona en modo
    Claude-solo, con el gate degradado a routing por naturaleza de la tarea.

    Ninguno de los dos instaladores pisa un archivo sin respaldarlo antes, y los
    dos soportan -WhatIf.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install-hibrido.ps1 -WhatIf

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install-hibrido.ps1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    # Instala solo el lado Claude aunque Codex este autenticado.
    [switch]$ClaudeOnly,
    # Se pasan tal cual al instalador de Codex.
    [switch]$WithSerena,
    [switch]$WithSecurity
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot

function Invoke-Installer {
    param([string]$Path, [hashtable]$Extra = @{})
    if (-not (Test-Path -LiteralPath $Path)) { throw "No se encontro el instalador: $Path" }
    Write-Host ''
    Write-Host "=== $Path ===" -ForegroundColor Cyan
    $params = @{}
    foreach ($k in $Extra.Keys) { $params[$k] = $Extra[$k] }
    if ($WhatIfPreference) { $params['WhatIf'] = $true }
    if ($VerbosePreference -eq 'Continue') { $params['Verbose'] = $true }
    & $Path @params
}

# --- lado Claude: siempre ---
Invoke-Installer (Join-Path $Root 'Orquestador\install.ps1')

# --- lado Codex: solo con sesion de ChatGPT ---
$codexReady = $false
if ($ClaudeOnly) {
    Write-Host ''
    Write-Host 'Modo -ClaudeOnly: se saltea el kit de Codex.' -ForegroundColor Yellow
} elseif (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
    Write-Warning "'codex' no esta en PATH. Se instalo solo el kit Claude."
} else {
    $status = (& codex login status 2>&1 | Out-String)
    # El wrapper nunca cae a API key: cambiaria el modelo de facturacion sin que
    # lo pidas. Por eso se exige sesion de ChatGPT, no cualquier credencial.
    if ($status -match '(?i)ChatGPT') {
        $codexReady = $true
        Invoke-Installer (Join-Path $Root 'codex\Orquestador\install.ps1') @{
            WithSerena = [bool]$WithSerena; WithSecurity = [bool]$WithSecurity
        }
    } else {
        Write-Warning 'Codex no esta autenticado con ChatGPT. Se instalo solo el kit Claude.'
        Write-Host '  Para completar el entorno hibrido:  codex login   (elegi "Sign in with ChatGPT")' -ForegroundColor Yellow
        Write-Host '  Y despues:  powershell -NoProfile -ExecutionPolicy Bypass -File .\install-hibrido.ps1' -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host '=== Verificacion ===' -ForegroundColor Cyan
if ($WhatIfPreference) {
    Write-Host '(-WhatIf: no se verifica nada, no se instalo nada)'
} else {
    & (Join-Path $Root 'Orquestador\verify.ps1')
    if ($codexReady) { & (Join-Path $Root 'codex\Orquestador\verify.ps1') -Global }
}

Write-Host ''
if ($codexReady) {
    Write-Host 'Entorno hibrido instalado. Abri una sesion nueva de Claude Code y deci: "Trabaja como Orquestador".' -ForegroundColor Green
} else {
    Write-Host 'Kit Claude instalado (modo Claude-solo). El gate va a routear sin Codex hasta que lo autentiques.' -ForegroundColor Yellow
}
