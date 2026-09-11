# Delegación a Codex

Leé este archivo cuando vayas a delegar algo a Codex. Si lo resolvés vos o con un
subagente Claude, no hace falta.

Codex es **capacidad delegada, no un segundo razonador**. Recibe tareas
autocontenidas y devuelve resultados compactos. Nunca conversa con el usuario.
Invocación única y directa por Bash — no gastes un subagente Claude de proxy:

```bash
orq run --role constructor --reason volume --spec <spec.md> --task "<nombre corto>" --phase construct
```

`--reason` es obligatorio: uno de los seis motivos del `SKILL.md`. Si no hay
motivo, no hay delegación. El runtime resuelve modelo (tier contra el catálogo
vivo), effort, sandbox y contrato de salida — no elegís slugs a mano.

Roles: `constructor`, `tester-tdd`, `verifier`, `reviewer`, `security-reviewer`,
`docs-researcher`. Exit codes: `0` ok · `2` NO-GO · `3` REUSE-DENIED · `4` fallo
o contrato violado · `5` Codex ausente o sin sesión ChatGPT · `6` uso · `7`
reviewer ya activo en esa tarea.

## Cuándo NO usar Codex

Typos, renames, cambios mecánicos chicos, documentación, configuración sin
comportamiento ejecutable, y cualquier cosa donde escribir la spec cueste más
que hacerlo vos. Registralo: `orq metrics --decision not_delegated --reason spec_cost_exceeds_work`.

## Idioma y ASCII

Toda spec va en **inglés** y **ASCII-safe**: sin acentos, comillas tipográficas,
flechas ni emojis. Los **literales del repo** — paths, identificadores, strings,
nombres de test, valores de API — se copian **exactos**. Tu conversación con el
usuario sigue en su idioma.

## Qué le pasás

La spec en un archivo (`--spec`). Nunca historial del chat, archivos completos,
tus razonamientos, logs largos ni salidas de test irrelevantes. Si el repo tiene
capsule (`references/capsule.md`), pegala en `VERIFIED REPOSITORY FACTS`.

## Plantilla de spec

```text
TASK
Short task name.

GOAL
Observable result expected from this delegation.

VERIFIED REPOSITORY FACTS
- Only facts verified from repository evidence.
- Database / framework / relevant pattern / package+test tooling / exact commands

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
- Path / exact command / expected result / measured baseline

CONSTRAINTS
-

DO NOT
- Do not modify existing RED tests.
- Do not add unrelated dependencies.
- Do not perform lateral refactors.
- Do not introduce technologies not verified in the repository.

UNCERTAINTY PROTOCOL
Verify from repository evidence before assuming. If a required fact cannot be
verified, return NEEDS_INFO before making a decision that depends on it.
```

### Por qué existe `REAL APPLICATION BEHAVIOR`

Codex optimiza para *hacer pasar el test*, porque ese es el criterio que le
damos. El caso que lo mostró: una heurística que sumaba toda clave terminada en
`_importe` satisfacía el test y no resolvía el bug — el objeto que arma la
aplicación nunca tiene esa clave. **Si el requisito se puede satisfacer con una
heurística que el test no distingue del comportamiento correcto, la spec tiene
que decir cuál es la forma correcta.**

## Qué te devuelve

10–20 líneas, contrato forzado por JSON Schema. El código **no vuelve**: está en
disco. Si necesitás más evidencia, `git diff` vos mismo — es gratis. El stream
completo queda en `~/.orquestador/logs/` (uno por corrida; `orq run` imprime la ruta) y la statusline muestra `CX>
<rol> <tiempo> <evento>` mientras corre.

Contrato `impl`: `status` (`DONE` | `NEEDS_INFO` | `BLOCKED`) + `clarifications`.
`DONE` y `NEEDS_INFO` van con `blocked=false`, `BLOCKED` con `blocked=true`;
`NEEDS_INFO` exige al menos una aclaración. Si no se cumple, el runtime lo trata
como contrato violado (exit 4).

