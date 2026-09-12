# Instalación — Orquestador V2

Todo lo hace `orq`. Nunca hace falta editar `settings.json`, `hooks.json` ni
archivos de MCP a mano, ni pedirle a un modelo que "investigue cómo instalar".

## Requisitos

| | Versión | Obligatorio |
|---|---|---|
| Node.js | ≥ 22.16 | sí |
| git | cualquiera reciente | sí |
| Claude Code | ≥ 2.1.x | para el lado Claude |
| Codex CLI | ≥ 0.15x, sesión **ChatGPT** (`codex login`) | no: sin Codex, modo Claude-solo |

Nunca se usa API key para Codex: cambiaría el modelo de facturación.

**Windows, solo para compilar desde código fuente** (mientras no hay release
en npm): `npm run build` compila además `orq-hidden.exe` (launcher sin
consola para hooks/statusline, D-034) con `csc.exe`, incluido de fábrica en
Windows como parte de .NET Framework 4.x — no hace falta instalar nada. Si
falta (Windows recortado/Server Core), `npm run build` avisa y sigue; `orq
init` va a frenar hasta que se compile. Es dependencia de build únicamente:
quien solo *usa* `orq` en Windows recibe el `.exe` ya compilado, nunca
necesita un compilador.

## Instalar

```bash
# Hasta que el paquete se publique en npm:
git clone https://github.com/Javier12301/ClaudeGPT.git && cd ClaudeGPT
npm install && npm run build && npm link     # deja `orq` en el PATH

orq init --dry-run     # lista exacta de lo que va a crear o modificar
orq init
orq doctor
```

Cuando se publique: `npx orquestador init`.

`orq init`:

1. Verifica Node, git, Claude, Codex y la sesión de Codex.
2. Copia el runtime a `~/.orquestador/runtime/` (estable aunque se limpie el cache de npx).
3. Instala skills y agents en `~/.claude/`, y fusiona `settings.json`: hooks
   (`SessionStart`, git-guard, métricas), deny rules de `git push` en Bash y
   PowerShell, statusline de `orq`. **No** pisa claves ajenas ni siembra
   `bypassPermissions`. Si ya tenés otra statusline, no la toca (el gate no verá
   la cuota de Claude y lo avisa).
4. Con sesión ChatGPT de Codex: roles en `~/.codex/agents/`, rules, git-guard en
   `hooks.json`, bloque administrado en `~/.codex/AGENTS.md`, skill base en
   `~/.agents/skills/orquestador/`.
5. Registra con los CLIs los MCPs que falten: `context7` y `codegraph`
   (codegraph se instala pinneado en `~/.orquestador/tools/`, sin npm global).
6. Respalda cada archivo antes de modificarlo (`~/.orquestador/backups/`, se
   conservan los últimos 5) y escribe un manifiesto de todo lo instalado.

Opciones: `--dry-run` · `--claude-only` · `--offline` (sin MCPs ni descarga de
codegraph; code intel cae a `git`).

**Idempotente**: la segunda corrida responde "sin cambios" y no toca el disco.

## Por repo (opcional)

`orq.config.json` en la raíz del repo:

```json
{
  "checks": { "lint": "npm run lint", "typecheck": "npx tsc --noEmit", "test": "npm test", "build": "npm run build" },
  "codeIntel": "codegraph",
  "asyncReview": { "maxConcurrent": 1 }
}
```

Sin `checks`, `orq checkpoint fast` no adivina: sugiere desde `package.json`.
El estado del repo va a `.orquestador/`, que se auto-ignora en git. El índice de
codegraph va a `.codegraph/` (agregalo a tu `.gitignore`).

## Actualizar

```bash
git pull && npm install && npm run build
orq init          # reemplaza lo propio, respeta lo ajeno
orq doctor
```

## Migrar desde el kit PowerShell (V1)

```bash
orq migrate --dry-run
orq migrate
```

Respalda y borra `codex-run.ps1`, `git-guard.ps1`, `orq-metrics.ps1`,
`statusline-wrapper.ps1`, el clon de ClaudeCodeStatusLine, el git-guard
PowerShell de Codex, los roles `explorador`/`e2e-browser`/`browser-diagnostics` y
las skills `constructor`/`revisor-completo` de `~/.agents/skills`; después corre
`init`, que reemplaza los hooks y la statusline V1 en `settings.json`.

No revierte las claves que el V1 imponía en `~/.codex/config.toml` (`model` fijo,
`approval_policy = "never"`, `sandbox_mode = "danger-full-access"`): las nombra
para que decidas. El V2 no las necesita.

