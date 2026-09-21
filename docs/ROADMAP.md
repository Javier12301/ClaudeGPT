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
- ~~El wrapper no rechaza explícitamente los flags de bypass.~~ Resuelto en V2:
  `assertNoBypass` los rechaza antes de lanzar Codex (con test). Texto original:
  el wrapper no los rechazaba: simplemente nunca
  los incluye. No hay guard si alguien los agregara.
- **Linux y macOS no están probados** (`D-014`, reemplazada por D-020: el V2 es
  Node y la suite pasa en Windows; sigue faltando la corrida real en POSIX, Fase 4). El kit declara `pwsh` 7 como
  runtime y se neutralizaron los seis puntos que asumían Windows, pero nadie corrió
  el instalador, el hook, la statusline ni las suites fuera de Windows. Además el
  cache de cuota de Claude lo escribe upstream con `$env:TEMP`, que fuera de
  Windows no existe: esa mitad del gate degradaría a `BALANCED`.
- ~~Los respaldos se acumulan sin límite~~ — resuelto en V2 (retención de 5).
  Texto original: los respaldos del instalador se acumulaban sin límite, un directorio por corrida en
  `~/.claude/orquestador-backups/`. Nada los borra.

## Fase 2.6 — Delegación selectiva y observabilidad del lado Claude

