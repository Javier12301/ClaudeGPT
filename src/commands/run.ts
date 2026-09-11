// `orq run`: delegacion a Codex. Reemplaza a codex-run.ps1 -Role.
//
// Exit codes (los mismos que el wrapper PowerShell, mas uno):
//   0 ok | 2 NO-GO cuota | 3 REUSE-DENIED | 4 fallo de Codex o contrato violado
//   5 Codex ausente o sin autenticar | 6 error de uso | 7 reviewer ya activo
import { spawn } from 'node:child_process'
import { openSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROLES, SEVERITY_ACTION, type Role, type ReviewPayload } from '../core/contracts.ts'
import { budget, formatBudget } from '../core/quota.ts'
import { record, DELEGATED } from '../core/telemetry.ts'
import { loadConfig } from '../core/config.ts'
import { activeJobs, isAlive, jobsDir, listJobs, loadJob, newJobId, saveJob, withTaskLock, type Job } from '../core/jobs.ts'
import { readClaudeUsage } from '../providers/claude.ts'
import { codexInfo, execCodex, fetchCodexQuota, newLiveLog, resolveCodex, sessionDetail, REUSE_LIMIT_KB, type ExecOutcome } from '../providers/codex.ts'
import { ensureStateDir, repoRoot } from './hook.ts'

export interface RunArgs {
  role?: string; spec?: string; prompt?: string; repo?: string; task?: string
  phase?: string; reason?: string; resume?: string; 'retry-of'?: string; 'clarify-of'?: string
  ephemeral?: boolean; background?: boolean; job?: string
}

const fail = (code: number, ...msg: string[]): number => { console.log(msg.join('\n')); return code }

// El resultado que ve el razonador: 10-20 lineas, nunca el codigo.
export function renderOutcome(role: Role, o: ExecOutcome): string[] {
  const L: string[] = []
  if (o.kind === 'failed') {
    L.push(`== Codex FALLO (exit ${o.exitCode}) ==`, o.stderrTail, 'El trabajo parcial (si lo hay) quedo en el working tree: revisar con git diff.')
  } else if (o.kind === 'contract') {
    L.push('== Contrato violado ==', o.why, `Salida completa en: ${o.outFile}`)
  } else if (o.kind === 'raw') {
    L.push(`(sin JSON valido; primeras lineas)`, o.head, `Salida completa en: ${o.outFile}`)
  } else {
    const p = o.payload
    L.push(`== Resultado (${role}) ==`)
    if (ROLES[role].schema === 'impl') {
      if (p.status === 'NEEDS_INFO') {
        L.push('== NECESITA INFO ==')
        for (const c of p.clarifications) {
          L.push(`  - Falta      : ${c.missing_fact}`, `    Pregunta   : ${c.question}`, `    Decision   : ${c.affected_decision}`, `    Verificado : ${c.evidence_checked.join('; ')}`)
        }
      } else if (p.status === 'BLOCKED') {
        L.push(`BLOQUEADO: ${p.summary}`)
      } else {
        L.push('Archivos:', ...p.files_changed.map((f: string) => `  - ${f}`), `Cambio: ${p.summary}`, `Tests : ${p.tests.status} via ${p.tests.command}`)
      }
      if (p.risks?.length) L.push('Riesgos:', ...p.risks.map((r: string) => `  - ${r}`))
    } else if (ROLES[role].schema === 'review') {
      const r = p as ReviewPayload
      if (!r.findings.length) L.push(`Sin findings. ${r.coverage_note}`)
      for (const f of r.findings) {
        L.push(`[${f.severity}] ${f.file}:${f.line} - ${f.problem}`, `     impacto: ${f.impact}`, `     evidencia: ${f.evidence}`, `     fix: ${f.suggested_fix}`, `     -> ${SEVERITY_ACTION[f.severity]}`)
      }
      if (r.findings.length) L.push(`Cobertura: ${r.coverage_note}`, 'Arbitraje: verificar cada finding contra el codigo; registrar con orq metrics --finding accepted|rejected.')
    } else {
      L.push(`Conclusion: ${p.conclusion}`, `Version   : ${p.api_version}`, `Fuente    : ${p.source}`, `Implica   : ${p.implication}`)
    }
  }
  if (o.sessionId) {
    const d = sessionDetail(o.sessionId)
    L.push('', `Sesion: ${o.sessionId}${d ? ` (${d.kb} KB, ${d.verdict})` : ''}`)
  }
  return L
}

