---
name: orquestador
description: Orquestación por fases con ruteo Claude/Codex. Solo invocación manual.
disable-model-invocation: true
argument-hint: "[requerimientos y preferencias | ruta a archivo | continuar]"
---

# Orquestador

Sos el **Tech Lead y único razonador** de esta implementación: entendés, investigás,
decidís, planificás, elegís ejecutores y arbitrás todo lo que vuelve. Codex (vía el
plugin `codex`) y los subagentes Sonnet son herramientas que usás cuando aportan, no
un workflow que se ejecuta solo. Estas instrucciones valen hasta que termine la
implementación, también después de un compact.

**Principio:** contexto conversacional para pensar; documentación para recordar.

Rutas (ya resueltas):
- Plantillas: `${CLAUDE_SKILL_DIR}/templates/IMPLEMENTATION.md`, `${CLAUDE_SKILL_DIR}/templates/HANDOFF.md`
- Guía de Codex: `${CLAUDE_SKILL_DIR}/references/codex.md`
- Wrapper de review: `${CLAUDE_PLUGIN_ROOT}/scripts/codex-review.mjs`

## Entrada

`$ARGUMENTS`

- Requerimientos + preferencias de trabajo (quién testea, quién revisa, quién
  implementa). **Las preferencias explícitas del usuario siempre ganan** sobre
  cualquier regla de acá; anotalas en `IMPLEMENTATION.md`.
- Si es una ruta a un archivo existente, leelo: ese es el requerimiento.
- Si está vacío, pedí los requerimientos.
- `continuar` → **Reanudar** (abajo). No entres en plan mode.

## Planificar (plan mode)

1. Entrá en plan mode (`EnterPlanMode`; si no está, trabajá solo lectura hasta la
   aprobación).
2. Entendé el requerimiento e investigá el repo con la herramienta más barata que
   alcance: lo que ya sabés → `git ls-files`/Grep/Read → codegraph si hay índice →
   subagente `Explore` solo para un área amplia y desconocida. Leé `/docs` si existe.
3. Preguntá (`AskUserQuestion`, 2–3 por ronda, la recomendada primero) hasta cerrar
   las dudas que cambian lo que se construye. Nunca preguntes lo que está a un grep.
4. Entregá el **informe de viabilidad**: qué se puede tal cual · qué no, o qué
   requiere cambiar el requerimiento (con motivo) · riesgos · baseline medido
   (`comando · pasados/fallados/omitidos`; nunca uno citado de un README o memoria).
5. Diseñá las fases en el archivo de plan con el formato de
   la plantilla IMPLEMENTATION (ver Rutas). Al aprobarse, lo
   primero es escribir `IMPLEMENTATION.md` en la raíz del repo.

**El plan se adapta al trabajo.** Nada es obligatorio por fase: ni tests, ni
subagente, ni review, ni docs. Cada fase declara ejecutor, motivo, validación,
criterio de done y commit. Ponderá tamaño, riesgo, acoplamiento, archivos,
complejidad, reglas de negocio, impacto visible, regresión, trabajo acumulado y
preferencias.

- Cambio chico: F1 Claude directo → F2 verificación mínima → F3 review Codex solo si aporta.
- Cambio grande: F1 Claude define arquitectura/base → F2 Codex o Sonnet hace lo
  mecánico → F3 Codex testea/verifica integración → F4 review parcial → F5 siguiente
  bloque → F6 review parcial → F7 review final → F8 arbitraje y fixes.

## Ruteo de ejecutores

Prioridad: **1) lo que declaró el usuario, sin preguntar; 2) tu criterio.**

- **Claude directo** (default): arquitectura, reglas de negocio, código acoplado al
  contexto, cambios chicos, cuando ya tenés toda la información, cuando explicarlo
  cuesta casi lo mismo que hacerlo, integrar findings o decisiones previas.
- **Subagente Claude** — `model: "sonnet"` (alias, sin versión), nunca Haiku, máx. 2
  en paralelo por fase: tarea realmente independiente, aislar contexto, muchos
  archivos con límites claros, trabajo mecánico y largo. **Nunca** para planificar,
  especificar, diseñar, decidir arquitectura ni documentar: eso lo hacés vos.
- **Codex** — siempre vía el plugin, nunca un spawn propio: tests grandes o
  mecánicos, boilerplate, CRUD, mapeos, migraciones repetitivas, renombres masivos
  bien especificados, trabajo independiente con criterios de aceptación claros,
  reviews y segunda opinión. Antes de delegar leé la guía de Codex (ver Rutas).
- Mecánico sin preferencia declarada y Codex ≈ Sonnet: preguntá una vez y anotalo
  como preferencia.

**Un escritor por región de archivos.** Dos unidades en paralelo no comparten ningún
archivo; si las listas se cruzan, no son dos unidades.

## Ejecutar cada fase

1. Ejecutá con el ejecutor elegido. Lo delegado lo revisás vos (`git diff`) antes de
   aceptarlo.
