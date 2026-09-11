// `orq run` de punta a punta contra un Codex falso: resolucion del shim, cuota
// por JSON-RPC, catalogo por tier, exec con schema, y cada modo de falla.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { sandbox, orq } from './helpers.ts'
import { readJsonl } from '../src/core/state.ts'
import { withTaskLock, saveJob, loadJob, type Job } from '../src/core/jobs.ts'
import { publishPid } from '../src/commands/run.ts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const rows = (repo: string) => readJsonl<any>(path.join(repo, '.orquestador', 'decisions.jsonl'))
const base = ['run', '--role', 'constructor', '--reason', 'volume', '--prompt', 'implementar X', '--task', 't1']

test('lock viejo: respeta al duenio vivo, recupera al muerto y no libera un lock ajeno', () => {
  const sb = sandbox()
  const task = 'lock-owner'
  const lock = path.join(sb.repo, '.orquestador', 'jobs', `.lock-${createHash('sha1').update(task).digest('hex').slice(0, 12)}`)
  const owner = path.join(lock, 'owner')
  const stale = new Date(Date.now() - 31_000)

  mkdirSync(lock, { recursive: true })
  writeFileSync(owner, String(process.pid))
  utimesSync(lock, stale, stale)
  assert.throws(() => withTaskLock(sb.repo, task, () => assert.fail('no debe robarlo'), 10), /lock ocupado/)

  writeFileSync(owner, '2147483646')
  utimesSync(lock, stale, stale)
  let ran = false
  withTaskLock(sb.repo, task, () => { ran = true })
  assert.equal(ran, true)
  assert.equal(existsSync(lock), false)

  withTaskLock(sb.repo, task, () => writeFileSync(owner, 'otro-token'))
  assert.equal(existsSync(lock), true, 'el finally no borra un lock que ya no posee')
})

test('ok: exit 0, resultado compacto, fila de delegacion completa', () => {
  const sb = sandbox()
  const argsLog = path.join(sb.home, 'argv.log')
  const r = orq(sb, base, { FAKE_CODEX: 'ok', FAKE_CODEX_LOG: argsLog })
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /Archivos:\n  - src\/a\.ts/)
  assert.match(r.out, /Tests : GREEN via npm test/)
  const d = rows(sb.repo).find(x => x.event === 'delegation')
  assert.equal(d.delegation_decision, 'delegated')
  assert.equal(d.reason, 'volume')
  assert.equal(d.model, 'm-worker', 'constructor = tier worker = rank 2 del catalogo vivo')
  assert.equal(d.session, '01aa0000-0000-7000-8000-000000000001')
  assert.equal(d.session_id, 'TEST-SESSION')
  assert.equal(d.status, 'DONE')
  const execArgs = readFileSync(argsLog, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).find((a: string[]) => a[0] === 'exec')
  assert.ok(execArgs.includes('agents.enabled=false'), 'el worker no abre su propio subloop')
  assert.ok(!execArgs.some((a: string) => a.startsWith('--dangerously')), 'nunca flags de bypass')
  const act = path.join(sb.home, '.orquestador', 'activity')
  assert.ok(!existsSync(act) || readdirSync(act).length === 0, 'BR-009: el heartbeat se borra al terminar')
  assert.equal(readdirSync(path.join(sb.home, '.orquestador', 'logs')).length, 1, 'un log vivo por corrida')
})

test('el stdin del worker lleva el contrato en ingles y la tarea intacta', () => {
  const sb = sandbox()
  const pf = path.join(sb.home, 'prompt.txt')
  orq(sb, [...base.slice(0, -4), '--prompt', 'ruta: src/ñandú.ts', '--task', 't'], { FAKE_CODEX: 'ok', FAKE_CODEX_PROMPT: pf })
  const p = readFileSync(pf, 'utf8')
  assert.match(p, /---- TASK ----\nruta: src\/ñandú\.ts/)
  assert.match(p, /NEEDS_INFO/)
  assert.doesNotMatch(p, /Engram/, 'el runtime no depende de Engram')
})

test('NEEDS_INFO sano: exit 0 y las preguntas agrupadas', () => {
  const sb = sandbox()
  const r = orq(sb, base, { FAKE_CODEX: 'needs-info' })
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /NECESITA INFO/)
  assert.match(r.out, /MySQL o Postgres\?/)
})

test('contrato violado (NEEDS_INFO sin preguntas): exit 4', () => {
  const sb = sandbox()
  const r = orq(sb, base, { FAKE_CODEX: 'contract' })
  assert.equal(r.code, 4)
  assert.match(r.out, /Contrato violado/)
})

test('exit != 0 de codex es fallo aunque haya archivo: exit 4 con la cola de stderr', () => {
  const sb = sandbox()
  const r = orq(sb, base, { FAKE_CODEX: 'fail' })
  assert.equal(r.code, 4)
  assert.match(r.out, /boom: sandbox error/)
  assert.equal(rows(sb.repo).find(x => x.event === 'delegation').exit_code, 3)
})

test('JSON corrupto: se trunca y se dice donde esta el resto', () => {
  const sb = sandbox()
  const r = orq(sb, base, { FAKE_CODEX: 'nojson' })
  assert.equal(r.code, 4)
  assert.match(r.out, /sin JSON valido/)
  assert.match(r.out, /Salida completa en:/)
})

test('review: findings con evidencia y la accion por severidad', () => {
  const sb = sandbox()
  const r = orq(sb, ['run', '--role', 'reviewer', '--reason', 'independence', '--prompt', 'revisar', '--task', 'r'], { FAKE_CODEX: 'review' })
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /\[P1\] src\/a\.ts:3 - race/)
  assert.match(r.out, /evidencia: dos requests concurrentes/)
  assert.match(r.out, /-> interrumpir/)
  assert.equal(rows(sb.repo).find(x => x.event === 'delegation').findings_by_severity.P1, 1)
})