// Se relee antes de escribir el PID: si el hijo ya termino y cerro el job, su
// estado final no se pisa con la foto vieja de 'running'.
export function publishPid(repo: string, job: Job, pid: number | null): void {
  const cur = loadJob(repo, job.id)
  saveJob(repo, cur && cur.status !== 'running' ? cur : { ...(cur ?? job), pid })
}

function launchBackground(repo: string, a: RunArgs, role: Role): number {
  // Chequeo del tope, alta del job y publicacion del PID bajo el mismo lock.
  return withTaskLock(repo, a.task!, () => admitBackground(repo, a, role))
}

function admitBackground(repo: string, a: RunArgs, role: Role): number {
  const cfg = loadConfig(repo)
  const task = a.task!
  const busy = activeJobs(repo, task).filter(j => ROLES[j.role as Role]?.readOnly)
  if (busy.length >= cfg.asyncReview.maxConcurrent) {
    return fail(7, `RECHAZADO: ya hay ${busy.length} reviewer(s) activo(s) para la tarea "${task}" (tope ${cfg.asyncReview.maxConcurrent}).`,
      ...busy.map(j => `  job ${j.id} (${j.role}, pid ${j.pid}) - orq jobs ${j.id}`),
      'ASYNC_REVIEW no es una via de fan-out: esperar ese resultado o subir asyncReview.maxConcurrent en orq.config.json.')
  }
  const id = newJobId()
  const self = fileURLToPath(new URL('../cli' + path.extname(fileURLToPath(import.meta.url)), import.meta.url))
  const argv = [self, 'run', ...Object.entries(a).flatMap(([k, v]) =>
    k === 'background' || v == null || v === false ? [] : v === true ? [`--${k}`] : [`--${k}`, String(v)]), '--repo', repo, '--job', id]
  const job: Job = { id, pid: null, role, task, status: 'running', started: new Date().toISOString() }
  saveJob(repo, job)
  // La salida del job va a su propio log: nunca al contexto del razonador.
  const log = openSync(path.join(jobsDir(repo), `${id}.log`), 'w')
  const child = spawn(process.execPath, argv, { detached: true, stdio: ['ignore', log, log], windowsHide: true, env: process.env })
  publishPid(repo, job, child.pid ?? null)
  child.unref()
  console.log(`Job ${id} lanzado (${role}, tarea "${task}"). Seguir con el trabajo; resultado: orq jobs ${id}`)
  return 0
}

