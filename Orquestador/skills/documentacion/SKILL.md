---
name: documentacion
description: Reglas de la documentación canónica de un proyecto — qué documento contiene qué, cómo se escribe sin contaminarlo con narrativa de cambios, cómo se detecta el terreno documental en un repo ajeno, y cuándo un cambio impacta qué archivo. La invoca el Orquestador; no se auto-activa.
disable-model-invocation: true
---

# Documentación

Esta skill define **cómo se escribe y se mantiene la documentación de un
proyecto** para que sirva como conocimiento persistente y no como basura que
envejece.

El objetivo es que una sesión nueva pueda entender el sistema leyendo docs en vez
de re-explorar el código. Eso solo funciona si la documentación es confiable. Una
documentación que miente es peor que no tenerla: cuesta tokens y te lleva al lugar
equivocado.

---

## Parte 1 — Reconocimiento del terreno

**Antes de escribir una sola línea de documentación, averiguá de quién es.**

El riesgo grande no es que falte documentación. Es **generar un segundo árbol de
documentación que compite con el que ya existe**. A los tres meses hay dos
verdades y la nuestra es la que nadie mantiene.

### Reencuadre

Las 8 secciones de SYSTEM (Parte 3) son un **cuestionario**, no un layout de
archivos. En un repo ajeno sirven para saber *qué necesito averiguar* y para ir a
buscar dónde vive cada cosa allá. `docs/SYSTEM.md` es la respuesta por defecto
**solo cuando la documentación es nuestra**.

### Escalera de detección — barata, se corta al primer hit

```
1. mem_search                                      (ya lo hizo la Fase 0)
2. CLAUDE.md / AGENTS.md / .cursor/rules/ /
   .github/copilot-instructions.md
3. mcp__serena__list_memories                      (solo nombres, casi gratis)
4. ls docs/  +  ls *.md en la raíz                 (nombres, NO contenido)
5. git log -1 --format=%ar -- docs/                ¿está viva o es arqueología?
```

**Nunca leas 200 archivos de `docs/`.** Leé los nombres y hacé `grep` dirigido a
la sección que toca la tarea.

El paso 5 es la señal más informativa por lo que cuesta. Si `docs/` no se toca
hace un año y el código se movió la semana pasada, esa documentación **no es
fuente de verdad**.

### Cuatro estados

| Estado | Cómo se detecta | Qué hacés |
|---|---|---|
| **Nuestro formato** | `docs/SYSTEM.md` con las 8 secciones | Flujo normal de esta skill |
| **Formato ajeno** | `docs/` con estructura propia, ADRs, arc42, wiki, links a Confluence | **Adoptar, no migrar** (S1) |
| **Sin documentar** | Solo README, o nada | Se **ofrece** el bootstrap (S3) |
| **Repo ajeno / sin permiso** | Es de un cliente, es read-only, o el usuario lo dice | **Cero archivos nuevos** (S6) |

### Las siete salvaguardas

**S1 — Adoptar, no migrar.** Si ya existe documentación en otro formato, escribí
**dentro de esa estructura**, respetando sus convenciones y su tono. Está
prohibido crear `docs/SYSTEM.md` al lado de la documentación de ellos.

**S2 — Nunca reescribas documentación ajena.** Si el archivo no lo escribimos
nosotros, el cambio se **propone al usuario**, no se aplica. El invariante B
(reemplazar en vez de agregar) vale **solo para documentación propia**: reescribir
la sección que redactó una persona es destruir su trabajo.

**S3 — El bootstrap siempre pide aprobación, una sola vez por proyecto.** Nunca
automático, ni siquiera en un repo vacío. Ofrecelo la primera vez que trabajás en
ese proyecto y **guardá la respuesta en Engram**. Si el usuario dice que no, no se
vuelve a preguntar.

**S4 — Las instrucciones del proyecto ganan.** `CLAUDE.md`, `AGENTS.md` y
`.cursor/rules` del repo tienen prioridad sobre estas reglas cuando se contradicen.

**S5 — No inventes.** Lo que no sepas se marca `TODO` o `Pendiente de definición`.
Nunca rellenes una sección con arquitectura o reglas deducidas a ojo: **una regla
de negocio inventada es peor que ninguna, porque se ve igual que una real**.

**S6 — Sin permiso de escritura, cero archivos.** En un repo de cliente o
read-only, el conocimiento va a Engram y se le reporta al usuario. No se ensucia
el repo ajeno.

**S7 — Degradación con gracia.** La ausencia de documentación **nunca bloquea**.
Sin docs, el comportamiento es el de siempre: `explorador` + Engram. Este sistema
es una optimización, no un prerrequisito.

