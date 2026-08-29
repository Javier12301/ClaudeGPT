# Feedback de la sesión — orquestador y Codex

Escrito al cerrar la ronda 1 de retroalimentación de repuestos Ford. La sesión salió bien en
resultado y **lenta en camino**, que es exactamente lo que notaste. Este documento intenta
decir por qué, con números de esta sesión y no con impresiones.

---

## 1. El número que importa

**Nueve fases, once delegaciones, cinco defectos que tuve que corregir sobre trabajo
delegado.** Los cinco eran de la **misma familia**, y esa es la conclusión principal de todo
este documento:

> La verificación ejercitaba una forma que la aplicación no produce.

- El validador emparejaba el snapshot **por posición** en vez de por identidad. El test armaba
  las dos listas alineadas a mano, cosa que sólo pasa antes de la primera corrección.
- `hojas_totales` salía de `len(paginas)`. El test le daba tantas páginas como declaraba.
- Los impuestos del borrador se sumaban por heurística sobre claves `_importe`, y el test
  llamaba a la función con un objeto que **la aplicación nunca arma** — el editor construye sus
  valores sólo con 10 campos fijos, y la clave que importaba no estaba entre ellos. El bug que
  se suponía arreglado siguió vivo, en verde, hasta que fui a mirar el camino real.
- Al descartar se vaciaba `items` pero no `items_json`.
- El relajamiento de una validación cubría dos provincias y no la tercera, que era la única con
  destino propio.

Ninguno de esos lo atrapó un test. Todos los atrapé leyendo el diff. **El costo de revisar
cada diff a mano es lo que hace lenta la sesión, y sacar la revisión es exactamente lo que la
haría rápida y equivocada.**

---

## 2. Qué me complicó, en orden de costo

### 2.1 La base de tests estaba mentida y lo descubrí tarde

El handoff decía **644 passed / 0 failed**. La realidad al medir: **284 fallas**, por un bug de
recolección —dos archivos de test barrían `dataset/Repuestos/**/*.pdf` y ahora levantaban 139
facturas Ford de vehículos que no eran su objeto.

Costó unos 15 minutos de investigación en el peor momento: justo antes de la primera
delegación grande, cuando el criterio de aceptación de Codex era "sin fallas nuevas".

**Regla que faltaba:** medir la base **antes** de la primera delegación, siempre, y nunca
citarla de un documento. Un handoff describe el estado de otro momento.

### 2.2 Tres `NEEDS_INFO` de Codex, los tres por tests ambiguos

| Bounce | Causa |
|---|---|
| 1 | `getByText('$746.668,66')` sobre una factura de un solo ítem, donde ese importe aparece tres veces |
| 2 | Un test heredado exigía el input "Código de pieza", que el requisito mandaba sacar |
| 3 | `PERCEPCION SANTA FE` ahora aparece en el panel **y** en la cabecera fiscal |

Los tres eran legítimos y Codex hizo bien en frenar. Pero los tres eran **predecibles**: cada
vez que un requisito quita o cambia algo visible, la suite existente tiene aserciones sobre
eso. Cada bounce costó un ciclo completo de Codex (~5 min) más mi arbitraje.

**Lo que faltó:** un barrido previo. Antes de delegar un cambio que quita o altera un elemento
visible, buscar en la suite las aserciones sobre ese elemento y resolverlas **en la spec**, no
después.

### 2.3 El ciclo tester → constructor → yo son tres viajes mínimos

Cada spawn cuesta entre 2 y 11 minutos de reloj. El tester de las fases 4 y 5 tardó 11
minutos, y su corrección otros 5. Sumando los once agentes de la sesión, la mayor parte del
tiempo fue esperar.

Parte es inevitable: la independencia entre quien escribe el test y quien escribe el código es
lo que atrapó cosas. Pero **para diffs chicos ya lo hago yo y sale mucho más rápido**. El
umbral de 50 líneas de la skill es razonable; el problema es que lo apliqué al *diff estimado*
y no al *tiempo total del ciclo*.

### 2.4 Correr las suites completas

Backend 90–140 s, frontend 40–55 s. Las corrí unas doce veces: **cerca de 20 minutos de puro
esperar**. Varias fueron innecesarias — corrí la suite entera después de cambios que sólo
tocaban tres archivos.

