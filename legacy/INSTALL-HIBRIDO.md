# Instalación del Orquestador Híbrido

Guía para dejar el entorno completo funcionando desde cero en otra máquina
(Windows + PowerShell 5.1). Qué hace y por qué: [README.md](README.md).

Tiempo estimado: 20–30 min, casi todo esperando descargas.

---

## 0. Camino rápido — instalador

Para el caso normal no hace falta seguir esta guía a mano:

```powershell
git clone https://github.com/Javier12301/Claudio-y-Gepeto
cd Claudio-y-Gepeto

# Ver qué va a hacer, sin tocar nada:
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-hibrido.ps1 -WhatIf

# Instalar:
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-hibrido.ps1
```

Ramifica según `codex login status`: con sesión de ChatGPT instala los dos kits,
sin ella instala solo el lado Claude, te dice qué falta y sigue funcionando en
modo Claude-solo. Respalda en `~/.claude/orquestador-backups/<timestamp>` antes
de pisar cualquier archivo tuyo, y termina corriendo la verificación.

**Dos cosas quedan afuera a propósito**, porque no se pueden ejecutar a ciegas:
los plugins (`/plugin install` solo corre dentro de una sesión de Claude Code) y
los MCPs (necesitan `npx`/`uv`). El instalador los detecta y te lista los
comandos exactos que faltan.

El resto de esta guía es la versión manual, y sigue siendo la referencia de qué
hace cada paso y por qué.

---

## Índice

