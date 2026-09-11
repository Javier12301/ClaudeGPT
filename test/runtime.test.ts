// Plan con dependencias, worktrees, checkpoints, code intel nativo y las piezas
// puras del proveedor Codex.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { analyzePlan } from '../src/commands/checkpoint.ts'
import { loadConfig } from '../src/core/config.ts'
import { native } from '../src/commands/codeintel.ts'
import { activityDir, heartbeat, pickModel, eventType, sessionDetail, REUSE_FREE_KB, REUSE_LIMIT_KB } from '../src/providers/codex.ts'
import { statusInvariant, SCHEMAS, assertNoBypass, ROLES } from '../src/core/contracts.ts'
import { sandbox, orq } from './helpers.ts'

const git = (cwd: string, ...a: string[]) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' })

test('heartbeat renueva la actividad cada 30 s aunque no haya eventos', () => {
  const sb = sandbox()
  const prev = process.env.ORQ_HOME
  process.env.ORQ_HOME = sb.env.ORQ_HOME
  mock.timers.enable({ apis: ['Date', 'setInterval'], now: new Date('2026-09-10T12:00:00Z') })
  let hb: ReturnType<typeof heartbeat> | undefined
  try {
    hb = heartbeat('reviewer', 'review')
    const file = path.join(activityDir(), `${process.pid}.json`)
    writeFileSync(file, 'viejo')
    mock.timers.tick(30_000)
    const activity = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(activity.last_event, 'iniciando')
    assert.equal(activity.role, 'reviewer')
  } finally {
    hb?.stop()
    mock.timers.reset()
    process.env.ORQ_HOME = prev
  }
})

test('plan: orden, listas, solo-research y bloqueadas segun hard/soft/independent', () => {
  const a = analyzePlan([
    { id: 'p1', status: 'done', checkpoint: 'fast', checkpoint_passed: true },
    { id: 'p2', depends_on: { p1: 'hard' } },
    { id: 'p3', depends_on: { p1: 'hard', p2: 'hard' } },
    { id: 'p4', depends_on: { p2: 'soft' } },
    { id: 'p5', depends_on: { p2: 'independent' } },
  ])
  assert.deepEqual(a.errors, [])
  assert.equal(a.order[0], 'p1')
  assert.ok(a.order.indexOf('p2') < a.order.indexOf('p3'))
  assert.deepEqual(a.ready.sort(), ['p2', 'p5'])
  assert.deepEqual(a.researchOnly, ['p4'])
  assert.deepEqual(a.blocked, ['p3'])
})

test('plan: hard exige done y checkpoint aprobado cuando la dependencia lo declara', () => {
  assert.deepEqual(analyzePlan([
    { id: 'p1', status: 'done', checkpoint: 'fast' },
    { id: 'p2', depends_on: { p1: 'hard' } },
  ]).blocked, ['p2'])
})

test('config: maxConcurrent invalido cae al default seguro', () => {
  for (const value of ['abc', 0, -1, 1.5]) {
    const sb = sandbox()
    writeFileSync(path.join(sb.repo, 'orq.config.json'), JSON.stringify({ asyncReview: { maxConcurrent: value } }))
    assert.equal(loadConfig(sb.repo).asyncReview.maxConcurrent, 1)
  }
})

test('plan: ciclos, dependencias inexistentes y tipos invalidos', () => {
  assert.match(analyzePlan([{ id: 'a', depends_on: { b: 'hard' } }, { id: 'b', depends_on: { a: 'hard' } }]).errors.join(), /ciclo/)
  assert.match(analyzePlan([{ id: 'a', depends_on: { x: 'hard' } }]).errors.join(), /no existe/)
  assert.match(analyzePlan([{ id: 'a' }, { id: 'b', depends_on: { a: 'maybe' as any } }]).errors.join(), /invalido/)
})

test('worktree: crear, detectar existente, negarse a borrar con cambios, limpiar', () => {
  const sb = sandbox()
  writeFileSync(path.join(sb.repo, 'a.txt'), 'x'); git(sb.repo, 'add', '.'); git(sb.repo, 'commit', '-qm', 'base')
  const add = orq(sb, ['worktree', 'add', 'modulo-b'])
  assert.equal(add.code, 0, add.out)
  const dir = path.join(path.dirname(sb.repo), 'repo.wt', 'modulo-b')
  assert.ok(existsSync(path.join(dir, 'a.txt')))
  assert.match(orq(sb, ['worktree', 'add', 'modulo-b']).out, /ya existe/)
  assert.match(orq(sb, ['worktree', 'list']).out, /orq\/modulo-b/)
  writeFileSync(path.join(dir, 'b.txt'), 'wip')
  const refused = orq(sb, ['worktree', 'remove', 'modulo-b'])
  assert.equal(refused.code, 1)
  assert.match(refused.out, /sin commitear/)
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'wip')
  const rm = orq(sb, ['worktree', 'remove', 'modulo-b'])
  assert.equal(rm.code, 0, rm.out)
  assert.match(rm.out, /se conserva: tiene commits sin integrar/, 'nunca se pierde trabajo ni se mergea solo')
  assert.equal(orq(sb, ['worktree', 'add', '../escape']).code, 6, 'nombre con path traversal rechazado')
})

