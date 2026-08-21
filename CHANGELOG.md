# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

Toda feature nueva del orquestador entra acá y actualiza la sección
correspondiente del [README.md](README.md) en el mismo diff.

## [Unreleased]

### Added

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