## TDD híbrido

```
tester (Claude, Sonnet) -> RED
orq run --role constructor --reason volume -> GREEN
vos revisas el diff
```

La independencia que importa es entre quien escribe el test y quien escribe el
código; con Tester Claude + Constructor Codex cruza proveedores. `tester-tdd` de
Codex es para cuando el razonador es Codex.

## Review adversarial

No se pide "revisá el código". El contrato del reviewer es: **intentá demostrar
que este cambio puede estar roto aunque los tests pasen.** Cada finding trae
`evidence` — qué ejecutó o leyó, qué input lo rompe. Sin evidencia no hay finding.

Pasale el requisito original, el diff o el alcance, los invariantes y las zonas
de riesgo. No le pidas que reexplore el proyecto.

**Batcheá** cuando no hay superficie de seguridad: una sola pasada de `reviewer`
pidiendo correctness y security. `security-reviewer` aparte solo para auth,
permisos, pagos, uploads, tokens, datos sensibles o trust boundaries.

### ASYNC_REVIEW

Cuando un bloque ya está en verde y lo que sigue no depende del review:

```bash
orq run --role reviewer --reason independence --background --spec review.md --task "fases 1-2"
# ... seguís con la fase 3 ...
orq jobs <id>      # el resultado, cuando lo necesites
```

Solo roles read-only. Tope duro: **un reviewer activo por tarea** (el segundo
sale con exit 7). Si llega un P0/P1, interrumpís lo que estés haciendo si toca lo
revisado; si no, lo tomás al cerrar la unidad.

Los findings se evalúan **uno por uno con evidencia** y el veredicto se registra:
`orq metrics --finding accepted|rejected --detail "file:line - por qué"`.

## `NEEDS_INFO`

1. Leés los hechos que pide y los resolvés desde evidencia del repo o decisiones
   que el usuario ya tomó. No le preguntás al usuario si ya tenés la respuesta.
2. Respondés **solo con hechos**, en un archivo:

```text
FACT_RESOLUTION
database_engine: MySQL
evidence: path/to/application.properties
Continue the original task. All previous constraints remain unchanged.
```

```bash
orq run --resume <session-id> --role <rol> --reason <el mismo> --spec continuation.md --clarify-of <session-id> --task "<nombre>"
```

**Tope: 2 ciclos por tarea.** Pasado el segundo: revisás y corregís la spec, y
decidís si arrancás una tarea nueva o cerrás por otra vía. `NEEDS_INFO` no es un
RED lógico: va con `--clarify-of`, no con `--retry-of`.

## Reutilización de sesiones

Reusás (`--resume <id>`) con las tres: **continuidad real** (misma tarea, archivos
y spec), **sesión liviana** (`orq session <id>` → `REUSE-OK` / `REUSE-IF-DIRECT`
/ `REUSE-DENIED`), y **corrida anterior sana** (exit 0; un `NEEDS_INFO` sano
cuenta). Arrancás de cero si cambia la tarea, el contrato, el rol o el sandbox,
o si el working tree cambió por fuera de Codex.

> **Un reviewer nunca hereda la sesión del constructor.** Si el que revisa es el
> que escribió, se pierde la independencia — que es medio motivo de usar Codex.

Expectativa realista: una sesión puede llegar a `REUSE-DENIED` en dos turnos.
Para arreglar findings, `SendMessage` a un subagente Claude es más confiable.

## Escritores

Nunca un writer de Claude y uno de Codex sobre los **mismos archivos** a la vez.
Regiones disjuntas en el mismo repo: el segundo writer en `orq worktree add
<nombre>` y `orq run --repo <ruta del worktree>`. Reviewers read-only, en paralelo.

**Codex nunca redacta documentación canónica.** Puede investigar
(`docs-researcher`), no escribir.
