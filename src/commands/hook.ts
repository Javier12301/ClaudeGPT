// `orq hook <nombre>`: hooks compartidos por Claude Code y Codex.
//
// Contrato comun: leen el evento por stdin, nunca bloquean el trabajo por un
// fallo propio (ante cualquier error: salida vacia, exit 0), y escriben en
// stdout solo lo que el contrato del evento admite.
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { record, rowFromHook, type HookEvent } from '../core/telemetry.ts'
import { repoState } from '../core/state.ts'
import { budget } from '../core/quota.ts'
import { readClaudeUsage } from '../providers/claude.ts'
import { fetchCodexQuota, readCodexUsageCache, resolveCodex } from '../providers/codex.ts'
import { isGitPush } from '../core/guard.ts'

// --- git-guard (D-008): publicar es exclusivo del usuario. El parser vive en core/guard.ts ---
export function gitGuardDecision(ev: HookEvent): object | null {
  if (!isGitPush(ev.tool_input?.command)) return null
  return { hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'Bloqueado por el Orquestador: publicar cambios (git push) es exclusivo del usuario.',
  } }
}

// Raiz del repo git que contiene `dir`, o null. Fuera de un repo no se loguea:
// un hook que corre en toda sesion no puede sembrar directorios en cualquier lado.
export function repoRoot(dir: string | undefined): string | null {
  if (!dir) return null
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (existsSync(path.join(d, '.git'))) return d
    if (path.dirname(d) === d) return null
  }
}

// El directorio de estado se ignora a si mismo: no ensucia `git status` de
// ningun repo, sin tocar su .gitignore.
export function ensureStateDir(root: string): void {
  const dir = repoState(root)
  const gi = path.join(dir, '.gitignore')
  try { if (statSync(gi).isFile()) return } catch { /* no existe */ }
  mkdirSync(dir, { recursive: true })
  writeFileSync(gi, '*\n')
}

function recordIn(cwd: string | undefined, event: string, fields: Record<string, unknown>, session?: string): void {
  const root = repoRoot(cwd)
  if (!root) return
  ensureStateDir(root)
  record(root, event, fields, session ?? null)
}

// --- session-start: el gate corre solo (P1 de la retro) ---
// El texto que imprime SessionStart entra como contexto. Corto a proposito.
export async function sessionStartContext(ev: HookEvent): Promise<string> {
  const cached = readCodexUsageCache()
  const fresh = cached && Date.now() - Date.parse(cached.ts) < 5 * 60_000
  const cmd = resolveCodex()
  const codex = fresh ? cached.res : await fetchCodexQuota(cmd, 5_000)
  const b = budget(!!cmd, codex, readClaudeUsage())
  recordIn(ev.cwd, 'gate', { state: b.state, decision: b.decision, codex_free_pct: b.codexFree,
    claude_5h_used: b.claudeFiveHour, claude_7d_used: b.claudeSevenDay }, ev.session_id)
  const pct = (v: number | null) => (v == null ? 'n/d' : `${v}%`)
  return [
    `[orq] Presupuesto: estado ${b.state} | Codex ${b.decision} (${pct(b.codexFree)} libre) | Claude 5h ${pct(b.claudeFiveHour)} 7d ${pct(b.claudeSevenDay)}.`,
    `[orq] ${b.stateReason}`,
    b.decision === 'NO-GO' ? '[orq] Codex no disponible: no delegar a Codex en esta sesion.' : '',
  ].filter(Boolean).join('\n')
}

async function readStdin(): Promise<string> {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  return raw
}

export async function hookCommand(name: string): Promise<void> {
  let ev: HookEvent = {}
  try { ev = JSON.parse((await readStdin()) || '{}') } catch { /* evento ilegible: se trata como vacio */ }
  try {
    if (name === 'git-guard') {
      const d = gitGuardDecision(ev)
      process.stdout.write(JSON.stringify(d ?? {}))
      return
    }
    if (name === 'session-start') {
      process.stdout.write(await sessionStartContext(ev) + '\n')
      return
    }
    if (name === 'metrics') {
      const row = rowFromHook(ev)
      if (row) recordIn(ev.cwd, row.event, row.fields, ev.session_id)
      return
    }
  } catch {
    // Un fallo del hook jamas frena el trabajo real. El git-guard degrada a
    // "sin decision": la deny rule de settings.json sigue activa.
    if (name === 'git-guard') process.stdout.write('{}')
  }
}
