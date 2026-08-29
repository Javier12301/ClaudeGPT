# FUENTES DE INVESTIGACION - ORQUESTADOR CLAUDEGPT

## Objetivo

Este documento sirve como biblioteca de referencia para el agente encargado de mejorar el orquestador de ClaudeGPT.

Debe usarse junto con:

- `FEEDBACK-ORQUESTADOR.md`
- `MEJORAS - INVESTIGAR.md`

No es obligatorio leer todas las fuentes antes de planificar.

La regla es:

> Consultar documentacion oficial para capacidades actuales. Consultar repositorios publicos como prior art cuando implementen un mecanismo relevante. Extraer patrones, fallos y trade-offs; no copiar arquitecturas completas.

Prioridad de fuentes:

1. Documentacion oficial actual.
2. Context7 para consultas concretas y actualizadas.
3. Repositorios oficiales.
4. Repositorios publicos de orquestacion como referencia.
5. Articulos o discusiones externas solo para complementar.

---

# 1. Context7

## Claude Code

Library ID oficial:

```text
/anthropics/claude-code
```

Usar Context7 para preguntas concretas, no para pedir toda la documentacion.

Consultas recomendadas:

```text
How do Claude Code subagents work, including lifecycle, context isolation, agent IDs, and resume behavior?
```

```text
Can a Claude Code subagent be resumed after it stops while preserving its previous conversation and tool context?
```

```text
How can a parent Claude Code session communicate with a subagent? Document SendMessage, agent IDs, prerequisites, and limitations.
```

```text
What are the differences between Claude Code subagents and agent teams? When should each be used?
```

```text
What are Claude Code best practices for choosing between the main conversation, subagents, and parallel agents when latency and shared context matter?
```

```text
How does Claude Code limit concurrent subagents and what configuration controls the limit?
```

```text
How do SubagentStop and Stop hooks work? Can they be used to validate completion or capture agent state?
```

```text
How are skills loaded into Claude Code subagents? Explain the skills frontmatter field and context implications.
```

```text
What mechanisms exist in Claude Code to persist or resume work without rebuilding the full task prompt?
```

### Investigacion P0 para ClaudeGPT

Comprobar especificamente si es posible implementar:

```text
tester starts
-> discovers design ambiguity
-> stops without writing
-> Tech Lead resolves the fact
-> same tester resumes with previous context
-> tester continues
```

Determinar:

- si requiere Agent Teams;
- si `SendMessage` funciona con subagents normales;
- si el agente puede quedar suspendido o necesariamente debe terminar;
- como se obtiene y conserva el `agent ID`;
- cuanto contexto conserva al reanudar;
- impacto en tokens;
- restricciones de concurrencia;
- comportamiento actual de la version instalada.

No asumir que una funcion documentada para Agent Teams aplica automaticamente a subagents normales.

---

## Codex CLI

Library ID oficial:

```text
/openai/codex
```

Consultas recomendadas:

```text
How does Codex CLI session resume work for non-interactive codex exec sessions? What context is preserved?
```

```text
How should AGENTS.md be structured to provide stable repository facts without repeating them in every task prompt?
```

```text
How are repository-level and subdirectory-level AGENTS.md instructions merged?
```

```text
What are the current Codex multi-agent or subagent capabilities? When is parallel delegation recommended?
```

```text
What are the recommended patterns for Codex skills and progressive disclosure to avoid unnecessary context loading?
```

```text
What are current Codex best practices for task prompts, acceptance criteria, file scope, verification commands, and repository context?
```

```text
How should Codex handle long-running test commands and non-interactive execution timeouts?
```

```text
What are the current configuration options related to project instruction size, context, sandboxing, and approval policies?
```

```text
What are the current limitations or best practices for multiple Codex agents writing concurrently to the same repository?
```

### Puntos a contrastar con ClaudeGPT

- `AGENTS.md` vs informacion repetida en specs.
- session resume real vs reconstruccion de specs.
- progressive disclosure de skills.
- parallel read-only work.
- writer isolation.
- prompts pequenos y autocontenidos.
- limites de contexto de sesiones reanudadas.

---

# 2. Documentacion oficial Claude Code

## Subagents

https://code.claude.com/docs/en/sub-agents

Investigar:

