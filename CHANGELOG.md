# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

Toda feature nueva del orquestador entra acá y actualiza la sección
correspondiente de [`docs/SYSTEM.md`](docs/SYSTEM.md) en el mismo diff.

## [Unreleased]

### Added

- README: prompt para que un agente instale o actualice el orquestador paso a
  paso en una máquina nueva.

### Fixed

- Windows: `orq init` no encontraba `npm` y no instalaba codegraph. El
  `npm.cmd` del instalador de Node no usa el formato cmd-shim; `parseNpmShim`
  ahora reconoce los dos.

### Removed

- Serena: backend `serena` de `CodeIntelProvider`, chequeo "code intel duplicado"
  de `orq doctor` y `.serena/` del repo. codegraph es el único motor (D-032).

## [2.0.0-rc.1] - 2026-09-10

Orquestador V2: runtime portable en Node/TypeScript (`orq`), sin dependencias
de runtime. Reemplaza al kit PowerShell. Ver docs/DECISIONS.md D-020 a D-031.

### Added

- **`orq`**, un solo CLI: `init`, `doctor`, `uninstall`, `migrate`, `budget`,
  `run`, `jobs`, `session`, `checkpoint`, `plan`, `worktree`, `codeintel`,
  `metrics`, `statusline` y `hook`. Windows, Linux, macOS y WSL con la misma
  logica; Node >= 22.16; cero dependencias de runtime.
- **Instalacion determinista** (`orq init`): idempotente (la segunda corrida no
  toca el disco), `--dry-run`, `--offline`, respaldo antes de cada escritura con
  retencion de 5, manifiesto de todo lo instalado. `orq uninstall` es su
  inversa exacta; `orq migrate` retira el V1 con respaldo. Registra los MCPs de
  verdad (`claude mcp add` / `codex mcp add`) en vez de listarlos como pendientes.
- **`orq doctor`**: runtime, git, Claude, Codex y su auth, hooks (y duplicados),
  hooks V1 remanentes, statusline, permisos peligrosos, cuota, archivos del kit,
  git-guard de Codex, `codex doctor`, code intel e indice.
- **Gate de presupuesto automatico** (hook `SessionStart`): el estado queda en el
  contexto sin que nadie lo pida (P1 de la retro: el gate opt-in nunca corria).
- **Cuota de Claude desde el stdin documentado de la statusLine** (`rate_limits`):
  `orq statusline` la persiste; reemplaza al cache de ClaudeCodeStatusLine.
- **Telemetria de utilidad**: filas por sesion, subagentes medidos por
  `SubagentStart`/`SubagentStop`, suites capturadas tambien desde la tool
  `PowerShell`, `delegation_decision` (delegated | not_delegated) con motivo de
  set cerrado, veredicto de findings (`--finding accepted|rejected`), checkpoints.
  El informe dice explicitamente cuando el log no registro la sesion.
- **Topologias** DIRECT / DELEGATED / ASYNC_REVIEW / PARALLEL. ASYNC_REVIEW con
  `orq run --background` y tope duro de 1 reviewer activo por tarea (exit 7).
  PARALLEL con `orq worktree` (sin merge automatico; no borra trabajo sin integrar).
- **Checkpoints**: `fast` (checks declarados en `orq.config.json`, corta en la
  primera falla) y `deep` (fast + review adversarial, bloqueante o no).
- **Planes con dependencias** `hard` / `soft` / `independent` (`orq plan check`).
- **Code intelligence detras de `CodeIntelProvider`**: codegraph (pinneado, en un
  prefijo propio), serena (solo MCP) y native (git). Fallback automatico a native.
- **Review adversarial**: el contrato del reviewer es "demostra que esto puede
  estar roto aunque los tests pasen"; los findings exigen `evidence`.
- Base de la skill de Codex como razonador (`kit/codex/skills/orquestador`).
- 103 tests con `node:test` y un Codex falso: sin gastar cuota.

### Changed

- El git-guard cubre la tool `PowerShell` de Claude Code (en el V1 solo `Bash`:
  un push por PowerShell no pasaba por ninguna capa de Claude). Deny rules en
  las dos tools.
- La skill del orquestador: 395 -> 265 lineas de preambulo permanente. Default
  NO DELEGATION con seis motivos nombrados; escritor por region de archivos (no
  por repo); fase obligatoria de ejercitar la app real antes de revisar el diff;
  politica P0-P3.
- Los roles Codex ya no fijan slugs de modelo (`gpt-5.6-*` ya estaba viejo: el
  catalogo vivo rankea `gpt-6-astra` primero); el tier se resuelve siempre en vivo.
- Engram pasa a compatibilidad: ningun modulo del runtime lo usa; los prompts lo
  consultan solo si esta disponible.

### Removed

- Kit PowerShell (`codex-run.ps1`, `orq-metrics.ps1`, `git-guard.ps1`,
  `statusline-wrapper.ps1`, instaladores y `verify.ps1`): movidos a `legacy/`.
