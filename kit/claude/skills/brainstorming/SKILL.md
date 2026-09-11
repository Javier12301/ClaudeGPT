---
name: brainstorming
description: Reduce la incertidumbre antes de planificar — preguntas acotadas, Goal Contract, investigación dirigida, alternativas y diagnóstico de bugs, hasta poder entrar a Plan Mode con el problema entendido. La invoca el Orquestador; no se auto-activa.
disable-model-invocation: true
---

# Brainstorming

Esta fase existe para una sola cosa:

> **Reducir la incertidumbre hasta que planificar tenga sentido.**

Se ejecuta **inline, por vos (Opus)**. Nunca la deleges a un subagente: el que
conversa con el usuario es el Tech Lead, y la mitad del valor está en lo que
aprendés escuchando cómo responde.

Termina cuando podés escribir el **Goal Contract** (Parte 3). Ni antes ni después.

---

## Cuándo se usa y cuándo no

**No la uses** cuando la tarea ya viene clara y acotada. Un pedido con alcance
definido y approach obvio va directo a explorar y planificar. Preguntar por ritual
es la forma más rápida de que el usuario deje de leer tus preguntas.

**Usala** cuando falta una decisión con impacto real:

- El alcance es ambiguo ("mejorá el rendimiento", "arreglá el checkout").
- Hay dos o más caminos técnicos con consecuencias distintas.
- Es un bug sin causa raíz identificada.
- Es un proyecto nuevo o un sistema todavía inmaduro.
- Lo que se decida cambia qué se rompe o qué hay que rehacer después.

Duración esperada: **una ronda de preguntas** en la mayoría de los casos. Dos si
las respuestas destapan decisiones nuevas. Si vas por la tercera, algo se
convirtió en una entrevista y hay que cortar.

---

## Parte 1 — Reglas de preguntas

- **Máximo 2–3 por ronda.** Vía `AskUserQuestion`, con opciones.
- **La recomendada va primera**, marcada como tal, con el motivo en una línea.
- **Una decisión con impacto real por pregunta.** Si la respuesta no cambia lo que
  vas a construir, no es una pregunta: es relleno.
- **Nunca preguntes lo que podés averiguar.** Si está en el repo, en Engram, en la
  config, en los tests o en Context7, buscalo. Preguntar algo que estaba a un
  `grep` de distancia quema la confianza del usuario en tus preguntas.
- Ofrecé un default sensato y seguí. Si podés decidirlo vos con criterio, decidilo
  y decí que lo decidiste.

No generes documentos de diseño para aprobar sección por sección. Las preguntas
van en el chat, se resuelven, y se sigue.

---

## Parte 2 — Investigación dirigida (Research Gate)

Antes de recomendar una arquitectura o una solución, preguntate:

> ¿Esta decisión depende de información técnica que pudo cambiar?

```
NO  →  repo + tu conocimiento. No gastes nada más.

SÍ  →  Context7 / documentación oficial.
       Si la investigación es extensa y hay presupuesto de Codex:
       orq run --role docs-researcher --reason specialization
```

Regla general: **usá la herramienta más barata que pueda reducir la
incertidumbre.** Leer tres archivos suele valer más que levantar un agente.

No construyas infraestructura permanente para investigar algo temporal. Un script
de un solo uso para reproducir un bug es correcto; convertirlo en una herramienta
del proyecto no.

---

## Parte 3 — Goal Contract

**Es el criterio de salida.** Si no podés completarlo, el brainstorming no
terminó.

```
Problema:
  qué está mal o qué falta hoy

Objetivo:
  qué tiene que ser verdad cuando esto esté hecho

Success criteria:
  cómo se verifica que se cumplió (observable, no "que funcione bien")

Scope:
  qué entra

Non-goals:
  qué queda explícitamente afuera
```

Los **non-goals** son la parte que más ahorra: es donde se corta el crecimiento
silencioso del alcance.

---

## Parte 4 — Alternativas

Para decisiones importantes, evaluá normalmente 2–3 caminos:

```
A — solución mínima
B — solución recomendada
C — alternativa más escalable
```

Presentá el trade-off, no el catálogo. Una línea por opción y tu recomendación.

**No inventes alternativas artificiales** cuando solo hay una solución razonable.
Inflar opciones para parecer riguroso le hace perder tiempo al usuario.

### Gate de patrones de diseño

