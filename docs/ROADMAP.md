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
  `Orquestador/tests/test-codex-run.ps1` (73 checks, sin dependencias: mismo
  patrón `Check` que `codex/Orquestador/verify.ps1`) — 26 de ellos sobre la
  máquina de estados. La suite se validó con mutación: mover cualquiera de los
  seis umbrales, reordenar dos reglas de precedencia o romper el quoting de
  `ConvertTo-CmdArg` la pone en RED. **`BR-004`…`BR-008` siguen sin verificar**;
  `BR-008` es criterio del orquestador y no es verificable contra código.
- ~~`Get-BudgetVerdict` tiene los umbrales `20` y `40` hardcodeados inline.~~
  Resuelto el 2026-08-22: todos los umbrales de presupuesto y de capacidad son
  constantes nombradas en el bloque de política, y los seis están fijados por
  mutación (mover cualquiera pone la suite en RED).
- El wrapper no rechaza explícitamente los flags de bypass: simplemente nunca
  los incluye. No hay guard si alguien los agregara.

## Fase 3 — Observabilidad de Codex e instalador

Estado: TODO. Investigado el 2026-08-21 contra `codex-cli 0.149.0`.

### Hallazgo que condiciona todo

`codex agents` ("Browse all agent sessions on the shared local app-server
daemon") sería exactamente la vista de subagentes que falta, pero **en Windows no
sirve**: exige `--remote <ADDR>`, y tanto `codex remote-control start` como
`codex app-server daemon start` responden *"daemon lifecycle is only supported on
Unix platforms"*. Revisar en cada update del CLI; si algún día arranca en
Windows, deja obsoleto el registry propio de abajo.

- [ ] **Registry de jobs + `-Background` en `codex-run.ps1`.** Hoy el wrapper
      bloquea (`WaitForExit`), así que no hay paralelismo real ni forma de ver
      qué está corriendo. Escribir `.orquestador/jobs/<id>.json` + `<id>.log` al
      lanzar, y un `codex-ps.ps1` que los tabule. Prioridad alta: es el único
      camino a la observabilidad en Windows.
      Referencia de diseño: `openai/codex-plugin-cc`, `scripts/lib/state.mjs` y
      `scripts/lib/tracked-jobs.mjs` (jobs dir por workspace, hash del root).
- [ ] **Contador de jobs en la statusline.** Depende del registry. El segmento
      `CX <n>%` ya está (`statusline-wrapper.ps1`, cache TTL 60s vía
      `codex-run.ps1 -QuotaCache`); falta sumarle `· N jobs`.
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

Con `sandbox_mode = "workspace-write"` + `[windows] sandbox = "elevated"`, Codex
no puede leer los `.pyd`/`.dll` de un `.venv` preexistente: el sandbox aplica la
ACE heredable sólo en la raíz del workspace y no repara los descendientes ya
creados (openai/codex#15165, sin fix upstream). Workaround: `icacls ".\.venv"
/reset /T /C /Q` una vez por repo. Pasar a `unelevated` NO es solución: rompe
`apply_patch` con split roots (openai/codex#32168, #32314).