- Dependencia de `daniel3303/ClaudeCodeStatusLine`.
- Rutas G y H y las skills `$constructor` / `$revisor-completo` de Codex
  (sub-orquestadores con fan-out por defecto).
- Roles Codex `explorador`, `e2e-browser` y `browser-diagnostics`.
- El instalador ya no siembra `defaultMode: bypassPermissions` ni impone
  `model`, `approval_policy` o `sandbox_mode` globales en `~/.codex/config.toml`.

### Fixed

- Informe de cierre que mezclaba sesiones, media subagentes en background en 0 s
  y no veia suites corridas por PowerShell (P0 de la retro).
- Procesos `codex app-server` huerfanos en Windows tras leer la cuota (se mata el
  arbol, no solo el launcher de Node).
- Estado de `.orquestador/` que ensuciaba `git status` de cualquier repo: ahora
  solo se escribe dentro de un repo git y el directorio se auto-ignora.

### Security

Hallazgos del review adversarial de Codex sobre este mismo runtime (ASYNC_REVIEW
real: 8 findings, 7 aceptados, 1 rechazado por diseño). Cada uno tiene su test
con la reproducción del reviewer.

- **git-guard**: la regex dejaba pasar `git --no-pager push`, `git -c k="A B" push`
  y `-C` con rutas con espacios (en argv). Reemplazada por un parser
  (`src/core/guard.ts`) que busca `git` en posición de comando, saltea opciones
  globales y recorre `bash -c`, `pwsh -Command`, `cmd /c`, `iex`, `$(…)` y
  backticks. De paso deja de bloquear texto inerte (`echo git push`).
- **ASYNC_REVIEW**: la admisión era check-then-create (8 lanzamientos simultáneos
  admitían 3). Ahora es atómica bajo un lock por tarea; escritura JSON con
  reintento ante `EPERM`/`EBUSY` de Windows.
- **uninstall** borraba archivos del usuario que init había reemplazado: ahora
  init preserva los originales (fuera de la rotación de backups) y uninstall los
  restaura. Solo se quitan los permisos que init agregó.
- **migrate** borraba el V1 antes de validar: ahora corre el preflight de init
  primero y restaura el V1 si init falla.
- **merge**: un hook del usuario en el mismo grupo que uno nuestro se perdía.
- Un payload de Codex estructuralmente inválido (p. ej. `{}` de un reviewer)
  crasheaba el render: ahora se valida contra el schema del rol (exit 4).
- Heartbeat y log vivo por corrida: dos corridas simultáneas ya no se pisan.

Segunda ronda del review (8 findings, 8 aceptados):

- **git-guard**: 13 formas más (agrupaciones `( )`/`{ }`, `if`/`while`, wrappers
  `sudo`/`env`/`nohup`/`Start-Process`, escapes `g\it`, ejecutables indirectos
  `$g`, `${GIT}`, `$(which git)`). Total: 44 bloqueadas, 12 inertes que pasan.
- **Lock de tarea con dueño**: un lock viejo solo se recupera si su proceso murió
  (a uno vivo y lento no se le roba), y solo lo suelta quien lo tomó.
- **Jobs en background**: el launcher ya no pisa con `running` un job que el hijo
  ya había cerrado.
- **init parcial** (`--claude-only` o sin sesión de Codex): conserva la propiedad
  de los archivos del kit Codex, así uninstall los sigue limpiando y restaurando.
- **Originales fuera del home** (`CLAUDE_CONFIG_DIR` externo): se guardan bajo un
  hash de la ruta; dos `SKILL.md` ya no comparten copia.
- **init que tira una excepción** deja un manifiesto parcial; migrate restaura el V1.
- **uninstall** conserva `includeCoAuthoredBy`/`attribution` si el usuario los
  cambió después de instalar.
- **Heartbeat** renovado por tiempo: un razonamiento largo sin eventos ya no
  desaparece de la statusline.

Review final (8 findings, 8 aceptados):

- **git-guard**: `cmd /c g^it push` y `eval git push` (verificados ejecutando git).
- **ASYNC_REVIEW**: un `maxConcurrent` inválido (`"abc"`, `0`) anulaba el tope;
  ahora cae a 1.
- **Plan**: una dependencia `hard` exige además el checkpoint aprobado
  (`orq checkpoint fast|deep --phase <id>` lo registra en `plan.json`).
- **Telemetría**: una corrida de tests sin éxito comprobable es `UNKNOWN`, nunca
  GREEN; decisiones de delegar y corridas de subagentes se informan por separado.
- **Manifiesto**: uno de una versión anterior se normaliza en vez de romper init;
  los archivos retirados del kit se quitan al reinstalar.
