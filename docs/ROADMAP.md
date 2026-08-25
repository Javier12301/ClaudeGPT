# Roadmap — Orquestador Híbrido Claude + Codex

Qué falta, en qué estado está, qué no construir todavía. Cómo funciona lo ya
terminado → [`SYSTEM.md`](SYSTEM.md).

---

## Fase 1 — Kit híbrido Claude + Codex

Estado: DONE

- [x] Integración híbrida Claude Code + Codex vía `codex exec`
- [x] Wrapper único de delegación (`Orquestador/scripts/codex-run.ps1`)
- [x] Routing consciente de presupuesto (cuotas Claude + Codex)
- [x] Resolución de modelos por tier contra catálogo vivo
- [x] Reutilización inteligente de sesiones de Codex
- [x] Contratos de salida forzados por JSON Schema
- [x] Observabilidad (`.orquestador/decisions.jsonl`)
- [x] Guard de git de cuatro capas (Claude + Codex)
- [x] `README.md` e `INSTALL-HIBRIDO.md` para el entorno completo
- [x] Diagramas Mermaid de arquitectura, routing y TDD

## Fase 2 — Brainstorming, plan gate y auto-documentación

Estado: IN_PROGRESS

- [x] Skill `brainstorming`
- [x] Skill `documentacion`
- [x] Cambios en la skill `orquestador` (Fases 0.6 y 6, columna de impacto
      documental en el routing A–H)
- [x] Trazabilidad BR en `tester`
- [x] Bootstrap documental (partir `README.md` en `docs/SYSTEM.md`,
      `docs/DECISIONS.md`, `docs/ROADMAP.md` y `CHANGELOG.md`)
- [ ] Verificación en uso real: que el caso A siga sin costar nada y que el flujo
      de brainstorming llegue a `EnterPlanMode`

## Fase 2.5 — Capacity routing

