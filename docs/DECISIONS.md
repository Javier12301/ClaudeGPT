# Decisiones — Orquestador Híbrido Claude + Codex

Rationale y trade-offs de las decisiones importantes del kit. Qué hace el
sistema hoy → [`SYSTEM.md`](SYSTEM.md). Qué falta → [`ROADMAP.md`](ROADMAP.md).

---

## D-001 — Un solo Tech Lead, Codex como capacidad delegada

Estado: Aceptada
Fecha: 2026-08-21

### Contexto
Había dos entornos multiagente que funcionaban bien **por separado**: uno en
Claude Code y otro en Codex. Los dos estaban diseñados como orquestadores
completos, así que competían por el mismo rol. Usarlos juntos significaba abrir
dos terminales y coordinarlas a mano.

### Opciones consideradas
A. Seguir usando los dos entornos por separado, coordinados a mano.
B. Fusionarlos con una regla estructural: un solo Tech Lead y el otro proveedor
   como capacidad delegada.

### Decisión
B. Hay un solo Tech Lead, y es Claude. Codex deja de ser un orquestador y pasa
a ser capacidad delegada.

### Motivo
| Problema | Cómo lo resuelve |
|---|---|
| Una sola suscripción se agota | Routing consciente de presupuesto: lee la cuota real de ambos y decide |
| El que escribe el código revisa su propio código | El review lo hace otro proveedor, en otra sesión |
| Las implementaciones grandes queman el contexto de Claude | Se delegan a Codex, que devuelve 10–20 líneas |
| Coordinar dos agentes a mano | Un solo loop: el usuario habla con Claude y nada más |
| Usar dos modelos para todo, aunque sea un typo | Routing adaptativo: lo trivial ni consulta cuotas |

### Consecuencias
+ Un solo punto de entrada para el usuario.
+ Presupuesto de ambas suscripciones aprovechado con criterio.
- No es una plataforma distribuida, ni tiene colas, dashboard, base de datos ni
  protocolo propio. Es un script y unas reglas: el alcance del kit se mantiene
  deliberadamente chico.

### Referencias
SYSTEM.md § 1 Contexto, § 3 Arquitectura

---

## D-002 — Roles de Codex deliberadamente no usados en el flujo híbrido

Estado: Aceptada, actualizada por D-030 (explorador/e2e/browser eliminados; tester-tdd se conserva)
Fecha: 2026-08-21

### Contexto
Codex trae un kit propio de roles y skills (`explorador`, `tester-tdd`,
`e2e-browser`, `browser-diagnostics`, `$constructor`, `$revisor-completo`) que
tendría sentido usar si Codex operara solo, pero el flujo híbrido ya cubre parte
de ese terreno del lado Claude.

### Opciones consideradas
A. Habilitar todos los roles de Codex disponibles.
B. Usar solo los roles que aportan algo que Claude no cubre ya.

### Decisión
B. `explorador` y `tester-tdd` de Codex no se usan porque Claude ya los cubre
con Serena (búsqueda semántica vía LSP). `e2e-browser` y `browser-diagnostics`
solo se levantan bajo pedido explícito. Las skills `$constructor` y
`$revisor-completo` son orquestadores completos y se reservan para delegación
total (rutas G y H), cuando Claude no participa.

### Motivo
Evitar duplicar razonamiento y tokens en un rol que ya tiene cobertura del
lado Claude, y reservar los orquestadores completos de Codex para el único
escenario donde tiene sentido que actúen como tales.

### Consecuencias
+ Menos roles activos, menos superficie que mantener sincronizada.
- Si Serena deja de estar disponible, `explorador`/`tester-tdd` de Codex serían
  la alternativa a reconsiderar.

### Referencias
SYSTEM.md § 3 Arquitectura (Roles Codex)

---

## D-003 — Orden del árbol de decisión y prioridad del caso trivial

Estado: Aceptada, actualizada por D-025 (el gate ya no depende de que el orquestador lo consulte)
Fecha: 2026-08-21

### Contexto
El árbol de decisión que corre el orquestador antes de tocar nada necesitaba
un orden explícito entre override del usuario, triviality y consulta de
presupuesto. La intención de diseño es que la mayoría de los caminos terminen
sin levantar Codex.

### Opciones consideradas
A. Consultar presupuesto primero y decidir routing después.
B. Cortar primero por override explícito, después por trivialidad, y solo
   entonces evaluar presupuesto.

### Decisión
B. El override del usuario corta primero: si pide "solo con Claude", ni
siquiera se consulta la cuota. Lo trivial sale por izquierda enseguida: un
rename no pasa por el gate de presupuesto ni levanta un solo agente. NO-GO no
es un error, es una rama válida: Codex se descarta, Claude sigue, y solo si
Claude tampoco tiene margen se propone esperar el reset.

El caso A (trivial) es el más importante del diseño: la mayoría de los pedidos
no justifican nada de esto, y el orquestador tiene que saber no hacer ruido.

### Motivo
Minimizar costo y ruido en el caso común (pedidos triviales) antes de invertir
en consultas de cuota o routing complejo.

### Consecuencias
+ La mayoría de los pedidos no levanta agentes ni consulta cuotas.
- El árbol tiene más ramas de corte temprano para mantener consistentes.

### Referencias
SYSTEM.md § 4 Flujos críticos (Gate de presupuesto y routing)

---

## D-004 — Lectura de cuota real como requisito habilitante

Estado: Aceptada, actualizada por D-023 (la cuota de Claude se lee del stdin de la statusLine)
Fecha: 2026-08-21

### Contexto
Sin una forma confiable de saber cuánta cuota le queda a cada proveedor, no
hay manera de decidir routing con criterio: cualquier regla de presupuesto
sería una suposición.

### Opciones consideradas
A. Rutear sin consultar cuotas, a criterio fijo.
B. Leer la cuota real de ambos proveedores antes de decidir.

### Decisión
B. Ambos proveedores exponen su consumo de forma legible (Codex vía JSON-RPC,
Claude vía el cache de la statusline), y esto fue el requisito que hizo
posible todo el resto del gate de presupuesto.

### Motivo
Un routing consciente de presupuesto solo es posible si el dato de cuota es
real y barato de obtener.

### Consecuencias
+ El gate de presupuesto decide con datos reales, no estimaciones.
- El gate depende de que ambas fuentes de cuota sigan disponibles (ver límite
  conocido: sin statusline, la mitad del gate queda ciega).

### Referencias
SYSTEM.md § 6 Integraciones

---

## D-005 — Resolución de modelos por tier contra catálogo vivo

Estado: Aceptada
Fecha: 2026-08-21

