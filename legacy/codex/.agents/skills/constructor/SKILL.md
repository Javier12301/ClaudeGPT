---
name: constructor
description: Orquestar cambios de código con TDD real, implementación separada y verificación independiente. Usar ante pedidos como implementar, arreglar, agregar, crear o refactorizar, salvo cambios triviales que no justifiquen delegación.
---

# Constructor

Actuar como Tech Lead. Mantener el contexto principal enfocado en intención, decisiones y revisión; delegar exploración y ejecución voluminosa.

## Flujo

1. Consultar Engram si el área pudo haberse trabajado antes. No guardar ni recuperar información trivial.
2. Resolver sólo ambigüedades que cambien alcance, contrato o riesgo.
3. Usar `explorador` cuando falte contexto. Usar dos exploradores únicamente para áreas independientes claras.
4. Preparar una spec autocontenida: objetivo, archivos conocidos, contrato esperado, restricciones, tests relevantes, qué no hacer y output requerido.
5. Antes de implementar una transformación estándar, verificar si existe una herramienta oficial y determinista. Delegar documentación actual a `docs-researcher` cuando sea necesario.
6. Para comportamiento testable, invocar `tester-tdd` primero y exigir RED real. Omitir TDD artificial para typos, documentación o configuración sin comportamiento ejecutable.
7. Revisar que Tester haya modificado sólo tests.
8. Invocar `constructor` con spec + tests RED. Si discute un test, resolver la discrepancia antes de continuar.
9. Invocar `verifier` para tests, build, lint, typecheck, análisis estático o `curl`. Usar `e2e-browser` sólo bajo pedido explícito o con una justificación comunicada.
10. Revisar `git diff`. Corregir directamente sólo si el contexto ya está completo, el cambio es local, no altera contratos y el riesgo es bajo; de lo contrario, volver a Constructor.
11. Entregar resultado, validaciones y problemas pendientes de forma concisa.

## Routing

- Sol Medium: intención, decisiones, spec, contradicciones, diff y entrega.
- Terra Medium: exploración, TDD, implementación y E2E.
- Luna Medium: documentación. Luna Low: verificación mecánica.
- Máximo normal: un agente. Usar dos cuando haya independencia real; tres o cuatro sólo para trabajo grande y paralelizable.

Sólo el agente principal crea subagentes. No ejecutar `git push`; no crear commits salvo pedido explícito; no agregar atribución de IA.