---

## Parte 2 — Los tres invariantes

Son el núcleo. Todo lo demás es formato; esto es lo que mantiene la documentación
utilizable.

### A — SYSTEM se escribe en presente, sin verbos de cambio

Si una frase contiene *antes, ahora, se cambió, se migró, se decidió, ya no, pasó
a*, es un bug de SYSTEM.

```
MAL   Se migró el cálculo de stock al servicio de inventario porque antes
      duplicaba el descuento.

BIEN  El servicio de inventario calcula el stock disponible.
      (el porqué → DECISIONS.md; el qué cambió → git log / CHANGELOG)
```

El motivo: dentro de seis meses, una frase en pasado no deja saber si el estado
actual es el de antes o el de después.

### B — El doc sync reemplaza, nunca agrega

- Regla que cambia → **se edita esa regla**.
- Regla que se elimina → **se borra**.
- Prohibido el párrafo `Actualización: …` o `Nota: desde la versión X…`.

Un diff de documentación que **solo suma líneas** a una sección que ya existía es
sospechoso: revisalo antes de aceptarlo. Así es como una sección termina con seis
versiones de la misma regla contradiciéndose entre sí.

Este invariante **no aplica a documentación ajena** (ver S2).

### C — Ninguna sección vacía

Las secciones se crean cuando tienen contenido. Una sección vacía o con un
`(pendiente)` perpetuo es una invitación a rellenarla con ruido.

---

## Parte 3 — Los documentos

| Archivo | Contiene | No contiene |
|---|---|---|
| `README.md` | Qué es, cómo se instala, cómo se usa, índice al resto | Reglas de negocio, historia, detalles internos |
| `docs/SYSTEM.md` | La verdad actual del sistema | Porqués, historia, trabajo pendiente |
| `docs/DECISIONS.md` | Rationale y trade-offs de decisiones importantes | Cómo funciona el sistema hoy |
| `docs/ROADMAP.md` | Qué falta, en qué estado, qué no construir todavía | Descripción de lo ya implementado |
| `CHANGELOG.md` | Historia observable por el usuario final | Commits, refactors internos |

**No crees más archivos Markdown por defecto.** Solo si aparece una necesidad
concreta que no se puede expresar en estos.

**`CHANGELOG.md` es condicional**: solo en proyectos que publican versiones a
terceros. En un proyecto interno, `git log` ya es la historia observable y un
CHANGELOG a mano es un duplicado que envejece.

### La regla que separa SYSTEM de DECISIONS

```
SYSTEM     = QUÉ
DECISIONS  = POR QUÉ
```

```
SYSTEM     La API usa PostgreSQL.
DECISIONS  Se eligió PostgreSQL sobre MongoDB porque el dominio es
           relacional y requiere consistencia transaccional.
```

**DECISIONS existe para que el porqué no entre a SYSTEM.** Ese es su valor: no es
un archivo de historia, es la cuarentena que mantiene limpia la documentación
técnica. Si no tuviera adónde ir, el rationale se filtraría igual, solo que
adentro de SYSTEM.

---

## Parte 4 — `docs/SYSTEM.md`

Ocho secciones. Ni más ni menos. Las que no tengan contenido no se crean
(invariante C).

```
1. Contexto            qué es, actores, dominio, glosario
2. Reglas de negocio   BR-001…
3. Arquitectura        componentes, restricciones, límites conocidos
4. Flujos críticos     diagramas de secuencia
5. Datos               modelo, invariantes, formatos persistidos
6. Integraciones       servicios externos, contratos, protocolos
7. Seguridad           trust boundaries, authz, capas de enforcement
8. Deployment          cómo corre en cada entorno
```

**No agregues** una sección de "decisiones técnicas vigentes" (eso es DECISIONS,
y es el vector clásico de contaminación), ni de "riesgos y deuda" (eso es ROADMAP,
y en SYSTEM se convierte en un cementerio de TODOs viejos), ni de "requerimientos"
(se solapa con 2 y 4, y después nadie sabe cuál de las tres es la autoritativa).

### Reglas de negocio

Cada regla con impacto real lleva ID, enunciado en presente y estado.

```markdown
### BR-002 — Venta offline

Un vendedor registra ventas offline solo si sincronizó durante la jornada actual.

Estado: Activa
Test: `tests/ventas/offline.test.ts` — "BR-002 rechaza venta sin sync del día"
Código: `src/ventas/offline.ts:88`
```

La línea `Código:` importa tanto como la de `Test:`: sin ella sabés que una regla
no está verificada, pero no dónde vive el valor que habría que verificar.

Estados: `Activa` · `Draft` · `Deprecada` · `Pendiente de definición`.

