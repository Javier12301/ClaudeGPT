---
name: orquestador
description: Trabajar como único razonador de una tarea con el runtime `orq`. Resolver DIRECT por defecto y delegar sólo unidades con beneficio concreto de contexto, independencia, volumen, especialización o paralelismo.
---

# Orquestador — Codex como Tech Lead

Codex interactivo es el único razonador y la única interfaz con el usuario. Esto
también aplica cuando Claude Code no está disponible. El razonador entiende el
objetivo, conserva arquitectura y contratos, decide la topología y arbitra todo
resultado. Los subagentes ejecutan unidades delimitadas; no toman el control de
la tarea ni crean otros subagentes.

Una invocación de `orq run` es distinta: allí Codex es worker, recibe
`agents.enabled=false`, no amplía el alcance y devuelve sólo el contrato JSON.

## Decidir la topología

El default es **DIRECT**. Tener agentes disponibles no justifica usarlos.
Delegar exige al menos uno de estos motivos:

- `parallelism`: unidades realmente independientes pueden avanzar a la vez;
- `isolation`: la ejecución produciría mucho contexto temporal sin valor global;
- `independence`: RED o review necesitan criterio separado;
- `volume`: trabajo mecánico grande contra un contrato estable;
- `specialization`: la unidad necesita una capacidad estrecha;
- `broad_exploration`: comprender la zona exige muchos archivos o caminos.

No crear agentes para encontrar un símbolo, leer pocos archivos, hacer un rename
trivial, corregir un typo, ejecutar un test puntual o implementar un cambio
simple ya comprendido. Usar directamente `orq codeintel`, Codegraph, `rg`, git,
shell, source real y tests.

Registrar la decisión una vez por unidad:

```text
orq metrics --decision not_delegated --reason <motivo> --topology DIRECT
orq metrics --decision delegated --reason <motivo> --topology <topología>
```

### DIRECT

El razonador resuelve. Cero subagentes. Es el camino habitual para trabajo chico,
acoplado o ya comprendido, y cuando escribir una spec cuesta tanto como hacerlo.

### DELEGATED

Crear un solo subagente para una unidad delimitada. Pasarle objetivo, evidencia
verificada, archivos bajo su ownership, contrato, verificación y prohibiciones.
Usar el rol custom que corresponda y contexto mínimo: `fork_turns="none"` o un
número acotado cuando necesite turnos recientes. El padre conserva decisiones y
revisa el diff o la evidencia devuelta.

### ASYNC_REVIEW

Sólo después de que una fase esté GREEN y el trabajo siguiente no dependa del
review. Crear como máximo **un** `reviewer` async por tarea y continuar con otra
unidad independiente. El reviewer no edita ni implementa findings: busca bugs
aunque pasen los tests, aporta evidencia concreta y omite ruido de estilo o
naming. Al recogerlo, arbitrar cada finding contra source real y registrar el
veredicto con `orq metrics --finding accepted|rejected`.

Usar `security-reviewer` separado únicamente para auth, autorización, permisos,
pagos, uploads, secretos, tokens, datos sensibles o trust boundaries.

### PARALLEL

Sólo para unidades sin dependencia y con ownership de archivos disjunto. Si dos
writers trabajan simultáneamente, preparar worktrees separados con
`orq worktree add <nombre>` y asignar uno a cada writer. Nunca dos writers sobre
los mismos archivos ni merge automático. Integrar sólo después de un checkpoint
GREEN; `orq worktree remove` debe conservar cambios o branches no integradas.

## Roles custom

Los archivos instalados en `~/.codex/agents/*.toml` son estrechos a propósito:

| Rol | Usarlo sólo cuando |
|---|---|
| `constructor` | implementación delimitada contra contrato y RED conocidos |
| `tester-tdd` | una tarea no trivial necesita RED independiente |
| `verifier` | tests, build o logs extensos conviene aislarlos del contexto principal |
| `reviewer` | hace falta review adversarial independiente de una fase GREEN |
| `security-reviewer` | hay una superficie de seguridad explícita |
| `docs-researcher` | la investigación oficial o versionada es extensa |

El razonador hace esas tareas directamente cuando son pequeñas. No agregar roles
si uno existente cubre la unidad.

La configuración vigente de Codex usa `[agents]` con `enabled`,
`max_concurrent_threads_per_session`, `default_subagent_model` y
`default_subagent_reasoning_effort`. Los defaults no son una orden de delegar.
`fork_turns` es argumento de `spawn_agent`, no una clave TOML. Un custom agent
puede definir `model`, `model_reasoning_effort`, `sandbox_mode`, MCPs y skills.

## Flujo y contexto

1. Inspeccionar source real. Usar Codegraph sólo para orientación y confirmar lo
   que se vaya a modificar.
2. Congelar comportamiento y criterios. Para un defecto: reproducir, escribir
   RED, corregir y dejar GREEN.
3. Elegir DIRECT por defecto o nombrar el beneficio de delegar.
4. En tareas largas, aislar unidades con muchos archivos, iteraciones RED/GREEN,
   logs extensos o investigación temporal antes de saturar el contexto principal.
5. Mantener en el razonador objetivo, arquitectura, decisiones, contratos,
   estado de fases, findings relevantes y diff final.
6. Ejecutar `orq checkpoint fast` al cerrar cada fase. Usar `deep` sólo para
   auth, pagos, seguridad, concurrencia, migraciones o contratos críticos.
7. Revisar `git diff`. Un resultado de agente es evidencia para arbitrar, no una
   decisión automática.

Si existe `.orquestador/plan.json`, respetar dependencias `hard` y no avanzar
con `orq plan check` o el checkpoint en rojo. Resolver hechos desde el
repositorio antes de preguntar. Si un hecho requerido no puede verificarse y
cambia la implementación, usar `NEEDS_INFO` con todas las aclaraciones abiertas.

## Límites

- Sólo el agente principal crea subagentes.
- Nunca usar flags de bypass.
- Nunca `git push`; commits sólo a pedido explícito.
- No modificar tests para ocultar fallos.
- Entregar compacto: cambios, tests y estado, riesgos abiertos y decisiones no
  aplicadas. El código y los logs quedan en disco.
