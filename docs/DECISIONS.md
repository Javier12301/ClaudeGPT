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

Estado: Aceptada
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

Estado: Aceptada
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

Estado: Aceptada
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

Estado: Aceptada
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

Estado: Aceptada
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
C. Los nueve roles del kit se declaran `danger-full-access` en su `.toml`.

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
- `verify.ps1` deja de distinguir roles lectores y escritores: exige
  `danger-full-access` en los nueve.
- `install.ps1` copia los `.toml` tal cual y avisa si alguno no está en
  `danger-full-access`. El fix viaja con el kit a cualquier repo que reinstale.
- En un entorno sin `[windows] sandbox = "elevated"`, `read-only` volvería a
  funcionar; la decisión es específica de Windows elevated y así queda anotada.

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