- **uninstall** borra `settings.json`/`hooks.json` que creó init y quedaron vacíos.
- **init** sin cambios ya no reescribe el manifiesto (conserva `installedAt`).
- **Informe**: un rol `constructor` se imprimía como `function Object()…1` (contador
  sobre `{}`); los contadores usan objetos sin prototipo. Encontrado leyendo el
  informe real, no por tests ni review.

## [1.x] - kit PowerShell (sin version publicada)

### Added

- **Observabilidad del lado Claude** (`Orquestador/hooks/orq-metrics.ps1`). Los
  spawns de subagentes y las corridas de tests entran al mismo
  `.orquestador/decisions.jsonl` que ya escribe el wrapper, distinguidos por el
  campo `event` (`spawn_start`, `spawn_end`, `test_run`). El punto de
  instrumentación es el par `PreToolUse`/`PostToolUse` sobre la herramienta
  `Agent`: `SubagentStop` no sirve porque su payload no trae rol ni duración.
  `-Report` agrega delegaciones por rol con duración, `NEEDS_INFO`, retries,
  sesiones reusadas, findings, suites completas contra dirigidas y corridas en
  RED. El hook nunca interrumpe trabajo — ante cualquier error escribe nada,
  emite `{}` y sale con 0.
- **Registro de fricción e informe de cierre.** `-Note <tipo> -Detail "..."
  -Phase <fase>` anota, en el momento en que ocurre, lo que ningún hook puede
  inferir: trabajo descartado (`rework`), defectos que encontró la revisión del
  diff (`review-defect`), `NEEDS_INFO` predecibles, suites completas de más
  (`wasted-verify`), rutas mal elegidas (`wrong-route`) y gotchas de entorno. Las
  categorías son un set cerrado: una categoría libre por evento vuelve el log
  inagrupable. `-Feedback` arma el informe de cierre con la forma de la sesión de
  referencia —números, fricciones que los explican, tabla de delegaciones una por
  una— y deja explícita una sección final con **lo que el log no sabe**, que
  contesta el orquestador. Si no se anotó ninguna fricción, el informe lo dice en
  vez de declarar que la sesión salió limpia.
- **Payload del hook verificado contra un evento real**, no contra la
  documentación: el campo es `tool_response` (la doc dice `tool_result`), y trae
  `duration_ms` —duraciones exactas, sin emparejar—, `tool_use_id` y `prompt_id`.
  De `tool_response.stdout`/`.stderr` sale el `result: RED/GREEN` de cada corrida,
  descartando los `0 failed` que si no leerían como fallo. No hay exit code en el
  payload; el emparejamiento FIFO queda como fallback cuando falta `duration_ms`.
- **Cierre de fase con dos salidas a sesión limpia** (`references/retro.md`). Al
  terminar una fase el orquestador ofrece, una sola vez y sin insistir,
  **retroalimentación** (una sesión nueva arregla el código: defectos abiertos y
  pendientes) o **feedback** (una sesión nueva evalúa la orquestación y recomienda
  qué regla ajustar). El usuario elige una, las dos o ninguna; si la fase salió
  limpia, ninguna es la respuesta correcta. Las gobierna un invariante: **el log
  es evidencia, el resumen del orquestador es testimonio** — los dos handoffs
  leen `decisions.jsonl` y `-Feedback` antes que la narrativa, y cuando discrepan
  gana el log. El handoff de la ruta A lleva una sección de *decisiones que no hay
  que revertir*, porque una sesión limpia no sabe qué era deliberado y "arregla"
  simplificaciones con techo conocido. La ruta B compara contra los números de la
  sesión de referencia y descarta toda recomendación sin un fallo observado
  detrás; el resultado lo aplica el usuario, nunca el orquestador sobre sí mismo.
- **Los tickets que llegan a mitad de una unidad se encolan, no interrumpen.**
  Pasan por el gate cuando la unidad en curso cierra. Absorberlos re-scopea una
  fase que ya tenía criterio de aceptación. La excepción es un ticket que
  invalide lo que está en curso: ahí se para y se replantea.
- **Repository Context Capsule** (`references/capsule.md`): formato de
  `.orquestador/repo.md` con intérprete, comandos, baseline y gotchas del repo,
  para pegar textual en las specs en vez de que cada subagente redescubra el
  entorno. Sin maquinaria de invalidación, a propósito.

### Changed

- **Delegación selectiva** (`D-018`). La primera decisión ante cada tarea pasa a
  ser `DIRECT` / `DELEGATE` / `PARALLELIZE`, con `DIRECT` como default: delegar es
  la excepción que hay que justificar. El umbral de "~50 líneas" se reemplaza por
  "más de tres archivos, o código que no tengo en contexto" — el tamaño del diff
  no mide el costo del ciclo. El TDD pasa a ser por riesgo en tres rutas
  (`BR-015`): presentacional y mecánico sin test nuevo, comportamiento acotado con
  un RED escrito por el orquestador, y pipeline completo con tester independiente
  solo para regla de negocio, cálculo, persistencia, validación, permisos, estados
  y contratos. La verify ladder pasa a ser **por alcance** antes que por tipo
  (test afectado → módulo → repo), con suite completa solo en cierre de fase,
  cambio transversal o entrega. El writer lock pasa a ser **por repositorio**, no
  por sesión: dos repos distintos ya no se serializan. La revisión del diff por el
  Tech Lead **no se toca**: es lo que encontró los cinco defectos que motivaron
  todo esto, y ninguno lo atrapó un test.
