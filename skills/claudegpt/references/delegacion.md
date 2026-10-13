# Delegación y reviews

Leelo antes de la primera delegación o review. Los workers nunca conversan con el
usuario ni escriben documentación canónica.

## Cuándo no delegar

Typos, renames chicos, documentación, configuración sin comportamiento ejecutable y todo
lo que cueste más especificar que hacer. Eso lo hacés vos.

## Nunca esperar a ciegas

Toda espera lleva timeout y corre en background con aviso al terminar. El fin se detecta
por el **fin del proceso** (`codex exec`, `codex review`) o por `worker_done` (Orca). Si
una espera supera lo razonable para el tamaño de la tarea, mirá la salida (archivo de
log, `orca terminal read`, `worker-read`) en vez de seguir esperando: un modal, un error
de auth o un comando trabado se ven ahí. Lo que no avanza se corta y se decide.

## Qué vía usar

| Ejecutor | Vía | Fin detectado por |
|---|---|---|
| Codex (implementar, testear) | `codex exec` directo, con sandbox | salida del proceso + archivo `-o` |
| Codex (review) | `codex review` | salida del proceso |
| Otros agentes (OpenCode, Gemini, Claude…) | Orca `worker-start` | `worker_done` |

Codex no va por Orca: en Windows un worker Codex con sandbox hace el trabajo pero no
puede reportar `worker_done` (named pipe de Orca, issue stablyai/orca#13539; en macOS
#22947). Correrlo sin sandbox para esquivarlo no es aceptable. Revisá ese issue: si se
cerró, Codex puede volver a `worker-start`.

## Codex: `codex exec`

Escribí la spec en un archivo temporal fuera de lo que se commitea y lanzalo en
background, con timeout:

```bash
codex exec -s workspace-write -o <tmp>/codex-last.md - < <tmp>/spec.txt > <tmp>/codex-log.txt 2>&1
```

- Corre en el directorio del repo (o del worktree) donde tiene que editar.
- `-o` guarda solo el mensaje final: leé ese archivo, no el log, salvo que falle.
- Modelo pedido por el usuario: `-m <modelo>`; esfuerzo: `-c model_reasoning_effort=<nivel>`.
- Exit ≠ 0 o archivo vacío → leé el final del log y decidí (reintentar con spec
  corregida, hacerlo vos, o informar).
- Dentro del sandbox de Codex en Windows, `node --test` puede no poder lanzar
  subprocesos; la validación que importa es la que corrés vos después.
- Si `codex` muestra "Background server has incompatible feature settings", el CLI y
  su daemon tienen versiones distintas (`codex app-server daemon version`). Pedile al
  usuario alinearlas: `npm i -g @openai/codex@latest` + `codex app-server daemon update`.

## Orca: ciclo mínimo supervisado

Orca evoluciona rápido: antes de la primera delegación de la sesión cargá la guía que
corresponde a tu binario con `orca skills get orchestration` (en Linux fuera de una
terminal de Orca el ejecutable es `orca-ide`). Si una flag de acá no coincide, manda la
guía. Usá siempre `--json`.

```text
orca status --json                                   # runtime listo
orca orchestration run-create --objective "<feature>" --json     # una vez; anotá run_id
orca orchestration worker-start --spec "<spec>" --task-title "<título>" \
     --agent <id> --worktree current --json          # o un worktree propio para trabajo independiente
orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json
orca orchestration reply --id <message_id> --body "<respuesta>" --json        # preguntas
orca orchestration worker-release --dispatch <dispatch_id> --json             # tras validar
orca orchestration check --ack <delivery_id> --json
```

Lanzá toda la ola independiente antes de esperar. Agente pedido con modelo concreto:
`--model <id>` (y `--effort` si aplica). Compará `launch.requested` con
`launch.effective`; nunca afirmes un modelo que no figura como efectivo.

### Hechos verificados (Orca 1.4.224, Windows)

- **Orca no verifica que el CLI exista.** Con un agente no instalado, `worker-start`
  devuelve `ready` y el preámbulo se pega en una shell. Antes de delegar:
  `command -v <cli>`. Si se coló igual: `worker-stop --dispatch <id>` enseguida.
- `check --wait --json` emite líneas de heartbeat (`{"_keepalive":true,…}`) antes del
  resultado: el resultado es **el último objeto JSON** de la salida.
- `worker-start` que no llega a `ready` (p. ej. `failedStage: agent_readiness`) deja una
  terminal: leela (`orca terminal read --terminal <handle> --json`) para ver la causa y
  seguí el `recovery` del receipt. Causas vistas: un modal del agente (aviso de update;
  se cierra enviando Esc a la terminal), flags duplicadas por los "default args" del
  agente en la configuración de Orca (lo corrige el usuario en Orca → Settings → Agents).
- Reintento sobre una terminal ya abierta:
  `worker-start --task <task_id> --retry-of <dispatch_id> --terminal <handle> --worktree <sel>`.
  Esa terminal no la cierra `worker-release` (queda `retained`); cerrala con
  `orca terminal close --terminal <handle>` después de validar.
- OpenCode: `--model` solo si Orca puede verificar el CLI; si no, `capability_unsupported`.
  En ese caso sin `--model` (usa el modelo configurado en OpenCode) y avisá al usuario.
- Los permisos efectivos del worker los define la configuración de agentes de Orca, no
  esta skill. Si están en modo sin sandbox, decíselo al usuario antes de delegar.
- `worker_done` trae `outcome` y `filesModified` en el payload. Es un reclamo, no
  evidencia: verificá con `git diff` y la validación de la spec.

### Al terminar o retomar

- Cada worker con resultado aceptado: `worker-release` (o reutilizá la terminal para una
  tarea siguiente del mismo agente). Antes de cerrar la feature,
  `orca orchestration worker-list --terminal-state reclaimable --json` debe estar vacío.
- Tres esperas vacías seguidas → `worker-list --json` y seguí el `projection.nextAction`
  de cada fila. Ausencia de señal no autoriza a parar ni reintentar.
- Reanudar: `orca orchestration run-use <run_id>` + `worker-list --json`;
  `worker-read --dispatch <id> --json` recupera la salida archivada.
- Worktree propio: cuando el worker termina, revisá su rama, mergeala vos y recién
  entonces `orca worktree rm` (nunca con cambios sin integrar).

## Spec para un worker

En **inglés ASCII-safe** (sin acentos, comillas tipográficas ni flechas). Literales del
repo exactos. Nunca el historial del chat, archivos enteros ni logs largos.

```text
TASK
Short task name.

GOAL
Observable result expected from this delegation.

ROLE
implementer | tester | reviewer | data. (Tester: write tests from the contract below,
not from the implementation. Reviewer: read-only, never edit files.)

SKILLS TO LOAD
- <installed skill name, if any>

VERIFIED REPOSITORY FACTS
- Only facts verified from repository evidence (stack, patterns, exact commands).

FILE SCOPE
May read:
May edit:
Must not edit:

CONTRACT / ACCEPTANCE CRITERIA
-

REAL APPLICATION BEHAVIOR
When invoked through:
Input is produced by:
Expected persisted state / user-visible result:

VALIDATION
- Exact command / expected result / measured baseline

DO NOT
- Do not push. Do not commit unless this spec says so; if you commit, never add
  Co-Authored-By or any attribution trailer.
- Do not modify existing tests unless the task says so.
- Do not add dependencies or perform lateral refactors.

UNCERTAINTY PROTOCOL
Verify from repository evidence before assuming. If a fact that changes the design
cannot be verified, stop without editing files and ask the coordinator:
NEEDS_INFO / missing_fact / evidence_checked / question / affected_decision
```

`REAL APPLICATION BEHAVIOR` existe porque los agentes optimizan para pasar el test: si una
heurística puede satisfacerlo sin resolver el problema real, decí cuál es la forma
correcta. Para datos generados: formato exacto + validación determinista que corrés vos.

## Reviews con Codex

`codex review` es no interactivo, read-only y aplica la skill oficial de OpenAI
`review-agent` (findings P0–P3 con archivo:línea). Lanzalo en background y esperá:

```bash
codex review --base <ref>          # parcial: commit anterior al bloque · final: rama de origen
codex review --commit <sha>        # un commit puntual
codex review --uncommitted         # cambios sin commitear
codex review "<instrucciones>"     # adversarial con foco
```

La salida incluye todo el transcript de Codex: redirigila a un archivo
(`codex review … > <tmp>/review.txt 2>&1`) y leé solo el bloque final de findings
(desde la última línea `codex`), no el log completo.

`--base` **no se combina** con instrucciones. Para el adversarial escribí el rango en el
texto: `"Review the changes between <ref> and HEAD (use git merge-base). Focus: <riesgos
concretos, invariantes y requisito>. Report P0-P3 findings with file:line evidence."`

Reviewer distinto de Codex pedido por el usuario: worker de Orca con ROLE reviewer y el
mismo formato de findings.

**Si falla** (Codex no instalado, sin login, error): informalo con el comando exacto para
que lo corra el usuario y esperá. Nunca saltees el review.

Anotá cada review en la tabla **Reviews** de `IMPLEMENTATION.md`.

## Sin Orca

Si Orca no está corriendo o la orquestación falla de forma reiterada: decíselo al usuario
y seguí con ejecución directa, `codex exec "<spec>"` / `codex review` por CLI, o los
subagentes nativos de tu agente. Nunca simules la supervisión de Orca.
