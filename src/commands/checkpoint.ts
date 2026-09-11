// Checkpoints y plan con dependencias.
//
// FAST: determinista. Los comandos que el repo declara en orq.config.json, en
//       orden de coste, cortando en la primera falla. Si falla, bloquea.
// DEEP: FAST + review adversarial de otro proveedor. Para auth, pagos,
//       seguridad, concurrencia, migraciones, contratos, arquitectura central.
//       No por defecto: un cambio chico no lo paga.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CHECK_ORDER, loadConfig } from '../core/config.ts'
import { readJson, repoState, writeJson } from '../core/state.ts'
import { record } from '../core/telemetry.ts'
import { ensureStateDir } from './hook.ts'
import { runCommand } from './run.ts'

const TAIL = 20

// Los comandos vienen del orq.config.json del propio repo (mismo limite de
// confianza que los scripts de package.json): se corren con shell a proposito.
function sh(cmd: string, cwd: string): Promise<{ code: number; out: string; secs: number }> {
  const t0 = Date.now()
  return new Promise(resolve => {
    let out = ''
    const c = spawn(cmd, { cwd, shell: true, windowsHide: true })
    c.stdout.on('data', d => { out += d }); c.stderr.on('data', d => { out += d })
    c.on('error', e => resolve({ code: 127, out: String(e), secs: 0 }))
    c.on('close', code => resolve({ code: code ?? 1, out, secs: Math.round((Date.now() - t0) / 100) / 10 }))
  })
}

// Sin checks declarados no se adivina: se sugiere desde package.json y se frena.
function suggest(root: string): string[] {
  const pkg = readJson<{ scripts?: Record<string, string> }>(path.join(root, 'package.json'))
  const s = pkg?.scripts ?? {}
  const map: Record<string, string> = {}
  for (const k of CHECK_ORDER) if (s[k]) map[k] = `npm run ${k}`
  if (s.test) map.test = 'npm test'
  return Object.keys(map).length ? [`Sugerencia para orq.config.json:`, JSON.stringify({ checks: map }, null, 2)] : []
}

