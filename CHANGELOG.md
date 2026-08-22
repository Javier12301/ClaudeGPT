# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

Toda feature nueva del orquestador entra acá y actualiza la sección
correspondiente de [`docs/SYSTEM.md`](docs/SYSTEM.md) en el mismo diff.

## [Unreleased]

### Added

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
