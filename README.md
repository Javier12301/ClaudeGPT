# Orquestador Híbrido — Claude Code + Codex

Un solo loop de ingeniería sobre dos suscripciones. Claude Opus es el Tech Lead y
la única interfaz con el usuario; Codex aporta capacidad exactamente donde mejora
costo, independencia de revisión o productividad. Codex nunca es un orquestador
propio en este flujo: es capacidad delegada.

---

## Índice

- [`docs/SYSTEM.md`](docs/SYSTEM.md) — cómo funciona el sistema hoy: contexto,
  reglas de negocio, arquitectura, flujos críticos, datos, integraciones y
  seguridad.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — por qué se tomó cada decisión de
  diseño relevante.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — qué falta y en qué estado está.
- [`CHANGELOG.md`](CHANGELOG.md) — historia observable de cambios.
- [`INSTALL-HIBRIDO.md`](INSTALL-HIBRIDO.md) — instalación del entorno completo.
  Si ya lo tenías instalado y solo querés la versión nueva:
  [§ 7.1 Actualizar desde una versión anterior](INSTALL-HIBRIDO.md#71-actualizar-desde-una-versión-anterior-a-las-skills-de-documentación).
- [`Orquestador/INSTALL.md`](Orquestador/INSTALL.md) — instalación solo del kit
  Claude.

---

## Cómo se usa

Le decís a Claude Code: *"Trabajá como Orquestador"*. A partir de ahí, es la
única interfaz: decide, delega a Codex cuando conviene, y arbitra el resultado
antes de entregarlo.

Para instalar el entorno completo desde cero:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-hibrido.ps1
```

Ramifica solo según tengas Codex autenticado o no, respalda antes de pisar nada y
termina verificando. Detalle y versión manual: [INSTALL-HIBRIDO.md](INSTALL-HIBRIDO.md).

---

## Ejemplos completos

### Tarea mediana — "Implementá recuperación de contraseña"

```
Claude (Fase 0)   mem_search "auth password reset" → sin contexto previo
Claude (Fase 0.5) -BudgetOnly → Claude 5h 72% · Codex 7d 20% · GO
Claude (Fase 1)   2 preguntas: ¿mail o SMS? ¿expiración del token?
Claude (Fase 2)   explorador @sonnet → auth.ts:120, mailer.ts:45, riesgo: sesiones

Claude presenta:

  Plan de ejecución
  - Orquestador:        Claude Opus
  - Exploración:        Claude Sonnet          (hecho)
  - Tests RED:          Claude Sonnet
  - Implementación:     Codex worker/medium
  - Verificación:       Codex cheap/low
  - Review correctness: Codex worker/high
  - Review seguridad:   Codex worker/high      (toca auth y tokens)
  - Revisión final:     Claude Opus

  Por qué Codex: la implementación toca 6 archivos y ~300 líneas — sacarla de mi
  contexto ahorra presupuesto, y con mi ventana de 5h al 72% conviene usar la
  segunda suscripción. Además el review queda independiente del que escribió.

Usuario: "Procedé."

  tester @sonnet                     → 9 tests RED
  -Role constructor                  → 6 archivos, GREEN, sesión 312 KB
  -Role verifier                     → build FAIL: falta exportar resetToken

  Claude: el error es del código que escribió ese mismo executor y la sesión
  está liviana → continuación, no sesión nueva.
  -Resume <id> -Prompt "Falta exportar resetToken desde auth/index.ts."
                                     → 3 líneas, sesión 388 KB, build PASS

  -Role reviewer                     → sesión NUEVA (rol distinto)
                                     → 2 findings (P1 race, P2 log)
  -Role security-reviewer            → 1 finding (P1 token sin rate limit)

Claude revisa `git diff` y evalúa los 3 findings con evidencia:
  - P1 race        → confirmado, fix directo (18 líneas)
  - P1 rate limit  → confirmado, fix directo (11 líneas)
  - P2 log         → descartado, el logger ya redacta (logger.ts:88)

Suite GREEN. mem_save de la decisión de expiración.
Entrega: qué se hizo, qué se descartó y por qué. Sin commit (no lo pediste).
```

### Tarea trivial — "Renombrá `usr` a `user` en session.ts"

```
Claude (Fase 0.5) → caso A, ni siquiera consulta cuotas
Claude edita el archivo. Fin.

Sin explorador. Sin tester. Sin Codex. Sin línea en decisions.jsonl.
```

---

## Registro de cambios

Ver [CHANGELOG.md](CHANGELOG.md).

Todo cambio de comportamiento del orquestador (nuevo rol, nuevo umbral, nueva
regla de routing, nuevo fallback) actualiza `docs/SYSTEM.md` (y
`docs/DECISIONS.md` si trae una decisión nueva) y `CHANGELOG.md` en el mismo
diff. Si no está documentado, no está terminado.