- lifecycle;
- context isolation;
- resume;
- agent IDs;
- herramientas heredadas;
- skills;
- cuando usar subagent vs main conversation;
- costos de cold start.

---

## Agent Teams

https://code.claude.com/docs/en/agent-teams

Investigar:

- comunicacion entre agentes;
- shared task list;
- SendMessage;
- paralelismo;
- coordinacion;
- overhead;
- restricciones;
- diferencias con subagents.

No adoptar Agent Teams automaticamente.

Evaluar si resuelve un problema real de ClaudeGPT con menor costo que el sistema actual.

---

## Best Practices

https://code.claude.com/docs/en/best-practices

Buscar especialmente:

- context engineering;
- uso del main agent;
- subagents para tareas autocontenidas;
- paralelismo;
- verificacion;
- prompts concretos;
- evitar cargar contexto innecesario;
- estrategias para tareas largas.

---

## Repositorio oficial

https://github.com/anthropics/claude-code

Revisar cuando sea necesario:

- CHANGELOG;
- hooks;
- plugins;
- ejemplos de subagents;
- implementaciones reales de loops;
- cambios recientes no reflejados aun en guias externas.

---

## Ralph Wiggum plugin

Repositorio:

https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum

Interesa para estudiar:

- loops con criterio de finalizacion;
- maximo de iteraciones;
- verification gates;
- condiciones de salida;
- evitar loops infinitos.

No copiar el loop completo si ClaudeGPT puede resolverlo con una politica mas simple.

---

# 3. Documentacion oficial OpenAI / Codex

## Codex multi-agent

https://developers.openai.com/codex/multi-agent

Investigar:

- cuando delegar;
- paralelismo;
- agentes read-heavy;
- conflictos entre escritores;
- routing por rol/modelo.

---

## AGENTS.md

https://developers.openai.com/codex/guides/agents-md

Investigar:

- instrucciones globales;
- instrucciones por repo;
- instrucciones por subdirectorio;
- precedencia;
- limites de tamaño;
- que informacion debe ser estable;
- que informacion debe quedar en la spec de tarea.

Objetivo para ClaudeGPT:

> No repetir en cada spec hechos que pueden vivir de forma estable en AGENTS.md o en un contexto de repositorio reutilizable.

---

## How OpenAI uses Codex

https://openai.com/business/guides-and-resources/how-openai-uses-codex/

Buscar:

- prompts tipo issue/PR;
- task scope;
- repository context;
- acceptance criteria;
- herramientas;
- AGENTS.md;
- verificacion.

---

## Codex agent loop

https://openai.com/index/unrolling-the-codex-agent-loop/

Usar para entender:

```text
model
-> tool action
-> observation
-> next decision
-> verification
-> completion
```

Extraer buenas practicas para:

- stopping conditions;
- evitar retries ciegos;
- observabilidad;
- limites del harness;
- tareas largas.

---

## OpenAI model prompting guidance

https://developers.openai.com/api/docs/guides/latest-model

Consultar para:

- prompting actual;
- instruction hierarchy;
- reducir instrucciones redundantes;
- evitar prompts inflados;
- especificaciones precisas;
- reasoning/verbosity cuando aplique.

No congelar tecnicas antiguas si la documentacion actual recomienda otra cosa.

---

## Repositorio oficial Codex

https://github.com/openai/codex

Revisar:

- docs;
- changelog/releases;
- issues relevantes;
- implementacion de skills;
- session resume;
- multi-agent;
- sandbox;
- configuracion.

---

# 4. Repositorios publicos de orquestacion

Estas fuentes son PRIOR ART, no autoridad.

No copiar mecanicamente.

Investigar solo mecanismos relevantes al cambio actual.

---

## Oh My Codex

https://github.com/Yeachan-Heo/oh-my-codex

Interesa especialmente por:

- orquestacion sobre Codex;
- roles;
- routing;
- estado persistente;
- politicas de delegacion;
- evitar fan-out innecesario;
- coordinacion de equipos.

Preguntas:

```text
How does this project decide whether a task should be delegated?
```

```text
How does it prevent unnecessary child agents or recursive delegation?
```

```text
How does it preserve state between agents?
```

```text
How does it handle reviewer findings and implementation fixes?
```

---

## Superpowers

https://github.com/obra/superpowers

Interesa por:

- skills;
- systematic debugging;
- testing;
- verification;
- review;
- mejora de instrucciones a partir de fallos reales.

Buscar especialmente la filosofia:

> Una regla nueva debe existir porque corrige un fallo observable, no porque suena teoricamente bien.

Aplicacion a ClaudeGPT:

Construir evals con casos reales:

- PostgreSQL inferido cuando era MySQL;
- test que usa un input imposible;
- subagente toma una decision de diseño en silencio;
- test heredado contradice un requisito nuevo;
- suite completa ejecutada innecesariamente;
- Explore redundante;
- reviewer detecta bug GREEN.

---

## Claude Squad

https://github.com/dougseven/claude-squad

Interesa por:

- roles;
- ownership;
- coordinacion;
- decisiones compartidas;
- memoria;
- separacion entre implementador y reviewer.

Extraer solo patrones que reduzcan contradicciones entre agentes.

---

## multiagents

https://github.com/zetbrush/multiagents

Interesa por:

- coordinacion multi-provider;
- comunicacion entre agentes;
- MCP;
- Claude + Codex;
- state sharing.

Evaluar si alguna tecnica ayuda a ClaudeGPT sin introducir infraestructura excesiva.

---

## wshobson/agents

https://github.com/wshobson/agents

Interesa por:

- skills/agentes reutilizables;
- adaptadores para diferentes harnesses;
- separacion entre concepto del rol y sintaxis especifica de Claude/Codex.

Idea a evaluar:

> Mantener una especificacion conceptual comun y compilarla a instrucciones nativas optimizadas para cada proveedor.

---

## claude-flow / Ruflo

https://github.com/ruvnet/claude-flow

Interesa por:

- swarms;
- routing;
- shared memory;
- coordination;
- scheduling.

Usar principalmente para estudiar trade-offs y fallos de sistemas grandes.

ClaudeGPT NO debe convertirse automaticamente en un swarm framework.

---

## Loop Engineering

https://github.com/maxmilian/loop-engineering

Interesa por:

- loop design;
- stopping conditions;
- verification;
- escalation;
- retries;
- feedback loops.

Buscar mecanismos simples para impedir:

```text
try
-> fail
-> retry same thing
-> fail
-> retry
```

Preferir:

```text
try
-> classify failure
-> resolve missing fact or change approach
-> retry only if evidence justifies it
```

---

## Wiggum

https://github.com/yy/wiggum

Interesa por:

- loops minimalistas;
- trabajo task-driven;
- TDD pragmatica;
- evitar ceremony en cambios triviales.

Contrastar con la nueva politica ClaudeGPT:

```text
TDD when meaningful behavior/risk exists.
No mandatory RED agent for purely presentational/mechanical changes.
```

---

# 5. Prompt para investigacion web de repositorios

Usar cuando la documentacion oficial no resuelva una cuestion o cuando se quiera estudiar prior art.

```text
Research public AI coding-agent orchestrators that implement the following mechanism:

[MECHANISM]

Prioritize:
1. active repositories;
2. real production-oriented implementations;
3. documented architectural decisions;
4. issues or postmortems describing failure modes;
5. implementations using Claude Code, Codex CLI, or mixed coding agents.

For each relevant project, extract only:

- repository URL;
- mechanism used;
- why it was introduced;
- failure mode it addresses;
- coordination model;
- context/session strategy;
- concurrency strategy;
- stopping/retry strategy;
- known trade-offs;
- what is applicable to ClaudeGPT;
- what should NOT be copied.

Do not summarize entire repositories.
Do not recommend architecture solely because it is popular.
Prefer simple mechanisms that solve observed ClaudeGPT failures.
```

---

# 6. Prompt para investigar persistencia de subagentes Claude

```text
Using current official Claude Code documentation first, investigate whether ClaudeGPT can implement this workflow:

1. Parent Tech Lead spawns a tester or constructor subagent.
2. Subagent works normally.
3. Subagent encounters a design-level ambiguity.
4. Subagent must NOT infer or write based on that ambiguity.
5. Subagent asks the parent for clarification.
6. Parent returns a factual resolution.
7. The same subagent continues with its previous context without rebuilding the full specification.

Determine:

- whether this is supported today;
- exact Claude Code feature(s) required;
- whether it uses normal subagents or Agent Teams;
- whether SendMessage is available;
- whether the child remains alive or must stop and be resumed;
- how agent IDs are obtained and reused;
- what context is preserved;
- whether tools/results are preserved;
- lifecycle limitations;
- token/cost implications;
- concurrency implications;
- permission implications;
- failure cases;
- minimum implementation necessary for ClaudeGPT.

Cite official documentation.

Then inspect public implementations only if useful.

Return:

SUPPORTED
PARTIALLY_SUPPORTED
NOT_SUPPORTED

followed by a minimal recommended design and fallback.
```