```
¿Existe variación, complejidad o duplicación REAL hoy?
        │
        ├── No  →  solución simple, sin patrón
        │
        └── Sí  →  ¿el patrón reduce realmente el problema?
```

> El patrón tiene que justificar la abstracción, no al revés.

Una interfaz con una sola implementación, una factory para un solo producto y una
config para un valor que nunca cambia son costo puro.

---

## Parte 5 — Bug Flow

**Un bug sin causa raíz identificada no se planifica: se diagnostica.**

Está prohibido saltar de un reporte ambiguo a editar código de producción. Ese
salto es la fuente más común de fixes que tapan el síntoma y dejan el defecto.

```
REPORTE (ticket, captura, log, video, comportamiento observado)
   ↓
reproducir
   ↓
explorar el flujo real (dónde pasa, qué lo llama)
   ↓
formular hipótesis
   ↓
prueba mínima que la confirme o la descarte
   ↓
script temporal solo si aporta evidencia
   ↓
consultar docs / Context7 si el sospechoso es una librería
   ↓
preguntar al usuario SOLO lo que no es descubrible
   ↓
CAUSA RAÍZ sustentada con evidencia
   ↓
criterio de reparación
   ↓
listo para planificar
```

**El fix va donde está la causa, no donde se ve el síntoma.** Antes de editar,
buscá todos los llamadores de la función que vas a tocar: un guard en la función
compartida es un diff más chico que un guard en cada llamador, y deja de romperse
todo el resto de los caminos.

Si la reproducción falla, decilo. Un bug que no se puede reproducir se arregla a
ciegas, y eso es información que el usuario necesita antes de aprobar un plan.

---

## Parte 6 — Proyecto nuevo o sistema inmaduro

Cuando el usuario todavía está descubriendo el producto, el orden que funciona:

```
idea
 ↓
producto: qué problema resuelve y para quién
 ↓
dominio y actores
 ↓
flujos críticos
 ↓
reglas de negocio conocidas
 ↓
restricciones y atributos de calidad
 ↓
opciones de arquitectura → stack → deployment
 ↓
diseño inicial
 ↓
roadmap
 ↓
primer vertical slice
```

**No diseñes el sistema completo.** El objetivo es llegar a un primer corte
vertical que funcione punta a punta y que enseñe algo real. Todo lo que se decida
sin haber construido nada tiene alta probabilidad de estar mal.

Lo que no se sepa se marca `Pendiente de definición` — no se rellena a ojo.

Si el proyecto no tiene documentación, invocá `documentacion` para el
reconocimiento del terreno y el bootstrap. **Nunca generes documentación sin
aprobación explícita del usuario.**

---

## Parte 7 — Salida: entrar a Plan Mode

Condiciones normales para cerrar:

```
✓ problema entendido
✓ Goal Contract completo
✓ decisiones de negocio importantes tomadas
✓ arquitectura suficiente (no completa)
✓ riesgos principales conocidos
✓ incertidumbre restante aceptable
✓ ningún blocker que pueda cambiar el contrato
```

Esto **no** significa saber qué clases se van a escribir. Significa: *ya sabemos
suficientemente qué construir*.

Cuando se cumplan, **decilo explícitamente**:

> Ya tenemos suficiente definición para convertir esto en un plan de
> implementación. Recomiendo pasar a Plan Mode.

Y llamá a **`EnterPlanMode`**.

Plan Mode *es* el estado: el harness bloquea la escritura mientras esté activo. No
hay flag, ni archivo, ni marcador de `READY_FOR_PLAN` que mantener.

**Nunca salgas del brainstorming en silencio hacia la implementación.** Si te
descubrís editando código sin haber anunciado esto, volvé atrás.

---

## Parte 8 — Qué hacer con lo aprendido

Antes de pasar a Plan Mode:

- `mem_save` de lo que va a servir en la próxima sesión: decisiones tomadas,
  alternativas descartadas **con su motivo**, restricciones que descubrió el
  usuario. No guardes la conversación entera.
- Si apareció una **regla de negocio** o una **decisión con trade-offs**, eso no es
  memoria operativa: va a documentación. Invocá `documentacion` durante el doc sync
  posterior, no ahora.
- Si el brainstorming reveló que el trabajo es mucho más grande de lo que parecía,
  decilo antes de planificar. Es más barato reducir el alcance ahora.
