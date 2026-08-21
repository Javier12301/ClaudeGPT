# Instalación del Orquestador Codex

Guía reproducible para Windows y PowerShell. El kit instala agentes y skills globalmente para usarlos desde cualquier repositorio.

## 1. Requisitos

- Codex CLI 0.147.0 o posterior.
- PowerShell 5.1 o posterior.
- Git.
- Node.js LTS, sólo para MCP de navegador.
- Engram, recomendado mediante `go install github.com/Gentleman-Programming/engram/cmd/engram@latest` o un binario oficial en el `PATH`.

Comprobación:

```powershell
codex --version
git --version
node --version
engram version
```

## 2. Instalar

Desde esta carpeta:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1
```

Opciones:

```powershell
.\install.ps1 -WhatIf
.\install.ps1 -WithSerena
.\install.ps1 -WithSecurity
.\install.ps1 -WithSerena -WithSecurity
```

El instalador:

1. hace backup de los archivos globales que va a tocar;
2. copia agents a `~/.codex/agents`;
3. copia skills a `~/.agents/skills`;
4. fusiona defaults en `~/.codex/config.toml`;
5. instala la rule y el hook de Git;
6. conserva instrucciones, hooks y configuración ajenos;
7. conserva Engram si el plugin nativo ya está habilitado; sólo ejecuta `engram setup codex` como fallback cuando falta esa integración.

Revisá y confiá el hook desde `/hooks`, luego iniciá una sesión nueva.

## 3. Configuración aplicada

- Principal: `gpt-5.6-sol`, reasoning Medium.
- Sandbox: `workspace-write`, red deshabilitada, approvals `on-request`.
- Windows: sandbox nativo `elevated`; usar `unelevated` sólo si políticas corporativas bloquean el modo recomendado.
- Concurrencia: cuatro subagentes como máximo.
- Status line nativa con modelo, reasoning, contexto, límites y branch.

No se usa `bypassPermissions` ni una status line externa.

## 4. Plugins y MCP

### Engram — fijo

El instalador detecta primero `engram@engram`. En una instalación nueva, instalá Engram y ejecutá el instalador; no hace falta repetir el setup si el plugin ya figura como `installed, enabled`.

```powershell
codex plugin list
engram doctor
```

Codex y Claude Code comparten `%USERPROFILE%\.engram\engram.db` en la misma PC. Este kit no activa sincronización entre máquinas.

### Context7 — fijo

Se configura como MCP remoto. Sol y `docs-researcher` pueden usarlo; los demás agentes lo deshabilitan.

El endpoint remoto funciona sin una dependencia local. Para mayores límites, agregá manualmente `bearer_token_env_var = "CONTEXT7_API_KEY"` a la sección de Context7 y definí la variable:

```powershell
[Environment]::SetEnvironmentVariable('CONTEXT7_API_KEY', 'tu-clave', 'User')
```

### Serena — opcional

```powershell
uv tool install serena-agent
.\install.ps1 -WithSerena
```

Sólo se habilita en `explorador` y `reviewer`. Para repos pequeños, `rg` y la exploración nativa suelen ser suficientes.

### Codex Security — opcional

```powershell
.\install.ps1 -WithSecurity
```

La revisión habitual usa `security-reviewer`. Para una auditoría profunda explícita se usa el plugin oficial y, cuando esté justificado, Sol con reasoning XHigh.

### Playwright y Chrome DevTools — bajo pedido

Quedan definidos pero deshabilitados en el agente principal. `e2e-browser` habilita Playwright y `browser-diagnostics` habilita Chrome DevTools.

Cada archivo de rol es una capa TOML validada por separado: todo MCP declarado debe repetir su transporte completo. `verify.ps1` lo comprueba para evitar regresiones.

## 5. Verificar

Si un subagente con rol personalizado falla al crearse, invocalo con `fork_turns = "none"` o con pocos turnos recientes; no combines `agent_type` con historial completo/`all`, porque el fork hereda el rol padre y Codex lo rechaza. El smoke debe comprobar un receiver/thread real, no confiar sólo en el texto final.

```powershell
.\verify.ps1
.\verify.ps1 -Global
```

También podés revisar manualmente:

```powershell
codex doctor
codex plugin list
codex mcp list
engram version
```

Dentro de Codex:

```text
/statusline
/hooks
```

## 6. Uso

Desde cualquier repo:

```powershell
codex
```

Solicitudes normales activan los skills por descripción. Usá `$constructor` o `$revisor-completo` sólo para forzar el routing.

## 7. Git

- `git push` queda bloqueado por rule y hook técnico.
- `git commit` exige aprobación y sólo debe solicitarse bajo pedido explícito.
- No se agrega atribución de IA.

El instalador y las verificaciones nunca ejecutan commit ni push.

## 8. Actualizar o reinstalar

Copiá una versión nueva del kit y repetí:

```powershell
.\install.ps1
.\verify.ps1 -Global
```

Los backups quedan en `~/.codex/orquestador-backups/`. El instalador reemplaza únicamente los agentes, skills y bloques que administra.