### Contexto
Los modelos cambian cada mes. Escribir un slug como `gpt-5.6-terra` en un
archivo de configuración es una bomba de tiempo.

### Opciones consideradas
A. Hardcodear IDs de modelo en la configuración.
B. Resolver por tier (`lead`/`worker`/`cheap`) contra el catálogo vivo de
   `codex debug models`, ordenando por `priority`.

### Decisión
B.

### Motivo
Evitar que un rename de modelo rompa la configuración del kit.

### Consecuencias
+ Un `gpt-5.7-*` futuro, o un modelo que no soporte cierto `effort`, no rompen
  nada: el wrapper degrada al `default_reasoning_level`.
- El resultado exacto de cada tier no es predecible de antemano: depende del
  catálogo del momento.

### Referencias
SYSTEM.md § 3 Arquitectura (Resolución de modelos por tier)

---

## D-006 — Economía de contexto como objetivo principal

Estado: Aceptada
Fecha: 2026-08-21

### Contexto
Delegar a Codex podía diseñarse solo como "quién ejecuta qué", sin cuidar
cuánto contexto consume la coordinación en sí.

### Opciones consideradas
A. Delegar sin restringir qué se envía ni qué se recibe.
B. Tratar la economía de contexto como objetivo de diseño explícito, no como
   efecto secundario.

### Decisión
B. Se define explícitamente qué se le pasa a Codex y qué no, se fuerza el
contrato de salida por JSON Schema, y se reutilizan sesiones de Codex cuando
hay continuidad real: una sesión ya cargada con el contexto de una tarea es un
activo — si faltan 90 líneas más, reusarla cuesta un prompt de una línea;
tirarla obliga a re-explicar todo.

### Motivo
El costo de coordinar dos proveedores puede superar el beneficio de delegar si
no se cuida activamente cuánto contexto se mueve en cada paso.

### Consecuencias
+ Delegaciones compactas (10–20 líneas de respuesta).
+ Continuaciones baratas cuando hay continuidad real.
- Requiere mantener el umbral de tamaño de rollout como proxy de cuándo reusar.

### Referencias
SYSTEM.md § 2 Reglas de negocio (Qué se le pasa a Codex, Reutilización de sesiones)

---

## D-007 — El que escribe el test no escribe el código, y el arbitraje no se resuelve por mayoría

Estado: Aceptada
Fecha: 2026-08-21

### Contexto
El orden TDD (tester → constructor → revisión) necesitaba una razón explícita
para no invertirse, y el paso de arbitraje final necesitaba una regla sobre
cómo se resuelven los findings cuando hay más de un modelo opinando.

### Opciones consideradas
A. Dejar que el mismo agente que implementa también escriba o ajuste sus
   propios tests.
B. Separar estrictamente quién escribe el test de quién escribe el código, y
   que Claude arbitre los findings con evidencia propia en vez de por
   consenso entre modelos.

### Decisión
B. Existe para que el mismo agente que escribe el código no escriba el test a
su medida. En la variante híbrida (Tester Claude → RED → Constructor Codex →
GREEN) esa independencia además cruza proveedores, que es lo más fuerte que se
puede conseguir sin escribir los tests a mano.

El arbitraje del paso final es el que sostiene todo: un finding no se acepta
porque lo dijo otro modelo, se acepta porque Claude lo verificó en el código.

### Motivo
La independencia entre quien escribe el test y quien escribe el código es lo
que hace confiable el TDD; resolver findings por mayoría de modelos cambiaría
"verificado" por "votado".

### Consecuencias
+ Independencia real entre spec, implementación y revisión.
- El arbitraje recae enteramente en Claude: es un cuello de botella deliberado,
  no un artefacto de falta de tiempo.

### Referencias
SYSTEM.md § 4 Flujos críticos (TDD híbrido — caso C)

---

## D-008 — Cuatro capas de enforcement de git, sin deduplicar

Estado: Aceptada
Fecha: 2026-08-21

### Contexto
El motor de `execpolicy` de Codex solo expresa **prefijos de argv** — no tiene
reglas por regex. Eso significa que estas formas lo evaden por construcción:

```
git -C . push origin main      → el prefijo arranca con -C, no matchea ["git","push"]
git --git-dir=.git push        → idem
```

### Opciones consideradas
A. Confiar en una sola capa de enforcement (la deny rule o la regla de
   `execpolicy`).
B. Duplicar la protección en cuatro capas independientes: deny rule de
   Claude, hook de Claude, regla de Codex, hook de Codex.

### Decisión
B. El hook evalúa el string completo del comando con una expresión regular que
contempla `-C`, `-c`, `--git-dir`, `--work-tree`, `git.exe` y las cadenas con
`&&`. Está verificado contra las diez formas, incluidos los negativos
(`git status`, `npm run push-docs` y un commit cuyo mensaje contiene la
palabra no se bloquean). El mismo `git-guard.ps1` sirve en los dos entornos
porque el formato de salida de un hook `PreToolUse` de Codex
(`hookSpecificOutput.permissionDecision = "deny"`) es idéntico al de Claude
Code.

### Motivo
Un deny de Claude no protege al proceso Codex (`codex exec` es un proceso hijo
con su propio motor de permisos), y las reglas de prefijo de `execpolicy` por
sí solas no cubren las formas con `-C`/`--git-dir`. Cada entorno necesita su
propia capa, y dentro de cada entorno hace falta tanto la regla declarativa
como el hook que evalúa el string completo.

### Consecuencias
+ Las diez formas conocidas de evadir el bloqueo de `git push` quedan cubiertas.
+ El mismo script de hook se reutiliza sin cambios en ambos entornos.
- Cuatro capas es más superficie para mantener sincronizada si cambia la regla
  de git.

### Referencias
SYSTEM.md § 7 Seguridad

---

## D-009 — No hacer ruido en pedidos triviales

Estado: Aceptada
Fecha: 2026-08-21

### Contexto
Un pedido tan simple como renombrar una variable podía, en teoría, disparar el
mismo pipeline completo (exploración, tests, delegación, review) que una
feature grande.

### Opciones consideradas
A. Correr siempre el pipeline completo, para uniformidad.
B. Que el caso trivial salga sin explorador, sin tester, sin Codex y sin línea
   en `decisions.jsonl`.

### Decisión
B. Que el ejemplo trivial sea así de corto es el punto: un orquestador que
levanta seis agentes para un rename no es potente, es caro.

### Motivo
La utilidad del kit se mide por cuánto ruido evita en el caso común, no por
cuánta maquinaria es capaz de levantar.

