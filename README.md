# ClaudeGPT

Claude trabaja como **Tech Lead**: investiga, pregunta, arma un plan por fases y reparte
el trabajo entre él mismo, subagentes Sonnet y **Codex**. Se activa **solo cuando lo
llamás** con `/claudegpt:orquestador`. El resto del tiempo, Claude Code funciona normal.

Funciona en **Windows y Linux**.

---

## Qué necesitás

| Herramienta | Para qué | Cómo se instala |
|---|---|---|
| **Claude Code** | Donde corre todo | https://claude.com/claude-code |
| **Git** | Clonar este repo | https://git-scm.com |
| **Node.js 18 o más** | Lo necesita Codex | https://nodejs.org |
| **Cuenta de ChatGPT** | Para iniciar sesión en Codex | — |
| **Codex CLI** | El ejecutor externo | Lo instala el script del paso 2 |
| **Plugin `codex`** (de OpenAI) | Conecta Claude Code con Codex | Paso 4 |
| **Plugin `claudegpt`** (este repo) | El orquestador | Paso 5 |
| Plugin `claudegpt-notify` | Notificación de escritorio (opcional) | Paso 5 |

---

## Instalación en una máquina nueva

**1. Clonar el repo**

```bash
git clone https://github.com/Javier12301/ClaudeGPT.git
cd ClaudeGPT
```

**2. Correr el instalador**

Verifica Node, instala Codex CLI y crea la config de Codex (`~/.codex/config.toml`).
Si esa config ya existe, no la toca.

- Windows (PowerShell):
  ```powershell
  powershell -ExecutionPolicy Bypass -File setup\install.ps1
  ```
- Linux:
  ```bash
  bash setup/install.sh
  ```

**3. Iniciar sesión en Codex** (se abre el navegador; entrá con tu cuenta de ChatGPT)

```bash
codex login
```

**4. En Claude Code: instalar el plugin de Codex**

```
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
```

**5. En Claude Code: instalar ClaudeGPT**

```
/plugin marketplace add Javier12301/ClaudeGPT
/plugin install claudegpt@claudegpt
/plugin install claudegpt-notify@claudegpt
```

La última línea es opcional: sirve para recibir una notificación cuando Claude termina.

**6. Recargar y verificar**

```
/reload-plugins
/codex:setup
```

`/codex:setup` tiene que decir que Codex está listo y con la sesión iniciada.
**No** actives el "review gate" que te ofrece: el orquestador decide cuándo revisar.

Listo.

---

## Cómo se usa

Escribí `/claudegpt:orquestador`, seguido de lo que querés y, si querés, de quién hace qué:

```
/claudegpt:orquestador Agregar login con Google. Tests: Codex. Review: Codex. Implementación: decidí vos.
```

También podés pasarle un archivo con el análisis:

```
/claudegpt:orquestador docs/analisis-login.md
```

Qué pasa después:

1. **Investiga y pregunta.** Arranca en modo plan, lee el código y te hace preguntas hasta cerrar las dudas.
2. **Te muestra el plan.** Incluye qué se puede hacer, qué no y los riesgos, dividido en fases, con quién hace cada una.
3. **Vos aprobás.** Guarda el plan en `IMPLEMENTATION.md` y empieza.
4. **Trabaja fase por fase.** Hace un commit por cada bloque terminado y pide reviews a Codex cuando conviene. **Nunca hace `git push`.**
5. **Si la conversación se vuelve muy larga,** guarda el estado y te sugiere hacer `/compact`.

**Para seguir otro día, o después de un `/compact`:**

```
/claudegpt:orquestador continuar
```

Lee `HANDOFF.md` e `IMPLEMENTATION.md` y sigue donde había quedado.

---

## Actualizar

```
/plugin marketplace update claudegpt
/reload-plugins
```

---

## Si algo falla

| Problema | Solución |
|---|---|
| `/claudegpt:orquestador` no aparece | `/reload-plugins`, y revisá que `/plugin` muestre `claudegpt` instalado |
| Codex dice que no hay sesión | `codex login` en una terminal |
| El review de Codex no arranca solo | El orquestador te muestra el comando para escribirlo a mano (por ejemplo `/codex:review --base main`) |
| En Windows se abren ventanas de consola con Codex | Volvé a la versión estable: en `setup/install.ps1`, `$CODEX_VERSION_WINDOWS` tiene la última versión verificada; volvé a correr el instalador |
| La notificación molesta o da problemas | `/plugin uninstall claudegpt-notify@claudegpt` (el orquestador no la necesita) |

---

## Detalles técnicos

- **Reviews automáticos:** `/codex:review` solo se puede invocar a mano. Para lanzarlo
  solo, `plugins/claudegpt/scripts/codex-review.mjs` busca el plugin de Codex instalado
  y lo llama directo. Esto depende de cómo está armado internamente el plugin de Codex:
  si cambia, el orquestador se detiene y te pide el comando manual. Nunca saltea el review.
- **Versión de Codex:** en Windows se usa la última versión probada sin ventanas
  (`$CODEX_VERSION_WINDOWS`, hoy 0.157.1). Subila solo después de probar una nueva. En
  Linux se instala la última (`latest`).
- **Estructura:** `plugins/claudegpt/` (skill y wrapper de review),
  `plugins/claudegpt-notify/` (opcional), `setup/` (instaladores y config de Codex),
  `docs/decisions.md` (por qué está hecho así).
- **Tests:** `node --test "plugins/*/test/*.test.mjs"` y `claude plugin validate .`
- **Versión anterior** (runtime `orq`): tag `v1-final`.

Licencia MIT.