export async function fastCheckpoint(root: string): Promise<{ pass: boolean; results: { check: string; code: number; secs: number }[] }> {
  const { checks } = loadConfig(root)
  const results: { check: string; code: number; secs: number }[] = []
  for (const k of CHECK_ORDER) {
    const cmd = checks[k]
    if (!cmd) continue
    const r = await sh(cmd, root)
    results.push({ check: k, code: r.code, secs: r.secs })
    console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${k.padEnd(10)} ${String(r.secs).padStart(6)} s  ${cmd}`)
    if (r.code !== 0) {
      console.log(r.out.trim().split('\n').slice(-TAIL).map(l => `      ${l}`).join('\n'))
      return { pass: false, results } // un typecheck roto invalida lo que sigue
    }
  }
  return { pass: true, results }
}

export async function checkpointCommand(root: string, kind: string | undefined, v: Record<string, any>): Promise<number> {
  if (kind !== 'fast' && kind !== 'deep') { console.log('uso: orq checkpoint fast | deep [--phase <id>] --spec <f> --task <t> [--role security-reviewer] [--blocking]'); return 6 }
  if (kind === 'deep' && (!v.spec || !v.task)) { checkpointPhase(root, v.phase, false); console.log('deep requiere --spec (criterios, invariantes, zonas de riesgo) y --task.'); return 6 }
  const { checks } = loadConfig(root)
  if (!Object.keys(checks).length) {
    checkpointPhase(root, v.phase, false)
    console.log(['Sin checks declarados en orq.config.json: el FAST checkpoint no tiene que correr.', ...suggest(root)].join('\n'))
    return 6
  }
  ensureStateDir(root)
  const fast = await fastCheckpoint(root)
  record(root, 'checkpoint', { kind: 'fast', pass: fast.pass, results: fast.results, task: v.task ?? null, phase: v.phase ?? null })
  if (!fast.pass) { checkpointPhase(root, v.phase, false); console.log('\nFAST checkpoint en RED: bloquea. No avanzar a fases con dependencia hard.'); return 1 }
  console.log('\nFAST checkpoint en verde.')
  if (kind === 'fast') { checkpointPhase(root, v.phase, true); return 0 }

  // DEEP: review adversarial de otro proveedor sobre el cambio ya verde.
  const role = v.role === 'security-reviewer' ? 'security-reviewer' : 'reviewer'
  const code = await runCommand({ role, spec: v.spec, task: v.task, phase: 'review', reason: 'independence', repo: root, background: !v.blocking })
  record(root, 'checkpoint', { kind: 'deep', blocking: !!v.blocking, role, task: v.task, launched: code === 0 })
  checkpointPhase(root, v.phase, code === 0)
  return code
}

function checkpointPhase(root: string, id: unknown, passed: boolean): void {
  if (typeof id !== 'string') return
  const file = path.join(repoState(root), 'plan.json')
  const plan = readJson<{ phases?: Phase[] }>(file)
  if (!plan) { console.log(`Nota: no existe un plan valido en ${file}; no se actualizo la fase "${id}".`); return }
  const phase = plan.phases?.find(p => p.id === id)
  if (!phase) { console.log(`Nota: la fase "${id}" no existe en ${file}; no se actualizo.`); return }
  phase.checkpoint_passed = passed
  writeJson(file, plan)
}

// --- plan.json: fases con dependencias explicitas ---
// { "phases": [ { "id": "p1", "status": "done" },
//               { "id": "p2", "depends_on": { "p1": "hard" }, "checkpoint": "fast" } ] }
export type DepKind = 'hard' | 'soft' | 'independent'
export interface Phase { id: string; title?: string; status?: 'todo' | 'doing' | 'done'; depends_on?: Record<string, DepKind>; checkpoint?: 'fast' | 'deep'; checkpoint_passed?: boolean }

export function analyzePlan(phases: Phase[]): { errors: string[]; order: string[]; ready: string[]; researchOnly: string[]; blocked: string[] } {
  const errors: string[] = []
  const ids = new Set(phases.map(p => p.id))
  if (ids.size !== phases.length) errors.push('ids de fase duplicados')
  for (const p of phases) for (const [d, k] of Object.entries(p.depends_on ?? {})) {
    if (!ids.has(d)) errors.push(`${p.id} depende de "${d}", que no existe`)
    if (!['hard', 'soft', 'independent'].includes(k)) errors.push(`${p.id} -> ${d}: tipo "${k}" invalido (hard|soft|independent)`)
  }
  // Orden topologico (Kahn) sobre hard+soft; independent no ordena.
  const deps = new Map(phases.map(p => [p.id, Object.entries(p.depends_on ?? {}).filter(([d, k]) => k !== 'independent' && ids.has(d)).map(([d]) => d)]))
  const order: string[] = []
  const pending = new Set(ids)
  while (pending.size) {
    const next = [...pending].filter(id => deps.get(id)!.every(d => !pending.has(d)))
    if (!next.length) { errors.push(`ciclo entre: ${[...pending].join(', ')}`); break }
    for (const id of next) { order.push(id); pending.delete(id) }
  }
  const byId = new Map(phases.map(p => [p.id, p]))
  const ready: string[] = [], researchOnly: string[] = [], blocked: string[] = []
  for (const p of phases) {
    if (p.status === 'done') continue
    const d = Object.entries(p.depends_on ?? {})
    const hardOpen = d.some(([id, k]) => {
      const dep = byId.get(id)
      return k === 'hard' && (dep?.status !== 'done' || (!!dep.checkpoint && dep.checkpoint_passed !== true))
    })
    const softOpen = d.some(([id, k]) => k === 'soft' && byId.get(id)?.status !== 'done')
    if (hardOpen) blocked.push(p.id)
    else if (softOpen) researchOnly.push(p.id)
    else ready.push(p.id)
  }
  return { errors, order, ready, researchOnly, blocked }
}

export function planCommand(root: string, sub: string | undefined): number {
  if (sub !== 'check') { console.log('uso: orq plan check'); return 6 }
  const file = path.join(repoState(root), 'plan.json')
  let plan: { phases?: Phase[] }
  try { plan = JSON.parse(readFileSync(file, 'utf8')) } catch (e: any) { console.log(`No se pudo leer ${file}: ${e.message}`); return 6 }
  const a = analyzePlan(plan.phases ?? [])
  if (a.errors.length) { console.log('Plan invalido:\n' + a.errors.map(e => `  - ${e}`).join('\n')); return 1 }
  console.log(`orden        ${a.order.join(' -> ')}`)
  console.log(`listas       ${a.ready.join(', ') || '-'}${a.ready.length > 1 ? '   (sin dependencia abierta: candidatas a PARALLEL si no comparten archivos)' : ''}`)
  console.log(`solo research ${a.researchOnly.join(', ') || '-'}   (soft: preparar, no aplicar cambios definitivos)`)
  console.log(`bloqueadas   ${a.blocked.join(', ') || '-'}   (hard: esperan el checkpoint de su dependencia)`)
  return 0
}
