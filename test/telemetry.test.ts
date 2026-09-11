// Cada bug del P0 de la retro (MEJORAR ORQUESTADOR/Mejorar.txt) tiene su test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { record, rowFromHook, readRows, subagentRuns, summarize, formatReport, testScope, testResult, logFile } from '../src/core/telemetry.ts'
import { appendJsonl } from '../src/core/state.ts'
import { repoRoot, ensureStateDir } from '../src/commands/hook.ts'

const tmpRepo = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'orq-tel-')); mkdirSync(path.join(d, '.git')); return d }
const at = (s: number) => new Date(Date.UTC(2026, 8, 10, 12, 0, s)).toISOString()

test('bug 1: el reporte filtra por sesion y no mezcla filas de otra', () => {
  const repo = tmpRepo()
  record(repo, 'delegation', { provider: 'codex', role: 'reviewer', delegation_decision: 'delegated' }, 'SESION-VIEJA')
  record(repo, 'delegation', { provider: 'codex', role: 'constructor', delegation_decision: 'delegated' }, 'SESION-VIEJA')
  record(repo, 'decision', { delegation_decision: 'not_delegated', reason: 'too_small' }, 'SESION-ACTUAL')
  const { rows } = readRows(repo, 'SESION-ACTUAL')
  assert.equal(rows.length, 1)
  const out = formatReport(repo, 'SESION-ACTUAL')
  assert.match(out, /delegaciones Codex\s+0/)
  assert.match(out, /0 delegadas \/ 1 directas/)
})

test('bug 2: subagente en background se mide por SubagentStart/Stop, no por el tool Agent', () => {
  // El tool Agent vuelve al lanzar: Pre y Post en el mismo instante (lo que daba 0 s).
  const rows = [
    { ts: at(0), session_id: 's', event: 'spawn_request', agent_type: 'Explore', task: 'mapear auth' },
    { ts: at(0), session_id: 's', event: 'subagent_start', agent_id: 'a1', agent_type: 'Explore' },
    { ts: at(1), session_id: 's', event: 'spawn_request', agent_type: 'Explore', task: 'mapear pagos' },
    { ts: at(1), session_id: 's', event: 'subagent_start', agent_id: 'a2', agent_type: 'Explore' },
    { ts: at(88), session_id: 's', event: 'subagent_stop', agent_id: 'a1', agent_type: 'Explore' },
    { ts: at(153), session_id: 's', event: 'subagent_stop', agent_id: 'a2', agent_type: 'Explore' },
  ]
  const { runs, stillRunning } = subagentRuns(rows)
  assert.deepEqual(runs.map(r => r.duration_s), [88, 152])
  assert.deepEqual(runs.map(r => r.task), ['mapear auth', 'mapear pagos'])
  assert.equal(stillRunning, 0)
})

test('bug 2b: el hook convierte SubagentStart/Stop y el PreToolUse de Agent en filas', () => {
  assert.equal(rowFromHook({ hook_event_name: 'SubagentStart', agent_id: 'x', agent_type: 'tester' })?.event, 'subagent_start')
  assert.equal(rowFromHook({ hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'tester' })?.event, 'subagent_stop')
  const req = rowFromHook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'constructor', description: 'GREEN' } })
  assert.equal(req?.event, 'spawn_request')
  assert.equal(req?.fields.agent_type, 'constructor')
  assert.equal(rowFromHook({ hook_event_name: 'PostToolUse', tool_name: 'Agent' }), null, 'el Post de Agent ya no se usa')
})

test('bug 3: una suite corrida por la tool PowerShell se registra', () => {
  const r = rowFromHook({ hook_event_name: 'PostToolUse', tool_name: 'PowerShell',
    tool_input: { command: 'npm test' }, tool_response: { stdout: 'Tests: 3 failed, 10 passed' } })
  assert.equal(r?.event, 'test_run')
  assert.equal(r?.fields.scope, 'full')
  assert.equal(r?.fields.result, 'RED')
  assert.equal(rowFromHook({ hook_event_name: 'PostToolUse', tool_name: 'PowerShell', tool_input: { command: 'Get-ChildItem' } }), null)
})

test('deteccion de runners y alcance', () => {
  assert.equal(testScope('npm test'), 'full')
  assert.equal(testScope('node --test test/quota.test.ts'), 'targeted')
  assert.equal(testScope('pytest -k slugify'), 'targeted')
  assert.equal(testScope('cd x && npx vitest run src/a.test.ts'), 'targeted')
  assert.equal(testScope('git status'), null)
  assert.equal(testScope('npm run build'), null)
})