- **Los subagentes Claude frenan antes de escribir** (`BR-014`, `D-019`).
  `tester` y `constructor` devuelven `NEEDS_INFO` —con `missing_fact`,
  `evidence_checked`, `question` y `affected_decision`— ante una ambigüedad que
  cambie el diseño, sin tocar un archivo, y agrupando todas las dudas en una sola
  devolución. El orquestador resuelve desde evidencia del repo y continúa por
  `SendMessage` sobre el **mismo** subagente, que conserva su contexto: no se
  reconstruye la spec ni se spawnea uno nuevo. Mismo tope que Codex (`BR-013`): 2
  ciclos, sin consumir presupuesto de retry. `explorador` reporta las dos
  interpretaciones con su evidencia en vez de elegir una.
- **El tester prueba el camino real** (`BR-015`). Al menos un test por cambio de
  comportamiento ejercita el componente o el endpoint **como lo invoca la
  aplicación**; un test que construye a mano una entrada que la aplicación nunca
  genera no cuenta como cobertura y hay que decirlo. Toda aserción de ausencia
  lleva un contraejemplo que verifica la presencia cuando corresponde. Además,
  reusar antes que crear: si la regla de negocio cambió y ya hay un test que la
  cubre, se ajusta ese test en vez de escribir uno nuevo al lado.
- **La skill del orquestador se parte en dos niveles.** `SKILL.md` queda con la
  política que se usa en toda tarea (~15 KB, contra ~31 KB), y el detalle pasa a
  `skills/orquestador/references/`: `routing.md` (casos A–H, estados de cuota,
  fallbacks), `codex.md` (delegación, plantilla de spec, `NEEDS_INFO`, reuso de
  sesión), `docs-matrix.md` (impacto documental y Definition of Done) y
  `capsule.md`. Se leen solo cuando la ruta los pide. El gate de presupuesto pasa
  a consultarse una vez por sesión, no por tarea.
- **Specs de Codex con `REAL APPLICATION BEHAVIOR`.** La plantilla canónica suma
  un bloque con cómo se invoca el cambio, quién produce el input, cuál es la
  fuente de verdad, qué estado se persiste y qué ve el usuario. Corrige la falla
  característica de Codex, que optimiza para hacer pasar el test porque ese es el
  criterio que se le da.
- **Baseline medida, nunca citada.** El estado de la suite se mide en la sesión
  antes de la primera delegación relevante. Un handoff, un README, un CHANGELOG o
  una memoria describen otro momento.
- `install.ps1` reescribe el runner en todos los hooks del snippet en vez de en
  uno fijo, y deduplica por evento al reinstalar. `verify.ps1` chequea los cuatro
  `references/` y el registro del hook de métricas en sus dos eventos.

- **Contrato de delegación a Codex endurecido.** El schema `impl` suma `status`
  (`DONE` | `NEEDS_INFO` | `BLOCKED`) y `clarifications[]` (`missing_fact`,
  `evidence_checked`, `question`, `affected_decision`); `blocked` se conserva con
  invariante (`DONE`/`NEEDS_INFO` → false, `BLOCKED` → true). Codex ahora
  devuelve `NEEDS_INFO` estructurado —con todas las preguntas juntas— en vez de
  asumir un hecho del repo no verificado o discutir de a una; sale con exit 0 y
  sigue siendo elegible para continuación directa de sesión. Todo el texto que el
  orquestador genera para Codex (spec canónica, prompts de continuación,
  `codex/Orquestador/AGENTS.md`, `developer_instructions` de los cinco roles del
  flujo híbrido, prompt inyectado por `codex-run.ps1`) pasa a inglés y
  ASCII-safe; los literales del repo se preservan exactos. Las continuaciones de
  `NEEDS_INFO` van por `-PromptFile` (UTF-8 sin BOM) con formato
  `FACT_RESOLUTION`, no por `-Prompt`. Tope de 2 ciclos de aclaración por tarea,
  como criterio del orquestador; `-ClarifyOf` lo deja registrado en
  `.orquestador/decisions.jsonl` sin consumir el presupuesto de retry lógico.
  Regla compartida verify-before-infer: nunca inventar motor de BD, framework,
  runner, contrato de API ni decisión de arquitectura; primero la evidencia del
  repo. El wrapper valida la invariante `status`/`blocked`/`clarifications`
  después de parsear (`Test-StatusInvariant`) y la trata como contrato violado si
  no se cumple; un exit ≠ 0 de `codex exec` es fallo aunque haya JSON en `-o`; y
  `-Resume` ahora exige `-Role` explícito porque el contrato de salida depende
  del rol. Ver `docs/DECISIONS.md` D-016 y `docs/SYSTEM.md` BR-011..BR-013.
  Cubierto por `Orquestador/tests/test-codex-run.ps1`.

