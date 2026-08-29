# Delegación a Codex

Leé este archivo cuando vayas a delegar algo a Codex. Si la tarea la resolvés
con subagentes Claude o vos mismo, no hace falta.

Codex es **capacidad delegada, no un segundo Tech Lead**. Vos hablás con el
usuario, decidís y arbitrás; Codex recibe tareas autocontenidas y devuelve
resultados compactos. Nunca conversa con el usuario.

Invocación única, directa por Bash (no gastes un subagente Claude de proxy):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/scripts/codex-run.ps1 `
  -Role constructor -PromptFile <spec.md> -Repo <repo> -Task "<nombre corto>" `
  -Phase construct
```

`-Phase` (`explore`, `contract`, `test`, `construct`, `verify`, `review`, `docs`)
solo alimenta el log de decisiones. Cuesta nada y es lo que después permite ver
en qué fase se concentran los retries.

Roles: `constructor`, `reviewer`, `security-reviewer`, `verifier`,
`docs-researcher`. El wrapper resuelve modelo, effort, sandbox y contrato de
salida solo — vos no elegís slugs de modelo a mano.

## Cuándo NO usar Codex

Typos, renames, cambios mecánicos, documentación, configuración sin
comportamiento ejecutable, y cualquier cosa donde el costo de escribir la spec
supere al de hacerlo vos. Codex no se usa por ritual.

## Idioma y ASCII

Todo spec y todo prompt de continuación va en **inglés** y **ASCII-safe**: sin
acentos, comillas tipográficas, flechas Unicode, emojis ni puntuación
decorativa. Los **literales del repo** —paths, identificadores, strings de
código, nombres de test, valores de API— se copian **exactos**, sin
"asciificar". Tu conversación con el usuario sigue en el idioma del usuario.

## Qué le pasás

Escribí la spec en un archivo y pasá `-PromptFile`. Nunca le mandes historial del
chat, archivos completos, tus razonamientos, logs largos ni salidas de test
irrelevantes.

Si el repo tiene una capsule (`references/capsule.md`), pegala textual en
`VERIFIED REPOSITORY FACTS` en vez de reescribir el entorno a mano.

## Plantilla canónica del spec

```text
TASK
Short task name.

GOAL
Observable result expected from this delegation.

VERIFIED REPOSITORY FACTS
- Only facts verified from repository evidence.
- Database:
- Framework:
- Relevant implementation pattern:
- Package/test tooling:
- Interpreter / exact commands:
- Other task-critical facts:

FILE SCOPE
May read:
May edit:
Must not edit:

ACCEPTANCE CRITERIA
-

REAL APPLICATION BEHAVIOR
When invoked through:
Input is produced by:
Source of truth:
Expected persisted state:
Expected user-visible result:

TESTS
- Path:
- Exact command:
- Expected result:
- Measured baseline before this task:

CONSTRAINTS
-

DO NOT
- Do not modify existing RED tests.
- Do not add unrelated dependencies.
- Do not perform lateral refactors.
- Do not introduce technologies not verified in the repository.
- Do not infer architecture from generic conventions.

UNCERTAINTY PROTOCOL
Verify from repository evidence before making assumptions.
If a required fact cannot be verified, return NEEDS_INFO before making a
decision that depends on it.
```

### Por qué existe `REAL APPLICATION BEHAVIOR`

La falla característica de Codex no es descuido, es el incentivo: optimiza para
*hacer pasar el test*, porque el criterio que le damos es "los tests en verde".
El caso que lo mostró: una heurística que sumaba toda clave terminada en
`_importe` satisfacía el test y no resolvía el bug, porque el objeto que arma la
aplicación nunca tiene esa clave.

> Si el requisito se puede satisfacer con una heurística que el test no
> distingue del comportamiento correcto, **la spec tiene que decir cuál es la
> forma correcta**. La mitigación es tuya y va acá.

## Qué te devuelve

10–20 líneas con contrato forzado por JSON Schema. Si necesitás más evidencia,
**leé `git diff` vos mismo** — es gratis y no pasa por el contexto de Codex.

El contrato `impl` trae `status` (`DONE` | `NEEDS_INFO` | `BLOCKED`) y
`clarifications`. Invariante: `DONE` y `NEEDS_INFO` van con `blocked=false`;
`BLOCKED` con `blocked=true`. `DONE` ⇒ `clarifications` vacío; `NEEDS_INFO` ⇒ al
menos una. `NEEDS_INFO` sale con exit 0.

## TDD híbrido

```
tester (Claude, Sonnet) -> RED
        v
codex-run -Role constructor -> GREEN
        v