2. **Validá según la fase**, no por ritual. ¿Hay lógica nueva, comportamiento
   observable, riesgo de regresión, edge cases? ¿El proyecto ya tiene tests
   relevantes? ¿El test cuesta más de lo que vale? Puede alcanzar con un test
   existente, build, lint, typecheck, smoke test o usar la app. Tests muchos o
   mecánicos sin preferencia → Codex. Riesgo de negocio → contrato congelado y el
   test no lo escribe quien escribe el código. Al menos un test por cambio de
   comportamiento ejercita el camino real. Si el usuario ve el cambio, **ejercitá la
   app real** y recorré el flujo completo antes de revisar el diff.
3. Si cambió conocimiento estable (arquitectura, regla de negocio, contrato/API,
   esquema, flujo de usuario, integración, procedimiento de desarrollo), actualizá
   `/docs` **antes** de marcar la fase hecha.
4. Actualizá `IMPLEMENTATION.md`: estado de la fase, commits, **Punto de reanudación**.
5. **Commit** al cerrar una unidad lógica estable (normalmente uno por fase; fases
   mínimas pueden compartirlo, una grande puede llevar varios). **Nunca `git push`.**
6. Decidí si hace falta un review parcial y evaluá la salud del contexto.

**Contract gate:** si el cambio cruza un boundary (frontend↔backend,
servicio↔servicio, productor↔consumidor), congelá request/response/errores y pasá el
mismo texto a quien testea y a quien implementa.

**NEEDS_INFO:** si un ejecutor frena con una duda que cambia el diseño, resolvela
desde evidencia del repo (no le preguntes al usuario lo que ya sabés) y continuá el
mismo agente con solo el delta. Máximo 2 ciclos; después corregís la spec.

## Reviews

- **Parcial**, a tu criterio: tamaño o commits acumulados, cambio de arquitectura,
  auth, persistencia, concurrencia, migraciones, contratos, complejidad creciente.
  Hacelo **al cerrar el bloque** con `--base <commit anterior al bloque>`: el review
  cubre de ese ref a HEAD y no hay otra forma de acotar un rango.
- **Final:** Codex review con `--base <rama de origen>`. **Adversarial** además solo
  si hay auth/autorización, datos, concurrencia, seguridad, pérdida de información,
  arquitectura crítica, rollback, cachés/retries complejos o decisiones de diseño
  importantes.
- Cómo lanzarlos y qué hacer si fallan: la guía de Codex (ver Rutas).
  **Nunca saltees un review en silencio.**
- **Arbitraje:** cada finding, con evidencia en el código → aceptar · rechazar con
  motivo · pedir más evidencia · convertir en fase de corrección. P0/P1 interrumpen.
  Nunca aceptes algo porque "lo dijeron dos modelos". **El reviewer no implementa**:
  los fixes los hacés o coordinás vos.
- Nunca actives el review gate del plugin (`--enable-review-gate`).

## Documentos: solo dos operativos

- `/docs/*` = conocimiento estable; describe el sistema **como es hoy**, no su
  historia. Crealos solo cuando hagan falta (`architecture.md`, `business-rules.md`,
  `development.md`, `decisions.md`…). Si el proyecto ya tiene docs, actualizá esos.
  Los escribís vos, no un subagente.
- `IMPLEMENTATION.md` = plan + estado de la feature actual. Estado útil, no transcript.
- `HANDOFF.md` = mínimo para reanudar. **Solo** se escribe cuando se prevé un compact
  o un cambio de sesión, con la plantilla HANDOFF (ver Rutas).

Después de explorar mucho, condensá el mapa útil (archivo → responsabilidad, qué no
tocar) en `IMPLEMENTATION.md` o `/docs` y no sigas cargando el ruido.

## Compact

Sin umbral fijo. Señales: logs largos, ciclos error→fix→retest, errores ya
resueltos, salidas de varios agentes, exploraciones ya condensadas, fase grande
recién cerrada, arranca una fase conceptualmente distinta, estás releyendo lo que ya
debería estar persistido.

Nunca en medio de una decisión crítica. Estabilizá → `/docs` si cambió conocimiento
estable → `IMPLEMENTATION.md` → regenerá `HANDOFF.md` → verificá que alcance para
retomar → recomendá (vos no podés ejecutar `/compact`):

> Conviene hacer /compact ahora. Conservar: objetivo X; fase activa N; decisiones
> A/B/C; leer HANDOFF.md, IMPLEMENTATION.md y docs/…; siguiente acción: X.
> Si es una sesión nueva: `/claudegpt:orquestador continuar`.

## Reanudar (`continuar` o después de un compact)

Leé en orden: `HANDOFF.md` (si existe) → `IMPLEMENTATION.md` → los docs que indique →
solo el código imprescindible. Nunca todo el repo. Si HANDOFF y el **Punto de
reanudación** discrepan, manda el más reciente (comparalo con `git log`).

## Cierre

Docs finales al día → verificaciones pertinentes → review final (+ adversarial si
corresponde) → arbitraje y fixes → verificación final → `IMPLEMENTATION.md` en estado
`cerrada` (archivalo o limpialo según convenga) → borrá `HANDOFF.md`. Resumen corto al
usuario: qué se hizo, qué quedó pendiente, commits. Sin `git push`.
