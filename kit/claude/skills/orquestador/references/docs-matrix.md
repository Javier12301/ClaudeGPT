# Sincronización de documentación

Leé este archivo **solo cuando el cambio tenga impacto documental real**. La
mayoría de las tareas no lo tienen y no deberían pagar esta fase.

## Cuándo mirar el terreno documental

Antes de escribir un documento en un repo que no conocés, averiguá qué
documentación existe y **de quién es**, con la escalera barata de la skill
`documentacion`: `CLAUDE.md`/`AGENTS.md` → `orq codeintel orient` → nombres en
`docs/` → antigüedad del último commit de `docs/`.

Si la documentación es **nuestra**: leé README y ROADMAP completos, y de
`SYSTEM.md` **solo el índice** — después `grep` de la sección que toca la tarea.
Nunca SYSTEM entero: un SYSTEM que se lee completo cada sesión te cuesta tokens
en vez de ahorrártelos.

Si la documentación es **ajena, vieja, o no existe**, invocá `documentacion`: ahí
están las siete salvaguardas. Las dos que más importan — no crear un segundo
árbol de documentación al lado del de ellos, y no generar nada sin aprobación
explícita del usuario.

La ausencia de documentación **nunca bloquea**.

## La matriz

**Después de GREEN y del review, nunca en paralelo con un executor.** Un solo
escritor sobre el working tree también vale para los documentos.

Mirá `git diff --name-only` y decidí:

| Cambio | Documentos |
|---|---|
| Typo, formato, comentario, refactor interno | ninguno |
| Feature visible por el usuario | CHANGELOG |
| Nueva regla de negocio | SYSTEM + CHANGELOG |
| Nueva decisión técnica o cambio arquitectónico | SYSTEM + DECISIONS |
| Fase terminada o nueva | ROADMAP |
| Setup / onboarding | README |
| Deploy o infraestructura | SYSTEM |
| Funcionalidad eliminada | SYSTEM + ROADMAP + CHANGELOG |

**La mayoría de las tareas sale con "ninguno".** Si estás tocando documentos en
el 80% de las tareas, el gate dejó de ser honesto y el sistema pasó a costar más
de lo que ahorra.

Cuando hay impacto, invocá `documentacion` y **escribí vos**. Los tres
invariantes (presente sin verbos de cambio, reemplazar en vez de agregar, sin
secciones vacías) son criterio, y delegar criterio a Sonnet sale caro en
revisión. Se delega a `constructor` solo el bootstrap inicial y las reescrituras
grandes.

**Reemplazar antes que agregar** vale también acá: si ya existe una sección que
cubre lo que estás documentando, actualizala. Un documento con dos secciones que
dicen cosas distintas sobre lo mismo es peor que uno desactualizado.

**Codex nunca redacta documentación canónica.** Puede investigar
(`orq run --role docs-researcher`), no escribir.

## Definition of Done

Escala con la ruta.

- **Directo / presentacional**: termina cuando funciona y revisaste el diff.
- **Comportamiento acotado**: implementación, test dirigido en GREEN,
  verificación por alcance, review del diff.
- **Riesgo de negocio**: todo lo anterior más contrato congelado, tester
  independiente, reviewer adversarial, **doc sync si hubo impacto**, y ROADMAP
  actualizado si cambió el estado de una fase.