### Consecuencias
+ Los pedidos triviales cuestan lo mismo que si no existiera el kit.
- Requiere que la clasificación "trivial" sea confiable; una clasificación
  incorrecta salta el pipeline de verificación cuando sí hacía falta.

### Referencias
SYSTEM.md § 3 Arquitectura (Los casos A–H), README.md (Ejemplos completos)

---

## D-010 — No hay un cuarto agente `reviewer` de Claude

Estado: Aceptada
Fecha: 2026-08-21

### Contexto
Se evaluó agregar un cuarto subagente Claude dedicado exclusivamente a review,
además de `explorador`, `tester` y `constructor`.

### Opciones consideradas
A. Agregar un subagente `reviewer` de Claude.
B. No agregarlo: el Orquestador-Opus ya es el revisor final.

### Decisión
B.

### Motivo
El Orquestador-Opus ya cumple el rol de revisor final. Se evalúa agregar un
`reviewer` propio solo si aparece un dolor concreto — por ejemplo, una
revisión de seguridad que exija un segundo par de ojos independiente del que
construyó.

### Consecuencias
+ Menos agentes que mantener y coordinar.
- Si aparece ese dolor concreto, esta decisión se revisita.

### Referencias
SYSTEM.md § 3 Arquitectura (Roles Claude)

---

## D-011 — No hay SDD completo

Estado: Aceptada
Fecha: 2026-08-21

### Contexto
Se evaluó adoptar un flujo de Spec-Driven Development completo: documento de
diseño con aprobación sección por sección antes de implementar.

### Opciones consideradas
A. SDD completo, con documento de diseño y aprobación por sección.
B. Brainstorming ligero de 2–3 preguntas antes de proceder.

### Decisión
B. Un SDD completo es demasiado verboso para el tamaño de la mayoría de los
pedidos que recibe este kit.

### Motivo
El costo de un documento de diseño formal no se justifica para el tamaño
típico de tarea que maneja el orquestador.

### Consecuencias
+ Menos fricción para arrancar una tarea.
- Pedidos genuinamente grandes o ambiguos no tienen un artefacto de diseño
  formal donde apoyarse; dependen del criterio del orquestador en el momento.

### Referencias
SYSTEM.md § 2 Reglas de negocio

---

## D-012 — Nunca Opus para subagentes

Estado: Aceptada
Fecha: 2026-08-21

### Contexto
Se evaluó si algún subagente debía correr en Opus en vez de Sonnet.

### Opciones consideradas
A. Permitir que un subagente use Opus cuando la tarea lo justifique.
B. Reservar Opus exclusivamente para el propio Orquestador.

### Decisión
B. Si hace falta Opus para algo puntual, lo hace el propio Orquestador.

### Motivo
Mantener una separación clara de costo y responsabilidad: Opus es el Tech
Lead, los subagentes son ejecución más barata.

### Consecuencias
+ Costo de subagentes predecible y más bajo.
- Un subagente no puede escalar a razonamiento de nivel Opus por sí mismo; la
  tarea vuelve al Orquestador si lo necesita.

### Referencias
SYSTEM.md § 3 Arquitectura (Roles Claude)

---

## D-013 — SONNET-LEAD en vez de CODEX-LEAD

Estado: Aceptada
Fecha: 2026-08-22

### Contexto
El empuje a Codex arrancaba recién con Claude arriba del 85% de su ventana de
5h (BR-003 anterior), y el routing ignoraba la ventana de 7 días. Para cuando
el gate reaccionaba, ya se había gastado la cuota cara en trabajo que Codex
podía absorber con la suya intacta.

Hacía falta además un comportamiento para cuando la ventana de Claude sí se
aprieta y Codex tiene margen.

### Opciones consideradas
A. `CODEX-HEAVY` — Opus se limita a contrato y arbitraje.
B. `CODEX-LEAD` — un thread persistente de Codex con `agents.enabled = true`
   se auto-orquesta, y Claude puentea la interacción con el usuario.
C. `SONNET-LEAD` — el orquestador recomienda `/model sonnet`; el lead sigue
   siendo Claude y sigue delegando rol por rol.

### Decisión
C, más el estado intermedio `CODEX-PREFERRED` a partir del 50% y un gate de la
ventana de 7 días al 80%.

### Motivo
A raciona Opus pero lo sigue gastando. B es un protocolo completo —estado,
timeouts, `request_user_input` puenteado, modos de falla propios— que degrada
la UX exactamente cuando el usuario está cansado y sin cuota, y rompe el
invariante de un solo Tech Lead.

C deja de gastar Opus en vez de racionarlo, conserva el invariante, y no
necesita protocolo nuevo: Sonnet corre la misma skill. En esa etapa el
razonamiento de Opus no hace falta, porque Codex hace el trabajo pesado y el
lead solo comunica y despacha.

El estado y el veredicto quedan como capas separadas que se componen: el
veredicto responde si Codex se puede usar, el estado quién lidera y ejecuta.
Colapsarlas obligaría a reescribir BR-001 y BR-002 sin ganar nada.

### Consecuencias
+ La ventana de 5h rinde varias veces más bajo presión.
+ Retira de la mesa el `lead.toml` con `agents.enabled = true` que estaba
  pendiente en ROADMAP Fase 3: si el lead barato es Sonnet, Codex no necesita
  auto-orquestarse nunca.
+ Los rangos del veredicto de Codex no se tocan.
- **El arbitraje en Sonnet es de menor calidad que en Opus.** Es un intercambio
  aceptable bajo presión de cuota, no una mejora.
- El cambio de modelo no es automático: una skill no puede cambiar el modelo de
  su sesión. El orquestador recomienda una vez y, si el usuario no cambia,
  sigue en Opus con el comportamiento de `CODEX-PREFERRED`.
- Los umbrales 50/70/80 son provisorios y sin evidencia. Se recalibran con los
  campos nuevos de `decisions.jsonl` después de ~25 tareas.

### Referencias
SYSTEM.md § 2 BR-003 · D-012 (el lead sí puede ser Sonnet; el subagente no)

---

## D-014 — `pwsh` 7 como runtime declarada, en vez de portar a bash

Estado: Reemplazada por D-020
Fecha: 2026-08-22

### Contexto
El kit son ~1500 líneas de PowerShell escritas contra 5.1 en Windows. Surgieron
dos necesidades a la vez: Serena no podía levantar su language server de
PowerShell (necesita `pwsh` 7+), y el entorno podía tener que correr fuera de
Windows.

### Opciones consideradas
A. Portar los scripts a bash y mantener las dos versiones.
B. Declarar `pwsh` 7 como runtime del kit y neutralizar rutas y lanzadores.
C. Dejarlo Windows-only y documentarlo.

