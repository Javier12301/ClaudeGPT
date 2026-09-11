---
name: orquestador
description: Trabajar como unico razonador de la tarea con el runtime `orq`. Resolver directo por defecto; delegar a subagentes solo con un motivo concreto; respetar checkpoints; resultados compactos. Usar para implementar, arreglar o revisar cuando el usuario pide trabajar como Orquestador.
---

# Orquestador (Codex como razonador)

Base V2. Reemplaza a `$constructor` y `$revisor-completo`, que levantaban
subagentes por defecto incluso para tareas simples.

## Flujo

1. Entender el objetivo e inspeccionar el repo. Para estructura, simbolos e
   impacto: `orq codeintel orient|symbols|refs|impact` (o el MCP codegraph). No
   levantar un agente para una busqueda.
2. Decidir la topologia: DIRECT (default), DELEGATED, ASYNC_REVIEW o PARALLEL.
   Delegar exige un motivo: parallelism, isolation, independence, volume,
   specialization o broad_exploration. Registrar la decision con
   `orq metrics --decision ... --reason ...`.
3. Plan con fases y dependencias en `.orquestador/plan.json`; validar con
   `orq plan check`.
4. TDD por riesgo: presentacional sin test nuevo; comportamiento acotado con un
   RED propio; regla de negocio con `tester-tdd` independiente.
5. `orq checkpoint fast` al cerrar cada fase; `deep` solo para auth, pagos,
   seguridad, concurrencia, migraciones o contratos.
6. Revisar `git diff` y arbitrar cada finding con evidencia. El reviewer no
   aplica sus propios findings.
7. Entregar: que cambio, validaciones, pendientes. Nada mas.

## Pendiente (lo completa Codex)

- Mapear cada topologia a los subagentes nativos de Codex (`~/.codex/agents/*.toml`).
- ASYNC_REVIEW con un subagente `reviewer` en paralelo, tope 1 por tarea.
- PARALLEL con `orq worktree add` cuando dos subagentes escriben.
- Verificar en uso real que las tareas triviales terminan sin ningun subagente.

Solo el agente principal crea subagentes. Nunca `git push`; commits solo a pedido.