- **Sandbox de Codex: los roles que escriben van en `danger-full-access`.** Iban 3
  fallos en 4 invocaciones con error 1920: bajo `[windows] sandbox = "elevated"`,
  `workspace-write` deniega las escrituras dentro del propio workspace. Tocar sólo
  `~/.codex/config.toml` no arreglaba nada, porque `codex-run.ps1` pasa el sandbox
  explícito por línea de comandos (`-s`, leído de `~/.codex/agents/<rol>.toml`) y un
  flag de CLI le gana siempre al config global. Ahora el instalador escribe **los dos
  niveles**: `sandbox_mode = "danger-full-access"` + `approval_policy = "never"` en el
  config global, y `danger-full-access` en los cinco roles que escriben
  (`constructor`, `tester-tdd`, `verifier`, `e2e-browser`, `browser-diagnostics`).
  Los roles lectores (`explorador`, `reviewer`, `security-reviewer`,
  `docs-researcher`) **también van `danger-full-access`**: bajo
  `[windows] sandbox = "elevated"` el modo `read-only` tampoco arranca `git` ni
  `rg` (`CreateProcessAsUserW` error 1920), así que su barrera pasa a ser el
  prompt más `agents.enabled=false`, igual que `verifier`. `verify.ps1` exige
  `danger-full-access` en los nueve roles; `install.ps1` avisa si alguno no lo
  está. El wrapper sigue sin pasar nunca
  `--dangerously-bypass-approvals-and-sandbox`: esto es config declarada, por rol.
  Ver `docs/DECISIONS.md` D-017.

### Fixed

- **La statusline perdía la salida del upstream y mostraba la versión de la CLI.**
  `statusline-wrapper.ps1` hacía `$line = $stdin | & statusline.ps1`, pero el upstream
  termina en `Write-Host -NoNewline`, que en PS 5.1 escribe al stream de información y
  no al pipeline: `$line` quedaba vacío y la línea llegaba a la consola por fuera del
  wrapper, imposible de editar. Con `6>&1` ahora se captura de verdad, y sobre eso se
  saca el segmento de versión (` | v2.1.245`) sin tocar el clon, para que `git pull`
  sobre ClaudeCodeStatusLine siga funcionando.
- **`CX %` ahora va coloreado** por umbral, igual que los porcentajes de Claude, con
  los umbrales de `Get-UsageColor` espejados porque `free_pct` es cuota disponible y
  no usada (verde ≥50, amarillo ≥30, naranja ≥10, rojo abajo). Se redondea a entero y
  se inserta al final de la **primera** línea, no después del aviso de update.
  Cubierto por `Orquestador/tests/test-statusline-wrapper.ps1`.

### Added

- **Señal de vida de Codex.** Una delegación era silencio total hasta que
  terminaba. `--json` ya se le pasaba a `codex exec`, pero `Invoke-CodexCli`
  consumía el stdout con un solo `ReadToEndAsync()`: el stream existía y nadie lo
  miraba. Ahora, con `-LiveLog`, el stdout se lee línea a línea y se vuelca a
  `$env:TEMP\claude\codex-live.log` (tailable con `Get-Content -Wait`), mientras
  un heartbeat alimenta el segmento `CX> <rol> <tiempo> <evento>` de la barra de
  estado. El heartbeat se borra al terminar, así que el segmento desaparece solo.
  Sin `-LiveLog` la función se comporta igual que antes, que es lo que necesitan
  `login status` y `debug models`.

- **Modo Claude-solo de verdad.** Sin `codex` instalado, el gate devuelve NO-GO
  con una razón propia —distinta del WARN de "`app-server` no responde"— y el
  orquestador enruta a `CLAUDE-LEAD`. Antes el wrapper tiraba una excepción al
  cargar y se llevaba puestos `-BudgetOnly`, `-QuotaCache` y la suite de tests: el
  modo se prometía en el README y nunca había funcionado.

- **Detección de actualización en `verify.ps1`.** Compara por hash lo instalado en
  `~/.claude` contra este repo y nombra el archivo desactualizado más el comando
  de reinstalación. Actualizar es volver a correr el instalador; esto es lo que
  avisa cuándo hace falta.

- **Chequeos de plugins y de `pwsh`.** `verify.ps1` avisa si falta el clon de un
  marketplace (con el `/plugin marketplace add` exacto) y si falta `pwsh` 7, que
  es lo que Serena necesita para resolver símbolos sobre archivos `.ps1`.

