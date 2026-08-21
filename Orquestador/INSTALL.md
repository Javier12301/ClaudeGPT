# Instalación del entorno Orquestador (lado Claude)

Guía para dejar Claude Code listo desde cero (reset limpio en otra PC).
Windows con PowerShell; los comandos POSIX equivalentes están anotados donde
cambian.

> **Este documento cubre solo el lado Claude.** Para el entorno híbrido completo
> (Claude Code + Codex), instalá esto primero y después seguí
> [`../INSTALL-HIBRIDO.md`](../INSTALL-HIBRIDO.md). Qué hace y por qué:
> [`../README.md`](../README.md).
>
> Dos cosas cambian si vas al híbrido: la statusline pasa a ser **obligatoria**
> (su cache es de donde se lee la cuota de Claude), y `settings-snippet.json`
> incorpora un hook `PreToolUse` que cubre las formas de publicar cambios que la
> deny rule sola no alcanza (`git -C`, `--git-dir=`).

## Qué es esto

Un flujo tipo tech lead: **Opus orquesta**, los subagentes ejecutan en
Sonnet/Haiku.

| Pieza | Rol |
|---|---|
| `/orquestador` (skill) | Opus. Habla con el usuario, pregunta, planifica, revisa, aplica fixes < ~50 líneas. |
| `explorador` (agent) | Sonnet, solo lectura. Localiza código y devuelve hallazgos con `archivo:línea`. |
| `tester` (agent) | Sonnet. Escribe tests en RED desde la spec, **antes** que Constructor. |
| `constructor` (agent) | Sonnet. Implementa hasta GREEN. No escribe sus propios tests. |

---

## 1. Plugins

Desde una sesión de Claude Code:

```
/plugin marketplace add Gentleman-Programming/engram
/plugin install engram@engram

/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail
```

- **engram** — memoria persistente entre sesiones (`mem_save`, `mem_search`).
  Los tres agentes la usan.
- **ponytail** — disciplina anti-over-engineering. Se **precarga** en
  `constructor` y `tester` vía el campo `skills` de su frontmatter, así arrancan
  con la regla activa desde el turno 1 sin recordárselo en cada delegación.

Reiniciá Claude Code después de instalar los plugins.

---

## 2. MCPs

### context7 — obligatorio

Documentación actualizada de librerías/frameworks/CLIs. El Orquestador la
consulta antes de planificar contra una librería, y le pasa lo relevante ya
digerido al subagente (así el subagente no gasta tokens resolviendo docs).

```
claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp@latest
```

### serena — muy recomendado

Búsqueda semántica vía language server (`find_symbol`,
`find_referencing_symbols`). Es el mayor ahorro de tokens del flujo: el Explorador
lee símbolos exactos en vez de volcar archivos enteros.