Estado: IN_PROGRESS. Ver
[D-013](DECISIONS.md#d-013--sonnet-lead-en-vez-de-codex-lead).

- [x] Umbrales de presupuesto y capacidad como constantes nombradas
- [x] Estado de capacidad en dos capas (`BR-003`), con precedencia ordenada y
      degradación a `BALANCED` sin lectura de cuota
- [x] Gate de la ventana de 7 días
- [x] `SONNET-LEAD` con regla de no insistir
- [x] Campos `state`, `phase`, `retry_of`, `claude_7d_used` en `decisions.jsonl`
- [x] Contract gate, verify ladder, anti-retry (`BR-008`), reviewer batcheado
- [x] Escalera de exploración Serena-first y partición por región de archivos
- [x] Instalador one-shot del lado Claude (ver Fase 3)
- [ ] **Recalibrar los umbrales 50/70/80 con datos reales.** Son provisorios y
      sin evidencia. Después de ~25 tareas, revisar con
      `Get-Content .orquestador\decisions.jsonl | ConvertFrom-Json | Group-Object state`.
      La pregunta que decide si falta algo más: cuántas veces se llegó a
      `SURVIVAL` con Codex sano.

### Deuda conocida

- `BR-001`, `BR-002` y `BR-003` están cubiertas por
  `Orquestador/tests/test-codex-run.ps1` (119 checks, sin dependencias: mismo
  patrón `Check` que `codex/Orquestador/verify.ps1`) — 26 de ellos sobre la
  máquina de estados y 18 sobre la degradación sin Codex instalado, estos
  últimos en procesos hijo con el PATH limpio, que es la única forma de probar
  algo que fallaba al cargar el script. La suite se validó con mutación: mover cualquiera de los
  seis umbrales, reordenar dos reglas de precedencia o romper el quoting de
  `ConvertTo-CmdArg` la pone en RED. **`BR-004`…`BR-008` siguen sin verificar**;
  `BR-008` es criterio del orquestador y no es verificable contra código.
- ~~`Get-BudgetVerdict` tiene los umbrales `20` y `40` hardcodeados inline.~~
  Resuelto el 2026-08-22: todos los umbrales de presupuesto y de capacidad son
  constantes nombradas en el bloque de política, y los seis están fijados por
  mutación (mover cualquiera pone la suite en RED).
- El wrapper no rechaza explícitamente los flags de bypass: simplemente nunca
  los incluye. No hay guard si alguien los agregara.
- **Linux y macOS no están probados** (`D-014`). El kit declara `pwsh` 7 como
  runtime y se neutralizaron los seis puntos que asumían Windows, pero nadie corrió
  el instalador, el hook, la statusline ni las suites fuera de Windows. Además el
  cache de cuota de Claude lo escribe upstream con `$env:TEMP`, que fuera de
  Windows no existe: esa mitad del gate degradaría a `BALANCED`.
- Los respaldos del instalador se acumulan sin límite, un directorio por corrida en
  `~/.claude/orquestador-backups/`. Nada los borra.

## Fase 3 — Observabilidad de Codex e instalador

Estado: TODO. Investigado el 2026-08-21 contra `codex-cli 0.149.0`.

### Hallazgo que condiciona todo

`codex agents` ("Browse all agent sessions on the shared local app-server
daemon") sería exactamente la vista de subagentes que falta, pero **en Windows no
sirve**: exige `--remote <ADDR>`, y tanto `codex remote-control start` como
`codex app-server daemon start` responden *"daemon lifecycle is only supported on
Unix platforms"*. Revisar en cada update del CLI; si algún día arranca en
Windows, deja obsoleto el registry propio de abajo.

- [x] **Señal de vida de Codex** (`D-015`). El wrapper vuelca el stream `--json`
      a `$env:TEMP\claude\codex-live.log` línea a línea mientras corre, y publica
      un heartbeat que la statusline muestra como `CX> <rol> <tiempo> <evento>`.
      Resuelve el problema que motivaba el registry —saber si Codex sigue vivo—
      sin tocar el protocolo de delegación.

- [ ] **Registry de jobs + `-Background` en `codex-run.ps1`.** Diferido a
      propósito (`D-015`): el wrapper sigue bloqueando. Lo que faltaba era la
      señal de vida, ya cubierta arriba; `-Background` solo hace falta el día que
      moleste no poder seguir hablando con Claude mientras Codex trabaja, o que
      se quiera paralelismo real. Diseño si llega ese día:
      `.orquestador/jobs/<id>.json` + `<id>.log` al lanzar, y un `codex-ps.ps1`
      que los tabule.
      Referencia de diseño: `openai/codex-plugin-cc`, `scripts/lib/state.mjs` y
      `scripts/lib/tracked-jobs.mjs` (jobs dir por workspace, hash del root).
- [ ] **Contador de jobs en la statusline.** Depende del registry, o sea de
      `-Background`: con el wrapper bloqueante nunca hay más de un job. El
      segmento de cuota `CX <n>%` y el de actividad `CX> <rol> …` ya están en
      `statusline-wrapper.ps1`.
- [x] **Instalador one-shot.** `install-hibrido.ps1` ramifica según
      `codex login status`: con sesión de ChatGPT instala los dos kits, sin ella
      instala solo el lado Claude y dice qué falta. `Orquestador/install.ps1` y
      `Orquestador/verify.ps1` clonan el patrón del lado Codex (respaldo antes de
      pisar, `-WhatIf`). El merge de `settings.json` está cubierto por
      `Orquestador/tests/test-install-merge.ps1` (14 checks contra un
      `CLAUDE_HOME` temporal), que fija que no se pierde ninguna clave del
      usuario y que reinstalar no duplica hooks ni permisos.

      **Plugins y MCPs quedan fuera a propósito:** `/plugin install` solo corre
      dentro de una sesión de Claude Code y los MCPs necesitan `npx`/`uv`. El
      instalador los detecta y lista los comandos faltantes en vez de
      ejecutarlos a ciegas.
### Decidido NO construir

- **Rol `lead.toml` con `agents.enabled = true`** (un Codex que se auto-orquesta
  cuando Claude se queda sin ventana). Reemplazado por `SONNET-LEAD`
  ([D-013](DECISIONS.md#d-013--sonnet-lead-en-vez-de-codex-lead)): si el lead
  barato es Sonnet, Codex no necesita auto-orquestarse nunca, y se conserva el
  invariante de un solo Tech Lead. Cae con él todo el Relay Mode: `codex-lead.ps1`,
  el puente de `request_user_input` y el thread persistente de `app-server`.
- **`repo-map.ps1` con cache por hash del árbol git.** El census de estructura lo
  resuelve un `git ls-files` filtrado por manifests, documentado en la Fase 2 de
  la skill. El cache es la parte que se rompe sola. Se promueve a script solo si
  se comprueba que se paga en cada sesión.
- **`metrics.ps1`.** Los campos ya están en `decisions.jsonl`; el agregador es un
  `Group-Object` de una línea. Se escribe cuando haya ~25 tareas que agregar.
- **Paralelismo real de writers y metadata de workstreams** (`size`, `coupling`,
  `risk`). Sin aislamiento por `git worktree` es corrupción esperando, y sin
  paralelismo la metadata es ceremonia. Sobrevive solo la regla de partición:
  dividir por región de archivos con dueño independiente, no por capa.
- Forkear `codex-plugin-cc`: se instala tal cual como capa de review y listo.
  Mantener un fork de un plugin que se mueve solo es deuda pura. Su hook `Stop`
  de review-gate va desactivado: el propio README avisa que puede armar un loop
  Claude/Codex infinito.
- Broker persistente de `app-server`: sólo lo justificaría la latencia del RPC,
  y el cache de 60s ya la tapa.
- `spawn_agents_on_csv`: resuelve fan-out sobre cientos de filas. No es nuestro
  problema.
- Envolver Codex como MCP server (`codex mcp-server`): saltea el gate de
  presupuesto de `codex-run.ps1`, que es el corazón del entorno.

### Gotcha de entorno: `.venv` bajo sandbox de Windows

**Resuelto (2026-08-25):** los cinco roles que escriben pasaron a
`sandbox_mode = "danger-full-access"`, que no aplica ACEs y por lo tanto no tiene
este problema. Se deja el diagnóstico anotado porque explica por qué el kit no
puede volver a `workspace-write` en Windows.

Con `sandbox_mode = "workspace-write"` + `[windows] sandbox = "elevated"`, Codex
no puede leer los `.pyd`/`.dll` de un `.venv` preexistente: el sandbox aplica la
ACE heredable sólo en la raíz del workspace y no repara los descendientes ya
creados (openai/codex#15165, sin fix upstream). Es la misma raíz que el error 1920
que rompía a `constructor` y `tester-tdd`. Workaround de la época:
`icacls ".\.venv" /reset /T /C /Q` una vez por repo. Pasar a `unelevated` NO era
solución: rompe `apply_patch` con split roots (openai/codex#32168, #32314).