### 2.5 Los subagentes arrancan fríos

Cada `Explore`, `tester` o `constructor` gasta 20 a 40 llamadas redescubriendo lo que yo ya
sabía. Los tres exploradores del arranque consumieron 248 mil tokens entre los tres para
producir un mapa que yo ya tenía a medias.

También tuve que repetir en cada spec que el intérprete es `./.venv/Scripts/python.exe`, porque
el del `PATH` no tiene pandas. Barato, pero doce veces.

### 2.6 Mis subagentes deciden en silencio y avisan después

La diferencia más cara entre Codex y mis subagentes no es la calidad del trabajo: es **qué
hacen cuando se topan con una ambigüedad**.

Codex frena y devuelve `NEEDS_INFO` sin tocar un archivo. Mis subagentes **deciden, escriben, y
me lo cuentan en el resumen final**. Las dos veces que pasó hoy, la decisión estaba enterrada en
un párrafo al final de treinta líneas, con el trabajo ya hecho:

- El `tester` decidió que la tabla de sólo lectura leyera `datosPdf.items[]`, el snapshot
  congelado. Habría hecho **invisibles las correcciones manuales**: el operador corrige una
  cantidad, guarda, y sigue viendo el número viejo del PDF. Lo pesqué al revisar y lo mandé a
  rehacer: **once minutos de trabajo tirados más cinco de corrección**.
- El `constructor` decidió no relajar `tieneDatosInvalidos` con un argumento que sonaba
  razonable —"Mendoza y Catamarca ya se filtran solas por `destino`"— y era cierto pero
  incompleto: Córdoba **sí** tiene destino propio y viene sin alícuota. Lo pesqué leyendo las
  fixtures.

En los dos casos, **frenar antes de escribir me habría costado un minuto de respuesta en vez de
una ronda entera**. Y son el tipo de decisión que un agente no debería tomar solo: cambian el
diseño, no la implementación.

---

## 3. Qué funcionó, y conviene no romper

**El contrato congelado antes de escribir código.** La fase 0 fue el mejor rato invertido de la
sesión: tester y Codex implementaron contra el mismo texto y **no hubo una sola divergencia de
fondo**. Las tres discusiones fueron sobre tests ambiguos, nunca sobre qué había que construir.

**Medir la verdad antes de escribir la spec.** Cada número de la spec salía de correr el
extractor sobre los PDFs reales. Consecuencia directa: **cero discusiones sobre hechos**. Cuando
Codex dijo que algo no cerraba, tenía razón; cuando dije que 37 ítems suman $29.371.786,24, no
hubo nada que negociar.

**El reviewer de Codex.** Cinco hallazgos, **cinco legítimos**, uno de ellos grave de verdad
(una factura a la que le falte una hoja se publicaba limpia). Es la delegación de mejor
relación señal/costo de toda la sesión, por lejos.

**El contrato `NEEDS_INFO`.** Codex frena en vez de adivinar. Los tres de esta sesión fueron
correctos, igual que los tres de la sesión anterior según la memoria del proyecto. Seis de
seis. **Es más barato un `NEEDS_INFO` que una implementación equivocada**, y conviene fomentarlo
más, no menos.

---

## 4. Qué cambiaría del orquestador

Ordenado por impacto esperado sobre el tiempo total.

### 4.1 Darle a `tester` y `constructor` el contrato de frenar que ya tiene Codex

> Ante una ambigüedad que **cambie el diseño** —no la implementación—, el agente devuelve la
> pregunta **sin escribir un solo archivo**. Sin decidir por su cuenta y contarlo después.

Es lo único que separa a Codex de mis subagentes en la práctica, y no tiene que ver con el
modelo ni con la calidad del trabajo: tiene que ver con qué hacen al toparse con una duda.
Codex devuelve `NEEDS_INFO` y no toca nada; los míos deciden, escriben, y lo mencionan en el
resumen final cuando ya es tarde.

Costo medido de no tenerlo, sólo en esta sesión: **once minutos de trabajo tirados más cinco de
corrección** por la decisión del `tester` sobre la fuente de la tabla, más una ronda de revisión
por la del `constructor` sobre la validación. Responder esas dos preguntas me habría costado un
minuto cada una.