V2 deja de administrar Engram. Si la instalación V1 o el usuario ya tenían su
plugin o configuración global, `migrate` los conserva porque no puede demostrar
ownership del proyecto; el runtime, las skills y `doctor` no dependen de ellos.

Abrí una sesión nueva de Claude Code después de migrar: los hooks se cargan al
iniciar.

## Desinstalar

```bash
orq uninstall --dry-run
orq uninstall
```

Borra solo lo que figura en el manifiesto: archivos del kit, hooks y permisos
propios, statusline si es la de `orq`, bloque de `AGENTS.md`, MCPs que `orq`
registró, runtime y codegraph. Tu `settings.json` queda como estaba antes de
instalar. Los respaldos se conservan.

## Diagnóstico — `orq doctor`

| Línea | Qué verifica | Si no está bien |
|---|---|---|
| node / git / claude / codex | Presentes, versión, sesión ChatGPT de Codex | Instalar; `codex login` |
| runtime | Instalado y en la versión del paquete | `orq init` |
| hook git-guard / metrics / session-start | Registrados exactamente una vez | `orq init` |
| hooks V1 · instalación V1 | Restos PowerShell | `orq migrate` |
| git-guard PowerShell | El guard cubre la tool `PowerShell` | `orq init` |
| statusline | Es la de `orq` | Sin ella el gate no ve la cuota de Claude |
| permisos | `bypassPermissions` activo | Decisión tuya; `orq` no lo necesita |
| cuota Claude | Hay una lectura | Aparece tras la primera respuesta (planes Pro/Max) |
| archivos del kit | Todos los del manifiesto | `orq init` |
| codex git-guard · codex metrics · codex doctor | Guard, telemetría de subagentes nativos y salud de Codex | `orq init` |
| code intel · índice del repo | codegraph instalado; `.codegraph/` presente | `orq init`; `orq codeintel orient` |

`orq doctor --json` para máquinas. Sale con 1 si hay algún FAIL.

Cuando `orq init` cambia `~/.codex/hooks.json`, Codex invalida la confianza del
hash anterior. Abrí una sesión interactiva, ejecutá `/hooks` y revisá ese archivo
para habilitarlo. `orq` no automatiza esa decisión ni usa
`--dangerously-bypass-hook-trust`. Hasta entonces los checks de presencia de
`doctor` pueden estar GREEN aunque Codex omita esos hooks.

## Troubleshooting

**El gate dice "Sin lectura de la cuota de Claude".** La statusline no es la de
`orq`, el plan no expone `rate_limits` (solo Pro/Max), o todavía no hubo una
respuesta en la sesión. Degrada a `BALANCED`: no bloquea nada.

**`orq run` sale con 5.** Codex no está o no tiene sesión ChatGPT: `codex login`.

**`orq run` sale con 7.** Ya hay un reviewer activo para esa tarea: `orq jobs`.

**`orq run` sale con 4.** Codex falló (exit ≠ 0), no devolvió JSON, o violó el
contrato. El mensaje dice cuál y dónde está la salida completa; el trabajo parcial
queda en el working tree (`git diff`).

**Un `git push` legítimo está bloqueado.** Es a propósito: publicar es tuyo.
Corrélo vos en tu terminal. El guard evalúa el comando entero, así que también
bloquea un comando compuesto que contenga un push.

**`orq` no está en el PATH.** `npm link` desde el repo, o
`node ~/.orquestador/runtime/dist/cli.js`.

**codegraph no se instaló** (red, proxy). `orq init --offline` y code intel cae a
`git`; `orq init` de nuevo cuando haya red.

**Codex falla con `CreateProcessAsUserW` error 1920 en Windows.** Los roles del
kit conservan `danger-full-access` bajo `[windows] sandbox = "elevated"`
(D-017). En Codex 0.153.4, pedir `-s read-only` bajo la política administrada de
esta máquina siguió mostrando `danger-full-access`; no permitió demostrar un
sandbox efectivo de sólo lectura. Para `reviewer`, `security-reviewer` y
`docs-researcher`, "read-only" es una barrera de instrucciones, no de sandbox.
`orq init` reinstala esos `.toml` sin usar flags de bypass.

**Linux/macOS.** La lógica es la misma, pero todavía no hay una corrida real
end-to-end fuera de Windows (ROADMAP). Reportá lo que encuentres con `orq doctor --json`.
El launcher sin consola (D-034) es Windows-only y no toca el comando de hooks/
statusline en POSIX: nada nuevo que verificar ahí.

**`orq init` dice que falta `dist/native/orq-hidden.exe`.** Corré `npm run
build` en Windows con `csc.exe` disponible (viene con .NET Framework 4.x,
casi siempre presente; si falta, activar ".NET Framework 3.5" en "Activar o
desactivar características de Windows").
