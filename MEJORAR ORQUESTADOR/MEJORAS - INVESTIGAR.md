# MEJORA DEL ORQUESTADOR — EFICIENCIA, LATENCIA Y DELEGACION SELECTIVA

Lee primero:

- `FEEDBACK-ORQUESTADOR.md`
- la skill actual del orquestador;
- agentes Claude;
- configuracion y wrapper de Codex;
- tests del orquestador;
- documentacion de arquitectura relevante.

No implementes inmediatamente.

Primero contrasta el feedback real de uso con la arquitectura actual, verifica que cada mejora propuesta sea compatible con las capacidades reales de Claude Code/Codex y genera un plan de implementacion.

El objetivo principal de esta iteracion es:

> Reducir tiempo total, spawns redundantes, reexploracion, verificaciones innecesarias y rondas de correccion, sin perder las defensas que actualmente estan encontrando errores reales.

No optimizar solamente tokens. Optimizar:

- tiempo de solucion;
- cantidad de delegaciones;
- cantidad de reintentos;
- trabajo descartado;
- uso de contexto;
- paralelismo util;
- calidad final.

---

## 1. Principio central: orquestar no significa delegar

Modificar la politica conceptual del orquestador.

El orquestador es el Tech Lead.

Su primera decision ante cada tarea o subtarea debe ser:

```text
DIRECT
DELEGATE
PARALLELIZE
```

No debe lanzar agentes por rutina.

### DIRECT

Resolver directamente cuando:

- el cambio es localizado;
- el orquestador ya posee suficiente contexto;
- no se necesita independencia;
- no existe una regla de negocio compleja que requiera un RED independiente;
- preparar spec + spawn + espera + revision costaria mas que implementar;
- la tarea es mecanica, visual o de bajo riesgo.

Ejemplos:

- texto;
- estilos;
- colores;
- componentes presentacionales;
- wiring simple;
- cambios mecanicos;
- pequeños ajustes ya comprendidos;
- fixes localizados cuya causa ya esta confirmada.

### DELEGATE

Delegar cuando la delegacion aporta una ventaja concreta:

- implementacion grande;
- varios archivos o modulos;
- contexto que el orquestador todavia no posee;
- investigacion independiente;
- regla de negocio importante;
- regresion que merece un tester independiente;
- revision adversarial;
- analisis especializado.

La cantidad de lineas NO debe ser el criterio principal.

Evaluar el costo del ciclo completo.

### PARALLELIZE

Paralelizar cuando existan tareas realmente independientes.

Especialmente investigar si el writer lock puede aplicarse por repositorio o worktree en vez de serializar toda la sesion.

Backend y frontend independientes no deberian bloquearse mutuamente si no existe colision real.

---

## 2. Introducir un Delegation / Cost Gate

Antes de cada spawn, el orquestador debe justificar internamente por que esa delegacion aporta valor.

Evaluar como minimo:

```text
Is independent reasoning useful?
Is independent testing useful?
Does the orchestrator already have the required context?
Is this task large or uncertain enough to amortize spawn latency?
Can this be completed directly faster without sacrificing quality?
Can it run safely in parallel with current work?
```

Resultado:

```text
DIRECT
DELEGATE_TESTER
DELEGATE_CONSTRUCTOR
DELEGATE_RESEARCH
DELEGATE_REVIEWER
PARALLEL_DELEGATION
```

No generar necesariamente un log verbose de esta decision para el usuario.

Debe ser una politica operacional del orquestador.

---

## 3. TDD basado en comportamiento y riesgo

Eliminar la idea de que todo cambio necesita obligatoriamente:

```text
tester -> constructor -> GREEN
```

Crear tests nuevos cuando el cambio introduce o modifica:

- regla de negocio;
- regresion;
- validacion;
- calculo;
- transformacion importante;
- persistencia;
- permisos;
- estados;
- contratos entre capas;
- comportamiento observable relevante.

No exigir TDD nuevo para:

- componentes puramente presentacionales;
- estilos;
- colores;
- textos;
- markup trivial;
- wiring mecanico;
- refactors internos cuyo comportamiento ya esta correctamente cubierto.

Antes de crear un nuevo test, responder internamente:

> What observable behavior or regression is this test protecting?

Si no existe una respuesta concreta, probablemente no corresponde crear un nuevo test.

Mantener ejecucion de tests existentes cuando sean relevantes.