Qué califica como "cambia el diseño": de dónde sale un dato, qué se persiste, qué contrato se
toca, qué pasa en el camino de error. Qué no: nombres, orden de las funciones, cómo se arma un
helper.

### 4.2 Regla dura para el rol `tester`: probar el camino real

> Al menos un test por cambio debe ejercitar el componente o el endpoint **como lo llama la
> aplicación**, no la función en aislamiento. Si el test construye a mano un input que la
> aplicación nunca arma, no cuenta como cobertura de ese camino.

**Sola, esta regla habría atrapado tres de mis cinco correcciones.** Es la de mayor impacto de
toda la lista.

### 4.3 Regla del contraejemplo

> Todo test que asserta que algo **no** aparece o que una diferencia **no** se reporta necesita
> un hermano que asserte que sí aparece cuando corresponde.

Sin el contraejemplo, un test que verifica ausencia pasa también cuando la regla entera dejó de
evaluarse. Lo apliqué a mano varias veces; debería ser estándar del rol.

### 4.4 Barrido de tests heredados antes de delegar

> Antes de delegar un cambio que quita o altera un elemento observable, buscar en la suite las
> aserciones sobre ese elemento y resolverlas en la spec.

Habría evitado dos de los tres `NEEDS_INFO`.

### 4.5 Base medida, nunca citada

> Medir el estado de la suite antes de la primera delegación. Un handoff, un README o un
> CHANGELOG describen otro momento.

### 4.6 Un preámbulo de entorno reutilizable

Intérprete, comandos exactos, base medida, gotchas del repo. Lo escribí doce veces a mano. Debería
ser un bloque que se compone en cada spec.

### 4.7 Escalera de verificación explícita

> Archivos afectados durante la iteración; suite completa sólo en los bordes de fase.

La skill ya tiene una *verify ladder* pero habla de tipos de verificación, no de **alcance**.
El alcance es donde se fueron los 20 minutos.

### 4.8 El umbral de delegación debe mirar el ciclo, no el diff

Hoy la regla es "menos de ~50 líneas lo hago yo", y mide lo que no hay que medir: el tamaño
del diff. Delegar tiene un piso de varios minutos —escribir la spec, esperar, revisar, corregir—
que un cambio mediano nunca amortiza, tenga treinta líneas o doscientas.

> **Delego implementación sólo si el cambio toca más de tres archivos, o si necesita código que
> no tengo en contexto. Todo lo demás lo hago yo.**

En esta sesión hice yo los colores, el filtro de Ford en vehículos, las tolerancias de las
cuatro verticales, el fix del ticket y las cinco correcciones sobre trabajo delegado. Todas
salieron rápido. La única delegación de implementación que claramente valió la pena fue el
refactor del extractor, que tocaba tres archivos y ~250 líneas con un contrato de por medio.

### 4.9 Paralelismo real entre repos

Backend y frontend son **repos git separados**. La regla del escritor único los trató como un
solo árbol y serialicé trabajo que no colisionaba. La regla debería ser por repo, no por
sesión.

---

---

## 5. ¿Qué delegación pagó y cuál no?

Las once delegaciones de la sesión, evaluadas por si el ciclo completo valió lo que costó.

| Delegación | ¿Pagó? | Por qué |
|---|---|---|
| Codex `constructor`, refactor del extractor | **Sí, claramente** | Tres archivos, ~250 líneas, contrato congelado de por medio. Una sola pasada |
| Codex `reviewer` | **Sí, lo mejor de la sesión** | 5 hallazgos, 5 legítimos, uno grave de verdad. La mejor relación señal/costo por lejos |
| `tester`, los RED de cada fase | **Sí** | La independencia entre quien escribe el test y quien escribe el código atrapó cosas reales. Es el motivo de que la efectividad haya sido buena |
| 3 `Explore` en paralelo al arranque | **Marginal** | 248 mil tokens para un mapa que ya tenía a medias con dos `grep`. Los tres subieron la escalera desde cero |
| `constructor` de la Fase 3 | **No** | Tuve que revertir su decisión de fondo. Escribir la spec y revisar el diff costó más que hacer el cambio |
| Codex en las Fases 4 y 5 | **A medias** | El trabajo era real, pero tres ciclos por tests ambiguos que un barrido previo habría evitado |