---

# 7. Prompt para investigar Delegation Gate

```text
Research current best practices for deciding when an AI coding orchestrator should:

- solve directly;
- delegate;
- delegate in parallel;
- use an independent tester;
- use an independent reviewer.

Use official Claude Code and Codex guidance first, then selected public orchestrators.

Optimize for:

- low wall-clock latency;
- low redundant context loading;
- low number of agent spawns;
- correctness;
- useful independence;
- safe parallelism.

Specifically investigate whether task size in lines of code is a poor delegation metric compared with:

- uncertainty;
- missing context;
- number of modules;
- need for independent reasoning;
- business risk;
- expected spawn latency;
- degree of shared context.

Produce a small decision policy suitable for ClaudeGPT.

Do not propose a complex scoring framework unless evidence shows it is necessary.
```

---

# 8. Prompt para investigar TDD selectivo

```text
Research best practices for AI coding agents using TDD selectively.

Goal:

ClaudeGPT should require new tests when a change protects meaningful observable behavior, such as:

- business rules;
- regressions;
- validations;
- calculations;
- transformations;
- persistence;
- permissions;
- state transitions;
- contracts;
- risky integrations.

It should not require an independent RED-test delegation for every:

- visual component;
- color;
- label;
- simple date display;
- markup change;
- mechanical wiring change.

Investigate how coding-agent workflows avoid:

- tests that exercise impossible inputs;
- overfitting implementation to tests;
- tests that validate implementation details;
- excessive TDD ceremony for trivial changes.

Return a practical routing rule for:

TRIVIAL
BEHAVIORAL
HIGH_RISK_BUSINESS

Include recommended verification depth for each.
```

---

# 9. Prompt para investigar context hygiene

```text
Using current Claude Code and Codex documentation, research how an orchestrator should minimize repeated context.

Focus on:

- CLAUDE.md;
- AGENTS.md;
- skills;
- progressive disclosure;
- repository facts;
- reusable environment metadata;
- session resume;
- subagent context isolation;
- cache invalidation.

Design guidance for ClaudeGPT so stable facts such as:

- runtime;
- interpreter;
- framework;
- database;
- test commands;
- repository layout;
- known environment gotchas;

do not need to be rediscovered or rewritten into every task specification.

At the same time, avoid creating a giant permanent context file.

Return:
- what belongs in persistent instructions;
- what belongs in a repository context capsule;
- what belongs only in a task spec;
- what should never be persisted.
```

---

# 10. Prompt para investigar safe parallelism

```text
Research safe parallelism patterns for coding agents.

Compare:

- one writer per entire session;
- one writer per repository;
- git worktrees;
- file-set ownership;
- concurrent read-only agents;
- backend/frontend parallel writers;
- reviewer concurrency.

Use official Claude Code and Codex guidance first.

Goal:

Reduce wall-clock time without increasing merge conflicts or inconsistent repository state.

Return the simplest concurrency model appropriate for ClaudeGPT today, plus more advanced options that should remain future work.
```

---

# 11. Loop Engineering - reglas a buscar

Al investigar loops, buscar convergencia alrededor de estas propiedades:

## Exit states explicitos

```text
DONE
NEEDS_INFO
BLOCKED
FAILED
```

No usar retries ambiguos.

---

## Failure classification antes de retry

Antes de repetir:

```text
Was the failure caused by:
- missing information?
- wrong assumption?
- test contradiction?
- environment?
- timeout?
- implementation defect?
- flaky infrastructure?
```

Solo reintentar si cambia algo.

---

## Bounded loops

Todo loop debe tener:

- condicion de finalizacion;
- limite de intentos;
- escalation path;
- evidencia requerida para marcar DONE.

---

## Reuse context when useful

Si el implementador ya posee el contexto y reviewer encuentra un fix localizado:

```text
reviewer
-> Tech Lead validates
-> original implementer/session fixes
```

No:

```text
reviewer
-> new cold constructor
-> new spec
-> new exploration
```

salvo que exista una razon concreta.

---

# 12. Buenas practicas de prompting para agentes

## Task specs

Preferir:

```text
TASK
GOAL
VERIFIED FACTS
SCOPE
ACCEPTANCE CRITERIA
REAL APPLICATION BEHAVIOR
VERIFICATION
CONSTRAINTS
UNCERTAINTY PROTOCOL
```

Evitar:

- historia completa de la conversacion;
- logs enormes;
- repetir arquitectura estable;
- instrucciones duplicadas;
- frases ambiguas;
- acceptance criteria limitados a "tests pass".

---

## Verified facts

Una spec debe distinguir:

```text
VERIFIED
UNKNOWN
ASSUMED
```

Para datos criticos:

> UNKNOWN must never silently become ASSUMED.

---

## Preguntas de un agente

El agente primero investiga localmente.

Solo pregunta si la ambiguedad sigue existiendo y afecta una decision real.

Formato recomendado:

```text
NEEDS_INFO

missing_fact:
evidence_checked:
question:
affected_decision:
```

Agrupar todas las dudas conocidas en una sola ronda cuando sea posible.

---

## Reviewer

Dar:

- requisito original;
- diff;
- invariantes;
- zonas de riesgo.

No pedirle que vuelva a explorar todo el proyecto salvo necesidad.

El reviewer debe buscar:

```text
Does this satisfy the real application path?
Can tests be GREEN while behavior remains wrong?
Was any assumption introduced?
Is persisted state consistent?
Are error paths correct?
Did the implementation broaden scope?
```

---

# 13. Anti-redundancy checklist

Antes de cada spawn:

```text
Do I already know enough to do this directly?
Does another agent provide useful independence?
Will this agent rediscover context I already possess?
Can I give it a smaller scope?
Can this work happen in parallel?
Does this task really need a new test?
Does this task really need a constructor?
Does this task really need a full reviewer?
Can an existing session/context perform the fix?
```

Antes de cada full suite:

```text
Did the change justify repository-wide verification?
Would affected tests/module verification give the same evidence right now?
```

Antes de Explore:

```text
Can a direct search answer this in under a minute?
```

---

# 14. Como usar estas fuentes durante la mejora

No hacer:

```text
Read every link.
Read every repository.
Summarize everything.
Then plan.
```

Eso genera el mismo problema que queremos solucionar.

Usar:

```text
Observed failure
-> identify mechanism involved
-> official docs
-> Context7 focused query
-> inspect 1-2 public implementations if useful
-> extract pattern
-> design minimal change
-> test against observed failure
```

Ejemplo:

```text
Observed failure:
Claude tester decided source of truth silently.

Question:
Can the same subagent pause/ask/resume?

Research:
Claude official subagent docs
-> Context7 focused query
-> Agent Teams docs if necessary
-> one public implementation if official docs leave a gap

Result:
minimal NEEDS_INFO/resume design
```

---

# 15. Criterio de adopcion

No incorporar una tecnica al orquestador solo porque otro proyecto la usa.

Una mejora debe responder:

1. Que fallo real de ClaudeGPT corrige?
2. Reduce tiempo, costo o errores?
3. Es mas simple que la alternativa?
4. Puede probarse?
5. Introduce nuevo estado o complejidad?
6. Tiene fallback?
7. Es compatible con Claude Code y Codex actuales?

Si no existe un fallo concreto o una ganancia clara:

```text
DO NOT ADD IT YET
```

---

# 16. Resultado esperado de la investigacion

El agente debe entregar primero un plan.

Separar:

```text
KEEP
CHANGE
ADD
REMOVE / SIMPLIFY
NOT POSSIBLE WITH CURRENT TOOLS
FUTURE
```

Para cada decision:

- evidencia;
- fuente;
- problema observado;
- propuesta minima;
- beneficio esperado;
- riesgo;
- prueba;
- impacto en tokens;
- impacto en wall-clock time;
- impacto en numero de spawns.

La mejora correcta no es la que usa mas agentes.

La mejora correcta es la que usa agentes solamente cuando su independencia, paralelismo o especializacion generan mas valor que su costo.