test('NO-GO por cuota: exit 2 y queda registrado como not_delegated/provider_unavailable', () => {
  const sb = sandbox()
  const r = orq(sb, base, { FAKE_CODEX: 'quota-low' })
  assert.equal(r.code, 2, r.out)
  const d = rows(sb.repo).find(x => x.event === 'decision')
  assert.equal(d.delegation_decision, 'not_delegated')
  assert.equal(d.reason, 'provider_unavailable')
})

test('sin sesion ChatGPT: exit 5, nunca cae a API key', () => {
  const sb = sandbox()
  const r = orq(sb, base, { FAKE_CODEX: 'logged-out' })
  assert.equal(r.code, 5)
  assert.match(r.out, /codex login/)
})

test('sin codex instalado: exit 5 y el sistema degrada a Claude-only', () => {
  const sb = sandbox(false)
  const r = orq(sb, base)
  assert.equal(r.code, 5)
  assert.match(r.out, /no esta instalado/)
  const b = orq(sb, ['budget'])
  assert.equal(b.code, 2)
  assert.match(b.out, /NO-GO - Codex no esta instalado/)
})

test('uso: sin --reason no se delega (la delegacion tiene que justificarse)', () => {
  const sb = sandbox()
  const r = orq(sb, ['run', '--role', 'constructor', '--prompt', 'x'])
  assert.equal(r.code, 6)
  assert.match(r.out, /--reason requerido/)
  assert.equal(orq(sb, ['run', '--role', 'nope', '--reason', 'volume', '--prompt', 'x']).code, 6)
})

test('resume de una sesion inexistente: exit 3 (REUSE-DENIED)', () => {
  const sb = sandbox()
  assert.equal(orq(sb, [...base, '--resume', 'no-existe']).code, 3)
})

test('--background solo para roles read-only', () => {
  const sb = sandbox()
  const r = orq(sb, [...base, '--background'])
  assert.equal(r.code, 6)
  assert.match(r.out, /read-only/)
})

test('ASYNC_REVIEW: el segundo reviewer de la misma tarea se RECHAZA (exit 7); otra tarea no', async () => {
  const sb = sandbox()
  const rv = ['run', '--role', 'reviewer', '--reason', 'independence', '--prompt', 'revisar', '--background']
  const env = { FAKE_CODEX: 'slow' }
  const first = orq(sb, [...rv, '--task', 'pago'], env)
  assert.equal(first.code, 0, first.out)
  const id = first.out.match(/Job (\S+) lanzado/)![1]
  const second = orq(sb, [...rv, '--task', 'pago'], env)
  assert.equal(second.code, 7, second.out)
  assert.match(second.out, /RECHAZADO/)
  assert.match(second.out, new RegExp(id))
  assert.equal(orq(sb, [...rv, '--role', 'security-reviewer', '--task', 'pago'], env).code, 7, 'otro rol reviewer, misma tarea: tambien')
  assert.equal(orq(sb, [...rv, '--task', 'otra-tarea'], env).code, 0, 'otra tarea tiene su propio cupo')
  // El job termina solo y queda con su resultado.
  for (let i = 0; i < 40; i++) {
    const j = orq(sb, ['jobs', id])
    if (/- done/.test(j.out)) { assert.match(j.out, /Sin findings/); return }
    await new Promise(r => setTimeout(r, 500))
  }
  assert.fail('el job en background nunca termino')
})

test('review: 8 lanzamientos simultaneos del mismo reviewer -> exactamente 1 admitido', async () => {
  const sb = sandbox()
  const { spawn } = await import('node:child_process')
  const { CLI } = await import('./helpers.ts')
  const launch = () => new Promise<number>(resolve => {
    const c = spawn(process.execPath, [CLI, 'run', '--role', 'reviewer', '--reason', 'independence', '--prompt', 'r', '--background', '--task', 'race'],
      { cwd: sb.repo, env: { ...sb.env, FAKE_CODEX: 'slow' }, stdio: 'ignore' })
    c.on('close', code => resolve(code ?? -1))
  })
  const codes = await Promise.all(Array.from({ length: 8 }, launch))
  assert.equal(codes.filter(c => c === 0).length, 1, `codigos: ${codes.join(',')}`)
  assert.equal(codes.filter(c => c === 7).length, 7, `codigos: ${codes.join(',')}`)
})

test('review: payload malformado (reviewer devuelve {}) es contrato violado, no un crash', () => {
  const sb = sandbox()
  const r = orq(sb, ['run', '--role', 'reviewer', '--reason', 'independence', '--prompt', 'x', '--task', 'm'], { FAKE_CODEX: 'malformed' })
  assert.equal(r.code, 4, r.out)
  assert.match(r.out, /Contrato violado/)
  assert.match(r.out, /\$\.findings: falta/)
})

test('launcher: publicar el PID no pisa un job que el hijo ya cerro', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'orq-pid-'))
  const job: Job = { id: 'j1', pid: null, role: 'reviewer', task: 't', status: 'running', started: new Date().toISOString() }
  saveJob(repo, { ...job, status: 'done', exit_code: 0 })
  publishPid(repo, job, 1234)
  assert.equal(loadJob(repo, 'j1')?.status, 'done')
  // Si el hijo sigue corriendo, el PID se publica.
  saveJob(repo, job)
  publishPid(repo, job, 1234)
  assert.equal(loadJob(repo, 'j1')?.pid, 1234)
})