- **`pwsh` 7 como runtime declarada (`D-014`).** Rutas y lanzadores dejaron de
  asumir Windows: `$HOME` en vez de `$env:USERPROFILE`, separadores neutros, y el
  instalador escribe `powershell … -ExecutionPolicy Bypass -File` en Windows o
  `pwsh -NoProfile -File` fuera. **Linux y macOS no están probados**: se quitaron
  los impedimentos conocidos, nada más.

- **Estado de capacidad en el gate de presupuesto.** `-BudgetOnly` ahora imprime
  un estado nombrado —`BALANCED`, `CODEX-PREFERRED`, `SONNET-LEAD`,
  `CLAUDE-LEAD`, `SURVIVAL`— además del veredicto de siempre. Son dos capas que
  se componen: el veredicto dice si Codex se puede usar y para qué, el estado
  dice quién lidera y quién ejecuta. El reparto de trabajo con Codex arranca al
  50% de la ventana de 5h en vez del 85%, así la cuota cara deja de gastarse en
  ejecución que Codex absorbe con la suya.

- **`SONNET-LEAD`.** Con Claude arriba del 70%, el orquestador recomienda
  `/model sonnet` **una sola vez**: sigue siendo la única interfaz con el usuario
  y sigue delegando rol por rol, pero deja de gastar Opus en vez de racionarlo.
  Si el usuario no cambia de modelo, se continúa en Opus con el comportamiento de
  `CODEX-PREFERRED` y no se vuelve a insistir en esa tarea. El cambio de modelo
  nunca es automático: `/model` es del usuario.

- **Gate de la ventana de 7 días.** Una semana por encima del 80% sube el piso a
  `CODEX-PREFERRED` aunque la ventana de 5h esté fresca. Antes el routing miraba
  solo la ventana corta, así que un lunes productivo dejaba el resto de la semana
  sin cuota y el gate no se enteraba.

- **Contract gate (Fase 3.6).** Cuando el cambio cruza un boundary, se congelan
  request, response y errores antes de que alguien escriba código, y el contrato
  congelado va en el prompt del tester y del constructor. Si no cruza ningún
  boundary, la fase no existe.

- **Verify ladder y regla anti-retry (`BR-008`).** La verificación corre de lo
  más barato y determinístico a lo más caro y corta ante la falla que invalida
  seguir. Dos RED lógicos consecutivos agotan los intentos y devuelven al
  contrato; las fallas de sandbox, red, tooling o salida truncada **no cuentan
  como retry**, así un gotcha de entorno no bloquea trabajo que nunca falló.

- **Instalación automática.** `install-hibrido.ps1` deja el entorno andando en
  otra máquina sin depender de que un agente lea la guía: ramifica según
  `codex login status` —con sesión de ChatGPT instala los dos kits, sin ella
  instala solo el lado Claude y dice qué falta— y termina corriendo la
  verificación. Suma `Orquestador/install.ps1` y `Orquestador/verify.ps1`, que
  clonan el patrón del lado Codex: respaldo timestampeado antes de pisar nada y
  `-WhatIf` en todo. El merge de `settings.json` preserva las claves, permisos,
  hooks y plugins del usuario, y reinstalar no acumula duplicados
  (`Orquestador/tests/test-install-merge.ps1`, 14 checks).

  Plugins y MCPs quedan fuera a propósito —`/plugin install` solo corre dentro de
  una sesión de Claude Code— así que el instalador los detecta y lista los
  comandos que faltan en vez de ejecutarlos a ciegas.

- **Campos nuevos en `decisions.jsonl`:** `state`, `phase`, `retry_of` y
  `claude_7d_used`, con `-Phase` y `-RetryOf` en el wrapper. Sin dashboard ni
  script agregador: un `Group-Object state` contesta la pregunta que importa.

- **Skill `brainstorming`.** Fase de reducción de incertidumbre antes de
  planificar: reglas de preguntas acotadas, Goal Contract como criterio de salida,
  gate de investigación, evaluación de alternativas y diagnóstico de bugs con
  causa raíz antes de tocar producción. Termina llamando a `EnterPlanMode`, así
  que el harness bloquea la escritura hasta que apruebes el plan. Solo se carga
  cuando el orquestador la invoca: una tarea trivial no la paga.

- **Skill `documentacion`.** Define los documentos canónicos y, sobre todo, los
  tres invariantes que mantienen la documentación utilizable: `SYSTEM.md` se
  escribe en presente sin verbos de cambio, el doc sync reemplaza en vez de
  agregar, y no existen secciones vacías. Incluye el reconocimiento del terreno
  documental para repos ajenos, con siete salvaguardas — entre ellas, no crear un
  segundo árbol de documentación al lado del que ya tiene el proyecto, y no
  generar documentación sin aprobación explícita.