Estado: IN_PROGRESS. Nace del uso real documentado en
`MEJORAR ORQUESTADOR/FEEDBACK-ORQUESTADOR.md`. Ver
[D-018](DECISIONS.md#d-018--delegar-por-costo-del-ciclo-no-por-tamaño-del-diff) y
[D-019](DECISIONS.md#d-019--el-contrato-de-frenar-es-replicable-no-del-proveedor).

- [x] Gate `DIRECT` / `DELEGATE` / `PARALLELIZE`, con `DIRECT` como default y el
      umbral de líneas reemplazado por "más de tres archivos o contexto que no
      tengo"
- [x] TDD por riesgo en tres rutas (`BR-015`): presentacional sin test nuevo,
      comportamiento acotado con RED del orquestador, pipeline completo para
      regla de negocio
- [x] `NEEDS_INFO` para `tester` y `constructor` (`BR-014`), con continuación por
      `SendMessage` sobre el mismo subagente
- [x] Regla del camino real y del contraejemplo en `tester`
- [x] Reusar antes que crear, también en tests: ajustar el test existente cuando
      cambia la regla, en vez de escribir uno nuevo al lado
- [x] Baseline de la suite medida en la sesión, nunca citada de un handoff
- [x] Verify ladder por alcance (test afectado → módulo → repo)
- [x] Barrido de tests heredados antes de delegar un cambio observable
- [x] Writer lock por repositorio en vez de por sesión
- [x] Fixes del reviewer aplicados por el orquestador o por la sesión original
- [x] `REAL APPLICATION BEHAVIOR` en la plantilla de spec de Codex
- [x] Skill partida en core + `references/` (~31 KB → ~15 KB de preámbulo)
- [x] Hook `orq-metrics.ps1`: spawns de subagentes Claude y suites full vs
      dirigidas en `decisions.jsonl`
- [x] Duraciones exactas desde `duration_ms` del payload, y `result: RED/GREEN`
      de cada corrida desde `tool_response.stdout`/`.stderr`
- [x] Fricción declarada (`-Note`) con categorías cerradas, e informe de cierre
      (`-Feedback`) con la forma de la sesión de referencia
- [ ] **Repository Context Capsule en uso real.** El formato está definido en
      `skills/orquestador/references/capsule.md`; falta escribir la primera
      `.orquestador/repo.md` en un repo de trabajo y medir si evita de verdad que
      los subagentes redescubran el entorno.
- [ ] **Medir la próxima sesión real contra la documentada.** `orq-metrics.ps1
      -Report` contra los números de referencia: 11 delegaciones, 3 `NEEDS_INFO`,
      12 suites completas, 5 fixes post-delegación. El criterio de éxito no es
      menos agentes: es que los cinco defectos se sigan encontrando con menos
      viajes.

### Deuda conocida

- `BR-014` y `BR-015` son criterio de prompt, no verificables contra código: no
  tienen test. Su evidencia va a ser la comparación de la próxima sesión.
- El `result: RED/GREEN` sale de firmas de texto en la salida del runner, porque
  el payload no trae exit code. Está probado contra los formatos de pytest, jest
  y vitest; un runner con otro formato de resumen puede dar un falso GREEN. Es
  una métrica perdida, nunca un fallo.
- El emparejamiento FIFO quedó como fallback: `duration_ms` viene en el payload y
  las duraciones son exactas. Falta confirmar en una sesión real que el evento de
  `Agent` también lo trae — se verificó sobre `Bash`, y por eso el fallback sigue
  ahí en vez de borrarse.
- La calidad del `-Feedback` depende de que las fricciones se anoten en el
  momento. Si no se anotan, el informe lo dice en vez de declarar que la sesión
  salió limpia.

## Fase 3 — Observabilidad de Codex e instalador

Estado: SUPERADA por la Fase 4 (V2). Investigado el 2026-08-21 contra `codex-cli 0.149.0`;
reverificado el 2026-09-10 contra `0.153.4`: el daemon sigue siendo solo Unix.

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

- [x] **Registry de jobs + `-Background`** — hecho en V2 como ASYNC_REVIEW
      (`orq run --background`, `.orquestador/jobs/`, tope 1 por tarea; D-026).
      Nota original: Diferido a
      propósito (`D-015`): el wrapper sigue bloqueando. Lo que faltaba era la
      señal de vida, ya cubierta arriba; `-Background` solo hace falta el día que
      moleste no poder seguir hablando con Claude mientras Codex trabaja, o que
      se quiera paralelismo real. Diseño si llega ese día:
      `.orquestador/jobs/<id>.json` + `<id>.log` al lanzar, y un `codex-ps.ps1`
      que los tabule.
      Referencia de diseño: `openai/codex-plugin-cc`, `scripts/lib/state.mjs` y
      `scripts/lib/tracked-jobs.mjs` (jobs dir por workspace, hash del root).
- [ ] **Contador de jobs en la statusline.** Sigue sin hacer: con tope 1 por
      tarea no hay una cola que contar; `orq jobs` alcanza. Nota original: Depende del registry, o sea de
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

- **Rol persistente `lead.toml` y Relay Mode.** Codex interactivo ya es el único
  Tech Lead cuando el usuario trabaja desde Codex y puede delegar con sus
  subagentes nativos. No hace falta otro rol lead, `codex-lead.ps1`, un puente de
  `request_user_input` ni un thread persistente de `app-server`.
- **`repo-map.ps1` con cache por hash del árbol git.** El census de estructura lo
  resuelve un `git ls-files` filtrado por manifests, documentado en la Fase 2 de
  la skill. El cache es la parte que se rompe sola. Se promueve a script solo si
  se comprueba que se paga en cada sesión.
- **`metrics.ps1`.** (En V2 es `orq metrics`, con filtro por sesión.) Los campos ya están en `decisions.jsonl`; el agregador es un
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

## Fase 4 — Orquestador V2 (runtime Node)

Estado: IN_PROGRESS. Ver [D-020](DECISIONS.md) a D-030 y CHANGELOG 2.0.0-rc.1.

- [x] Runtime `orq` en Node/TypeScript, sin dependencias de runtime
- [x] `init` / `doctor` / `uninstall` / `migrate` deterministas, idempotentes, con manifiesto
- [x] Gate automático en `SessionStart` (P1 de la retro)
- [x] Cuota de Claude desde el stdin de la statusLine; fuera ClaudeCodeStatusLine
- [x] Telemetría por sesión, subagentes por `SubagentStart`/`Stop`, suites por
      PowerShell, `delegation_decision`, veredicto de findings (P0 de la retro)
- [x] Topologías, ASYNC_REVIEW con tope, worktrees, checkpoints, planes con dependencias
- [x] `CodeIntelProvider` con codegraph / native
- [x] Skill recortada (395 → 265 líneas), escritor por región, ejercitar la app real
- [x] Base de la skill de Codex como razonador
- [x] **Migrar esta máquina**: `orq migrate` sobre el home real y una sesión nueva
      de Claude Code que muestre el gate en el contexto y un `orq metrics` fiel.
- [ ] **Corrida real en Linux y macOS** (instalar, doctor, una sesión, uninstall).
- [ ] **`npm publish`** — solo con la verificación end-to-end completa (INSTALL.md).
      `npm run build` va a tener que correr en una máquina/CI Windows (o
      cross-compilar con el SDK de `dotnet`) para que `dist/native/orq-hidden.exe`
      y `bash.exe` viajen ya compilados en el tarball (D-034/D-035); hoy se compilan localmente con `csc.exe`.
- [x] **Decidir Serena**: retirada, codegraph es el único motor (D-032).
- [x] **Completar la skill de Codex**: DIRECT por defecto, topologías nativas,
      Codex standalone, aislamiento de contexto y roles estrechos.
- [ ] **Recalibrar con datos**: después de ~25 tareas, `orq metrics --all` —
      umbrales 50/70/80 (BR-003), cuántas `not_delegated` terminaron en `rework`,
      tasa de findings aceptados por rol (¿el reviewer encuentra bugs reales?).
- [x] **Retirar Engram del core V2** (D-033): sin runtime, prompts, instalación,
      diagnóstico ni estado versionado; instalaciones globales ajenas se conservan.
- [ ] **Caveman**: solo si la telemetría muestra output narrativo inútil medible.
- [ ] Borrar `legacy/` cuando `orq migrate` se haya usado en real sin problemas.

### Deuda conocida

- `test_run.result` sigue saliendo de firmas de texto cuando el payload no trae
  exit code: un runner con otro formato puede dar un falso GREEN (métrica perdida,
  nunca fallo).
- El `task` de un subagente se asocia por orden (FIFO por tipo); con spawns
  paralelos del mismo tipo el texto puede cruzarse. La duración no (va por `agent_id`).
- Launchers sin consola en Windows (D-034/D-035): verificados subsistema GUI,
  contrato de pipes, argumentos, cwd, exit code, concurrencia y ownership
  reversible. Falta la confirmación visual final en CLI y VS Code con una
  sesión nueva; el proxy ahora cubre el Git Bash primario confirmado.
- codegraph tiene bus factor 1; está pinneado y detrás de `CodeIntelProvider`.
- Un workflow nativo de Claude Code (dynamic workflows) no pasa por el gate de cuota.
- El hook `SessionStart` agrega dos líneas de contexto también en repos donde no
  se orquesta.
