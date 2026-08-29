# Routing por cuota y capacidad

Leé este archivo cuando vayas a consultar el presupuesto de la sesión, cuando el
estado cambie, o cuando algo falle por cuota.

## El gate — una vez por sesión

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/scripts/codex-run.ps1 -BudgetOnly
```

**Se consulta una vez por sesión, no por tarea.** Recalculás solo si el usuario
lo pide, si arranca una tarea grande después de mucho trabajo, o si algo falló
por cuota. Para un typo o una explicación no lo consultás nunca.

Devuelve **dos capas** que se componen y no se pisan:

- **Veredicto** (`GO` / `WARN` / `NO-GO`) — *¿se puede usar Codex, y para qué?*
- **Estado** (`BALANCED` / `CODEX-PREFERRED` / `SONNET-LEAD` / `CLAUDE-LEAD` /
  `SURVIVAL`) — *¿quién lleva el lead y quién ejecuta?*

El estado decide el reparto; el veredicto sigue vetando el volumen dentro del
estado.

## Veredicto de Codex

- **NO-GO** (Codex < 10% libre, o `spendControlReached`): Codex queda descartado.
  Seguís Claude-only y se lo decís al usuario con la hora de reset.
- **WARN** (10–20%): solo si el usuario lo pide explícitamente.
- **GO acotado** (20–40%): review / verify / docs sí; implementación voluminosa no.
- **GO normal** (≥ 40%): delegación normal, incluso implementación grande.

## Estados

| Estado | Qué hacés |
|---|---|
| `BALANCED` | Reparto por naturaleza de la tarea |
| `CODEX-PREFERRED` | Vos pensás, contratás y arbitrás; **la ejecución pesada va a Codex** |
| `SONNET-LEAD` | Recomendás `/model sonnet` **una sola vez** y Codex ejecuta |
| `CLAUDE-LEAD` | Pipeline Claude. Codex solo si el usuario lo pide |
| `SURVIVAL` | **No arranques trabajo nuevo.** Cerrá y hacé checkpoint |

`CODEX-PREFERRED` es el estado que cambia el hábito: **no esperes a estar al 85%
para delegar.** A partir del 50% de tu ventana de 5h, la ejecución mecánica y
verificable contra un contrato la hace Codex con su cuota, no vos con la tuya.

> **El estado nunca bloquea.** Si no se puede leer la cuota de Claude, el gate
> degrada a `BALANCED` y te avisa. Nunca infiere un estado desde un dato que no
> tiene, y nunca te deja sin herramienta.

### `SONNET-LEAD` — la regla de no insistir

Al entrar, recomendá el cambio **una vez, al presentar el plan**, con el motivo y
el número de cuota:

> *Estás al 74% de tu ventana de 5h. Te conviene `/model sonnet`: yo sigo
> orquestando y hablando con vos, Codex hace el trabajo pesado, y la ventana
> rinde varias veces más. Si preferís seguir en Opus, procedo igual.*

**Si el usuario no cambia de modelo, seguís en Opus con el comportamiento de
`CODEX-PREFERRED` y no lo volvés a mencionar en esa tarea.** Repetirlo es la
forma más rápida de que deje de leer lo que decís. En la tarea siguiente sí
podés volver a plantearlo: la cuota cambió y la decisión es nueva.

Vos no podés cambiar tu propio modelo — `/model` es del usuario. Nunca digas ni
sugieras que el cambio es automático.

### `SURVIVAL` — checkpoint, no una última feature

Quedarte sin cuota a mitad de una unidad cuesta más de recuperar que la unidad
entera. Dejás de iniciar trabajo nuevo y cerrás lo abierto, en este orden:

```
terminar la unidad actual -> tests -> verify -> working tree consistente
-> doc sync minima (ROADMAP) -> checkpoint en Engram -> informar al usuario
```

El checkpoint guarda: objetivo, estado GREEN/RED, qué se terminó, qué falta,
decisiones tomadas, riesgos abiertos y **el siguiente paso concreto**.

> **Regla dura: no intentes "una última feature".** Es exactamente el momento en
> que sale mal y no queda cuota para arreglarlo.

## Rutas de ejecución

Se combinan con el gate DIRECT / DELEGATE / PARALLELIZE del `SKILL.md`: primero
decidís si delegás, y recién ahí esta tabla dice a quién.

| Caso | Cuándo | Quién ejecuta |
|---|---|---|
| **A — directo** | Ya tenés el contexto y el cambio es localizado | Vos solo. Sin agentes, sin Codex |
| **B — desarrollo normal** | Feature acotada, bug con causa clara | Pipeline Claude |
| **B+ — normal con riesgo** | Toca contratos, concurrencia, datos compartidos | Pipeline Claude + `-Role reviewer` |
| **C — implementación voluminosa** | Muchos archivos, mucho código nuevo | Claude tester RED → `-Role constructor` |
| **D — seguridad** | auth, permisos, pagos, uploads, tokens, datos sensibles | Pipeline Claude + `-Role security-reviewer` |
| **E — verificación cara** | build/lint/typecheck/suite larga | `-Role verifier` |
| **F — investigación documental extensa** | comparar libs, migración de versión | `-Role docs-researcher` |
| **G — delegación total** | Tarea autocontenida sin arbitraje, con Claude apretado | `$constructor` de Codex |
| **H — auditoría completa** | "revisá todo el proyecto" | `$revisor-completo` de Codex |

En el plan al usuario **declará siempre** el estado, qué modelo usa cada paso y
por qué se usa (o no) Codex. El usuario tiene que poder decir "procedé" y nada más.

## Overrides del usuario

| El usuario dice | Comportamiento |
|---|---|
| *"hacelo solo con Claude"* | Codex no se usa. Ni siquiera consultás cuota |
| *"usá también Codex"* | Al menos una delegación con utilidad real (no ritual) |
| *"que Codex implemente"* | Vos seguís liderando; Codex ejecuta `-Role constructor` |
| *"que Codex revise"* | Codex read-only como reviewer |
| nada | Vos decidís según costo, complejidad, riesgo y beneficio |

## Fallbacks

| Falla | Qué hacés |
|---|---|
| Codex sin cuota | Claude-only. Avisás con la hora de reset |
| Codex se queda sin cuota a mitad | El trabajo parcial quedó en disco: retomás desde `git diff` |
| Claude apretado, Codex con margen | `SONNET-LEAD`: recomendás `/model sonnet` una vez y delegás |
| Ambos sin cuota | `SURVIVAL`: cerrás la unidad, checkpoint, informás |
| Codex no autenticado | Decís qué falta. **No** usás API key: cambiaría la facturación |
| `app-server` no responde | Cuota desconocida → tratás como WARN, no como GO |
| Output enorme | El wrapper trunca. Leés el archivo completo solo si hace falta |
| Codex modificó tests | Rechazás el resultado, `git checkout` de esos archivos, lo reportás |
| Tests siguen RED | Decidís: corregir spec / reintentar / volver al Tester |
| Claude y Codex discrepan | **Vos arbitrás con evidencia.** Nunca por mayoría de modelos |

## Testing E2E y performance

Playwright MCP y Chrome DevTools MCP **no se usan automáticamente**. Solo cuando
el usuario lo pide para esa tarea.

- **Chrome DevTools MCP = observar**: performance, network, Web Vitals, profiling.
- **Playwright MCP = actuar**: flujos E2E repetibles como parte de la suite de
  regresión, ejecutados por Tester.
- **claude-in-chrome = uso personal del usuario.** Ni vos ni Tester lo invocan.

Si hace falta autenticación para un test local, el usuario pasa el token o la
cuenta de testing. No inventes credenciales ni asumas que existen.