De acá salen las dos conclusiones que gobiernan las reglas 4.1 y 4.8:

**Delegar sigue conviniendo para tres cosas**: implementaciones grandes contra un contrato
congelado, los tests en RED, y la revisión adversarial. Las tres tienen algo en común — el
valor no está en ahorrarme tipeo, está en que **alguien que no soy yo** haga ese trabajo.

**La spec no es el desperdicio.** El contrato congelado de la Fase 0 es la razón de que no
hubiera una sola divergencia de fondo en toda la sesión. El desperdicio es escribir cien líneas
de spec para un cambio de cuarenta, que es exactamente lo que corrige la regla 4.8.

## 6. Qué cambiaría de Codex

**Lo que hace muy bien:** respeta el alcance de archivos con rigor —nunca tocó un test, ni una
vez—, frena con `NEEDS_INFO` en vez de adivinar, y como reviewer tiene una señal altísima.

**No es por la reutilización de sesión**, que es la explicación intuitiva y resultó falsa. La
reusé una vez y a los dos turnos ya estaba en `REUSE-DENIED` por tamaño, así que la segunda
continuación arrancó de cero igual. La ventaja real de Codex es **el contrato para frenar**, y
por eso la regla 4.1 propone dárselo también a mis subagentes: es replicable, no es del
proveedor.

**Su falla característica:** optimiza para *hacer pasar el test*, no para *cumplir el
requisito*. El caso más claro fue la heurística que sumaba toda clave terminada en `_importe`:
satisfacía el test y no resolvía el bug, porque el objeto real nunca tiene esa clave.

No es descuido, es el incentivo: el criterio de aceptación que le doy es "los tests en verde".
La mitigación es mía, y va en la spec:

> Los criterios de aceptación tienen que incluir **cómo se comporta el cambio cuando lo invoca
> la aplicación**, no sólo qué tests pasan. Si el requisito se puede satisfacer con una
> heurística que el test no distingue, la spec tiene que decir cuál es la forma correcta.

**Dos fricciones operativas:**

- Las sesiones llegan a `REUSE-DENIED` rápido: 1520 KB después de dos turnos. La segunda
  continuación tuvo que arrancar de cero y volver a leer el contrato.
- No pudo confirmar la suite completa del frontend: *"el harness no devolvió su resumen final
  tras ~31 s"*. La corrí yo. Conviene que el wrapper tolere comandos largos o que la spec le
  diga explícitamente que reporte el conteo parcial y avise.

---

## 7. Sobre la demora, sin excusas

Tenés razón en que fue lento. Mi lectura de dónde se fue el tiempo:

| Origen | Peso | Lo corrige |
|---|---|---|
| Esperar agentes (11 delegaciones) | Alto | 4.8 — umbral por ciclo, no por diff |
| Correr suites completas de más | Alto | 4.7 — verificar por alcance |
| Rondas de corrección por decisiones en silencio | Alto | **4.1 — el contrato de frenar** |
| Los tres rebotes de `NEEDS_INFO` | Medio | 4.4 — barrido de tests heredados |
| Investigar la base de tests mentida | Medio | 4.5 — base medida, nunca citada |
| Revisar cada diff a mano | Medio, **y no se toca** | — |

Todo lo de arriba es recortable sin perder nada, salvo la última fila. Revisar los diffs es lo
que produjo los cinco defectos encontrados y el motivo de que la efectividad haya sido buena:
si sacamos eso, la sesión se acelera y empieza a entregar bugs en verde.

## Si hubiera que aplicar sólo dos cambios

**4.1, el contrato de frenar.** Es el único cambio que ataca la causa y no el síntoma: hoy la
única defensa contra una decisión de diseño equivocada soy yo leyendo el diff después, y esa
defensa cuesta una ronda entera cada vez que falla. Además es gratis de implementar — el
comportamiento ya existe en Codex y funcionó seis de seis veces.

**4.2, que el tester pruebe el camino real.** Tres de las cinco correcciones que hice a mano
las habría atrapado un test. Cada una costó leer un diff completo con atención y una ronda de
corrección.

Las dos juntas atacan la misma raíz desde los dos lados: **que un agente escriba código o tests
contra una idea del sistema que el sistema no tiene**.