test('checkpoint fast: corta en la primera falla y bloquea; sin checks, sugiere y no adivina', () => {
  const sb = sandbox()
  writeFileSync(path.join(sb.repo, 'package.json'), JSON.stringify({ scripts: { test: 'node -e 1', lint: 'node -e 1' } }))
  const none = orq(sb, ['checkpoint', 'fast'])
  assert.equal(none.code, 6)
  assert.match(none.out, /Sugerencia/)
  writeFileSync(path.join(sb.repo, 'orq.config.json'), JSON.stringify({ checks: {
    lint: 'node -e "process.exit(0)"', typecheck: 'node -e "console.log(\'TS2322 boom\'); process.exit(2)"', test: 'node -e "process.exit(0)"' } }))
  const r = orq(sb, ['checkpoint', 'fast'])
  assert.equal(r.code, 1)
  assert.match(r.out, /PASS  lint/)
  assert.match(r.out, /FAIL  typecheck/)
  assert.match(r.out, /TS2322 boom/)
  assert.doesNotMatch(r.out, /PASS  test/, 'no corre lo que el typecheck roto invalida')
  const row = readFileSync(path.join(sb.repo, '.orquestador', 'decisions.jsonl'), 'utf8')
  assert.match(row, /"event":"checkpoint".*"pass":false/)
})

test('checkpoint --phase persiste el resultado sin fallar si el plan o la fase no existen', () => {
  const sb = sandbox()
  writeFileSync(path.join(sb.repo, 'orq.config.json'), JSON.stringify({ checks: { test: 'node -e "process.exit(0)"' } }))
  mkdirSync(path.join(sb.repo, '.orquestador'), { recursive: true })
  writeFileSync(path.join(sb.repo, '.orquestador', 'plan.json'), JSON.stringify({ phases: [{ id: 'p1', checkpoint: 'fast' }] }))
  const ok = orq(sb, ['checkpoint', 'fast', '--phase', 'p1'])
  assert.equal(ok.code, 0, ok.out)
  assert.equal(JSON.parse(readFileSync(path.join(sb.repo, '.orquestador', 'plan.json'), 'utf8')).phases[0].checkpoint_passed, true)
  writeFileSync(path.join(sb.repo, 'orq.config.json'), JSON.stringify({ checks: { test: 'node -e "process.exit(1)"' } }))
  const fail = orq(sb, ['checkpoint', 'fast', '--phase', 'p1'])
  assert.equal(fail.code, 1, fail.out)
  assert.equal(JSON.parse(readFileSync(path.join(sb.repo, '.orquestador', 'plan.json'), 'utf8')).phases[0].checkpoint_passed, false)
  const absent = orq(sb, ['checkpoint', 'fast', '--phase', 'otra'])
  assert.equal(absent.code, 1, absent.out)
  assert.match(absent.out, /fase "otra" no existe/)
})

test('code intel native: simbolos, referencias, impacto y tests relacionados con solo git', async () => {
  const sb = sandbox()
  mkdirSync(path.join(sb.repo, 'src')); mkdirSync(path.join(sb.repo, 'test'))
  writeFileSync(path.join(sb.repo, 'src', 'slug.ts'), 'export function slugify(s: string) { return s }\n')
  writeFileSync(path.join(sb.repo, 'src', 'page.ts'), "import { slugify } from './slug'\nslugify('a')\n")
  writeFileSync(path.join(sb.repo, 'test', 'slug.test.ts'), "import { slugify } from '../src/slug'\n")
  git(sb.repo, 'add', '.')
  const s = await native.symbols(sb.repo, 'slugify')
  assert.deepEqual(s.map(x => `${x.file}:${x.line}`), ['src/slug.ts:1'])
  assert.equal((await native.refs(sb.repo, 'slugify')).length, 4)
  const i = await native.impact(sb.repo, ['src/slug.ts'])
  assert.deepEqual(i.dependents, ['src/page.ts'])
  assert.deepEqual(i.tests, ['test/slug.test.ts'])
  assert.match(await native.orient(sb.repo), /3 archivos trackeados/)
})

