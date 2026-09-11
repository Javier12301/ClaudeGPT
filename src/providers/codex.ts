// Proveedor Codex: el port de Orquestador/scripts/codex-run.ps1.
//
// Resuelve modelos por tier contra el catalogo vivo (nunca un slug fijo), lee
// la cuota por JSON-RPC, ejecuta `codex exec` con el contrato forzado por JSON
// Schema, y devuelve un resultado compacto. Stateless por corrida (D-016).
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { IS_WIN, killTree, resolveCommand, run, type Command } from '../core/proc.ts'
import { codexHome, orqHome, readJson, writeJson } from '../core/state.ts'
import { ROLES, SCHEMAS, assertNoBypass, statusInvariant, validate, workerPrompt, type Role } from '../core/contracts.ts'
import type { CodexRateLimits } from '../core/quota.ts'

export const REUSE_FREE_KB = 400    // por debajo: reusar sin dudar (BR-004)
export const REUSE_LIMIT_KB = 1200  // por encima: sesion nueva obligatoria (BR-005)
export const RPC_TIMEOUT_MS = 15_000 // BR-007
export const EXEC_TIMEOUT_MS = 30 * 60_000
export const MAX_RAW_LINES = 20     // BR-006

export const resolveCodex = (): Command | null => resolveCommand('codex')

export async function codexInfo(cmd = resolveCodex()) {
  if (!cmd) return { installed: false, version: null as string | null, auth: 'missing' as const }
  const v = await run(cmd, ['--version'], { timeoutMs: 30_000 })
  // `codex login status` escribe en stderr, no en stdout.
  const a = await run(cmd, ['login', 'status'], { timeoutMs: 30_000 })
  const text = `${a.stdout}\n${a.stderr}`
  const auth = a.code === 0 && /logged in/i.test(text)
    ? (/chatgpt/i.test(text) ? 'chatgpt' as const : 'api-key' as const)
    : 'none' as const
  return { installed: true, version: v.stdout.trim().split(/\s+/).pop() ?? null, auth }
}

// JSON-RPC por stdio contra `codex app-server`: initialize -> initialized ->
// account/rateLimits/read. Nunca rechaza: sin respuesta devuelve null.
export function fetchCodexQuota(cmd = resolveCodex(), timeoutMs = RPC_TIMEOUT_MS): Promise<CodexRateLimits | null> {
  if (!cmd) return Promise.resolve(null)
  return new Promise(resolve => {
    let buf = '', done = false
    const child = spawn(cmd.file, [...cmd.prefix, 'app-server'], { windowsHide: true, detached: !IS_WIN, stdio: ['pipe', 'pipe', 'ignore'] })
    const finish = (v: CodexRateLimits | null) => {
      if (done) return
      done = true; clearTimeout(timer)
      killTree(child.pid)
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    const send = (m: object) => { try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n') } catch { finish(null) } }
    child.on('error', () => finish(null))
    child.on('close', () => finish(null))
    child.stdin.on('error', () => finish(null))
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buf += chunk
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1)
        let msg: any
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.id === 1) {
          send({ method: 'initialized', params: {} })
          send({ id: 2, method: 'account/rateLimits/read', params: {} })
        } else if (msg.id === 2) finish(msg.result ?? null)
      }
    })
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'orq', title: 'orq', version: '2' } } })
  })
}

// Cache de cuota de Codex para la statusline (el RPC tarda 1-2 s y la statusline
// se renderiza en cada turno: nunca puede esperarlo).
export const codexUsageFile = (): string => path.join(orqHome(), 'codex-usage.json')
export async function refreshCodexUsageCache(): Promise<void> {
  const res = await fetchCodexQuota()
  writeJson(codexUsageFile(), { ts: new Date().toISOString(), res })
}

// --- modelos por tier (D-005) ---
export interface CatalogModel { slug: string; priority: number; visibility?: string
  default_reasoning_level?: string; supported_reasoning_levels?: { effort: string }[] }

export function pickModel(catalog: CatalogModel[], tier: 'lead' | 'worker' | 'cheap', effort?: string) {
  const list = catalog.filter(m => m.visibility === 'list').sort((a, b) => a.priority - b.priority)
  if (!list.length) throw new Error('El catalogo de modelos de Codex vino vacio.')
  const idx = Math.min({ lead: 0, worker: 1, cheap: 2 }[tier], list.length - 1)
  const m = list[idx]
  const supported = (m.supported_reasoning_levels ?? []).map(l => l.effort)
  const eff = effort && supported.includes(effort) ? effort : (m.default_reasoning_level ?? effort ?? 'medium')
  return { slug: m.slug, effort: eff }
}

