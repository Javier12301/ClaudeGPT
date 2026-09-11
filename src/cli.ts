#!/usr/bin/env node
// orq: runtime del Orquestador V2. Un solo binario; cada subcomando es un
// modulo en commands/. Sin dependencias de runtime: node:util.parseArgs.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { budget, formatBudget } from './core/quota.ts'
import { formatFeedback, formatReport, record, FRICTION, REASONS, NOT_DELEGATED } from './core/telemetry.ts'
import { readClaudeUsage } from './providers/claude.ts'
import { fetchCodexQuota, refreshCodexUsageCache, resolveCodex, sessionDetail, REUSE_FREE_KB, REUSE_LIMIT_KB } from './providers/codex.ts'
import { ensureStateDir, hookCommand, repoRoot } from './commands/hook.ts'
import { statuslineCommand } from './commands/statusline.ts'
import { finalizeJob, jobsCommand, runCommand } from './commands/run.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const PKG_ROOT = path.resolve(HERE, '..')
const VERSION: string = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version

const HELP = `orq ${VERSION} - Orquestador V2 (Claude Code + Codex)

Instalacion
  orq init [--dry-run] [--claude-only] [--offline]
                                         instala y configura (idempotente)
  orq doctor [--json]                    diagnostico completo
  orq uninstall [--dry-run]              borra solo lo que instalo orq
  orq migrate [--dry-run]                migra una instalacion PowerShell (V1)

Ejecucion
  orq budget [--json]                    gate de presupuesto (veredicto + estado)
  orq run --role <rol> --reason <motivo> (--spec <f> | --prompt <t>)
          [--task <t>] [--phase <f>] [--resume <id>] [--retry-of <id>]
          [--clarify-of <id>] [--ephemeral] [--background]
  orq jobs [<id>]                        reviews en background
  orq session <id>                       tamano y veredicto de reuso de una sesion Codex
  orq checkpoint fast|deep [--phase <id>] [--role <r>] [--task <t>] [--blocking]
  orq plan check                         valida .orquestador/plan.json
  orq worktree add|list|remove <nombre>  aislamiento para writers paralelos
  orq codeintel orient|symbols|refs|impact [args]

Telemetria
  orq metrics [--feedback] [--session <id> | --all]
  orq metrics --decision delegated|not_delegated --reason <motivo> [--task <t>] [--topology <t>]
  orq metrics --note <tipo> --detail "<que paso>" [--phase <f>]
  orq metrics --finding accepted|rejected --detail "<file:line - por que>"

Integracion (los llama Claude Code, no el usuario)
  orq statusline | orq hook git-guard|metrics|session-start
`

const { values: v, positionals: pos } = parseArgs({
  allowPositionals: true,
  strict: true,
  options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    json: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'claude-only': { type: 'boolean' }, offline: { type: 'boolean' },
    'refresh-cache': { type: 'boolean' }, feedback: { type: 'boolean' }, all: { type: 'boolean' },
    session: { type: 'string' }, repo: { type: 'string' },
    role: { type: 'string' }, spec: { type: 'string' }, prompt: { type: 'string' }, task: { type: 'string' },
    phase: { type: 'string' }, reason: { type: 'string' }, resume: { type: 'string' },
    'retry-of': { type: 'string' }, 'clarify-of': { type: 'string' }, ephemeral: { type: 'boolean' },
    background: { type: 'boolean' }, job: { type: 'string' }, blocking: { type: 'boolean' },
    decision: { type: 'string' }, topology: { type: 'string' }, note: { type: 'string' },
    detail: { type: 'string' }, finding: { type: 'string' },
  },
})

const repo = path.resolve(v.repo ?? process.cwd())
const root = () => repoRoot(repo) ?? repo

async function budgetCommand(): Promise<number> {
  if (v['refresh-cache']) { await refreshCodexUsageCache(); return 0 }
  const cmd = resolveCodex()
  const b = budget(!!cmd, await fetchCodexQuota(cmd), readClaudeUsage())
  console.log(v.json ? JSON.stringify(b) : formatBudget(b))
  return b.decision === 'NO-GO' ? 2 : 0
}