Requiere [uv](https://docs.astral.sh/uv/), que **no viene con Python** — instalalo
primero:

```powershell
winget install --id=astral-sh.uv -e --accept-source-agreements --accept-package-agreements
```

Cerrá y reabrí la terminal (winget modifica el PATH), después:

```
uv tool install -p 3.13 serena-agent
claude mcp add --scope user serena -- serena start-mcp-server --context claude-code --project-from-cwd
```

`uv` deja los ejecutables en `~/.local/bin` (ya suele estar en PATH porque ahí
vive `claude.exe`). Verificá con `serena --version` antes de registrar el MCP.

Si preferís scope por proyecto:
`claude mcp add serena -- serena start-mcp-server --context claude-code --project "$(pwd)"`

### playwright — solo bajo pedido

E2E determinístico para regresión automatizada. **El Orquestador y el Tester no
lo invocan solos**: se usa únicamente cuando vos lo pedís para esa tarea.

```
claude mcp add --scope user playwright -- npx -y @playwright/mcp@latest
```

### chrome-devtools — solo bajo pedido

Performance, network, Web Vitals, profiling. Igual que Playwright: **solo cuando
vos lo pedís**.

```
claude mcp add --scope user chrome-devtools -- npx -y chrome-devtools-mcp@latest
```

### División de roles de browser

- **Chrome DevTools MCP = observar.** Diagnóstico de performance y network. Mira
  qué pasa en el navegador, no interactúa como usuario.
- **Playwright MCP = actuar.** Flujos E2E repetibles (login, checkout,
  formularios) como parte de la suite. Determinístico, pensado para regresión.
- **claude-in-chrome = uso personal tuyo.** Tu sesión autenticada, fuera del flujo
  de agentes. Ni el Orquestador ni el Tester lo invocan.

Si un test local necesita autenticación, vos pasás el token o la cuenta de
testing. Los agentes no inventan credenciales.

---

## 3. Copiar skills y agents

El kit tiene **tres skills**: `orquestador` (la que invocás vos) más
`brainstorming` y `documentacion`, que solo invoca el orquestador. Las tres tienen
que estar instaladas.

Desde la carpeta de este kit:

```powershell
$dst = "$env:USERPROFILE\.claude"
New-Item -ItemType Directory -Force "$dst\skills" | Out-Null
New-Item -ItemType Directory -Force "$dst\agents" | Out-Null
Copy-Item ".\skills\*"      "$dst\skills\" -Recurse -Force
Copy-Item ".\agents\*.md"   "$dst\agents\" -Force
```

POSIX:

```bash
mkdir -p ~/.claude/skills ~/.claude/agents
cp -R skills/. ~/.claude/skills/
cp agents/*.md ~/.claude/agents/
```

Claude Code detecta los archivos nuevos sin reiniciar, salvo que la carpeta
`skills/` o `agents/` no existiera al arrancar la sesión — en ese caso, reiniciá.

> [!NOTE]
> **¿Actualizando desde una versión anterior?** Los mismos dos comandos alcanzan:
> copian el árbol completo de `skills/`, así que traen `brainstorming` y
> `documentacion` además de `orquestador`. Reiniciá la sesión después, porque las
> carpetas de skill nuevas no siempre se detectan en caliente.
>
> Si tenés también el kit Codex, nada del lado Codex cambió con esta versión: el
> detalle completo está en
> [`INSTALL-HIBRIDO.md` § 7.1](../INSTALL-HIBRIDO.md#71-actualizar-desde-una-versión-anterior-a-las-skills-de-documentación).

---

## 4. Mergear `settings-snippet.json`

Abrí `~/.claude/settings.json` y **fusioná** las claves de `settings-snippet.json`
(no lo reemplaces: `permissions.deny` se agrega a lo que ya tengas).

Qué hace cada cosa:

- `attribution: { commits: false, pullRequests: false }` — los commits **no**
  llevan `Co-Authored-By: Claude` ni `🤖 Generated with Claude Code`.
  `includeCoAuthoredBy: false` va incluido por compatibilidad con versiones
  anteriores a la v2.0.62, donde esa era la clave.
- `permissions.deny: ["Bash(git push:*)"]` — el push queda bloqueado por
  configuración, no solo por prompt. **El push lo hacés vos, siempre.**
- `statusLine` — barra de estado de ClaudeCodeStatusLine (ver §4.5). Cloná el
  repo primero, si no la barra queda vacía.
- `model: opus` + `effortLevel: medium` — el Orquestador corre en Opus; los
  subagentes bajan a Sonnet/Haiku por llamada.

---

## 4.5. Status line (ClaudeCodeStatusLine)

Barra de estado con modelo, carpeta, branch, tokens de contexto usados, nivel de
effort, **% de rate limit de 5h y de 7d con hora de reset**, créditos extra y
avisos de update. Repo: <https://github.com/daniel3303/ClaudeCodeStatusLine>

```powershell
git clone https://github.com/daniel3303/ClaudeCodeStatusLine "$env:USERPROFILE\.claude\statusline"
```

Copiá el wrapper de este kit (arregla el encoding, ver abajo):

```powershell
Copy-Item ".\statusline-wrapper.ps1" "$env:USERPROFILE\.claude\" -Force
```

Y en `~/.claude/settings.json` (ya viene en `settings-snippet.json`):

```json
"statusLine": {
  "type": "command",
  "command": "powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/statusline-wrapper.ps1"
}
```

### Por qué el wrapper

El script upstream formatea horas y montos con la **cultura del sistema**. En un
Windows en español eso produce `11:00 p. m.` (con espacio duro U+00A0),
`sáb ago 22` y `$31,66` — y PowerShell 5.1 los emite en el codepage OEM, así que
los acentos y el espacio duro salen como `?`:

```
5h 44% @11:00p.?m. | 7d 4% @s?b ago 22, 9:00p.?m. | extra $31,66/$50,00
```

`statusline-wrapper.ps1` fija cultura invariante + salida UTF-8 antes de llamar
al script, y arregla las tres cosas de una:

```
5h 45% @11:00pm | 7d 4% @sat aug 22, 9:00pm | extra $31.66/$50.00
```

Va aparte a propósito: **no toca el clon**, así `git pull` sigue funcionando sin
conflictos.

Notas:

- Usa `powershell` (5.1, viene con Windows). Si tenés PowerShell 7 instalado,
  cambiá `powershell` por `pwsh`.
- `-ExecutionPolicy Bypass` es **por proceso**, no cambia la política de la
  máquina. Sin eso, una policy `Restricted` o `AllSigned` (típica en máquinas
  corporativas) rechaza el script en silencio y no ves ninguna barra.
- En Linux/Mac: apuntá directo a `~/.claude/statusline/statusline.sh` (el
  wrapper es solo para Windows/PowerShell) y asegurate de tener `jq` y `curl`.
- Los datos de rate limit necesitan login OAuth (Pro/Max). `STATUSLINE_CHECK_UPDATES=false`
  desactiva las llamadas a la API de GitHub.
- **Reemplaza la statusline de ponytail** (solo puede haber un `statusLine`). No
  vas a ver el badge `[PONYTAIL]`, pero el plugin sigue activo igual y el aviso
  de "STATUSLINE SETUP NEEDED" no vuelve a aparecer — el hook solo chequea que
  exista *alguna* `statusLine`.
- Para actualizar: `git pull` dentro de `~/.claude/statusline`.

---

## 4.6. Modo de permisos: bypassPermissions

`permissions.defaultMode: "bypassPermissions"` — las sesiones arrancan sin
prompts de permiso. Es lo que hace fluido el flujo del Orquestador: los
subagentes trabajan sin frenar cada Edit o Bash esperando confirmación.

**Lo que igual sigue bloqueado**: las docs son explícitas en que *"Deny rules
block in every mode, including `bypassPermissions`"*. O sea, `Bash(git push:*)`
sigue vigente — el push lo seguís haciendo solo vos. Tampoco se auto-aprueban
las acciones que ningún modo aprueba (reglas `ask` explícitas, tools de conector
que la organización marcó como `ask`).

**Lo que sí cambia**: se saltean los prompts de escritura a rutas protegidas como
`.git` y `.claude`, y las `allow` rules dejan de tener efecto (ya está todo
permitido). Anthropic recomienda este modo para entornos aislados. Si en la PC
del trabajo manejás repos ajenos o credenciales sensibles, considerá dejar
`"auto"` — que igual auto-aprueba, pero con un clasificador revisando cada acción.

Para volver atrás: cambiá `defaultMode` a `"auto"`. Para alternar en caliente
dentro de una sesión, `Shift+Tab` cicla los modos.

---

## 5. Verificación

En una sesión nueva:

1. `/skills` → aparece `orquestador`.
2. `/agents` → aparecen `explorador`, `constructor`, `tester` con sus modelos.
3. `/orquestador` → la skill carga y el rol queda activo.
4. En un repo chico, pedile una tarea ambigua y confirmá que:
   - hace `mem_search` antes de decidir,
   - pregunta 2–3 cosas con `AskUserQuestion`,
   - levanta `explorador`,
   - presenta un plan que dice **qué modelo usa cada agente**,
   - llama a `tester` **antes** que a `constructor`.
5. `constructor` debe arrancar con ponytail cargado (menciona la disciplina lazy
   sin que se la pidas) y no puede llamar `Agent`.
6. Commit de prueba → **no** debe aparecer `Co-Authored-By`.
7. Intentar `git push` → debe quedar bloqueado por la deny rule.
8. `claude mcp list` → `serena` y `context7` en ✔ Connected.
9. La barra de estado muestra modelo, contexto y los % de rate limit 5h/7d,
   **sin `?` en las horas** (`@11:00pm`, no `@11:00p.?m.`).
10. `/status` → permission mode en `bypassPermissions`.

---

## Reglas de git que aplica el Orquestador

- **Nunca** hace `git push`. Solo vos.
- **`git commit` solo si vos se lo pedís explícitamente.**
- Sin atribución a Claude en los mensajes de commit.

---

## Decisiones deliberadas

Ver [`docs/DECISIONS.md`](../docs/DECISIONS.md).