vos revisas el diff
```

**No uses `tester-tdd` de Codex** para una spec que tu Tester ya cubrió. La
independencia que importa es entre *quien escribe el test* y *quien escribe el
código*, y con Tester Claude + Constructor Codex ya la tenés — encima entre
proveedores distintos.

## Review adversarial

Después de un cambio importante, `-Role reviewer`. Buscá correctness,
regresiones, races, edge cases, contratos rotos y cobertura faltante relevante.
**No** estilo cosmético, nombres subjetivos, ni refactors no pedidos.

Pasale el requisito original, el diff, los invariantes y las zonas de riesgo. No
le pidas que reexplore el proyecto entero. Las preguntas que tiene que responder:

```
Does this satisfy the real application path?
Can tests be GREEN while behavior remains wrong?
Was any assumption introduced?
Is persisted state consistent?
Are error paths correct?
Did the implementation broaden scope?
```

`-Role security-reviewer` solo cuando la tarea toca auth, permisos, pagos,
uploads, tokens, datos sensibles o trust boundaries.

**Batcheá el review cuando no hay superficie de seguridad**: una sola pasada de
`reviewer` pidiendo correctness **y** security. Dos invocaciones separadas solo
en el caso D, cuando el security review necesita su propia sesión y su foco.

Los findings **se evalúan uno por uno con evidencia**. Nunca aceptes un finding
porque "lo dijeron dos modelos": vos sos el árbitro final y verificás en el código.

## Flujo `NEEDS_INFO`

1. Leés los hechos que pide.
2. Los resolvés desde evidencia del repo o decisiones que el usuario ya tomó.
   **No** preguntás al usuario si ya tenés evidencia suficiente.
3. Respondés **solo con hechos**, sin discutir por qué su interpretación anterior
   estaba mal salvo que haga falta para avanzar.
4. Reanudás la **misma** sesión si las reglas de reuso lo permiten.

La continuación va por `-PromptFile` (archivo temporal UTF-8 sin BOM), **no** por
`-Prompt "<texto>"`, con formato `FACT_RESOLUTION`:

```text
FACT_RESOLUTION

database_engine: MySQL
evidence: path/to/application.properties

Continue the original task.
All previous constraints remain unchanged.
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/scripts/codex-run.ps1 `
  -Resume <session-id> -Role <rol> -PromptFile <continuation-spec.md> -ClarifyOf <session-id> `
  -Repo <repo> -Task "<nombre corto>"
```

**Tope: 2 ciclos por tarea/spec.** Pasado el segundo sin resolver: dejás de
reanudar en automático, revisás el spec/contrato, lo corregís, y decidís si
arrancás una tarea nueva o cerrás por otra vía. `NEEDS_INFO` **no** es un RED
lógico y **no** consume el presupuesto de retry: se registra con `-ClarifyOf`,
no con `-RetryOf`.

## Reutilización de sesiones

Una sesión ya cargada con el contexto de una tarea es un activo. Reusarla cuesta
un prompt corto; tirarla obliga a re-explicar todo.

**Reusá** (`-Resume <ID> -Role <rol> -PromptFile <delta.md>`) con las tres:

1. **Continuidad real** — misma tarea, mismos archivos, misma spec.
2. **Sesión liviana** — el wrapper lo dice solo (`REUSE-OK` / `REUSE-IF-DIRECT` /
   `REUSE-DENIED`). Consultable con `-SessionInfo <id>`.
3. **La corrida anterior terminó sana** — exit 0 y `blocked: false`. Un
   `NEEDS_INFO` sano cuenta como terminada sana.

**Arrancá de cero** si: es otra tarea, cambió el contrato, cambia el rol, cambia
el sandbox, el wrapper devuelve `REUSE-DENIED`, o el working tree cambió por
fuera de Codex.

> **Un reviewer nunca hereda la sesión del constructor.** Si el que revisa es el
> mismo que escribió, se pierde la independencia del review. El wrapper usa
> sesión nueva al cambiar de rol; no lo fuerces.

El prompt de continuación es **solo el delta**. Ahí está todo el ahorro.

> **Expectativa realista:** una sesión puede llegar a `REUSE-DENIED` por tamaño
> en dos turnos. No planifiques una cadena larga de continuaciones asumiendo que
> la sesión va a seguir viva; para arreglar findings, el `SendMessage` a un
> subagente Claude es más confiable.

Decile al usuario cuándo reusás: *"continúo en la sesión de Codex de la
implementación anterior (312 KB, liviana) en vez de arrancar una nueva"*.

## Un solo escritor por repo

**Nunca** corras el `constructor` de Claude y un executor de Codex sobre el mismo
repositorio a la vez. Reviewers read-only sí pueden ir en paralelo si el snapshot
es coherente. Repos distintos no se bloquean entre sí.

**Codex nunca redacta documentación canónica.** Puede investigar
(`-Role docs-researcher`), no escribir.
