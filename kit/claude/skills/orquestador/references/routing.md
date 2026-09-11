# Presupuesto, estados y fallbacks

Leé este archivo cuando el estado del gate cambie o algo falle por cuota.

## El gate — corre solo

El hook `SessionStart` ejecuta el gate y te deja en el contexto:

```
[orq] Presupuesto: estado CODEX-PREFERRED | Codex GO (80% libre) | Claude 5h 58% 7d 25%.
[orq] Claude planifica y arbitra; ejecucion a Codex.
```

Recalculás (`orq budget`) solo si el usuario lo pide, si arranca una tarea grande
después de mucho trabajo, o si algo falló por cuota. Para un typo, nunca.

Dos capas que se componen y no se pisan:

- **Veredicto** (`GO` / `WARN` / `NO-GO`) — *¿se puede usar Codex, y para qué?*
- **Estado** — *¿quién ejecuta?* El estado decide el reparto; el veredicto
  sigue vetando el volumen dentro del estado.

## Veredicto de Codex

| Codex libre | Veredicto |
|---|---|
| ≥ 40% | **GO** — delegación normal, incluso implementación grande |
| 20–40% | **GO acotado** — review / verify / docs sí; implementación voluminosa no |
| 10–20% | **WARN** — solo si el usuario lo pide |
| < 10%, `spendControlReached`, o `codex` ausente | **NO-GO** — Claude-only, con la hora de reset |

## Estados

| Estado | Qué hacés |
|---|---|
| `BALANCED` | Reparto por naturaleza de la tarea |
| `CODEX-PREFERRED` | Vos pensás, contratás y arbitrás; **la ejecución pesada va a Codex** |
| `SONNET-LEAD` | Recomendás `/model sonnet` **una sola vez** y Codex ejecuta |
| `CLAUDE-LEAD` | Claude-only. Codex solo si el usuario lo pide |
| `SURVIVAL` | **No arranques trabajo nuevo.** Cerrá y hacé checkpoint |

`CODEX-PREFERRED` es el que cambia el hábito: **no esperes a estar al 85% para
delegar.** Desde el 50% de tu ventana de 5h, la ejecución mecánica y verificable
contra un contrato la hace Codex con su cuota. Igual tiene que haber uno de los
seis motivos del `SKILL.md` — el estado dice *quién* ejecuta, no *que* haya que
delegar.

> **El gate nunca bloquea.** Sin lectura de la cuota de Claude (statusline ajena,
> plan sin `rate_limits`, primer turno) degrada a `BALANCED` y lo dice.

### `SONNET-LEAD` — no insistir

Recomendalo **una vez, al presentar el plan**, con el número:

> *Estás al 74% de tu ventana de 5h. Te conviene `/model sonnet`: sigo
> orquestando, Codex hace el trabajo pesado. Si preferís seguir en Opus, procedo
> igual.*

Si no cambia, seguís con el comportamiento de `CODEX-PREFERRED` y no lo volvés a
mencionar en esa tarea. No podés cambiar tu propio modelo: nunca digas que el
cambio es automático.

### `SURVIVAL` — checkpoint, no una última feature

```
terminar la unidad actual -> tests -> working tree consistente
-> doc sync minima (ROADMAP) -> checkpoint -> informar al usuario
```

El checkpoint guarda objetivo, GREEN/RED, qué se terminó, qué falta, decisiones,
riesgos y **el siguiente paso concreto** en el estado durable del proyecto y en
la respuesta al usuario.

## Qué rol de Codex, cuándo

Solo después de decidir **que** se delega (uno de los seis motivos):

| Necesidad | Rol |
|---|---|
| Implementación voluminosa contra RED ya escrito | `orq run --role constructor --reason volume` |
| RED independiente cuando el razonador es Codex | `--role tester-tdd --reason independence` |
| Review adversarial de un cambio con riesgo | `--role reviewer --reason independence` (`--background` = ASYNC_REVIEW) |
| auth, permisos, pagos, uploads, tokens, trust boundaries | `--role security-reviewer --reason independence` |
| build / lint / typecheck / suite larga que no querés en tu contexto | `--role verifier --reason isolation` |
| Documentación actual, versiones, deprecaciones | `--role docs-researcher --reason specialization` |

Primero context7 vos mismo; `docs-researcher` solo si la investigación es extensa.

## Overrides del usuario

| El usuario dice | Comportamiento |
|---|---|
| *"hacelo solo con Claude"* | Codex no se usa. `--decision not_delegated --reason user_override` |
| *"usá también Codex"* | Al menos una delegación con utilidad real (no ritual) |
| *"que Codex implemente"* | Seguís liderando; Codex ejecuta `--role constructor` |
| *"que Codex revise"* | Codex read-only como reviewer |
| nada | Decidís vos por los seis motivos |

## Fallbacks

| Falla | Qué hacés |
|---|---|
| NO-GO / Codex ausente | Claude-only; `orq run` ya lo registra como `provider_unavailable` |
| Codex se queda sin cuota a mitad | El trabajo parcial quedó en disco: retomás desde `git diff` |
| Codex no autenticado (exit 5) | Decís qué falta (`codex login`). **Nunca** API key: cambia la facturación |
| `app-server` no responde | Cuota desconocida → WARN, no GO |
| Output sin JSON válido (exit 4) | El runtime trunca y dice dónde está el resto |
| Codex modificó tests que no debía | Rechazás, `git checkout` de esos archivos, lo reportás |
| Claude y Codex discrepan | **Vos arbitrás con evidencia**, nunca por mayoría |
| Reviewer ya activo (exit 7) | Esperás su resultado (`orq jobs <id>`); no lanzás otro |

## Browser

Chrome DevTools MCP **solo** en proyectos con frontend y cuando el cambio es
visible: consola, red, performance, screenshots, verificación de UI. Nunca por
defecto.
