# Codex: delegar y revisar

Leelo cuando vayas a delegar en Codex o a lanzar un review. Codex es capacidad
delegada: nunca conversa con el usuario y nunca escribe documentación canónica.

## Cuándo NO usar Codex

Typos, renames chicos, documentación, configuración sin comportamiento ejecutable, y
todo lo que cueste más especificar que hacer. Eso lo hacés vos.

## Delegar trabajo: `codex:rescue`

Invocá la skill `codex:rescue` con args `--background <spec>` si es largo, o sin flag
para esperar el resultado. También sirve el Agent `subagent_type: "codex:codex-rescue"`.
El código vuelve en disco: revisalo con `git diff` antes de aceptarlo.

La spec va en **inglés ASCII-safe** (sin acentos, comillas tipográficas ni flechas).
Los literales del repo (paths, identificadores, strings, nombres de test) van exactos.
Nunca le pases el historial del chat, archivos enteros ni logs largos.

```text
TASK
Short task name.

GOAL
Observable result expected from this delegation.

VERIFIED REPOSITORY FACTS
- Only facts verified from repository evidence (stack, patterns, exact commands).

FILE SCOPE
May read:
May edit:
Must not edit:

ACCEPTANCE CRITERIA
-

REAL APPLICATION BEHAVIOR
When invoked through:
Input is produced by:
Expected persisted state / user-visible result:

TESTS
- Path / exact command / expected result / measured baseline

DO NOT
- Do not modify existing tests unless the task says so.
- Do not add unrelated dependencies or perform lateral refactors.

UNCERTAINTY PROTOCOL
Verify from repository evidence before assuming. If a fact that changes the design
cannot be verified, stop without editing files and return:
NEEDS_INFO / missing_fact / evidence_checked / question / affected_decision
```

`REAL APPLICATION BEHAVIOR` existe porque Codex optimiza para pasar el test. Si una
heurística puede satisfacer el test sin resolver el problema real, la spec dice cuál
es la forma correcta.

## Lanzar un review

`/codex:review` y `/codex:adversarial-review` no se pueden invocar desde el modelo.
Este plugin trae un wrapper que busca el companion instalado del plugin `codex` y lo
llama con los mismos argumentos que usan esos comandos. Lanzalo con
`Bash(run_in_background: true)` y esperá la notificación:

```bash
node "<wrapper>" review "--base <ref>"
node "<wrapper>" adversarial-review "--base <ref> <foco>"
```

`<wrapper>` es la ruta absoluta "Wrapper de review" que figura en el SKILL.md del
orquestador (ya resuelta; no uses `${CLAUDE_PLUGIN_ROOT}` literal en Bash).

- `<ref>`: parcial → el commit anterior al bloque; final → la rama de origen.
- `<foco>` (solo adversarial): los riesgos concretos, en una línea en inglés.
- Pasale al adversarial el requisito, los invariantes y las zonas de riesgo en el foco;
  no le pidas que reexplore el proyecto.

**Si falla** (exit 3 = companion no encontrado, u otro error): detenete y mostrale al
usuario el comando exacto para tipearlo, por ejemplo `/codex:review --base main`.
Esperá su resultado antes de seguir. Nunca saltees el review.

Anotá cada review en la tabla **Reviews** de `IMPLEMENTATION.md`.