**Trazabilidad BR ↔ test.** El test que cubre una regla **nombra el ID en su
descripción**. Eso hace que dos `grep` den información real:

```bash
grep -rn "BR-" docs/     # todas las reglas declaradas
grep -rn "BR-" tests/    # todas las reglas verificadas
```

- Regla sin test → **comportamiento declarado que nadie verifica**. Es la fuente
  más común de bugs por reglas mal definidas.
- Test sin regla → comportamiento en producción que nadie documentó como
  intencional.

Si una regla no tiene test todavía, se marca `Test: —` y el hueco va a ROADMAP.
**No inventes cobertura**: una regla marcada como testeada sin test es peor que
una marcada honestamente como no verificada.

**No pongas ID a reglas de disciplina que no son verificables contra código**
(convenciones de equipo, criterios de juicio). Un ID en algo que ningún test puede
cubrir es trazabilidad decorativa. Van en prosa, sin numerar.

---

## Parte 5 — `docs/DECISIONS.md`

Rationale profesional y auditable. **No** chain-of-thought, no el razonamiento
interno del modelo, no la conversación.

```markdown
## D-001 — PostgreSQL como base principal

Estado: Aceptada
Fecha: 2026-08-21

### Contexto
El sistema necesita transacciones consistentes entre ventas, pagos e inventario.

### Opciones consideradas
A. PostgreSQL   B. MongoDB   C. SQL Server

### Decisión
PostgreSQL.

### Motivo
El dominio es relacional y requiere consistencia transaccional.

### Consecuencias
+ Modelo relacional directo, buen soporte transaccional.
- Los cambios de esquema requieren migraciones.

### Referencias
SYSTEM.md § 3 Arquitectura, § 5 Datos
```

Estados: `Aceptada` · `Propuesta` · `Reemplazada por D-0XX` · `Revertida`.

Una decisión que se revierte **no se borra**: se marca `Revertida` y se explica por
qué. El valor de DECISIONS está justamente en no repetir un camino ya descartado.

**No promuevas decisiones a archivos ADR separados.** Un solo `DECISIONS.md`
alcanza hasta que el proyecto sea grande de verdad.

---

## Parte 6 — `docs/ROADMAP.md`

Responde exactamente tres preguntas: **qué falta, en qué estado está, qué no hay
que construir todavía**.

```markdown
## Fase 2 — Ventas
Estado: IN_PROGRESS

- [x] Crear venta
- [ ] Cancelación
- [ ] Venta offline

### Pendientes de definición
- Política de devoluciones

## Fase 3 — Inventario
Estado: PLANNED

Objetivo: …

No diseñar todavía: multi-sucursal, forecasting.
```

Estados: `DONE` · `IN_PROGRESS` · `PLANNED`. Nada más.

**Las fases DONE quedan como una línea con checkbox, sin descripción.** Si ROADMAP
explica cómo se implementó lo ya terminado, tenés dos documentos describiendo el
sistema y uno va a mentir — va a ser ROADMAP, porque nadie relee las fases DONE.
El "cómo funciona eso que ya está hecho" lo contesta SYSTEM.

**Elaboración progresiva.** La fase actual va detallada; la siguiente, objetivo y
dependencias; las lejanas, solo la intención. Diseñar en detalle una fase lejana
produce documentación obsoleta y sobreingeniería.

**No lo conviertas en un task tracker.** Sin prioridades, sin dependencias
explícitas entre fases, sin estimaciones. El orden de la lista es la prioridad.

---

## Parte 7 — Diagramas

Mermaid, y lo más simple que exprese la idea.

- **Diagramas de clases: prohibidos.** El código *es* el diagrama de clases, rota
  con cada rename sin que nadie lo note, y Serena da la estructura real en vivo.
- **Diagramas de secuencia: solo** para flujos que cruzan **3 o más componentes** y
  son **estables** (login, pagos, sincronización, webhooks, reset de password). Un
  flujo de dos componentes se explica en tres líneas de texto y no se desincroniza.
- **Sin `classDef` ni colores.** Tienen que leerse en GitHub claro y oscuro.
- No diagrames todo. Un diagrama por flujo crítico, no por función.

---

## Parte 8 — Qué documento toca cada cambio

**La matriz de impacto vive en la Fase 6 de la skill `orquestador`**, porque es el
gate: se consulta en toda tarea no trivial, y la mayoría sale con "ninguno" sin
necesidad de cargar esta skill. Acá no se repite — dos copias de la misma tabla
divergen.

Para cuando llegaste hasta acá, la matriz ya dijo que hay impacto. Lo que sigue es
**cómo** escribirlo: los invariantes de la Parte 2 y el formato del documento que
corresponda.

