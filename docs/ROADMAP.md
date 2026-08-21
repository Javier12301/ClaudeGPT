# Roadmap — Orquestador Híbrido Claude + Codex

Qué falta, en qué estado está, qué no construir todavía. Cómo funciona lo ya
terminado → [`SYSTEM.md`](SYSTEM.md).

---

## Fase 1 — Kit híbrido Claude + Codex

Estado: DONE

- [x] Integración híbrida Claude Code + Codex vía `codex exec`
- [x] Wrapper único de delegación (`Orquestador/scripts/codex-run.ps1`)
- [x] Routing consciente de presupuesto (cuotas Claude + Codex)
- [x] Resolución de modelos por tier contra catálogo vivo
- [x] Reutilización inteligente de sesiones de Codex
- [x] Contratos de salida forzados por JSON Schema
- [x] Observabilidad (`.orquestador/decisions.jsonl`)
- [x] Guard de git de cuatro capas (Claude + Codex)
- [x] `README.md` e `INSTALL-HIBRIDO.md` para el entorno completo
- [x] Diagramas Mermaid de arquitectura, routing y TDD

## Fase 2 — Brainstorming, plan gate y auto-documentación

Estado: IN_PROGRESS

- [x] Skill `brainstorming`
- [x] Skill `documentacion`
- [x] Cambios en la skill `orquestador` (Fases 0.6 y 6, columna de impacto
      documental en el routing A–H)
- [x] Trazabilidad BR en `tester`
- [x] Bootstrap documental (partir `README.md` en `docs/SYSTEM.md`,
      `docs/DECISIONS.md`, `docs/ROADMAP.md` y `CHANGELOG.md`)
- [ ] Verificación en uso real: que el caso A siga sin costar nada y que el flujo
      de brainstorming llegue a `EnterPlanMode`

### Deuda conocida

- No hay tests del lado Claude: `codex/Orquestador/verify.ps1` cubre solo el
  kit Codex. Las siete reglas BR-001…BR-007 están sin verificar.
- `Get-BudgetVerdict` tiene los umbrales `20` y `40` hardcodeados inline
  (`codex-run.ps1:239-241,243`) en vez de constantes nombradas, a diferencia de
  `$MinFreePercent`, `$CLAUDE_PRESSURE`, `$REUSE_FREE_KB` y `$REUSE_LIMIT_KB`.
- El wrapper no rechaza explícitamente los flags de bypass: simplemente nunca
  los incluye. No hay guard si alguien los agregara.