export async function modelCatalog(cmd: Command): Promise<CatalogModel[]> {
  const r = await run(cmd, ['debug', 'models'], { timeoutMs: 60_000 })
  if (r.code !== 0) throw new Error(`No se pudo leer el catalogo de modelos: ${r.stderr.trim().slice(0, 200)}`)
  const d = JSON.parse(r.stdout)
  return Array.isArray(d) ? d : d.models
}

// --- roles: ~/.codex/agents/<rol>.toml es la fuente de verdad del prompt ---
export function roleConfig(role: Role) {
  const f = path.join(codexHome(), 'agents', `${role}.toml`)
  let raw: string
  try { raw = readFileSync(f, 'utf8') } catch { throw new Error(`Falta el rol '${role}' en ${f}. Corre: orq init`) }
  const instructions = raw.match(/developer_instructions\s*=\s*"""([\s\S]*?)"""/)?.[1].trim() ?? ''
  const effort = raw.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1] ?? 'medium'
  const sandbox = raw.match(/^\s*sandbox_mode\s*=\s*"([^"]+)"/m)?.[1] ?? 'read-only'
  return { instructions, effort, sandbox }
}

// --- sesiones y reuso (BR-004/005) ---
function walk(dir: string, match: (name: string) => boolean, out: string[] = []): string[] {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, match, out)
    else if (match(e.name)) out.push(p)
  }
  return out
}

export type ReuseVerdict = 'REUSE-OK' | 'REUSE-IF-DIRECT' | 'REUSE-DENIED'
export function sessionDetail(id: string) {
  const f = walk(path.join(codexHome(), 'sessions'), n => n.endsWith('.jsonl') && n.includes(id))[0]
  if (!f) return null
  const kb = Math.round(statSync(f).size / 1024)
  const verdict: ReuseVerdict = kb < REUSE_FREE_KB ? 'REUSE-OK' : kb <= REUSE_LIMIT_KB ? 'REUSE-IF-DIRECT' : 'REUSE-DENIED'
  return { id, path: f, kb, verdict }
}

// --- senal de vida (D-015 / BR-009): existe solo mientras corre ---
// Un archivo por corrida (por PID): con ASYNC_REVIEW puede haber un reviewer en
// background y un constructor en primer plano a la vez, y ninguno puede pisar
// ni borrar la senal del otro.
export const activityDir = (): string => path.join(orqHome(), 'activity')
export const logsDir = (): string => path.join(orqHome(), 'logs')
export const LOGS_KEEP = 20

// Log vivo de una corrida: uno por corrida, se conservan los ultimos LOGS_KEEP.
export function newLiveLog(role: string): string {
  mkdirSync(logsDir(), { recursive: true })
  const old = readdirSync(logsDir()).filter(n => n.endsWith('.log')).sort()
  for (const n of old.slice(0, Math.max(0, old.length - LOGS_KEEP + 1))) rmSync(path.join(logsDir(), n), { force: true })
  return path.join(logsDir(), `${new Date().toISOString().replace(/[:.]/g, '-')}-${role}-${process.pid}.log`)
}

export interface Activity { role: string; phase: string; started: string; last_event: string; items: number; pid: number }
export function activeRuns(freshMs = 90_000): Activity[] {
  let names: string[] = []
  try { names = readdirSync(activityDir()).filter(n => n.endsWith('.json')) } catch { return [] }
  return names.flatMap(n => {
    const f = path.join(activityDir(), n)
    try { if (Date.now() - statSync(f).mtimeMs >= freshMs) return [] } catch { return [] }
    const a = readJson<Activity>(f)
    return a ? [a] : []
  }).sort((a, b) => b.started.localeCompare(a.started))
}

export function eventType(line: string): string {
  return line.match(/"type"\s*:\s*"([A-Za-z_]+)"/)?.[1] ?? ''
}

export function heartbeat(role: string, phase: string) {
  const file = path.join(activityDir(), `${process.pid}.json`)
  const started = new Date().toISOString()
  let items = 0, last = 0, lastEv = 'iniciando'
  const write = (ev: string, force = false) => {
    if (!ev) return
    lastEv = ev
    if (ev === 'item_completed') items++
    if (!force && Date.now() - last < 1000) return
    last = Date.now()
    try { writeJson(file, { role, phase, started, last_event: ev, items, pid: process.pid }) } catch { /* no critico */ }
  }
  write('iniciando', true)
  // Un razonamiento largo puede no emitir eventos por minutos: la senal se
  // renueva por tiempo para no desaparecer de la statusline mientras corre.
  const timer = setInterval(() => write(lastEv, true), 30_000)
  timer.unref()
  return { write, stop: () => { clearInterval(timer); try { unlinkSync(file) } catch { /* ya no estaba */ } } }
}

