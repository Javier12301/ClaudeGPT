# Cierre de fase — los dos handoffs a sesión limpia

Leé este archivo al cerrar una fase, cuando el usuario elige una de las dos
salidas. Las dos arrancan en una sesión nueva y por el mismo motivo: **una sesión
larga acumula contexto degradado**, y seguir arreglando ahí adentro produce más
errores que arrancar limpio. Pero resuelven cosas distintas y no se mezclan.

| | Qué arregla | Quién la corre |
|---|---|---|
| **A — Retroalimentación** | El código: defectos abiertos, pendientes, deuda de la fase | Sesión Claude nueva, como orquestador |
| **B — Feedback** | El orquestador: qué regla falló y qué habría que ajustar | Sesión nueva, o `orq run --role reviewer` |

Se puede pedir una, la otra, las dos, o ninguna y seguir. **Ninguna es el default
si la fase salió limpia**: preguntar por ritual al cerrar cada fase es la misma
ceremonia que venimos sacando.

---

## La regla que gobierna las dos

> **El log es evidencia. Tu resumen es testimonio.**

El resumen lo escribís vos, que sos la parte evaluada, al final y de memoria. Va
a estar sesgado de forma sistemática: recuerda las delegaciones que salieron
bien, olvida las que no pagaron, y describe como deliberadas decisiones que
fueron inercia. Es el mismo problema del handoff que declaraba *644 passed / 0
failed* cuando había 284 fallas.

Por eso los dos handoffs arrancan por `.orquestador/decisions.jsonl` y por la
salida de `orq metrics --feedback`, y recién después leen tu narrativa. **Cuando discrepan,
gana el log.**

---

## A — Retroalimentación: arreglar el código en limpio

El objetivo es que una sesión sin contexto degradado termine lo que quedó
abierto. Lo que le pasás **no es** el relato de la fase: es el estado.

### Qué generás

```markdown
# Handoff — <fase>

## Estado medido
Baseline al cerrar: <passed/failed/skipped>, comando exacto, medido a las <hora>.
Working tree: <limpio | N archivos sin commitear>.
Fallas preexistentes conocidas: <lista, o ninguna>.

## Qué se implementó
Una línea por unidad, con los archivos que tocó. Sin justificaciones.

## Qué queda abierto
- Defectos confirmados, con archivo:línea y cómo reproducirlos.
- Pendientes que se decidieron dejar afuera, y por qué se dejaron.
- Tests en RED que siguen en RED a propósito, si los hay.

## Decisiones que NO hay que revertir
Lo deliberado que un ojo nuevo va a querer "arreglar":
- Simplificaciones marcadas con `ponytail:` y su techo.
- Contratos congelados que se acordaron con el usuario.
- Cosas que se dejaron feas por una razón, con la razón.

## Entorno
Pegar la capsule del repo (`.orquestador/repo.md`).
```

### El riesgo específico de esta ruta

Una sesión limpia no sabe por qué se decidió nada, así que **va a "corregir" lo
deliberado**. La sección *Decisiones que NO hay que revertir* no es cortesía: es
lo único que separa un arreglo de una regresión. Si una simplificación tiene un
techo conocido, se nombra el techo.

El resto de las secciones son estado verificable. Si estás por escribir un
párrafo explicando por qué algo salió como salió, eso va en la ruta B, no acá.

---

## B — Feedback: arreglar al orquestador

El objetivo es cambiar una regla **con evidencia**, no con impresión. Si al
terminar no podés nombrar qué regla cambiarías y qué fallo concreto la motiva, la
retro no encontró nada — y decirlo es un resultado válido.

### Orden de fuentes, obligatorio

```
1. orq metrics --feedback
2. .orquestador/decisions.jsonl crudo, si algún número no cierra
3. git log / git diff de la fase
4. el resumen del orquestador   <- testimonio, se lee ultimo
```

### El ancla de comparación

*"¿Mejoró la eficiencia?"* sin referencia es infalsificable. Hay un punto medido,
y es contra ése que se compara:

| Métrica | Sesión de referencia |
|---|---|
| Delegaciones | 11 |
| `NEEDS_INFO` | 3, los tres predecibles |
| Suites completas | 12 (~20 min de espera) |
| Fixes post-delegación | 5, ninguno atrapado por un test |
| Trabajo descartado | 11 min + 5 de corrección, por una decisión en silencio |

Fuente: `MEJORAR ORQUESTADOR/FEEDBACK-ORQUESTADOR.md`. Normalizar por tamaño de
la fase antes de comparar — cinco delegaciones en una fase chica no es mejor que
once en una grande.

### Las preguntas que tiene que contestar

```
1. Que delegacion no pago el ciclo completo, y que la habria reemplazado?
2. De que familia eran los defectos que encontro la revision del diff?
   (una familia repetida es una regla faltante; cinco defectos sueltos no lo son)
3. Que NEEDS_INFO era predecible, y que barrido lo habria evitado?
4. Que verificacion se corrio de mas, y con que alcance alcanzaba?
5. Que decidio un subagente en silencio que deberia haber frenado?
6. Que regla existente se ignoro, y por que era facil ignorarla?
7. Que regla nueva corrige un fallo OBSERVADO en esta fase?
```

La 7 es el filtro: **una regla nueva existe porque corrige un fallo observable,
no porque suena bien.** Una recomendación sin un evento del log detrás se
descarta — es exactamente así como la skill se infló hasta las 900 líneas.

### Formato de salida

Por cada recomendación: **fallo observado** (con la entrada del log o el
`archivo:línea`), **cambio mínimo propuesto**, **archivo que toca**, **cómo se
prueba**, y **qué se rompe si el cambio está mal**. Sin eso, no es accionable.

Priorizadas `P0`/`P1`/`P2`, y con una sección explícita de **qué NO cambiar**:
las defensas que están encontrando errores reales se nombran para que la próxima
ronda de optimización no las toque. La revisión del diff por el Tech Lead es la
primera de esa lista.

### Por qué conviene Codex acá

`orq run --role reviewer` da independencia **entre proveedores**, no solo
entre contextos. Un Claude nuevo evaluando a un Claude comparte sesgos que un
revisor de otro proveedor no tiene, y el reviewer de Codex fue la delegación de
mejor señal/costo de la sesión medida: cinco hallazgos, cinco legítimos.

Si va por esa vía, la spec se arma con la plantilla de `references/codex.md` y el
log entra como hecho verificado, no como archivo a explorar.

---

## Qué hacés con el resultado

**Nada, en esa sesión.** El feedback se entrega al usuario y **él decide** qué se
ajusta. Un orquestador que se auto-modifica a partir de su propia retro cierra el
loop sobre sí mismo y deja de tener control externo.

Los hallazgos aceptados con evidencia quedan en findings, decisiones o
documentación canónica según su alcance, para que la próxima retro no los
descubra de nuevo.
