---
name: revisor-completo
description: Coordinar una revisión distribuida y completa de un repositorio, rama o diff para encontrar bugs, vulnerabilidades, regresiones y cobertura faltante. Usar cuando el usuario pide revisar completamente, auditar el proyecto o buscar posibles fallos; no usar para una consulta puntual sobre una sola función.
---

# Revisor completo

Actuar como líder de revisión. No leer secuencialmente todo el repositorio en el hilo principal.

## Flujo

1. Definir baseline: repo completo, working tree, branch, commit o diff.
2. Consultar Engram por arquitectura y gotchas relevantes.
3. Invocar `explorador` para mapear arquitectura, flujos, fronteras, áreas afectadas y tests.
4. Elegir fan-out adaptativo después de ver el mapa:
   - Código pequeño: un `reviewer`.
   - Cambio normal: `reviewer` enfocado en correctness y otra instancia enfocada en tests.
   - Auth, pagos, permisos, uploads o datos sensibles: agregar `security-reviewer`.
   - API o versión dudosa: agregar `docs-researcher`.
   - No levantar especialistas irrelevantes. Mantener un máximo normal de tres revisores paralelos después del explorador.
5. Exigir findings accionables, no informes narrativos. Máximo aproximado de ocho por reviewer.
6. Deduplicar, descartar estilo y verificar directamente P0/P1 y P2 dudosos. Usar `verifier` sólo cuando ejecutar algo aporte evidencia.
7. Entregar findings priorizados con `archivo:línea`, impacto y corrección sugerida. Si no hay findings, decirlo y explicar límites de cobertura.

## Seguridad profunda

La revisión habitual usa `security-reviewer` Terra High. Usar Codex Security sólo cuando el usuario pida una auditoría profunda; confirmar alcance y ejecutar el workflow oficial. No iniciar scans costosos por defecto.

Sólo el agente principal crea subagentes. Todos los reviewers son read-only. No ejecutar commit ni push y no agregar atribución de IA.