---

## 4. Tester: probar el camino real

Agregar una regla fuerte al rol tester.

Cuando se modifica comportamiento relevante:

> At least one test must exercise the changed behavior through the same meaningful path used by the application.

Un test no cuenta como cobertura suficiente si construye manualmente una entrada que la aplicacion real nunca genera.

El tester debe verificar:

- quien construye el input;
- que estructura produce realmente;
- como llega al componente/servicio;
- que estado se persiste;
- que dato consume finalmente la UI/API.

La sesion de feedback mostro varios GREEN falsos causados por tests que ejercitaban formas irreales.

---

## 5. Regla del contraejemplo

Para reglas negativas:

```text
X must not appear
X must not be reported
X must not be accepted
```

crear cuando sea razonable un caso complementario que demuestre:

```text
X does appear when appropriate
X is reported when appropriate
X is accepted under the valid condition
```

Evitar tests que pasen simplemente porque toda la regla dejo de ejecutarse.

---

## 6. Subagentes Claude: investigar comunicacion persistente

Investigar especificamente si la version/capacidades actuales de Claude Code permiten mantener un subagente vivo o reanudar su contexto de manera que pueda realizar este flujo:

```text
spawn
  ->
work
  ->
design ambiguity detected
  ->
ask Tech Lead
  ->
receive factual resolution
  ->
continue from same context
```

La condicion fundamental:

> El agente NO debe tomar una decision de diseño por su cuenta si la informacion necesaria es ambigua.

Debe poder detenerse ANTES de modificar archivos.

Investigar las capacidades reales disponibles.

No asumir que existe persistencia solamente porque seria conveniente.

Determinar:

1. si un subagente puede comunicarse con el agente padre durante su ejecucion;
2. si puede suspenderse y continuar;
3. si existe session/resume;
4. si puede mantenerse contexto sin reconstruir otra spec;
5. limitaciones de lifecycle;
6. costos;
7. comportamiento cuando termina el subagente.

Si existe una solucion oficial y estable, diseñar su integracion.

Si NO existe, diseñar el fallback mas barato posible.

Fallback deseado:

```text
NEEDS_INFO
-> respuesta factual del orquestador
-> continuar/recrear usando solamente delta + contexto minimo necesario
```

No reconstruir cientos de lineas de spec innecesariamente.

Documentar claramente que alternativa es realmente posible.

---

## 7. NEEDS_INFO tambien para agentes Claude

Independientemente de si existe persistencia:

Tester y Constructor no pueden decidir silenciosamente cuestiones que cambien:

- fuente de un dato;
- modelo de persistencia;
- contrato;
- comportamiento funcional;
- error path;
- arquitectura;
- responsabilidad entre capas;
- reglas de dominio.

Ante una ambiguedad de ese nivel:

```text
STOP
DO NOT WRITE
RETURN NEEDS_INFO
```

Deben incluir:

```text
missing_fact
evidence_checked
question
affected_decision
```

No usar `NEEDS_INFO` para detalles triviales de implementacion.

Nombres internos, helpers, organizacion local y decisiones puramente mecanicas pueden quedar a criterio del agente.

---

## 8. Reducir correcciones mediante reutilizacion del contexto

Hoy una revision puede encontrar defectos y provocar otra delegacion innecesaria.

Investigar y rediseñar este flujo.

Preferencia:

```text
constructor
-> implementa
-> targeted verification

reviewer independiente
-> findings

Tech Lead valida findings

si los findings son validos y localizados:
    original constructor/session corrige
    OR Tech Lead corrige directamente
```

No lanzar automaticamente un constructor nuevo para arreglar el trabajo de otro constructor.

Objetivo:

- aprovechar contexto ya cargado;
- evitar nuevos cold starts;
- evitar specs completas repetidas.

Mantener independencia del reviewer.

El reviewer NO debe convertirse automaticamente en implementador de sus propios findings salvo que exista una razon explicita de arquitectura para hacerlo.

---

## 9. Mantener la revision adversarial

NO eliminar la revision final por buscar velocidad.

El feedback demostro que leer el diff y el reviewer encontraron defectos que los tests no detectaron.

Preservar:

- revision del diff por el Tech Lead;
- reviewer independiente en cambios de riesgo suficiente;
- contrato congelado para trabajos grandes.

Optimizar lo anterior al review, no quitar el review que actualmente protege calidad.