- **Fase 0.6 y Fase 6 en la skill `orquestador`.** La 0.6 lee la documentación
  existente por índice, nunca entera. La 6 sincroniza documentación después de
  GREEN y del review, con una matriz de impacto donde la mayoría de las tareas
  sale sin tocar nada. El caso A no tiene impacto documental nunca.

- **Trazabilidad de reglas de negocio.** Las reglas llevan `BR-00X`, con su
  ubicación en código y el test que las cubre. Un `grep` señala las reglas
  declaradas que nadie verifica. Las siete reglas del propio kit quedan
  registradas como no verificadas, que es el estado real.

- **Guía de actualización desde una versión anterior**
  ([`INSTALL-HIBRIDO.md` § 7.1](INSTALL-HIBRIDO.md)): qué cambia del lado Claude,
  qué no se toca del puente ni del kit Codex, cómo verificarlo y cómo volver
  atrás. El comando de copia de la versión anterior traía un solo archivo de
  skill, así que hay que usar el nuevo.

- **Bootstrap documental.** `README.md` se parte en `docs/SYSTEM.md` (estado
  actual del sistema), `docs/DECISIONS.md` (rationale de las decisiones de
  diseño) y `docs/ROADMAP.md` (qué falta y en qué estado). `README.md` queda
  como puerta de entrada corta, con índice a los cuatro documentos. La sección
  "Decisiones deliberadas" de `Orquestador/INSTALL.md` se muda a
  `docs/DECISIONS.md`.

- **Integración híbrida Claude Code + Codex** vía `codex exec`. Claude Opus queda
  como único Tech Lead e interfaz con el usuario; Codex pasa a ser capacidad
  delegada (implementación voluminosa, review independiente, verificación,
  investigación documental).
- **`Orquestador/scripts/codex-run.ps1`** — único punto de entrada de la
  delegación. Resuelve modelo, chequea presupuesto, fuerza el contrato de salida,
  registra la decisión y gestiona sesiones.
- **Routing consciente de presupuesto.** Lee la cuota real de ambos proveedores
  antes de gastar nada: Codex vía el método JSON-RPC `account/rateLimits/read` de
  `codex app-server`; Claude vía el cache de la statusline
  (`%TEMP%\claude\statusline-usage-cache.json`). Umbrales GO / WARN / NO-GO, y
  empuje automático de trabajo a Codex cuando Claude pasa el 85% de su ventana de 5h.
- **Resolución de modelos por tier** (`lead` / `worker` / `cheap`) contra el
  catálogo vivo de `codex debug models`, con degradación si falta un tier y
  validación del `effort` contra `supported_reasoning_levels`. Sin slugs
  hardcodeados: sobrevive a los renames de modelo.
- **Reutilización inteligente de sesiones Codex.** `-Resume <id>` continúa una
  sesión con un prompt de solo el delta; `-SessionInfo <id>` informa tamaño,
  turnos y veredicto. Umbral por tamaño de rollout (<400 KB reusar, 400 KB–1.2 MB
  solo continuación directa, >1.2 MB sesión nueva). Un reviewer nunca hereda la
  sesión del constructor.
- **Contratos de salida forzados por JSON Schema** (`--output-schema`): tres
  esquemas (implementación, review, documental). Codex devuelve 10–20 líneas en
  vez del código que ya escribió en disco.
- **`.orquestador/decisions.jsonl`** — una línea por delegación con ruta, roles,
  modelos, cuotas al momento de decidir, sesión, reuso y resultado.
- **Hook `git-guard.ps1` en el entorno Claude**, compartido con Codex sin cambios
  (el formato `hookSpecificOutput.permissionDecision` de ambos es idéntico).
- **`README.md`** con índice navegable e **`INSTALL-HIBRIDO.md`** para reinstalar
  el entorno completo en otra máquina.
- **Cuatro diagramas Mermaid** en el README: arquitectura, árbol de decisión
  completo (cuándo se levanta Codex y cuándo no, incluidos overrides y ramas de
  cuota), decisión de reuso de sesión, y un `sequenceDiagram` del caso C con sus
  dos puntos de retroceso.

### Fixed

- **El instalador ya no revierte el `model` del usuario.** `model` y `effortLevel`
  se siembran si faltan y no se pisan si ya están. Antes cada reinstalación volvía
  a `opus`, deshaciendo el `/model sonnet` que el propio kit recomienda en el
  estado `SONNET-LEAD`.

- **El instalador dejó de pedir plugins que ya están instalados.** Chequea el clon
  del marketplace, igual que ya hacía con los MCPs.

- **`codex login status` escribe en stderr aunque todo esté bien**, y con
  `ErrorActionPreference = Stop` PowerShell lo pintaba como `NativeCommandError`:
  una instalación sana parecía rota.

