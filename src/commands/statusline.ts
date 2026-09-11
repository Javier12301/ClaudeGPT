// `orq statusline`: la statusLine de Claude Code.
//
// Lee el JSON documentado que Claude Code pasa por stdin, persiste la cuota
// (rate_limits) para el gate, e imprime una linea. Reemplaza a
// statusline-wrapper.ps1 + el clon de ClaudeCodeStatusLine.
//
// Contrato: nunca falla ni tarda. Todo lo lento (el RPC de cuota de Codex) se
// dispara desacoplado y se lee de cache en el turno siguiente.
import { spawn } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { persistUsage, type StatuslineInput } from '../providers/claude.ts'
import { activeRuns, codexUsageFile, readCodexUsageCache } from '../providers/codex.ts'
import { freePercent } from '../core/quota.ts'

const CODEX_CACHE_TTL_MS = 60_000
const HEARTBEAT_FRESH_MS = 90_000 // corrida matada sin cleanup: no dejar el segmento pegado

const e = '\x1b['
const dim = (s: string) => `${e}2m${s}${e}0m`
// used=true: verde cuando se uso poco. used=false (cuota libre): espejado.
function color(pct: number, used: boolean): string {
  const free = used ? 100 - pct : pct
  const c = free >= 50 ? '0;160;0' : free >= 30 ? '230;200;0' : free >= 10 ? '255;176;85' : '255;85;85'
  return `${e}38;2;${c}m${Math.round(pct)}%${e}0m`
}

function ageMs(file: string): number {
  try { return Date.now() - statSync(file).mtimeMs } catch { return Infinity }
}

// La rama sale de .git/HEAD: leer un archivo, no lanzar git en cada render.
function gitBranch(dir: string): string | null {
  for (let d = dir; ; d = path.dirname(d)) {
    try {
      let head = path.join(d, '.git')
      const st = statSync(head)
      if (st.isFile()) head = path.resolve(d, readFileSync(head, 'utf8').replace(/^gitdir:\s*/, '').trim()) // worktree
      const ref = readFileSync(path.join(head, 'HEAD'), 'utf8').trim()
      return ref.startsWith('ref: ') ? ref.replace(/^ref: refs\/heads\//, '') : ref.slice(0, 7)
    } catch { /* subir */ }
    if (path.dirname(d) === d) return null
  }
}

function refreshCodexCacheDetached(): void {
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli' + path.extname(fileURLToPath(import.meta.url)))
  try {
    spawn(process.execPath, [cli, 'budget', '--refresh-cache'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch { /* sin cuota de Codex en la linea: no es critico */ }
}

export function renderStatusline(input: StatuslineInput): string {
  const dir = input.workspace?.current_dir ?? input.cwd ?? process.cwd()
  const parts: string[] = []
  parts.push(`${e}1m${input.model?.display_name ?? 'Claude'}${e}0m`)
  const branch = gitBranch(dir)
  parts.push(path.basename(dir) + (branch ? dim(` (${branch})`) : ''))
  const ctx = input.context_window?.used_percentage
  if (ctx != null) parts.push(`ctx ${color(ctx, true)}`)
  const rl = input.rate_limits
  const q: string[] = []
  if (rl?.five_hour?.used_percentage != null) q.push(`5h ${color(rl.five_hour.used_percentage, true)}`)
  if (rl?.seven_day?.used_percentage != null) q.push(`7d ${color(rl.seven_day.used_percentage, true)}`)
  if (q.length) parts.push(q.join(' '))
  const cx = readCodexUsageCache()
  const cxFree = freePercent(cx?.res)
  if (cxFree != null) parts.push(`${dim('CX')} ${color(cxFree, false)}`)
  // Senal de vida: un archivo por corrida de Codex, solo mientras corre.
  const runs = activeRuns(HEARTBEAT_FRESH_MS)
  if (runs.length) {
    const a = runs[0]
    const s = Math.max(0, Math.round((Date.now() - Date.parse(a.started)) / 1000))
    parts.push(`CX> ${a.role} ${s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`} ${a.last_event}${runs.length > 1 ? ` (+${runs.length - 1})` : ''}`)
  }
  return parts.join(dim(' | '))
}

export async function statuslineCommand(): Promise<void> {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  let input: StatuslineInput = {}
  try { input = JSON.parse(raw) } catch { /* sin payload: linea minima */ }
  try { persistUsage(input) } catch { /* nunca romper la statusline */ }
  if (ageMs(codexUsageFile()) >= CODEX_CACHE_TTL_MS) refreshCodexCacheDetached()
  process.stdout.write(renderStatusline(input) + '\n')
}