test('pickModel: tiers por posicion, degradan si faltan modelos, effort validado', () => {
  const cat = [
    { slug: 'c', priority: 3, visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low' }] },
    { slug: 'a', priority: 1, visibility: 'list', default_reasoning_level: 'high', supported_reasoning_levels: [{ effort: 'high' }] },
    { slug: 'b', priority: 2, visibility: 'list', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'medium' }, { effort: 'high' }] },
    { slug: 'x', priority: 0, visibility: 'hide' },
  ]
  assert.equal(pickModel(cat, 'lead').slug, 'a')
  assert.equal(pickModel(cat, 'worker').slug, 'b')
  assert.equal(pickModel(cat, 'cheap').slug, 'c')
  assert.equal(pickModel([cat[1]], 'cheap').slug, 'a', 'degrada al unico modelo')
  assert.equal(pickModel(cat, 'lead', 'low').effort, 'high', 'effort no soportado cae al default')
  assert.equal(pickModel(cat, 'worker', 'high').effort, 'high')
  assert.throws(() => pickModel([], 'lead'))
})

test('sessionDetail: umbrales de reuso por tamano del rollout', () => {
  const sb = sandbox()
  const day = path.join(sb.env.CODEX_HOME!, 'sessions', '2026', '09', '10')
  mkdirSync(day, { recursive: true })
  const make = (id: string, kb: number) => writeFileSync(path.join(day, `rollout-x-${id}.jsonl`), 'x'.repeat(kb * 1024))
  make('small', REUSE_FREE_KB - 1); make('mid', REUSE_FREE_KB + 1); make('big', REUSE_LIMIT_KB + 1)
  const prev = process.env.CODEX_HOME
  process.env.CODEX_HOME = sb.env.CODEX_HOME
  try {
    assert.equal(sessionDetail('small')?.verdict, 'REUSE-OK')
    assert.equal(sessionDetail('mid')?.verdict, 'REUSE-IF-DIRECT')
    assert.equal(sessionDetail('big')?.verdict, 'REUSE-DENIED')
    assert.equal(sessionDetail('nada'), null)
  } finally { process.env.CODEX_HOME = prev }
})

test('eventType tolera lineas raras', () => {
  assert.equal(eventType('{"type":"item_completed","item":{"type":"x"}}'), 'item_completed')
  assert.equal(eventType('no json'), '')
  assert.equal(eventType(''), '')
})

test('contratos: invariante de status (BR-011) y schemas', () => {
  assert.ok(statusInvariant(null))
  assert.ok(statusInvariant({ findings: [] }), 'payload no-impl no aplica')
  assert.ok(statusInvariant({ status: 'DONE', blocked: false, clarifications: [] }))
  assert.ok(!statusInvariant({ status: 'DONE', blocked: false, clarifications: [1] }))
  assert.ok(statusInvariant({ status: 'NEEDS_INFO', blocked: false, clarifications: [1] }))
  assert.ok(!statusInvariant({ status: 'NEEDS_INFO', blocked: false, clarifications: [] }))
  assert.ok(!statusInvariant({ status: 'NEEDS_INFO', blocked: true, clarifications: [1] }))
  assert.ok(statusInvariant({ status: 'BLOCKED', blocked: true, clarifications: [] }))
  assert.ok(!statusInvariant({ status: 'BLOCKED', blocked: false, clarifications: [] }))
  const review: any = SCHEMAS.review
  assert.ok(review.properties.findings.items.required.includes('evidence'), 'el reviewer tiene que traer evidencia')
  for (const r of Object.values(ROLES)) assert.ok(SCHEMAS[r.schema])
})

test('ningun flag de bypass puede colarse en los args de codex', () => {
  assert.throws(() => assertNoBypass(['exec', '--dangerously-bypass-approvals-and-sandbox']))
  assert.throws(() => assertNoBypass(['--ignore-rules']))
  assert.doesNotThrow(() => assertNoBypass(['exec', '-s', 'danger-full-access']))
})

test('validate: estructura contra los schemas del runtime', async () => {
  const { validate } = await import('../src/core/contracts.ts')
  const ok = { findings: [{ severity: 'P1', file: 'a', line: 1, problem: 'p', impact: 'i', evidence: 'e', suggested_fix: 'f' }], coverage_note: 'c' }
  assert.equal(validate(SCHEMAS.review, ok), null)
  assert.match(validate(SCHEMAS.review, {})!, /findings: falta/)
  assert.match(validate(SCHEMAS.review, { ...ok, extra: 1 })!, /no permitida/)
  assert.match(validate(SCHEMAS.review, { ...ok, findings: [{ ...ok.findings[0], severity: 'P9' }] })!, /no esta en/)
  assert.match(validate(SCHEMAS.review, { ...ok, findings: [{ ...ok.findings[0], line: '3' }] })!, /entero/)
})