test('resultado: 0 failed es GREEN, N failed es RED, exit code manda si viene', () => {
  assert.equal(testResult('Tests: 0 failed, 12 passed'), 'GREEN')
  assert.equal(testResult('2 failed'), 'RED')
  assert.equal(testResult('10 failing'), 'RED')
  assert.equal(testResult('ℹ pass 9\nℹ fail 0'), 'GREEN')
  assert.equal(testResult('ℹ pass 8\nℹ fail 1'), 'RED')
  assert.equal(testResult('todo verde', 1), 'RED')
})

test('resultado desconocido o interrumpido nunca se informa GREEN', () => {
  assert.equal(testResult('sin resumen reconocible'), 'UNKNOWN')
  assert.equal(testResult('10 passed in 0.2s'), 'GREEN')
  const interrupted = rowFromHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: 'npm test' }, tool_response: { stdout: '10 passed', is_error: true } })
  assert.notEqual(interrupted?.fields.result, 'GREEN')
  const repo = tmpRepo()
  record(repo, 'test_run', { scope: 'full', result: 'UNKNOWN' }, 's')
  assert.match(formatReport(repo, 's'), /1 UNKNOWN/)
})

test('delegacion decidida y ciclo de subagente se reportan por separado', () => {
  const rows = [
    { ts: at(0), session_id: 's', event: 'decision', delegation_decision: 'delegated', reason: 'parallelism' },
    { ts: at(1), session_id: 's', event: 'subagent_start', agent_id: 'a1', agent_type: 'tester' },
    { ts: at(2), session_id: 's', event: 'subagent_stop', agent_id: 'a1', agent_type: 'tester' },
  ]
  const s = summarize(rows)
  assert.equal(s.delegated, 1)
  assert.equal(s.runs.length, 1)
})

test('honestidad: sin eventos de la sesion el informe lo dice en vez de reportar cero', () => {
  const repo = tmpRepo()
  record(repo, 'gate', { state: 'BALANCED' }, 'otra')
  const out = formatReport(repo, 'esta-no-existe')
  assert.match(out, /no registro eventos de esta sesion/)
  assert.doesNotMatch(out, /delegaciones Codex\s+0/)
})

test('delegation_decision: las directas se cuentan y se agrupan por motivo', () => {
  const repo = tmpRepo()
  for (const reason of ['already_had_context', 'already_had_context', 'too_small']) {
    record(repo, 'decision', { delegation_decision: 'not_delegated', reason }, 's')
  }
  record(repo, 'friction', { kind: 'rework' }, 's')
  const out = formatReport(repo, 's')
  assert.match(out, /0 delegadas \/ 3 directas/)
  assert.match(out, /already_had_context\s+2/)
  assert.match(out, /3 decisiones directas y 1 rework/)
})

test('el gate que no corrio se ve en el reporte', () => {
  const repo = tmpRepo()
  record(repo, 'decision', { delegation_decision: 'not_delegated', reason: 'too_small' }, 's')
  assert.match(formatReport(repo, 's'), /NO CORRIO/)
  record(repo, 'gate', { state: 'BALANCED' }, 's')
  assert.match(formatReport(repo, 's'), /corrio al arrancar/)
})

test('linea corrupta en el log no rompe el reporte', () => {
  const repo = tmpRepo()
  record(repo, 'gate', {}, 's')
  appendJsonl(logFile(repo), '{no json')
  assert.equal(readRows(repo, 's').rows.length, 1)
})

test('fuera de un repo git no se escribe nada; adentro, el dir se auto-ignora', () => {
  const plain = mkdtempSync(path.join(os.tmpdir(), 'orq-plain-'))
  assert.equal(repoRoot(plain), null)
  const repo = tmpRepo()
  const sub = path.join(repo, 'a', 'b'); mkdirSync(sub, { recursive: true })
  assert.equal(repoRoot(sub), repo)
  ensureStateDir(repo)
  assert.equal(readFileSync(path.join(repo, '.orquestador', '.gitignore'), 'utf8'), '*\n')
  assert.ok(!existsSync(path.join(plain, '.orquestador')))
})

test('un rol llamado como una propiedad de Object se cuenta bien', () => {
  const repo = tmpRepo()
  record(repo, 'delegation', { role: 'constructor', provider: 'codex', status: 'DONE' }, 's')
  const out = formatReport(repo, 's')
  assert.doesNotMatch(out, /native code/)
  assert.match(out, /constructor\s+1/)
})