### Decisión
B. PowerShell 5.1 sigue siendo el piso soportado en Windows.

### Motivo
`pwsh` 7 corre nativo en Linux y macOS, así que resuelve la portabilidad sin
reescribir nada ni duplicar el mantenimiento — y de paso destraba Serena, que era
un requisito independiente. A duplica la superficie de bugs por una plataforma que
todavía no se usa.

Lo que impedía correr fuera de Windows no era el lenguaje sino seis puntos
concretos: `$env:USERPROFILE`, `$env:TEMP`, separadores `\` literales,
`-ExecutionPolicy` (que no existe fuera de Windows), el nombre del ejecutable del
host, y `Start-Process -WindowStyle`. Se neutralizaron todos.

### Consecuencias
+ Serena resuelve símbolos sobre los `.ps1` del kit.
+ El instalador escribe el lanzador correcto según plataforma.
+ `verify.ps1` avisa si falta `pwsh`.
- **Linux y macOS no están probados.** Se quitaron los impedimentos conocidos;
  que funcione es una hipótesis, no un hecho verificado. Anotado en ROADMAP.
- El cache de cuota de Claude lo escribe el repo upstream `ClaudeCodeStatusLine`
  usando `$env:TEMP`, que fuera de Windows no existe. En esas plataformas esa
  mitad del gate queda ciega y degrada a `BALANCED`, que es la degradación ya
  documentada en BR-003 — no un modo de falla nuevo.
- `$IsWindows` no existe en PowerShell 5.1 (vale `$null`), así que la condición de
  plataforma es siempre `($null -eq $IsWindows -or $IsWindows)`.

### Referencias
SYSTEM.md § 2 BR-001 · INSTALL-HIBRIDO.md § 1

---

## D-015 — Señal de vida por tee del stream, en vez de `-Background` con registry

Estado: Aceptada, actualizada por D-026 (-Background ya existe: ASYNC_REVIEW)
Fecha: 2026-08-22

### Contexto
Una delegación a Codex tarda minutos y no emitía absolutamente nada hasta
terminar. Desde afuera, "trabajando" y "colgado" se ven igual. La Fase 3 del
ROADMAP tenía anotado un registry de jobs + `-Background` como "único camino a la
observabilidad en Windows", después de descartar `codex agents` (exige `--remote`
y el daemon es solo Unix).

Al ir a implementarlo apareció el dato que cambia el análisis: **`--json` ya se le
pasaba a `codex exec`** desde siempre. El stream de eventos existía; lo que faltaba
era mirarlo. `Invoke-CodexCli` consumía el stdout con un único `ReadToEndAsync()`,
que no entrega nada hasta el EOF.

### Opciones consideradas
A. Registry de jobs + `-Background` + `codex-ps.ps1`, como estaba planeado.
B. Tee del stream `--json` a un log, más un heartbeat para la statusline.
C. Las dos: B ahora, A detrás de un flag opcional.

### Decisión
B. El wrapper sigue bloqueando.

### Motivo
El problema real declarado por el usuario era *"saber que no se murió"*, y para
eso el registry es desproporcionado: A cambia el protocolo de delegación (lanzar y
recolectar en vez de llamar), y trae PIDs huérfanos, recolección del JSON final y
timeouts a mano. B resuelve el problema declarado sin tocar nada aguas abajo — el
`return` de `Invoke-CodexCli` es idéntico, así que el parseo del `session_id`, el
payload y `decisions.jsonl` no se enteran. C paga el costo de escribir y testear la
rama de A sin que nadie la haya pedido todavía.

`-Background` no está descartado, está diferido: se hace el día que moleste el
bloqueo o haga falta paralelismo real. Ese día el registry vuelve a tener sentido,
porque ahí sí puede haber más de un job.

### Consecuencias
- Sigue sin haber paralelismo: una delegación a la vez.
- `-LiveLog` es opcional en `Invoke-CodexCli` a propósito: `login status` y
  `debug models` usan la misma función y no deben loguear ni pisar el heartbeat.
- **El tee obliga a escribir el stdin de forma asíncrona.** La rama sin `-LiveLog`
  arranca `ReadToEndAsync()` *antes* de escribir stdin, así que el stdout se drena
  solo. Leer línea a línea invierte ese orden y reintroduce el deadlock clásico de
  pipes: si el hijo llena su stdout mientras el padre llena el stdin del hijo, los
  dos quedan bloqueados. Por eso la rama `-LiveLog` usa `WriteAsync` + `WaitAny`
  sobre `@(lectura, escritura)` y cierra stdin desde el bucle. Lo encontró el
  reviewer de Codex sobre este mismo cambio; está cubierto por un test de runtime
  con 500 KB de stdin contra un hijo que emite 2000 líneas antes de leer.
- El heartbeat se borra al terminar la corrida: es lo que hace desaparecer el
  segmento de la statusline sin enseñarle a distinguir estados.

### Referencias
ROADMAP.md Fase 3 · INSTALL-HIBRIDO.md § 6 (test 16) y § 8 · CHANGELOG.md

## D-016 — Estados de resultado estructurados y tope de aclaraciones

Estado: Aceptada
Fecha: 2026-08-26

### Contexto
Las delegaciones a Codex funcionaban pero salían "muy discutidas": Codex infería
hechos del repo que no había verificado (un motor de BD, un runner de tests),
implementaba contra el supuesto equivocado, y el RED que seguía disparaba un
reintento. Cuando sí preguntaba, preguntaba de a un hecho por vez, y cada round
trip costaba una corrida entera. El único canal de "no pude" era el booleano
`blocked`, que no distingue "me falta un dato" de "se cayó el build".

### Opciones consideradas
A. Dejar todo en el prompt: pedirle a Codex que "pregunte si tiene dudas", sin
   contrato.
B. `status = DONE | NEEDS_INFO | BLOCKED` en el schema `impl` + `clarifications[]`
   estructurado, con el tope de ciclos como estado del wrapper.
C. Igual que B pero con el tope como criterio del orquestador y un `-ClarifyOf`
   solo para el log, sin estado persistente en el wrapper.

### Decisión
C. `status` y `clarifications` entran al schema `impl` (lo comparten
`constructor`, `tester-tdd` y `verifier`); `blocked` se conserva con invariante.
El tope de 2 ciclos lo aplica el orquestador; el wrapper solo registra
`clarify_of`.

### Motivo
El schema fuerza el contrato donde el prompt no puede (A no es verificable). El
tope como estado del wrapper (B) contradice `D-014`/`D-015`: el wrapper es
stateless a propósito — cada corrida es una llamada, no un job con memoria.
`-ClarifyOf` replica exactamente lo que ya hace `-RetryOf`: no cambia el
protocolo, deja el ciclo observable en `decisions.jsonl`, y la decisión de parar
queda donde está el criterio, que es el orquestador. Separar `NEEDS_INFO` del
presupuesto de retry evita que una ambigüedad legítima queme un intento lógico.

El texto que se genera para Codex pasa a inglés y ASCII-safe: PowerShell 5.1
emite en el codepage OEM y Codex rechaza stdin que no sea UTF-8 válido; los
literales del repo se preservan exactos porque asciificar un path o un nombre de
test rompe el trabajo. La comunicación con el usuario no cambia de idioma.

### Consecuencias
- `NEEDS_INFO` sale con exit 0 y `blocked=false`: sigue siendo reusable para
  continuación directa por las reglas de tamaño de rollout.
- La continuación va por `-PromptFile` (archivo UTF-8 sin BOM), no por
  `-Prompt "<texto>"`: mismo motivo de encoding que el prompt principal, que ya
  entra por stdin.
- El schema `impl` cambia para los tres roles que lo comparten; `review` y `docs`
  quedan intactos.
- El tope de ciclos no es verificable contra código: es criterio, como el resto
  de la "Disciplina del orquestador".

### Referencias
docs/SYSTEM.md BR-011..BR-013 · D-014 · D-015 · CHANGELOG.md ·
Orquestador/skills/orquestador/SKILL.md

## D-017 — Todos los roles Codex en `danger-full-access` en Windows

Estado: Aceptada
Fecha: 2026-08-26

### Contexto
El commit `411462b` movió los cinco roles que escriben (`constructor`,
`tester-tdd`, `verifier`, `e2e-browser`, `browser-diagnostics`) a
`danger-full-access` porque bajo `[windows] sandbox = "elevated"` el modo
`workspace-write` deniega las escrituras dentro del repo (error 1920). Dejó a los
cuatro roles lectores (`explorador`, `reviewer`, `security-reviewer`,
`docs-researcher`) en `read-only`, con la idea de que "la barrera de los lectores
es el sandbox, no sólo el prompt".

La primera invocación real de `reviewer` sobre un diff mostró que esa barrera no
es funcional en este entorno: bajo `elevated`, el modo `read-only` tampoco puede
lanzar procesos hijo. Codex falla con `CreateProcessAsUserW` error 1920 al
intentar ejecutar `git diff` o `rg`, y devuelve "no pude verificar" sin haber
podido leer nada.

### Opciones consideradas
A. Dejar los lectores en `read-only` y aceptar que en Windows `elevated` no
   pueden ejecutar comandos (reviewer inútil).
B. Bajar el sandbox nativo a `unelevated`.
C. Mover los cuatro roles lectores a `danger-full-access`, igual que los que
   escriben; la barrera de los lectores pasa a ser el prompt más
   `agents.enabled=false`.

### Decisión
C. Los roles del kit se declaran `danger-full-access` en su `.toml`.

### Motivo
A deja el flujo con un `reviewer` que no puede hacer su trabajo. B cambia el
sandbox nativo para todo el kit por un caso de borde y arriesga regresiones en
los roles que escriben, que ya estaban resueltos. C usa el patrón que ya
funciona: `verifier` corre `danger-full-access` con barrera de prompt desde el
commit anterior y nunca editó fuera de lo pedido. El permiso sigue siendo config
declarada por rol en `~/.codex/agents/<rol>.toml`, auditable y verificada por
`verify.ps1`; no es el flag `--dangerously-bypass-approvals-and-sandbox`, que
sigue sin usarse.

### Consecuencias
- Para los roles lectores, la única barrera contra escritura es el prompt ("review
  without editing") y `agents.enabled=false`. El diff se sigue evaluando en
  Claude, que es el árbitro final.
- La instalación deja de distinguir roles lectores y escritores: conserva
  `danger-full-access` en los seis roles actuales.
- `install.ps1` copia los `.toml` tal cual y avisa si alguno no está en
  `danger-full-access`. El fix viaja con el kit a cualquier repo que reinstale.
- En un entorno sin `[windows] sandbox = "elevated"`, `read-only` volvería a
  funcionar; la decisión es específica de Windows elevated y así queda anotada.

### Revalidación 2026-09-11

Con Codex CLI 0.153.4 se ejecutaron `git` y `rg` solicitando `-s read-only`.
No reapareció el error 1920, pero el banner efectivo siguió mostrando
`sandbox: danger-full-access` por la política administrada de esta máquina.
La prueba no demuestra que `read-only` funcione y por eso no se reducen permisos.
En `reviewer`, `security-reviewer` y `docs-researcher`, sólo lectura es una
barrera de instrucciones más `agents.enabled=false`, no una garantía de sandbox.

### Referencias
docs/SYSTEM.md § Invariantes del wrapper y § Windows · D-002 · commit `411462b` ·
codex/Orquestador/verify.ps1 · codex/Orquestador/install.ps1 ·
INSTALL-HIBRIDO.md § troubleshooting

---

## D-018 — Delegar por costo del ciclo, no por tamaño del diff

Estado: Aceptada
Fecha: 2026-08-28

### Contexto
Dos días de uso real produjeron un resultado bueno por un camino lento. La sesión
documentada en `MEJORAR ORQUESTADOR/FEEDBACK-ORQUESTADOR.md` cerró con once
delegaciones, tres `NEEDS_INFO` predecibles, doce corridas de suite completa
(~20 minutos de espera) y 248 mil tokens en tres `Explore` que produjeron un mapa
que el orquestador ya tenía a medias.

La regla vigente era "un fix directo se limita a ~50 líneas; por encima se
delega". Mide el tamaño del diff, que es lo que no hay que medir: delegar tiene un
piso de varios minutos —escribir la spec, esperar el spawn, revisar, corregir—
que un cambio mediano no amortiza, tenga treinta líneas o doscientas. De las once
delegaciones, tres pagaron claramente, una no pagó y una pagó a medias.

### Opciones consideradas
A. Subir el umbral de líneas.
B. Reemplazar el umbral por una decisión explícita `DIRECT` / `DELEGATE` /
   `PARALLELIZE` con `DIRECT` como default.
C. Quitar la revisión del diff por el Tech Lead, que es donde se iba el tiempo
   restante.

### Decisión
B. Ante cada tarea y subtarea, la primera decisión es una de tres, y delegar es
la excepción que hay que justificar. La implementación se delega cuando el cambio
toca más de tres archivos o necesita código que el orquestador no tiene en
contexto.

C queda descartada explícitamente: la revisión del diff produjo los cinco
defectos que la sesión encontró, y ninguno lo atrapó un test. Sacarla acelera la
sesión y la hace entregar bugs en verde.

### Motivo
El valor de delegar no es ahorrar tipeo: es que **alguien que no sea el
orquestador** haga el trabajo. Eso vale para tres cosas —implementaciones grandes
contra un contrato congelado, los tests en RED, y la revisión adversarial— y no
vale para nada más. En todo lo demás, el ciclo de delegación cuesta más de lo que
produce.

### Consecuencias
+ Los fixes sobre trabajo delegado los aplica el orquestador, sin spawn nuevo.
+ El TDD pasa a ser por riesgo: presentacional sin test nuevo, comportamiento
  acotado con un RED escrito por el orquestador, y pipeline completo solo para
  regla de negocio, cálculo, persistencia, validación, permisos, estados y
  contratos.
- El orquestador absorbe más trabajo y consume más de su propia ventana. Lo cubre
  el estado `CODEX-PREFERRED`, que sigue vigente sin cambios.
- Es el cambio que más defensa saca. La mitigación es que la frontera se define
  por categoría de riesgo y no por tamaño, y que la revisión del diff corre en las
  tres rutas.

### Referencias
docs/SYSTEM.md § Disciplina del orquestador · D-001 ·
MEJORAR ORQUESTADOR/FEEDBACK-ORQUESTADOR.md § 4.8 y § 5

---

## D-019 — El contrato de frenar es replicable, no del proveedor

Estado: Aceptada
Fecha: 2026-08-28

### Contexto
La diferencia más cara entre Codex y los subagentes Claude no era la calidad del
trabajo: era qué hacían al toparse con una ambigüedad. Codex frena y devuelve
`NEEDS_INFO` sin tocar un archivo —seis de seis veces correctamente, entre dos
sesiones—. Los subagentes Claude decidían, escribían, y lo contaban en un párrafo
al final del resumen, con el trabajo ya hecho.

Costo medido en una sola sesión: el `tester` decidió que una tabla leyera un
snapshot congelado, lo que habría hecho invisibles las correcciones manuales del
operador — once minutos de trabajo tirados más cinco de corrección. El
`constructor` decidió no relajar una validación con un argumento correcto pero
incompleto. Responder esas dos preguntas habría costado un minuto cada una.

La hipótesis intuitiva era que la ventaja de Codex venía de la reutilización de
sesión. Resultó falsa: la sesión llegó a `REUSE-DENIED` por tamaño a los dos
turnos y la segunda continuación arrancó de cero igual.

### Opciones consideradas
A. Adoptar Agent Teams para tener comunicación padre-hijo.
B. Dar a `tester` y `constructor` el mismo contrato de frenar, con `SendMessage`
   para continuar.
C. Aceptar el comportamiento actual y confiar en la revisión del diff.

### Decisión
B. `tester` y `constructor` devuelven `NEEDS_INFO` sin escribir un solo archivo
ante una ambigüedad que cambie el diseño. El orquestador resuelve el hecho desde
evidencia y responde con `SendMessage` al mismo subagente, solo con el delta.

### Motivo
La investigación contra la documentación y los contratos de herramienta de la
versión instalada devuelve **PARTIALLY_SUPPORTED**, a favor: `SendMessage`
continúa un subagente propio **con su contexto intacto**, y `ListAgents` los
enumera. Lo que no existe es que el hijo empuje un mensaje al padre a mitad de
ejecución — tiene que terminar su turno. Eso alcanza: el subagente termina
devolviendo `NEEDS_INFO`, y la continuación no reconstruye la spec.

Agent Teams (opción A) agregaría un modelo de coordinación entero para un
problema que ya está resuelto. C es lo que veníamos haciendo, y cuesta una ronda
completa cada vez que falla.

### Consecuencias
+ La defensa contra una decisión de diseño equivocada deja de ser una sola —el
  orquestador leyendo el diff después— y pasa a haber dos.
+ Es más barato que el equivalente en Codex, que pierde la sesión por tamaño.
- Riesgo de que se use para trivialidades y agregue viajes. Mitigado con la lista
  explícita de qué **no** califica: nombres internos, helpers, orden de funciones,
  organización local.
- El emparejamiento start/end de las métricas es aproximado con spawns paralelos
  del mismo tipo: el payload del hook no trae un id de invocación.

### Referencias
docs/SYSTEM.md § BR-014 y § BR-015 · D-016 ·
MEJORAR ORQUESTADOR/FEEDBACK-ORQUESTADOR.md § 4.1 · Orquestador/agents/*.md

---

## D-020 — Runtime Node/TypeScript sin dependencias, en lugar de PowerShell

Estado: Aceptada
Fecha: 2026-09-10

### Contexto
D-014 declaró `pwsh` 7 como runtime para portar el kit fuera de Windows. Nadie lo
corrió fuera de Windows, y el kit seguía cargando problemas propios de
PowerShell 5.1: quoting manual de argumentos (`ConvertTo-CmdArg`), codepage OEM,
BOM en UTF-8, deadlocks de pipes resueltos a mano (BR-010).

### Opciones consideradas
A. Mantener `pwsh` 7 (D-014).
B. Dos implementaciones: PowerShell para Windows y bash para POSIX.
C. Una sola implementación en Node/TypeScript.

### Decisión
C, con cero dependencias de runtime: `node:util.parseArgs`, `node:child_process`,
`node:test`. devDependencies: `typescript` y `@types/node`.

### Motivo
Node ya es requisito de Claude Code, Codex (se instala por npm) y codegraph: no
agrega runtime. `spawn` con array de args elimina el quoting manual y su
superficie de inyección; los streams de Node eliminan el deadlock de BR-010 por
construcción. B duplica cada bug.

### Consecuencias
+ Un solo código, con 103 tests, incluidos paths Windows/POSIX y shims npm.
+ `codex.cmd` se lanza sin shell: el runtime lee el shim y ejecuta `node <script>`.
- Linux y macOS no tienen todavía una corrida real end-to-end.
- El kit PowerShell queda en `legacy/` hasta que `orq migrate` se use en real.

## D-021 — No construir un motor de orquestación

Estado: Aceptada
Fecha: 2026-09-10

### Contexto
El pedido V2 incluía fases, dependencias, paralelismo y checkpoints. Claude Code
(v2.1.268) ya trae *dynamic workflows*: un runtime JS con `agent()`,
`pipeline()`, `parallel()`, `phase()`, output por JSON Schema y resumabilidad.

### Opciones consideradas
A. Un motor propio de DAG/fan-out en `orq`.
B. Política en la skill + las piezas mecánicas que el motor nativo no tiene.

### Decisión
B. `orq` aporta proveedor Codex, cuota, contratos, jobs en background con tope,
worktrees, checkpoints, telemetría e instalación. El plan con dependencias es un
JSON validado por un orden topológico, no un scheduler.

### Motivo
El motor nativo solo orquesta subagentes Claude y no conoce cuotas ni Codex; lo
que falta es chico. Un scheduler propio duplicaría al nativo y empujaría hacia
el multiagente que el V2 quiere evitar.

### Consecuencias
+ Poco código; la orquestación sigue siendo criterio del razonador.
- Un workflow nativo con muchos agentes no pasa por el gate de cuota de `orq`.

## D-022 — Code intelligence: codegraph detrás de una interfaz, Serena hasta que muera el PowerShell

Estado: Reemplazada por D-032

Estado: Aceptada
Fecha: 2026-09-10

### Contexto
Se evaluaron GitNexus, `lzehrung/codegraph` y Serena. Benchmark en scratchpad:
sobre este repo (entonces PowerShell) codegraph indexó 24 archivos y no encontró
`Get-CodexVerdict`; Serena lo encontró con sus 3 referencias en 1 call. Sobre un
repo TypeScript de 841 archivos, codegraph indexó en 28 s y resolvió `symbols`,
`refs`, `rdeps` y `affected` en 1 call cada uno, con salida compacta.

### Opciones consideradas
A. GitNexus. B. Serena. C. codegraph. D. codegraph detrás de una interfaz.

### Decisión
D. `CodeIntelProvider` de seis métodos con tres backends (codegraph, serena,
native). codegraph pinneado (`2.3.24`) en `~/.orquestador/tools`, MCP registrado
por `orq init` en Claude y Codex. Un motor activo por vez. Serena no se retira
mientras el repo tenga PowerShell relevante; tras la migración se repite el
benchmark y se decide.

### Motivo
GitNexus: licencia PolyForm-Noncommercial-1.0.0 (prohíbe uso comercial), 883
versiones en 7 meses. codegraph: MIT, solo Node, CLI + MCP, `affected` (tests
derivados del grafo) que Serena no tiene, sin Python/uv/LSP. Pero tiene bus
factor 1 (un autor, 5 estrellas): la interfaz hace que cambiarlo sea una línea.
Serena gana en precisión de referencias (LSP) y es el único que ve PowerShell.

### Consecuencias
+ Instalación sin Python; funciona desde Claude, desde Codex y con `orq codeintel`.
+ `native` garantiza que nunca falta code intel.
- Referencias por tree-sitter, no por compilador.
- Mientras convivan, `doctor` avisa "dos motores activos".

## D-023 — La cuota de Claude sale del stdin de la statusLine

Estado: Aceptada
Fecha: 2026-09-10

### Contexto
El gate leía la cuota de Claude del cache que escribe un repo PowerShell de
terceros (ClaudeCodeStatusLine) en `$env:TEMP`. No existe `claude usage`.

### Decisión
Claude Code pasa a toda `statusLine.command` un JSON documentado con
`rate_limits.five_hour` / `seven_day` (`used_percentage`, `resets_at`) y
`session_id`. `orq statusline` lo persiste en `~/.orquestador/claude-usage.json`.

### Consecuencias
+ Soportado, cross-platform, sin dependencias de terceros.
+ Una ventana cuyo `resets_at` pasó vale 0, no el último dato.
- `rate_limits` solo existe en Pro/Max y después de la primera respuesta; con
  otra statusline configurada, `init` no la pisa y el gate degrada a BALANCED.

## D-024 — Telemetría reescrita, y medir también lo que no se delega

Estado: Aceptada
Fecha: 2026-09-10

### Contexto
La retro (`MEJORAR ORQUESTADOR/Mejorar.txt`) mostró un informe que afirmaba
cosas que no pasaron. Causas raíz verificadas: sin filtro de sesión; los
subagentes en background vuelven del tool `Agent` al lanzarse (Pre y Post en el
mismo instante: 0 s); en Windows las suites corren por la tool `PowerShell`, que
el matcher `Agent|Bash` no veía. SYSTEM.md decía que `SubagentStop` no trae el
rol: hoy trae `agent_id` y `agent_type`.

### Decisión
Toda fila lleva `session_id` (hooks: del payload; CLI: `CLAUDE_CODE_SESSION_ID`).
Subagentes apareados por `SubagentStart`/`SubagentStop` y `agent_id`. Matcher
`Bash|PowerShell`. Nueva fila `decision` con `delegation_decision` y motivo de set
cerrado. El informe declara cuando no hay datos de la sesión.

### Motivo
Si solo se mide lo delegado, una sesión sin delegaciones se ve igual a una donde
el gate nunca corrió. Con `not_delegated` y `rework` en el mismo log se puede ver
si la política DIRECT está bien calibrada.

## D-025 — El gate corre en SessionStart

Estado: Aceptada
Fecha: 2026-09-10

### Contexto
"Una vez por sesión" dependía de la memoria del orquestador. En la sesión de la
retro no corrió y nadie lo notó.

### Decisión
Hook `SessionStart`: calcula veredicto y estado, los registra (`gate`) y los deja
en el contexto en dos líneas. Usa el cache de cuota de Codex si tiene menos de 5
minutos; si no, RPC con 5 s de timeout.

### Consecuencias
+ El orquestador nunca decide si consultarlo, solo qué hacer con la respuesta.
- Dos líneas de contexto en toda sesión, también en repos donde no se orquesta.

## D-026 — ASYNC_REVIEW con tope duro de un reviewer por tarea

Estado: Aceptada
Fecha: 2026-09-10

### Contexto
D-015 difirió `-Background` hasta que hiciera falta paralelismo real. La
topología ASYNC_REVIEW lo necesita: el razonador sigue mientras otro proveedor
revisa algo ya verde.

### Decisión
`orq run --background`, solo para roles read-only y con `--task` obligatorio.
Jobs como archivos en `.orquestador/jobs/`. El runtime rechaza (exit 7) un segundo
reviewer activo sobre la misma tarea; un job cuyo PID murió no bloquea. Subir el
tope exige `asyncReview.maxConcurrent` explícito.

### Motivo
La topología existe para no bloquear al razonador, no para abrir otra vía de
fan-out. Un tope en el prompt no se cumple bajo presión; uno en el runtime sí.

## D-027 — Un escritor por región de archivos; worktrees solo para writers paralelos

Estado: Aceptada
Fecha: 2026-09-10

### Contexto
"Un escritor por repositorio" serializó en la retro dos unidades con conjuntos de
archivos disjuntos.

### Decisión
Dos unidades sin archivos en común pueden escribir en paralelo. Si las dos
escriben en el mismo repo, la segunda va en `orq worktree add` (branch
`orq/<nombre>`, directorio hermano `<repo>.wt/`). Nunca worktree para un
reviewer. Nunca merge automático; `remove` se niega con cambios sin commitear y
conserva la branch si no está integrada.

## D-028 — El instalador no siembra permisos peligrosos ni impone config global

Estado: Aceptada
Fecha: 2026-09-10

### Contexto
El V1 sembraba `defaultMode: bypassPermissions` y fijaba `model`,
`approval_policy = "never"` y `sandbox_mode = "danger-full-access"` a nivel global
en `~/.codex/config.toml`, afectando sesiones ajenas al kit. El git-guard y las
deny rules solo cubrían la tool `Bash`.

### Decisión
No se siembra `bypassPermissions` (doctor avisa si está). En Codex solo se
agregan roles, rules, hooks, un bloque administrado de `AGENTS.md` y MCPs
faltantes; los roles declaran su sandbox en su `.toml` (D-017 sigue vigente).
`migrate` nombra las claves que impuso el V1, no las revierte. Git-guard y deny
rules cubren `Bash` y `PowerShell`.

## D-029 — Engram como compatibilidad, no como core

Estado: Reemplazada por D-033
Fecha: 2026-09-10

### Decisión
Ningún módulo del runtime lo usa; `init` no lo instala ni lo desinstala; los
prompts lo consultan "si está disponible". El estado operacional vive en
`.orquestador/`. Se revisa con datos al estabilizar el V2 (ROADMAP).

## D-030 — Rutas G/H y roles Codex sin uso, fuera

Estado: Aceptada
Fecha: 2026-09-10

### Contexto
Las rutas G y H delegaban a `$constructor` / `$revisor-completo`, orquestadores
completos de Codex con fan-out por defecto: contradicen "un solo razonador" y no
tienen ni un uso registrado. `explorador`, `e2e-browser` y `browser-diagnostics`
de Codex ya estaban declarados sin uso (D-002).

### Decisión
Se eliminan del kit (`orq migrate` los retira con respaldo). `tester-tdd` se
conserva: es el RED independiente cuando el razonador es Codex. Los `.toml`
restantes pierden el slug de modelo fijo y los bloques MCP con `cmd /c`.

### Referencias
SYSTEM.md § 3 · ROADMAP.md Fase 4 · CHANGELOG 2.0.0-rc.1

## D-031 — git-guard por parser, no por regex

Estado: Aceptada
Fecha: 2026-09-10

### Contexto
El review adversarial de Codex sobre el V2 mostró que la regex heredada del V1
tenía falsos negativos reales (`git --no-pager push`, `git -c k="A B" push`,
`-C` con espacios en argv) y falsos positivos (`echo git push`, mensajes de
commit). En esta misma sesión el guard V1 bloqueó un heredoc que solo *mencionaba*
la frase.

### Opciones consideradas
A. Ampliar la regex. B. Parser de línea de comandos mínimo.

### Decisión
B (`src/core/guard.ts`): tokeniza respetando comillas, separa por `; & | 
`,
busca `git` en posición de comando (después de asignaciones y wrappers como
`sudo`/`env`), saltea las opciones globales de git y compara el subcomando.
Recorre lo que se ejecuta indirectamente: `bash -c`, `pwsh -Command`, `cmd /c`,
`iex`, `$(…)`, backticks, y `-c alias.x=push`.

### Motivo
Una regex no puede distinguir posición de comando de texto dentro de un
argumento: o se le escapan formas válidas o bloquea texto inerte. Es una frontera
de seguridad: no se simplifica.

### Consecuencias
+ 44 formas bloqueadas y 12 textos inertes que pasan, con test (el segundo review
  sumó agrupaciones, `if/while`, wrappers como `sudo`/`env`/`nohup`/`Start-Process`,
  escapes `g\it`/`` g`it `` y ejecutables indirectos `$g`, `${GIT}`, `$(which git)`).