---

## 10. Barrido previo de tests heredados

Antes de delegar un cambio que:

- elimina UI;
- renombra algo observable;
- cambia una regla;
- cambia un contrato;
- cambia texto utilizado por tests;
- cambia estructura persistida;

buscar primero referencias existentes.

Ejemplo conceptual:

```text
rg "observable being changed" tests/
```

Identificar:

- tests que ahora contradicen el requisito;
- selectors ambiguos;
- fixtures obsoletas;
- contratos heredados.

Resolver estas contradicciones en la spec antes de lanzar Tester/Constructor.

Objetivo:

reducir `NEEDS_INFO` predecibles.

---

## 11. Baseline medido, nunca heredado

Antes de la primera delegacion relevante:

medir el estado actual necesario.

No confiar en:

- handoff;
- README;
- memoria;
- CHANGELOG;
- resultado de una sesion anterior.

Guardar conceptualmente:

```text
BASELINE

repo:
command:
passed:
failed:
skipped:
measured_at:
known_preexisting_failures:
```

Las regresiones deben compararse contra una baseline real de la sesion.

---

## 12. Verification ladder por alcance

Reducir ejecuciones completas innecesarias.

Durante iteracion:

```text
affected test
-> affected feature/module
-> affected repository
```

Suite completa solamente cuando tenga valor:

- cierre de fase;
- cambio transversal;
- antes de entrega;
- cuando el riesgo lo justifique.

No correr backend/frontend completos despues de cada cambio localizado.

Mantener una verificacion final suficientemente amplia.

---

## 13. Repository Context Capsule

Investigar la implementacion de un contexto reutilizable y barato.

Ejemplo:

```yaml
repository:
  name:
  root:

environment:
  runtime:
  interpreter:
  package_manager:
  database:
  framework:

commands:
  targeted_tests:
  module_tests:
  full_suite:

baseline:
  passed:
  failed:

architecture:
  relevant_entrypoints:
  relevant_modules:

gotchas:
  - PATH Python does not contain pandas
```

Este bloque debe poder componerse automaticamente en las specs.

Objetivo:

evitar que cada subagente redescubra:

- interprete;
- framework;
- base de datos;
- comandos;
- entrypoints;
- gotchas;
- arquitectura basica.

Investigar invalidacion cuando cambien manifests/configs relevantes.

No crear una cache compleja si una solucion mas simple alcanza.

---

## 14. Exploration Gate

No lanzar `Explore` por defecto.

Orden preferido:

```text
existing context
-> cheap repository search
-> direct inspection
-> Explore only if uncertainty remains
```

Si el Tech Lead ya conoce los archivos y el flujo, no gastar un subagente entero redescubriendolos.

Cuando Explore sea necesario, darle una pregunta concreta y scope reducido.

Evitar multiples exploradores solapados.

---

## 15. Paralelismo util

Investigar paralelismo real para trabajos grandes.

Ejemplos:

```text
backend implementation || frontend implementation
research || unrelated implementation
independent repositories
independent read-only investigations
```

Mantener seguridad contra colisiones.

Evaluar:

- writer lock por repo;
- worktrees;
- conjuntos de archivos;
- lectores concurrentes;
- escritores independientes.

No introducir paralelismo por el solo hecho de ser posible.

La meta es reducir wall-clock time sin generar conflictos.

---

## 16. Routing por riesgo

Diseñar rutas conceptuales.

### TRIVIAL / PRESENTATIONAL

```text
Tech Lead implements
-> targeted verification
-> diff review
```

### NORMAL BEHAVIORAL CHANGE

```text
independent RED when justified
-> Tech Lead or Constructor implements
-> targeted GREEN
-> diff review
```

### LARGE / HIGH-RISK BUSINESS CHANGE

```text
freeze contract
-> independent tester
-> constructor
-> real-path verification
-> adversarial reviewer
-> fix using existing context when possible
-> final Tech Lead diff review
```

### RESEARCH

```text
direct investigation if cheap
OR
specialized research delegation if uncertainty/size justifies it
```

El orquestador debe elegir la ruta.

No aplicar la ruta mas costosa universalmente.

---

## 17. Reviewer routing

El reviewer de Codex mostro una relacion señal/costo especialmente buena.

Mantenerlo prioritariamente para:

- implementaciones grandes;
- reglas de negocio importantes;
- cambios transversales;
- persistencia;
- extractores/parsers;
- validaciones;
- contratos;
- cambios donde una implementacion incorrecta puede igualmente dejar tests GREEN.

No lanzar reviewer adversarial completo para cada cambio visual trivial.

---

## 18. Acceptance criteria mas fuertes para Constructores

No usar solamente:

```text
all tests must pass
```

Incluir cuando corresponda:

```text
REAL APPLICATION BEHAVIOR

When invoked through:
...

Input is produced by:
...

Source of truth:
...

Expected persisted state:
...

Expected user-visible result:
...
```

El constructor debe implementar el requisito, no optimizar solamente para GREEN.

---

## 19. Manejo de fixes del reviewer

Evitar:

```text
constructor
-> reviewer
-> NEW constructor
-> reviewer
-> NEW constructor
```

Preferir:

```text
constructor/session A
-> reviewer B
-> Tech Lead validates
-> session A fixes validated findings
-> targeted verify
```

Si session A ya no existe:

- para fixes pequenos: Tech Lead;
- para fixes grandes: nueva delegacion solo si realmente amortiza el costo.

No delegar automaticamente.

---

## 20. Metricas para validar esta mejora

Agregar o aprovechar observabilidad suficiente para comparar sesiones.

Medir como minimo:

```text
total wall-clock duration
delegation count
delegations by role
NEEDS_INFO count
retries
new sessions
resumed sessions
Explore count
full suite executions
targeted suite executions
review findings
post-delegation fixes
estimated/reported token usage where available
```

No convertirlo en un sistema de telemetria complejo.

Necesitamos poder responder:

> La nueva politica realmente redujo trabajo redundante?

Comparar con sesiones como la documentada en `FEEDBACK-ORQUESTADOR.md`.

---

## 21. No romper lo que ya funciona

Preservar explicitamente:

- Claude como unico Tech Lead;
- contrato congelado para cambios grandes;
- `NEEDS_INFO`;
- reglas anti-inferencia;
- separacion tester/constructor cuando TDD tiene valor;
- reviewer independiente;
- revision final del diff;
- sandbox;
- limites de scope;
- budget routing;
- observabilidad;
- session reuse de Codex cuando sea rentable;
- specs Codex en ingles/ASCII-safe;
- comportamiento verify-before-infer.

---

# INVESTIGACION REQUERIDA ANTES DEL PLAN

Antes de proponer cambios, verificar en el repo y capacidades actuales:

1. Como se crean actualmente subagentes Claude.
2. Que lifecycle tienen.
3. Si existe comunicacion padre-hijo.
4. Si existe resume/persistencia.
5. Como se manejan actualmente Codex sessions.
6. Como se implementa writer lock.
7. Como se decide actualmente DIRECT vs DELEGATE.
8. Como se decide actualmente si corresponde TDD.
9. Como funciona la verify ladder actual.
10. Que informacion del repo ya se cachea/reutiliza.
11. Que metricas ya existen.
12. Que partes propuestas ya estan parcialmente implementadas.

No duplicar mecanismos existentes.

---

# RESULTADO ESPERADO

Primero entregar un plan, no modificar codigo.

El plan debe separar:

```text
KEEP
CHANGE
ADD
REMOVE/SIMPLIFY
INVESTIGATE FURTHER
```

Para cada cambio indicar brevemente:

- problema observado;
- cambio propuesto;
- archivos/componentes afectados;
- beneficio esperado;
- riesgo;
- como probarlo.

Priorizar cambios por:

```text
P0 - highest impact / low complexity
P1 - high impact
P2 - structural optimization
P3 - optional/future
```

No convertir esta mejora en una reescritura completa del orquestador.

La arquitectura actual funciona y produce buenos resultados.

El objetivo es eliminar trabajo innecesario alrededor de las partes que ya funcionan.

# CRITERIO PRINCIPAL DE EXITO

Una tarea que Claude ya comprende debe resolverse directamente.

Una tarea que necesita independencia debe delegarse.

Una tarea grande e independiente debe poder paralelizarse.

Una regla de negocio importante debe protegerse con tests significativos.

Una duda de diseño debe detener al agente antes de que escriba.

Una revision debe reutilizar contexto existente para corregir cuando sea seguro.

Y ninguna de estas optimizaciones debe reducir la capacidad actual del sistema para encontrar errores reales.