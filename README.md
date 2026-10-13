# ClaudeGPT

Una skill que convierte a tu agente en **Tech Lead**: investiga, pregunta, arma un plan
por fases y, solo cuando conviene, delega en otros agentes CLI (Codex, OpenCode, Gemini,
Claude…) a través de [Orca](https://github.com/stablyai/orca). Se activa **solo cuando la
llamás**; el resto del tiempo tu agente funciona normal.

Funciona en **Windows y Linux**.

---

## Qué necesitás

| Herramienta | Para qué |
|---|---|
| Un agente con soporte de skills: **Claude Code** (Tech Lead por defecto) o **Codex** | Donde corre la skill |
| **Node.js 18+** | `npx skills` |
| **[Orca](https://github.com/stablyai/orca)** abierto | Lanzar y supervisar agentes que no son Codex |
| **Codex CLI** (`npm i -g @openai/codex@latest`, `codex login`) | Tests, tareas delegadas y reviews |
| Opcionales: OpenCode, Gemini u otros agentes de Orca | Si los vas a pedir como ejecutores |

---

## Instalación

```bash
# Skills oficiales de Orca (si todavía no las tenés).
# En Linux, fuera de una terminal de Orca, usá orca-ide en vez de orca.
orca skills install --skill orca-cli --skill orchestration

# ClaudeGPT, global, para Claude Code y Codex
npx skills add Javier12301/ClaudeGPT --skill claudegpt -g -a claude-code codex -y
```

La instalación no toca ninguna configuración tuya; solo copia la skill.

**Actualizar:** `npx skills update claudegpt -g` · **Desinstalar:** `npx skills remove claudegpt -g`

Desde un clon local: `npx skills add <ruta-al-clon> --skill claudegpt -g -a claude-code codex -y`.

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
**tu aprobación** → ejecución → validación → reviews → cierre. Cada fase tiene ejecutor,
validación, criterio de done y commit.

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
| OpenCode, Gemini, Claude y otros | Workers supervisados de Orca (`orca orchestration worker-start`) |

Codex no va como worker de Orca porque en Windows, con sandbox, no puede avisar que
terminó ([stablyai/orca#13539](https://github.com/stablyai/orca/issues/13539)).

Estado de una implementación en el repo que se orquesta: `IMPLEMENTATION.md` (plan y
fases), `HANDOFF.md` (solo para retomar) y `/docs` (conocimiento estable). Lo operativo
de los workers lo guarda Orca.

---

## Problemas comunes

| Síntoma | Qué hacer |
|---|---|
| `/claudegpt` no aparece | `npx skills ls -g` debe listar `claudegpt`; reiniciá el agente |
| Codex muestra "Background server has incompatible feature settings" | CLI y daemon en versiones distintas: `npm i -g @openai/codex@latest` y `codex app-server daemon update` |
| Un worker de Orca no arranca (`agent_readiness`) | Mirá su terminal en Orca: suele ser un aviso de update o un login vencido del agente |
| Orca agrega flags duplicadas a un agente | Orca → Settings → Agents: revisá permisos y argumentos por defecto |

---

## Estructura

- `skills/claudegpt/` — la skill (`SKILL.md`, `references/delegacion.md`, plantillas,
  `agents/openai.yaml` para Codex).
- `docs/decisions.md` — por qué está hecho así.
- Versiones anteriores: tag `v1-final` (runtime `orq`) y el historial de la v2 (plugin de
  Claude Code sobre `codex-plugin-cc`).

Licencia MIT.