export async function runCommand(a: RunArgs): Promise<number> {
  const role = a.role as Role
  if (!role || !(role in ROLES)) return fail(6, `--role requerido: ${Object.keys(ROLES).join(' | ')}`)
  if (!a.reason || !(DELEGATED as readonly string[]).includes(a.reason)) {
    return fail(6, `--reason requerido (por que delegar): ${DELEGATED.join(' | ')}`,
      'Si ninguno aplica, no se delega: orq metrics --decision not_delegated --reason <motivo>.')
  }
  let prompt = a.prompt ?? ''
  if (a.spec) { try { prompt = readFileSync(a.spec, 'utf8') } catch { return fail(6, `No existe: ${a.spec}`) } }
  if (!prompt.trim()) return fail(6, 'Falta --spec <archivo> o --prompt <texto>.')
  const repo = path.resolve(a.repo ?? process.cwd())
  const root = repoRoot(repo) ?? repo
  ensureStateDir(root)

  if (a.background) {
    if (!ROLES[role].readOnly) return fail(6, `--background solo para roles read-only (reviewer, security-reviewer, docs-researcher): un writer en paralelo exige worktree (orq worktree add).`)
    if (!a.task) return fail(6, '--background requiere --task: el tope de reviewers es por tarea.')
    return launchBackground(root, a, role)
  }

  const cmd = resolveCodex()
  const logSkip = (why: string) => record(root, 'decision', { delegation_decision: 'not_delegated', reason: 'provider_unavailable', detail: why, task: a.task ?? '', role })
  if (!cmd) { logSkip('codex ausente'); return fail(5, 'Codex no esta instalado en el PATH. Seguir Claude-only.') }
  const info = await codexInfo(cmd)
  if (info.auth !== 'chatgpt') {
    logSkip(`auth ${info.auth}`)
    return fail(5, 'Codex no esta autenticado con ChatGPT. Corre: codex login', 'No se usa API key automaticamente (cambiaria la facturacion).')
  }

  const b = budget(true, await fetchCodexQuota(cmd), readClaudeUsage())
  console.log(formatBudget(b))
  if (b.decision === 'NO-GO') { logSkip(b.reason); return fail(2, '', 'NO-GO: no se invoca a Codex. Seguir Claude-only.') }

  if (a.resume) {
    const d = sessionDetail(a.resume)
    if (!d) return fail(3, `REUSE-DENIED: sesion ${a.resume} no encontrada (corrio con --ephemeral?). Arrancar sesion nueva.`)
    if (d.verdict === 'REUSE-DENIED') return fail(3, `REUSE-DENIED: la sesion lleva ${d.kb} KB (limite ${REUSE_LIMIT_KB} KB). Sesion nueva con spec fresca.`)
    console.log(`Reusando sesion ${a.resume} (${d.kb} KB, ${d.verdict})`)
  }

  const liveLog = newLiveLog(role)
  console.log(`Codex trabajando (${role}). En vivo: ${liveLog}`)
  const t0 = Date.now()
  let o: ExecOutcome
  try {
    o = await execCodex(cmd, { role, prompt, repo, resume: a.resume, phase: a.phase, ephemeral: a.ephemeral, liveLog })
  } catch (e: any) {
    return fail(4, `== Codex no pudo arrancar == ${e?.message ?? e}`)
  }
  const lines = renderOutcome(role, o)
  console.log('\n' + lines.join('\n'))

  const p = o.kind === 'ok' || o.kind === 'contract' ? o.payload : null
  const exitCode = o.kind === 'ok' ? 0 : o.kind === 'failed' ? o.exitCode : 4
  record(root, 'delegation', {
    delegation_decision: 'delegated', reason: a.reason, provider: 'codex', role, task: a.task ?? '', phase: a.phase ?? null,
    model: o.model, effort: o.effort, sandbox: o.sandbox, reused: !!a.resume,
    session: o.sessionId, rollout_kb: o.sessionId ? sessionDetail(o.sessionId)?.kb ?? null : null,
    codex_free_pct: b.codexFree, claude_5h_used: b.claudeFiveHour, claude_7d_used: b.claudeSevenDay, state: b.state,
    retry_of: a['retry-of'] ?? null, clarify_of: a['clarify-of'] ?? null,
    exit_code: exitCode, outcome: o.kind, status: p?.status ?? null, blocked: !!p?.blocked,
    tests: p?.tests?.status ?? null, files_changed: p?.files_changed?.length ?? null,
    findings: Array.isArray(p?.findings) ? p.findings.length : null,
    findings_by_severity: Array.isArray(p?.findings) ? p.findings.reduce((acc: Record<string, number>, f: any) => (acc[f.severity] = (acc[f.severity] ?? 0) + 1, acc), Object.create(null)) : null,
    duration_s: Math.round((Date.now() - t0) / 1000), job: a.job ?? null,
  })
  if (a.job) {
    const job = loadJob(root, a.job)
    if (job) saveJob(root, { ...job, status: exitCode === 0 ? 'done' : 'failed', finished: new Date().toISOString(), exit_code: exitCode, summary: lines })
  }
  return exitCode === 0 ? 0 : 4
}

export function jobsCommand(repo: string, id?: string): number {
  const root = repoRoot(repo) ?? repo
  if (id) {
    const j = loadJob(root, id)
    if (!j) return fail(6, `Job no encontrado: ${id}`)
    console.log(`Job ${j.id} - ${j.role} - "${j.task}" - ${j.status}${j.exit_code != null ? ` (exit ${j.exit_code})` : ''}`)
    if (j.summary) console.log(j.summary.join('\n'))
    else {
      // Sin resumen: el job termino temprano o sigue corriendo. El log dice por que.
      try { console.log(readFileSync(path.join(jobsDir(root), `${id}.log`), 'utf8').trim().split('\n').slice(-20).join('\n')) } catch { /* sin log */ }
    }
    return 0
  }
  const jobs = listJobs(root)
  if (!jobs.length) { console.log('Sin jobs.'); return 0 }
  for (const j of jobs) {
    const st = j.status === 'running' && !isAlive(j.pid) ? 'muerto (sin cleanup)' : j.status
    console.log(`${j.id}  ${j.role.padEnd(18)} ${st.padEnd(20)} ${j.task}`)
  }
  return 0
}

// Un job que termino por un camino temprano (auth, NO-GO, uso) no llega a
// escribir su resultado: se cierra aca para que no quede "running" para siempre.
export function finalizeJob(repo: string, id: string, code: number): void {
  const root = repoRoot(repo) ?? repo
  const j = loadJob(root, id)
  if (j && j.status === 'running') saveJob(root, { ...j, status: code === 0 ? 'done' : 'failed', finished: new Date().toISOString(), exit_code: code })
}