function metricsCommand(): number {
  const r = root()
  const task = v.task ?? ''
  if (v.decision) {
    if (v.decision !== 'delegated' && v.decision !== 'not_delegated') { console.log('--decision delegated|not_delegated'); return 6 }
    if (!v.reason || !(REASONS as readonly string[]).includes(v.reason)) { console.log(`--reason: ${REASONS.join(' | ')}`); return 6 }
    const mismatch = (NOT_DELEGATED as readonly string[]).includes(v.reason) !== (v.decision === 'not_delegated')
    if (mismatch) { console.log(`el motivo "${v.reason}" no corresponde a ${v.decision}`); return 6 }
    ensureStateDir(r)
    record(r, 'decision', { delegation_decision: v.decision, reason: v.reason, task, topology: v.topology ?? null, phase: v.phase ?? null })
    console.log(`decision registrada: ${v.decision} (${v.reason})`)
    return 0
  }
  if (v.note) {
    if (!(FRICTION as readonly string[]).includes(v.note)) { console.log(`--note: ${FRICTION.join(' | ')}`); return 6 }
    ensureStateDir(r)
    record(r, 'friction', { kind: v.note, detail: v.detail ?? '', phase: v.phase ?? null })
    console.log(`friccion registrada: ${v.note}`)
    return 0
  }
  if (v.finding) {
    if (v.finding !== 'accepted' && v.finding !== 'rejected') { console.log('--finding accepted|rejected'); return 6 }
    ensureStateDir(r)
    record(r, 'finding_verdict', { verdict: v.finding, detail: v.detail ?? '', task })
    console.log(`finding ${v.finding}`)
    return 0
  }
  const s = v.all ? 'all' : v.session ?? null
  console.log(v.feedback ? formatFeedback(r, s) : formatReport(r, s))
  return 0
}

function sessionCommand(id: string | undefined): number {
  if (!id) { console.log('uso: orq session <id>'); return 6 }
  const d = sessionDetail(id)
  if (!d) { console.log(`Sesion no encontrada: ${id}`); return 6 }
  console.log(`== Sesion ${d.id} ==\nRollout  : ${d.kb} KB\nVeredicto: ${d.verdict}  (libre <${REUSE_FREE_KB}KB, limite ${REUSE_LIMIT_KB}KB)`)
  return 0
}

async function main(): Promise<number> {
  const [cmd, ...rest] = pos
  if (v.version) { console.log(VERSION); return 0 }
  if (!cmd || v.help || cmd === 'help') { console.log(HELP); return 0 }
  switch (cmd) {
    case 'statusline': await statuslineCommand(); return 0
    case 'hook': await hookCommand(rest[0] ?? ''); return 0
    case 'budget': return budgetCommand()
    case 'metrics': return metricsCommand()
    case 'session': return sessionCommand(rest[0])
    case 'jobs': return jobsCommand(repo, rest[0])
    case 'run': {
      // Un job en background se cierra siempre, tambien si runCommand explota.
      let code = 1
      try { code = await runCommand({ ...v, repo }); return code }
      finally { if (v.job) finalizeJob(repo, v.job, code) }
    }
    case 'init': return (await import('./commands/install.ts')).initCommand({ dryRun: !!v['dry-run'], claudeOnly: !!v['claude-only'], external: !v.offline })
    case 'doctor': return (await import('./commands/install.ts')).doctorCommand({ json: !!v.json })
    case 'uninstall': return (await import('./commands/install.ts')).uninstallCommand({ dryRun: !!v['dry-run'], external: !v.offline })
    case 'migrate': return (await import('./commands/install.ts')).migrateCommand({ dryRun: !!v['dry-run'], external: !v.offline })
    case 'checkpoint': return (await import('./commands/checkpoint.ts')).checkpointCommand(root(), rest[0], v)
    case 'plan': return (await import('./commands/checkpoint.ts')).planCommand(root(), rest[0])
    case 'worktree': return (await import('./commands/worktree.ts')).worktreeCommand(root(), rest[0], rest[1])
    case 'codeintel': return (await import('./commands/codeintel.ts')).codeintelCommand(root(), rest[0], rest.slice(1))
    default: console.log(`comando desconocido: ${cmd}\n\n${HELP}`); return 6
  }
}

main().then(code => { process.exitCode = code }, err => { console.error(`orq: ${err?.message ?? err}`); process.exitCode = 1 })