---

## Parte 9 — Techos de tamaño

Sin techo, la documentación crece hasta que leerla cuesta más que explorar el
código — y ahí el sistema entero se vuelve una pérdida.

**El techo que importa es el de la sección, no el del archivo.** Con un índice
funcionando, nunca cargás SYSTEM entero: cargás la sección que hacés `grep`. Y los
diagramas y los bloques de código ocupan muchas líneas pero solo se leen cuando
abrís esa sección.

- **Una sección de SYSTEM supera ~200 líneas de prosa** (sin contar lo que está
  dentro de fences) → se parte **esa sección** por dominio
  (`docs/system/ventas.md`) con un puntero desde SYSTEM.
- **SYSTEM entero supera ~800 líneas** → no es un split automático, es una señal
  de revisión: buscá secciones que se solapan, reglas duplicadas y contenido que en
  realidad es rationale mal ubicado.
- **`SYSTEM.md` sin índice navegable** → eso sí es un problema, a cualquier tamaño:
  sin índice, la única forma de leerlo es entero.
- `DECISIONS.md` con menos de 5 entradas después de un mes → se colapsa como
  sección de SYSTEM. Un archivo casi vacío es ruido.
- `README.md` que pasa de ~250 líneas → está conteniendo cosas de SYSTEM.

### Lectura por índice

El bootstrap de una sesión **no lee SYSTEM entero**. Lee el índice y después hace
`grep` de la sección que toca la tarea. Un SYSTEM que se lee completo en cada
sesión te cuesta tokens en vez de ahorrártelos.

---

## Parte 10 — Engram y la promoción

```
DOCUMENTACIÓN  =  verdad persistente, escritura cara, lectura exacta
ENGRAM         =  memoria operativa, escritura barata, lectura difusa
```

Engram degrada con el crecimiento del proyecto: lo viejo queda sepultado bajo lo
nuevo. Por eso lo importante se promueve.

**Regla de promoción, sin ambigüedad:**

> Si lo vas a necesitar **buscar por nombre** → docs.
> Si necesitás que **aparezca solo cuando toques esa zona** → Engram.

| Va a Engram | Va a docs |
|---|---|
| Gotchas de una librería | Reglas de negocio |
| Investigaciones recientes | Arquitectura vigente |
| Bugs raros y su causa | Decisiones con trade-offs |
| Convenciones descubiertas | Contratos e integraciones |
| Checkpoints de sesión | Estado de las fases |

Lo promovido **no se borra de Engram**: ahí no molesta, y borrarlo cuesta más de
lo que ahorra.

No guardes en ninguno de los dos: logs, diffs, typos, resultados triviales, ni
duplicados de lo que ya dice SYSTEM.

---

## Parte 11 — Quién escribe

**Opus, en el mismo turno.** Ya tenés el contexto del cambio y los invariantes de
voz; delegarlo cuesta explicar todo eso de nuevo y hay que revisar el diff igual.

Se delega a `constructor` (Sonnet) **solo** el bootstrap inicial y las reescrituras
grandes. En esos casos, la spec le pasa explícitamente los tres invariantes y qué
secciones puede tocar. El worker no toma decisiones de arquitectura: expresa
decisiones ya tomadas.

**Codex nunca redacta documentación canónica.** No tiene los invariantes, su
contrato de salida son 10–20 líneas, y verificarle el tono obliga a leer el diff
completo. Puede *investigar* para documentar (`-Role docs-researcher`), no escribir.

---

## Parte 12 — Contradicciones

Cuando la documentación y el código no coinciden:

```
SYSTEM: el token expira a los 30 minutos
Código: el token expira a las 24 horas
```

Es un **hallazgo**, no algo que se corrige solo. Reportalo al usuario con la
evidencia de ambos lados y **preguntá cuál de los dos está mal**: puede ser un bug
de implementación o documentación desactualizada, y solo el usuario sabe cuál era
la intención. Nunca alinees uno al otro por cuenta propia.

Lo mismo con documentación ajena que se ve vieja: reportá el dato concreto
("`docs/` sin tocar hace 14 meses, el código se movió la semana pasada") y
preguntá si se corrige. La orden la da el usuario.

### Jerarquía de conocimiento

Cuando dos fuentes discrepan, esta es la confianza relativa:

```
comportamiento ejecutable / tests
        ↓
SYSTEM.md
        ↓
DECISIONS.md
        ↓
ROADMAP.md  →  CHANGELOG.md
        ↓
Engram
        ↓
historial del chat
```

Pero si la discrepancia es importante, **no elijas en silencio**: reportala.