- **La detección de deriva no usa `Get-FileHash`.** Instalar `pwsh` 7 antepone sus
  módulos al `PSModulePath` de la máquina, y PowerShell 5.1 pasa a resolver la
  `Microsoft.PowerShell.Utility` de la 7.x, donde `Get-FileHash` deja de estar
  disponible. Se usa SHA256 por .NET, que no pasa por el autoload de módulos.
  `test-install-merge.ps1` corre `verify.ps1` entero para que un cmdlet que se
  evapora vuelva a ser un FAIL y no un instalador que muere a mitad.

- **`test-install-merge.ps1` filtraba `$env:CLAUDE_HOME`** al shell que corría la
  suite. Ahora lo restaura en un `finally`, como ya hacía `test-codex-run.ps1` con
  `CODEX_HOME`.

- **`git push` era evadible en ambos entornos.** `git -C . push origin main` y
  `git --git-dir=.git push` no matcheaban ni la deny rule de Claude
  (`Bash(git push:*)`) ni las `prefix_rule` de Codex, porque el prefijo de argv
  arranca con la opción. El motor de `execpolicy` solo expresa prefijos, así que
  la cobertura completa la da el hook, que evalúa el comando con una expresión
  regular. Se agregó el hook del lado Claude (antes no existía) y se sumaron
  reglas `prompt` para las formas `-C` / `--git-dir` / `--work-tree` como segunda
  capa del lado Codex. Verificado con `codex execpolicy check` y con el hook
  ejercitado contra las diez formas, sin publicar nada.
- **Mensaje del guard a ASCII.** Los acentos salían como mojibake por el codepage
  OEM de PowerShell 5.1.
- **`settings-snippet.json` declaraba `effortLevel` que no estaba instalado.**
  Se agregó al merge.

### Changed

- **`explorador` deja de ser el default para localizar código.** La Fase 2 sube
  una escalera de costo y para en el primer escalón que alcanza: `git ls-files`
  para la estructura del repo, Serena para símbolos y referencias, `Grep` para
  texto, y el `explorador` LLM solo para entender un flujo completo. Cuando se
  levanta, recibe entrypoints concretos en vez de un área.

- **La partición del trabajo es por región de archivos con dueño independiente,
  no por capa.** `frontend / backend` era una etiqueta arbitraria. Si dos
  unidades necesitan editar los mismos archivos, no son dos unidades.

- **Reviewer batcheado.** Una sola pasada de `correctness + security` cuando la
  tarea no toca auth, permisos, pagos, uploads ni tokens. Dos invocaciones
  separadas solo cuando sí los toca.

- **Todos los umbrales de presupuesto son constantes nombradas.** `20` y `40`
  estaban hardcodeados inline en `Get-BudgetVerdict`. Los seis están fijados por
  mutación: mover cualquiera pone la suite en RED.

- **Rediseño modular y visual de diagramas Mermaid en `README.md`**:
  - Reestructuración de diagramas monolíticos en subgrafos (`subgraph`) por capas jerárquicas (Tech Lead, Ejecución, Arbitraje) para evitar sobrecarga y desproporción visual en GitHub.
  - División del árbol de decisión (Sección 4.0) en un Macro-Flujo de Presupuesto/Gate (4.0a) y una Matriz de Routing por Naturaleza de la Tarea (4.0b) en disposición `flowchart LR`.
  - Optimización de nodos, reemplazando rombos de texto largo por cajas redondeadas compactas con etiquetas concisas en las flechas (`|Sí|`, `|No|`, `|>40%|`).
  - Paleta de colores personalizada mediante `classDef` con alto contraste y legibilidad garantizada tanto en GitHub Dark Mode como Light Mode.
  - Incorporación de avisos nativos de GitHub Alerts (`> [!IMPORTANT]`, `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`) para destacar invariantes y reglas del orquestador.
- **`AGENTS.md` de Codex** distingue ahora dos modos: sesión interactiva propia
  (Codex es Tech Lead) y sesión iniciada por Claude vía `codex exec` (Codex es
  executor, no crea subagentes, devuelve solo el contrato pedido). Toda
  invocación desde Claude lleva `-c agents.enabled=false`.
- **`SKILL.md` del Orquestador**: nueva Fase 0.5 (presupuesto y routing con los
  casos A–H), y secciones de delegación a Codex, reutilización de sesiones,
  overrides del usuario, fallbacks y documentación viva.
- **Política de Engram**: Claude es el único que escribe decisiones; Codex es
  read-mostly y reporta hallazgos en `risks` en vez de guardarlos. Elimina la
  duplicación en el origen sin reconciliar topic keys entre proveedores.

### Notes

- Verificado sobre Claude Code 2.1.237 y Codex CLI 0.147.0 (plan ChatGPT Plus),
  Windows 10 con PowerShell 5.1.
- No se instaló ningún plugin nuevo: no existe una integración oficial
  Claude↔Codex, y `codex exec` supera a `codex mcp-server` para este uso (el MCP
  expone solo `codex` y `codex-reply`, sin forma de acotar el output; `exec`
  ofrece `--output-schema`, `-o`, exit codes y `exec resume` para la continuidad).
