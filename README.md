# ClaudeGPT

Una skill que convierte a tu agente en **Tech Lead**: investiga, pregunta, arma un plan
por fases y, solo cuando conviene, delega en otros agentes CLI (Codex, OpenCode, Gemini,
Claude…) a través de [Orca](https://github.com/stablyai/orca). Se activa **solo cuando la
llamás**; el resto del tiempo tu agente funciona normal.

Funciona en **Windows y Linux**.

---

## Instalación rápida

**1. Lo imprescindible**

| Herramienta | Para qué | Instalación |
|---|---|---|
| **Node.js 18+** | `npx` para instalar skills | https://nodejs.org |
| **Claude Code** (o Codex) | Donde corre la skill | https://claude.com/claude-code |
| **Orca** | Lanza y supervisa los demás agentes | https://github.com/stablyai/orca (releases) |
| **Codex CLI** | Tests, tareas delegadas y reviews | `npm i -g @openai/codex@latest` y después `codex login` |

**2. ClaudeGPT y las skills de Orca**

```bash
npx skills add Javier12301/ClaudeGPT --skill claudegpt -g -a claude-code codex -y
orca skills install --skill orca-cli --skill orchestration
```

En Linux, fuera de una terminal de Orca, usá `orca-ide` en vez de `orca`.
No toca ninguna configuración tuya: solo copia las skills.

**3. Reiniciá tu agente** y probá: `/claudegpt <requerimiento>`.

---

## Actualizar

```bash
npx skills update claudegpt -g                       # ClaudeGPT
npm i -g @openai/codex@latest                        # Codex CLI
codex app-server daemon update                       # daemon de Codex (misma versión que el CLI)
```

Orca se actualiza desde la propia app. Para desinstalar ClaudeGPT:
`npx skills remove claudegpt -g`.

**¿Venís de la v2 (plugin `/claudegpt:orquestador`)?** Quitá el plugin viejo; si no, Claude
Code muestra el error `Failed to load marketplace "claudegpt"`:

```bash
claude plugin uninstall claudegpt@claudegpt
claude plugin uninstall claudegpt-notify@claudegpt   # si lo tenías
claude plugin marketplace remove claudegpt
```

El plugin `codex@openai-codex` ya no hace falta para ClaudeGPT; podés dejarlo si usás sus
comandos `/codex:*`.

---

## Herramientas recomendadas

Ninguna es obligatoria: la skill las usa si están y sigue sin ellas. Mejoran mucho el
flujo porque el agente gasta menos contexto y trabaja con información actualizada.

| Herramienta | Qué aporta | Instalación |
|---|---|---|
| **[CodeGraph](https://github.com/colbymchenry/codegraph)** | Mapa del código consultable: el agente encuentra símbolos y llamadas sin leer archivos enteros ni levantar exploradores | `npm i -g @colbymchenry/codegraph` → `codegraph install` (conecta tus agentes) → `codegraph init` en cada repo |
| **[Engram](https://github.com/Gentleman-Programming/engram)** | Memoria entre sesiones: decisiones, preferencias y hallazgos no se pierden | Binario desde [releases](https://github.com/Gentleman-Programming/engram/releases) (en el PATH) → `engram setup claude-code` y `engram setup codex` |
| **[Context7](https://github.com/upstash/context7)** | Documentación de librerías al día, en vez de lo que el modelo recuerda | `npx ctx7 setup` o `claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp` · Codex: `codex mcp add context7 --url https://mcp.context7.com/mcp` |
| **[Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)** | Probar interfaces en desktop y mobile, ver network y consola | `claude mcp add --scope user chrome-devtools -- npx -y chrome-devtools-mcp@latest` · Codex: `codex mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest` |
| **[OpenCode](https://opencode.ai)** | Ejecutor con modelos económicos o gratuitos para datos y tareas mecánicas | `npm i -g opencode-ai` |
| **find-skills** | Buscar skills especializadas cuando hacen falta | `npx skills add vercel-labs/skills --skill find-skills -g -y` |

---

## Configurar Orca (una sola vez)

En **Orca → Settings → Agents**:

- **Permisos: Manual.** En Yolo, Orca lanza los agentes sin sandbox ni confirmaciones.
- **Activá** los agentes que vayas a usar (Codex, OpenCode, Gemini…).
- Si un agente no arranca, mirá su terminal en Orca: suele ser un aviso de actualización
  o un login vencido.

---

## Uso

En Claude Code `/claudegpt`, en Codex `$claudegpt`:

```text
/claudegpt Implementar importación masiva de productos.

Preferencias:
- Implementación: decidí vos
- Tester: Codex
- Review: Codex
- Generación de categorías: OpenCode
```

Las preferencias son opcionales y mandan sobre el criterio del Tech Lead. Se pueden dar
por rol, fase o tarea, con cualquier agente que Orca soporte. Si pedís uno que no está
instalado, la skill te avisa y te ofrece una alternativa; nunca lo cambia en silencio.

Flujo: requerimiento → preguntas solo de lo que falta → investigación → plan por fases →
**tu aprobación** → ejecución → validación → reviews → cierre.

Para retomar después de un corte o en otra sesión: `/claudegpt continuar`.

### Reglas que siempre se cumplen

- Commits por unidad lógica, **sin `Co-Authored-By`** ni trailers de atribución.
- **Nunca `git push`.**
- Delegar solo cuando conviene; nada de levantar agentes porque sí.
- Quien implementa no escribe los tests que lo validan ni se revisa a sí mismo.
- Review de Codex con `codex review`; los findings los arbitra el Tech Lead.

---

## Cómo funciona por dentro

| Ejecutor | Vía |
|---|---|
| Tech Lead | El agente donde invocaste la skill |
| Codex (implementar, testear) | `codex exec` con sandbox `workspace-write` |
| Codex (review) | `codex review` (usa la skill oficial `review-agent` de OpenAI) |
| OpenCode, Gemini, Claude y otros | Workers supervisados de Orca |

Codex no va como worker de Orca porque en Windows, con sandbox, no puede avisar que
terminó ([stablyai/orca#13539](https://github.com/stablyai/orca/issues/13539)).

En el repo que se orquesta quedan `IMPLEMENTATION.md` (plan y fases), `HANDOFF.md`
(solo para retomar) y `/docs` (conocimiento estable).

---

## Problemas comunes

| Síntoma | Qué hacer |
|---|---|
| `/claudegpt` no aparece | `npx skills ls -g` debe listar `claudegpt`; reiniciá el agente |
| Codex muestra "Background server has incompatible feature settings" | CLI y daemon en versiones distintas: corré los comandos de **Actualizar** |
| Un worker de Orca no arranca | Mirá su terminal en Orca (aviso de update, login vencido) |
| Orca agrega flags duplicadas o lanza agentes sin sandbox | Orca → Settings → Agents: permisos en Manual |

---

## Estructura

- `skills/claudegpt/` — la skill (`SKILL.md`, `references/delegacion.md`, plantillas,
  `agents/openai.yaml` para Codex).
- `docs/decisions.md` — por qué está hecho así.
- Versiones anteriores: tag `v1-final` (runtime `orq`) y el historial de la v2 (plugin de
  Claude Code sobre `codex-plugin-cc`).

Licencia MIT.