0. [Camino rápido — instalador](#0-camino-rápido--instalador)
1. [Prerequisitos](#1-prerequisitos)
2. [Kit Claude](#2-kit-claude)
3. [Kit Codex](#3-kit-codex)
4. [Puente híbrido](#4-puente-híbrido)
5. [Verificación](#5-verificación)
6. [Smoke tests](#6-smoke-tests)
7. [Actualizar y desinstalar](#7-actualizar-y-desinstalar)
   · [7.1. Actualizar desde una versión anterior](#71-actualizar-desde-una-versión-anterior-a-las-skills-de-documentación)
8. [Problemas conocidos](#8-problemas-conocidos)

> ¿Ya tenías el kit instalado y solo querés la versión nueva? Andá directo
> a [7.1](#71-actualizar-desde-una-versión-anterior-a-las-skills-de-documentación).

---

## 1. Prerequisitos

```powershell
claude --version      # probado con 2.1.240
codex  --version      # probado con 0.149.0
git    --version
pwsh   --version      # PowerShell 7+ — ver abajo
node   --version      # solo para los MCP de navegador
```

`pwsh` 7 es la runtime declarada del kit ([`D-014`](docs/DECISIONS.md)). En Windows
PowerShell 5.1 sigue alcanzando para correr todo, pero `pwsh` hace falta igual por
dos motivos: es lo que permite que el kit corra fuera de Windows, y es lo que
**Serena** necesita para levantar su language server de PowerShell — sin él, sus
herramientas de símbolos fallan en cualquier repo que declare ese LS.

```powershell
winget install --id Microsoft.PowerShell -e
```

Después de instalarlo hay que **reabrir Claude Code**: los servidores MCP heredan
el PATH del proceso que los lanzó, así que Serena no lo ve hasta la sesión
siguiente.

Ambos CLIs autenticados con **suscripción**, no con API key:

```powershell
codex login           # elegí "Sign in with ChatGPT"
codex login status    # debe decir: Logged in using ChatGPT
```

> El wrapper nunca cae a API key automáticamente: cambiaría el modelo de
> facturación esperado sin que lo pidas.

---

## 2. Kit Claude

Seguí [`Orquestador/INSTALL.md`](Orquestador/INSTALL.md) completo. Resumen:

```powershell
# plugins (desde una sesión de Claude Code)
/plugin marketplace add Gentleman-Programming/engram
/plugin install engram@engram
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail

# MCPs
claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp@latest
winget install --id=astral-sh.uv -e     # cerrá y reabrí la terminal
uv tool install -p 3.13 serena-agent
claude mcp add --scope user serena -- serena start-mcp-server --context claude-code --project-from-cwd
```

Skills, agentes y statusline. Son **tres** skills: `orquestador` (la que invocás
vos) más `brainstorming` y `documentacion`, que solo invoca el orquestador.

```powershell
$dst = "$env:USERPROFILE\.claude"
New-Item -ItemType Directory -Force "$dst\skills","$dst\agents" | Out-Null
Copy-Item ".\Orquestador\skills\*"    "$dst\skills\" -Recurse -Force
Copy-Item ".\Orquestador\agents\*.md" "$dst\agents\" -Force

git clone https://github.com/daniel3303/ClaudeCodeStatusLine "$dst\statusline"
Copy-Item ".\Orquestador\statusline-wrapper.ps1" "$dst\" -Force
```

> La statusline **no es opcional en el entorno híbrido**: su cache es de donde el
> wrapper lee la cuota de Claude. Sin ella, esa mitad del gate de presupuesto
> queda ciega y se trata como WARN.

---

## 3. Kit Codex

```powershell
cd codex\Orquestador
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1
.\verify.ps1 -Global
```

Instala los 9 roles en `~/.codex/agents`, las skills en `~/.agents/skills`, la
regla y el hook de git, y fusiona los defaults en `~/.codex/config.toml` sin
pisar configuración ajena. Los backups quedan en `~/.codex/orquestador-backups\`.

Después, **dentro de Codex**, confiá el hook:

```text
/hooks
```

---

## 4. Puente híbrido

Los archivos que hacen la integración:

```powershell
$dst = "$env:USERPROFILE\.claude"
New-Item -ItemType Directory -Force "$dst\scripts","$dst\hooks" | Out-Null

# el wrapper: único punto de delegación a Codex
Copy-Item ".\Orquestador\scripts\codex-run.ps1" "$dst\scripts\" -Force

# el guard de git del lado Claude (mismo script que usa Codex)
Copy-Item ".\Orquestador\hooks\git-guard.ps1"   "$dst\hooks\"   -Force

# observabilidad del lado Claude: spawns, suites y fricción
Copy-Item ".\Orquestador\hooks\orq-metrics.ps1" "$dst\hooks\"   -Force
```

La skill del orquestador se copia **entera con su carpeta**, no solo el
`SKILL.md`: el core apunta a `references/` y sin esa carpeta quedan punteros a
archivos que no existen.

```powershell
Copy-Item ".\Orquestador\skills\orquestador" "$dst\skills\" -Recurse -Force
```

Y mergeá `Orquestador\settings-snippet.json` en `~/.claude/settings.json`.
**Fusionar, no reemplazar**: `permissions.deny`, `permissions.allow`,
`hooks.PreToolUse` y `hooks.PostToolUse` se agregan a lo que ya tengas.

Lo que aporta cada clave:

| Clave | Para qué |
|---|---|
| `permissions.deny` | Bloquea las formas directas de publicar cambios |
| `hooks.PreToolUse` → `git-guard.ps1` | Cubre además `git -C` y `--git-dir=`, que la deny rule no alcanza |
| `hooks.PreToolUse` → `orq-metrics.ps1` (matcher `Agent`) | Registra el arranque de cada subagente |
| `hooks.PostToolUse` → `orq-metrics.ps1` (matcher `Agent\|Bash`) | Duración de cada spawn y resultado de cada corrida de tests |
| `permissions.allow` → `codex-run.ps1` | Evita un prompt de permiso en cada delegación |
| `attribution` + `includeCoAuthoredBy` | Commits sin atribución de IA |
| `model: opus` + `effortLevel: medium` | El Orquestador corre en Opus |
| `defaultMode: bypassPermissions` | Flujo sin prompts. Las deny rules siguen vigentes igual |

`orq-metrics.ps1` corre en `PostToolUse` sobre **cada** comando Bash. Está escrito
para no poder interrumpir nada: ante cualquier error escribe nada, emite `{}` y
sale con 0.

Reiniciá Claude Code para que tome los hooks nuevos.

---

## 5. Verificación

```powershell
claude mcp list       # serena y context7 conectados
codex doctor          # todo en verde
codex plugin list     # engram@engram: installed, enabled
engram version
```

En una sesión nueva de Claude Code:

1. `/skills` → aparece `orquestador`
2. `/agents` → `explorador`, `constructor`, `tester`
3. `/status` → permission mode `bypassPermissions`
4. La barra de estado muestra los % de rate limit 5h/7d **sin `?`** en las horas

El puente:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\scripts\codex-run.ps1" -BudgetOnly -Verbose
```

Salida esperada: ejemplo y umbrales de presupuesto en
[`docs/SYSTEM.md` § 2 Reglas de negocio](docs/SYSTEM.md#2-reglas-de-negocio).

Si los slugs de modelo son otros, está bien: se resuelven del catálogo vivo. Lo
que importa es que los tres tiers resuelvan a algo.

---

## 6. Smoke tests

| # | Qué valida | Cómo | Esperado |
|---|---|---|---|
| 1 | Trivial no levanta Codex | pedile un rename de variable | lo hace Opus solo; sin línea en `decisions.jsonl` |
| 2 | Lectura de cuotas | `-BudgetOnly` | ambos % y un veredicto |
| 3 | Modelos por tier | `-BudgetOnly -Verbose` | los 3 tiers resuelven a slugs reales |
| 4 | Guard de Codex (reglas) | ver abajo | `forbidden` / `prompt`, nunca vacío |
| 5 | Guard de Claude (hook) | ver abajo | denegado por el hook |
| 6 | TDD híbrido | feature mediana | Tester RED → Codex GREEN → Claude revisa |
| 7 | Cross-review | `-Role reviewer` | findings `[P#] archivo:línea` |
| 8 | Contexto acotado | mirá la spec enviada | solo objetivo + paths + tests, sin historial |
| 9 | Output compacto | cualquier delegación | ≤20 líneas |
| 10 | Reuso de sesión | implementá algo y pedí "agregá X" | mismo `SESSION_ID`, prompt corto |
| 11 | Umbral de reuso | `-Resume` sobre sesión >1.2 MB | `REUSE-DENIED` |
| 12 | Aislamiento de rol | reviewer tras constructor | sesión nueva, no hereda |
| 13 | NO-GO por cuota | `-MinFreePercent 99` | sale sin invocar a Codex, exit 2 |
| 14 | Sin autenticar | `codex logout` en una prueba | mensaje claro, exit 5, sin fallback a API key |
| 15 | Serena resuelve simbolos | ver abajo | ~20 funciones de `codex-run.ps1` |
| 16 | Senal de vida de Codex | ver abajo | el log crece mientras corre |

**Test 4** — sin publicar nada:

```powershell
codex execpolicy check --rules "$env:USERPROFILE\.codex\rules\orquestador.rules" git push origin main
codex execpolicy check --rules "$env:USERPROFILE\.codex\rules\orquestador.rules" git -C . push origin main
```

Primero → `forbidden`. Segundo → `prompt` (las `prefix_rule` solo expresan
prefijos de argv; la cobertura total la da el hook).

**Test 5** — creá un repo de prueba **sin remote configurado** y pedile a Claude
que corra `git -C <ese-repo> push origin main`. Debe responder el guard:

```
Bloqueado por el Orquestador: publicar cambios es exclusivo del usuario.
```

Sin remote, aunque el guard fallara no habría a dónde publicar. **No pruebes esto
en un repo real.**

**Test 15** — el unico que confirma que Serena funciona de verdad. Pedile a
Claude, en una sesion abierta:

> corré `get_symbols_overview` sobre `Orquestador/scripts/codex-run.ps1`

Debe devolver ~20 funciones (`Get-CodexQuota`, `Invoke-CodexCli`, …). Si tira
error o vuelve vacío, andá a [§ 8 — *Serena no devuelve símbolos*](#8-problemas-conocidos).

> **`verify.ps1` no puede validar esto.** Solo comprueba que `pwsh` esté en el
> PATH y que el MCP esté configurado — que Serena *resuelva* símbolos depende de
> un language server que vive en el proceso del MCP, y eso únicamente se ve desde
> una sesión de Claude. Un `verify.ps1` en verde **no** garantiza que Serena ande.

**Test 16** — mientras una delegación a Codex está corriendo, en otra ventana:

```powershell
Get-Content -Wait "$env:TEMP\claude\codex-live.log"
```

El archivo crece línea a línea mientras Codex trabaja. En paralelo, la barra de
estado muestra `CX> <rol> <tiempo> <evento>`, y el segmento desaparece solo
cuando la corrida termina.

**Test 13**:

```powershell
powershell -File "$env:USERPROFILE\.claude\scripts\codex-run.ps1" -Role verifier `
  -Prompt "no importa" -MinFreePercent 99
```

---

## 7. Actualizar y desinstalar

**Actualizar el kit**: `git pull` y volvé a correr el instalador. Es la misma
operación que instalar — respalda todo antes de pisar y no duplica hooks ni
permisos.

```powershell
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-hibrido.ps1 -WhatIf
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-hibrido.ps1
```

**Para saber si hace falta**, corré la verificación: compara por hash lo instalado
en `~/.claude` contra el repo y marca en FAIL cada archivo que quedó atrás.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Orquestador\verify.ps1
```

Los respaldos quedan en `~/.claude/orquestador-backups\<timestamp>` y
`~/.codex/orquestador-backups\<timestamp>`. **Nada los borra**: si molestan, se
limpian a mano.

**Actualizar los CLIs**: `codex update`. Hacelo *después* de que los smoke tests
pasen, para no cambiar la base bajo los pies.

### 7.0. Actualizar a la versión con delegación selectiva y métricas

Es la actualización más reciente. Si venís de cualquier versión anterior, **corré
el instalador y listo** — hace todo esto solo, respalda lo que pisa y no toca el
lado Codex:

```powershell
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-hibrido.ps1
```

Después **reiniciá Claude Code**: hay hooks nuevos y una carpeta de skill nueva,
y ninguna de las dos cosas se toma en caliente de forma confiable.

**Cómo saber en cuál estás:**

```powershell
Test-Path "$env:USERPROFILE\.claude\skills\orquestador\references\retro.md"
```

`False` → estás en una versión anterior.

**Qué cambia:**

| Componente | ¿Cambió? |
|---|---|
| `skills/orquestador/` | **Sí** — el `SKILL.md` es un core más chico y hay una carpeta `references/` nueva con cinco archivos |
| `agents/tester.md`, `agents/constructor.md` | **Sí** — suman el contrato de frenar (`NEEDS_INFO`) y las reglas de test |
| `agents/explorador.md` | **Sí** — reporta ambigüedades en vez de resolverlas |
| `hooks/orq-metrics.ps1` | **Nuevo** |
| `settings.json` | **Sí** — un `PreToolUse` y un `PostToolUse` nuevos para el hook de métricas |
| `scripts/codex-run.ps1` | **No cambió** |
| `hooks/git-guard.ps1` | **No cambió** |
| Kit Codex (`~/.codex`) | **No cambió nada** |

> [!IMPORTANT]
> Si copiás a mano en vez de usar el instalador, copiá la **carpeta** de la skill,
> no el `SKILL.md` suelto. El core apunta a `references/` y sin esa carpeta el
> orquestador queda con punteros a archivos que no existen.

**Verificación** — el instalador la corre solo al terminar, pero a mano es:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Orquestador\verify.ps1
```

Tiene que decir `reference retro.md presente` y `settings registra el hook de
metricas en PostToolUse`. Si aparece "hay una versión más nueva en el repo",
volvé a correr el instalador.

**Primera señal de que las métricas andan**: después de una tarea con delegación,
`.orquestador/decisions.jsonl` en el repo donde trabajaste tiene líneas con
`"event"`. El informe de cierre:

```powershell
powershell -NoProfile -File "$env:USERPROFILE\.claude\hooks\orq-metrics.ps1" -Feedback
```

### 7.1. Actualizar desde una versión anterior a las skills de documentación

Si ya tenías el kit híbrido funcionando y querés la versión con `brainstorming`,
`documentacion` y sincronización de documentación, esto es lo único que cambia.

**Cómo saber en cuál estás:**

```powershell
Test-Path "$env:USERPROFILE\.claude\skills\documentacion"
```

`False` → estás en la versión anterior.

**Qué hay que tocar y qué no:**

| Componente | ¿Hace falta actualizarlo? |
|---|---|
| Skills de Claude | **Sí** — hay dos skills nuevas y `orquestador` cambió |
| `agents/tester.md` | **Sí** — suma la trazabilidad de reglas `BR-00X` |
| `agents/constructor.md`, `agents/explorador.md` | No cambiaron |
| `scripts/codex-run.ps1` | **No cambió** |
| `hooks/git-guard.ps1` y `settings.json` | **No cambiaron** |
| Kit Codex (`~/.codex`) | **No cambió nada**. No hace falta correr `install.ps1` |

O sea: **el puente y el lado Codex quedan como están**. Es una actualización solo
del lado Claude.

> [!IMPORTANT]
> El comando de copia de la versión anterior copiaba un único archivo
> (`skills\orquestador\SKILL.md`). Si lo usás, las dos skills nuevas no se
> instalan y el orquestador va a intentar invocar skills que no existen. Usá el
> comando de abajo, que copia el árbol entero.

Desde la raíz del kit nuevo (mismas rutas que el paso 2):

```powershell
$dst = "$env:USERPROFILE\.claude"
Copy-Item ".\Orquestador\skills\*"    "$dst\skills\" -Recurse -Force
Copy-Item ".\Orquestador\agents\*.md" "$dst\agents\" -Force
```

POSIX:

```bash
cp -R Orquestador/skills/. ~/.claude/skills/
cp Orquestador/agents/*.md ~/.claude/agents/
```

**Reiniciá la sesión de Claude Code.** Los archivos sueltos se detectan en
caliente, pero las carpetas de skill nuevas no siempre.

**Verificación:**

```powershell
# 1. Las tres skills instaladas
Get-ChildItem "$env:USERPROFILE\.claude\skills" -Name
# esperado: brainstorming, documentacion, orquestador

# 2. El agent tester trae la trazabilidad
Select-String "BR-00X" "$env:USERPROFILE\.claude\agents\tester.md"

# 3. El puente sigue intacto
powershell -NoProfile -File "$env:USERPROFILE\.claude\scripts\codex-run.ps1" -BudgetOnly
```

Si el paso 3 devuelve el veredicto de presupuesto como siempre, la actualización
no tocó nada del híbrido.

**Sobre tus proyectos ya documentados**: no hay migración. La documentación que ya
tengas se queda como está y el orquestador la adopta en el formato en que esté —
nunca crea un `docs/SYSTEM.md` al lado de documentación que ya existe, y no genera
documentación nueva sin pedirte permiso primero.

**Volver atrás**: borrá `~/.claude/skills/brainstorming` y
`~/.claude/skills/documentacion`, y restaurá `skills/orquestador/SKILL.md` y
`agents/tester.md` desde tu copia anterior del kit. No hay estado persistido en
ningún lado que haya que limpiar.

**Desinstalar el puente** (deja ambos kits intactos):

```powershell
Remove-Item "$env:USERPROFILE\.claude\scripts\codex-run.ps1"
Remove-Item "$env:USERPROFILE\.claude\hooks\git-guard.ps1"
```

y sacá de `~/.claude/settings.json` el bloque `hooks.PreToolUse` del guard y la
entrada `permissions.allow` del wrapper.

---

## 8. Problemas conocidos

**El guard bloquea un comando compuesto entero.** Si cualquier parte del comando
dispara la regla, se deniega todo. Es correcto, pero sorprende: partí el comando.

**La statusline no muestra nada.** Necesita el clon en `~/.claude/statusline` y
`statusline-wrapper.ps1` en `~/.claude`. Sin `-ExecutionPolicy Bypass`, una policy
`Restricted` la rechaza en silencio.

**Horas con `?` en la statusline.** Falta el wrapper: el script upstream usa la
cultura del sistema y PowerShell 5.1 emite en codepage OEM.

**`codex exec` falla con "input is not valid UTF-8".** Versión vieja del wrapper.
El actual escribe bytes UTF-8 directo al stream (.NET Framework no tiene
`StandardInputEncoding`).

**"Output schema file is not valid JSON".** Ídem: `Set-Content -Encoding UTF8`
escribe BOM en PS 5.1. El wrapper actual usa `UTF8Encoding($false)`.

**Serena no devuelve símbolos.** `get_symbols_overview` o `find_symbol` sobre un
`.ps1` tira error o vuelve vacío, y la Fase 2 del SKILL cae a `Grep` sin que se
note. **Causa:** `.serena/project.yml` declara el language server `powershell`,
que necesita `pwsh` 7+. **Y hay un segundo paso que es el que se olvida:** el MCP
hereda el PATH del proceso que lo lanzó, así que instalar `pwsh` con Claude Code
abierto **no alcanza** — el MCP sigue con el PATH viejo hasta que se relanza.

```powershell
pwsh --version                    # si falla: winget install Microsoft.PowerShell
```

**Fix: instalá `pwsh` 7 y cerrá y reabrí Claude Code.** Después verificá con el
Test 15 de § 6. Si `pwsh --version` anda en la terminal pero Serena sigue sin
resolver, es que la sesión se abrió antes de la instalación: reabrila.

**No sé si Codex sigue vivo.** Una delegación tarda minutos y antes era silencio
total. Hoy el wrapper vuelca el stream `--json` a un log a medida que llega:

```powershell
Get-Content -Wait "$env:TEMP\claude\codex-live.log"
```

Y la barra de estado muestra `CX> <rol> <tiempo> <último evento>` mientras corre.
El segmento sale de `$env:TEMP\claude\codex-activity.json`, que el wrapper borra
al terminar: por eso desaparece solo. Si el segmento queda pegado, la statusline
lo descarta igual a los 90 segundos sin refresco.

**Instalar `pwsh` 7 rompe cmdlets de PowerShell 5.1.** El instalador de
PowerShell 7 antepone sus módulos al `PSModulePath` de la máquina. Cuando arranca
**5.1**, resuelve `Microsoft.PowerShell.Utility` de la 7.x y algunos cmdlets dejan
de existir — `Get-FileHash` es el caso confirmado:

```powershell
powershell -NoProfile -Command "Get-Command Get-FileHash"   # CommandNotFoundException
```

El kit no depende de ninguno: la detección de deriva usa SHA256 por .NET, que no
pasa por el autoload de módulos. Pero si tenés scripts propios en 5.1 que sí lo
usan, el diagnóstico es este, no una instalación corrupta. Comprobación:

```powershell
powershell -NoProfile -Command "$env:PSModulePath = 'C:\WINDOWS\system32\WindowsPowerShell\v1.0\Modules'; Get-Command Get-FileHash"
```

Si ahí aparece, el `PSModulePath` es la causa.

**Codex reporta que no puede ejecutar Python.** El sandbox puede denegar los
intérpretes instalados desde la Microsoft Store (`WindowsApps\python.exe`). Instalá
Python desde python.org. Codex marca `tests: NOT_RUN` en vez de inventar un GREEN.

**Codex falla con `CreateProcessAsUserW` error 1920.** El rol quedó en
`sandbox_mode = "workspace-write"` o `"read-only"`. Bajo `[windows] sandbox = "elevated"`
ninguno de los dos puede lanzar el proceso hijo: los que escriben fallan al tocar el
repo, los lectores (`reviewer`, `security-reviewer`, `docs-researcher`, `explorador`)
al invocar `git` o `rg`. Los nueve roles del kit van en
`danger-full-access`; corré `codex\Orquestador\install.ps1` de nuevo, o verificá con
`codex\Orquestadorerify.ps1 -Global`. Ojo: no alcanza con tocar
`~/.codex/config.toml`, porque `codex-run.ps1` pasa el sandbox por `-s` desde
`~/.codex/agents/<rol>.toml` y el flag de CLI le gana al config global.

**Una corrida de Codex se cuelga hasta el timeout.** Suele ser un hook que escribe
algo distinto del JSON del contrato en stdout. Un hook `PreToolUse` debe emitir
**solo** su JSON.

**El hook no se aplica tras editar `hooks.json`.** Cambia el hash de confianza:
volvé a `/hooks` dentro de Codex y confiálo.