// --- ejecucion ---
export interface ExecOptions {
  role: Role
  prompt: string
  repo: string
  resume?: string
  phase?: string
  ephemeral?: boolean
  liveLog?: string
  timeoutMs?: number
}

export type ExecOutcome =
  | { kind: 'ok'; payload: any; sessionId: string | null; model: string; effort: string; sandbox: string; exitCode: 0 }
  | { kind: 'failed'; exitCode: number; stderrTail: string; sessionId: string | null; model: string; effort: string; sandbox: string }
  | { kind: 'contract'; payload: any; why: string; outFile: string; sessionId: string | null; model: string; effort: string; sandbox: string }
  | { kind: 'raw'; head: string; outFile: string; sessionId: string | null; model: string; effort: string; sandbox: string }

export async function execCodex(cmd: Command, o: ExecOptions): Promise<ExecOutcome> {
  const role = ROLES[o.role]
  const cfg = roleConfig(o.role)
  const model = pickModel(await modelCatalog(cmd), role.tier, cfg.effort)
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'orq-codex-'))
  const schemaFile = path.join(tmp, 'schema.json')
  const outFile = path.join(tmp, 'last-message.json')
  writeFileSync(schemaFile, JSON.stringify(SCHEMAS[role.schema])) // sin BOM por construccion

  // `codex exec resume` NO acepta -C ni -s: hereda cwd y sandbox de la sesion.
  const args = o.resume ? ['exec', 'resume', o.resume] : ['exec', '-C', o.repo, '-s', cfg.sandbox]
  args.push(
    '-m', model.slug,
    '-c', `model_reasoning_effort=${model.effort}`,
    '-c', 'agents.enabled=false', // un solo razonador: el worker no abre su propio subloop
    '--output-schema', schemaFile,
    '-o', outFile,
    '--json',
    '--skip-git-repo-check',
  )
  if (o.ephemeral && !o.resume) args.push('--ephemeral')
  args.push('-') // el prompt entra por stdin
  assertNoBypass(args)

  // El stream --json va a disco, nunca al contexto del razonador (D-015).
  if (o.liveLog) { mkdirSync(path.dirname(o.liveLog), { recursive: true }); writeFileSync(o.liveLog, '') }
  const hb = heartbeat(o.role, o.phase ?? '')
  let r
  try {
    r = await run(cmd, args, {
      cwd: o.repo,
      input: workerPrompt(cfg.instructions, role.schema, o.prompt),
      timeoutMs: o.timeoutMs ?? EXEC_TIMEOUT_MS,
      onLine: line => {
        hb.write(eventType(line))
        if (o.liveLog) { try { appendFileSync(o.liveLog, line + '\n') } catch { /* no critico */ } }
      },
    })
  } finally {
    hb.stop()
  }

  // El id sale de los eventos --json (autoritativo).
  const sessionId = o.resume
    ?? r.stdout.match(/"(?:session_id|sessionId|thread_id|threadId)"\s*:\s*"([0-9a-fA-F-]{36})"/)?.[1]
    ?? null
  const meta = { sessionId, model: model.slug, effort: model.effort, sandbox: cfg.sandbox }

  // Un exit != 0 es fallo aunque haya quedado JSON en -o (BR-011).
  if (r.code !== 0) {
    rmSync(tmp, { recursive: true, force: true })
    return { kind: 'failed', exitCode: r.code, stderrTail: r.stderr.trim().split('\n').slice(-5).join('\n'), ...meta }
  }
  let raw = ''
  try { raw = readFileSync(outFile, 'utf8') } catch { /* sin archivo */ }
  let payload: any = null
  try { payload = JSON.parse(raw) } catch { /* sin JSON valido */ }
  rmSync(schemaFile, { force: true })
  if (payload == null) {
    return { kind: 'raw', head: raw.split('\n').slice(0, MAX_RAW_LINES).join('\n'), outFile, ...meta }
  }
  // Estructura contra el schema del rol, y despues la invariante de status (BR-011).
  const why = validate(SCHEMAS[role.schema], payload) ?? (statusInvariant(payload) ? null : `status='${payload.status}' blocked=${!!payload.blocked} clarifications=${(payload.clarifications ?? []).length} (D-016)`)
  if (why) return { kind: 'contract', payload, why, outFile, ...meta }
  rmSync(tmp, { recursive: true, force: true })
  return { kind: 'ok', payload, exitCode: 0, ...meta }
}

export function readCodexUsageCache(): { ts: string; res: CodexRateLimits | null } | null {
  return readJson(codexUsageFile())
}
