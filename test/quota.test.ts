// Portado de Orquestador/tests/test-codex-run.ps1: mismos casos, mismos bordes.
// Mover cualquiera de los siete umbrales o reordenar dos reglas pone esto en RED.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { budget, freePercent, claudeLevel, type CodexRateLimits, type ClaudeUsage } from '../src/core/quota.ts'

const cx = (used: number): CodexRateLimits => ({ rateLimits: { primary: { usedPercent: used } } })
const cl = (h5: number | null, d7: number | null = 10): ClaudeUsage | null =>
  h5 == null ? null : { fiveHour: h5, sevenDay: d7 }

test('freePercent', () => {
  assert.equal(freePercent(null), null)
  assert.equal(freePercent({ rateLimits: { primary: {} } }), null)
  assert.equal(freePercent(cx(30)), 70)
  assert.equal(freePercent({ rateLimits: { primary: { usedPercent: 20 }, secondary: { usedPercent: 80 } } }), 20, 'ventana mas ajustada')
  assert.equal(freePercent({ rateLimits: { primary: { usedPercent: 20 } }, rateLimitsByLimitId: { other: { primary: { usedPercent: 90 } } } }), 10, 'entre limitIds')
})

test('BR-001: sin codex instalado es NO-GO con razon propia', () => {
  const b = budget(false, cx(0), cl(10))
  assert.equal(b.decision, 'NO-GO')
  assert.match(b.reason, /instalado/)
  assert.equal(b.state, 'CLAUDE-LEAD')
  assert.equal(budget(false, null, cl(95)).state, 'SURVIVAL')
})

test('BR-001/002: veredictos', () => {
  assert.equal(budget(true, { rateLimits: { primary: { usedPercent: 10 }, spendControlReached: true } }, null).decision, 'NO-GO')
  assert.equal(budget(true, cx(95), null).decision, 'NO-GO')
  assert.equal(budget(true, cx(85), null).decision, 'WARN')
  const acotado = budget(true, cx(70), null)
  assert.equal(acotado.decision, 'GO'); assert.equal(acotado.allowHeavy, false)
  const normal = budget(true, cx(40), null)
  assert.equal(normal.decision, 'GO'); assert.equal(normal.allowHeavy, true)
  assert.equal(budget(true, null, null).decision, 'WARN', 'app-server sin respuesta')
  assert.match(budget(true, cx(40), cl(90)).reason, /empujar trabajo a Codex/)
})

for (const [used, decision, heavy, name] of [
  [90, 'WARN', false, 'exactamente 10% libre'],
  [90.5, 'NO-GO', false, 'apenas bajo 10%'],
  [80, 'GO', false, 'exactamente 20%'],
  [80.5, 'WARN', false, 'apenas bajo 20%'],
  [60, 'GO', true, 'exactamente 40%'],
  [60.5, 'GO', false, 'apenas bajo 40%'],
] as const) {
  test(`borde de veredicto: ${name} -> ${decision}`, () => {
    const b = budget(true, cx(used), null)
    assert.equal(b.decision, decision)
    assert.equal(b.allowHeavy, heavy)
  })
}

for (const [codexUsed, h5, state, name] of [
  [30, 20, 'BALANCED', 'regla 8: ambos con margen'],
  [30, 60, 'CODEX-PREFERRED', 'regla 6: presionado y GO'],
  [30, 75, 'SONNET-LEAD', 'regla 5: apretado y GO'],
  [30, 95, 'SONNET-LEAD', 'regla 4: critico y GO'],
  [95, 20, 'CLAUDE-LEAD', 'regla 3: Codex NO-GO'],
  [95, 95, 'SURVIVAL', 'regla 2: critico y NO-GO'],
  [85, 95, 'SURVIVAL', 'regla 2: critico y WARN'],
  [85, 20, 'CLAUDE-LEAD', 'regla 7: WARN sin critico'],
  [85, 60, 'CLAUDE-LEAD', 'precedencia: presionado + WARN da 7, no 6'],
  [85, 75, 'CLAUDE-LEAD', 'precedencia: apretado + WARN da 7, no 5'],
] as const) {
  test(`estado ${name} -> ${state}`, () => assert.equal(budget(true, cx(codexUsed), cl(h5)).state, state))
}

test('composicion: presionado + GO acotado da CODEX-PREFERRED sin volumen', () => {
  const b = budget(true, cx(70), cl(60))
  assert.equal(b.state, 'CODEX-PREFERRED')
  assert.equal(b.allowHeavy, false)
  assert.match(b.stateReason, /acotado/)
})

for (const [h5, level, state] of [
  [49.5, 'fresco', 'BALANCED'], [50, 'presionado', 'CODEX-PREFERRED'],
  [69.5, 'presionado', 'CODEX-PREFERRED'], [70, 'apretado', 'SONNET-LEAD'],
  [84.5, 'apretado', 'SONNET-LEAD'], [85, 'critico', 'SONNET-LEAD'],
] as const) {
  test(`borde de nivel ${h5} -> ${level}`, () => {
    const b = budget(true, cx(30), cl(h5))
    assert.equal(b.level, level)
    assert.equal(b.state, state)
  })
}

test('gate de 7 dias', () => {
  assert.equal(budget(true, cx(30), cl(10, 80)).state, 'BALANCED', 'exactamente 80 no fuerza el piso')
  const b = budget(true, cx(30), cl(10, 80.5))
  assert.equal(b.level, 'presionado'); assert.equal(b.state, 'CODEX-PREFERRED')
  assert.equal(claudeLevel(90, 95), 'critico', 'sube el piso, nunca lo baja')
})

test('regla 1: sin cuota de Claude nunca se infiere estado', () => {
  const b = budget(true, cx(95), null)
  assert.equal(b.state, 'BALANCED'); assert.equal(b.level, null)
  assert.match(b.stateReason, /statusline/)
  assert.equal(budget(true, null, null).state, 'BALANCED')
})