- Un alias de git definido en la config del usuario (`git p` → push) no se ve.
  Lo cubren las otras capas (D-008).


## D-032 — Serena deprecada: codegraph es el único motor de code intel

### Contexto
D-022 dejaba a Serena viva hasta que se retirara el PowerShell. El V1 quedó
migrado (`orq migrate`, 2026-09-10), el repo ya es TypeScript y Serena estaba
configurada solo con el language server de PowerShell. codegraph resolvió las 6
tareas del benchmark de D-022.

### Opciones consideradas
A. Mantener Serena como backend opcional. B. Retirarla.

### Decisión
B. Se quita el MCP de Claude y de Codex, el backend `serena` de
`CodeIntelProvider`, el chequeo "code intel duplicado" de `orq doctor` y
`.serena/` del repo. Quedan `codegraph` y `native` (fallback git).

### Motivo
Un solo motor evita el aviso permanente de duplicado y el costo de Python/uv/LSP
para una herramienta que ya no ve el código del repo.

### Consecuencias
+ Menos superficie: un backend menos, sin dependencia de Python.
- Se pierde la precisión LSP en referencias; `orq codeintel refs` usa el grafo de
  codegraph. Si hiciera falta, `CodeIntelProvider` permite volver a sumar un backend.
- Una configuración histórica con un backend ya retirado cae a codegraph sin
  convertir la migración en error.

## D-033 — Engram fuera del core V2

Estado: Aceptada
Fecha: 2026-09-11

### Contexto

V2 ya conserva estado durable en `.orquestador/`, decisiones, planes, findings,
telemetría, jobs y git. Mantener además Engram en prompts y archivos versionados
sumaba una capa sin ownership claro sobre instalaciones globales del usuario.

### Decisión

Engram deja de formar parte del core V2. El runtime, `init`, `doctor`, las skills
y los agentes no lo consultan, instalan ni exigen. Se eliminan `.engram/` y las
instrucciones `mem_*` del repo. `migrate` y `uninstall` conservan plugins o
configuración global preexistentes porque V2 no puede demostrar que le
pertenezcan.

### Consecuencias

+ Menos capas de estado y ningún warning por ausencia de Engram.
+ Codex standalone y Claude usan las mismas fuentes durables del proyecto.
- V2 no administra ni limpia una instalación global heredada del V1; el usuario
  puede mantenerla para otros proyectos.
