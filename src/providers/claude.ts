// Proveedor Claude. Del lado Claude el runtime no ejecuta nada (los subagentes
// son nativos de Claude Code): solo detecta la CLI y lee la cuota.
//
// La cuota sale del JSON que Claude Code le pasa por stdin a la statusline
// (campo documentado `rate_limits`). `orq statusline` lo persiste en
// ~/.orquestador/claude-usage.json y este modulo lo lee. Reemplaza al cache de
// ClaudeCodeStatusLine, que era un repo PowerShell de terceros.
import path from 'node:path'
import { orqHome, readJson, writeJson } from '../core/state.ts'
import { resolveCommand, run } from '../core/proc.ts'
import type { ClaudeUsage } from '../core/quota.ts'

export const usageFile = (): string => path.join(orqHome(), 'claude-usage.json')

interface Window { used_percentage?: number; resets_at?: number }
export interface StoredUsage {
  ts: string
  session_id?: string
  five_hour?: Window | null
  seven_day?: Window | null
}

// Lo que llega por stdin a la statusline; solo tipamos lo que se usa.
export interface StatuslineInput {
  session_id?: string
  cwd?: string
  model?: { display_name?: string }
  workspace?: { current_dir?: string }
  context_window?: { used_percentage?: number | null }
  cost?: { total_cost_usd?: number }
  rate_limits?: { five_hour?: Window; seven_day?: Window } | null
}

// Solo se escribe si el payload trae rate_limits: al arrancar la sesion no
// viene (hasta la primera respuesta de la API) y pisar el ultimo dato bueno
// con nada dejaria al gate ciego sin motivo.
export function persistUsage(input: StatuslineInput, now = new Date()): boolean {
  const rl = input.rate_limits
  if (!rl || (!rl.five_hour && !rl.seven_day)) return false
  writeJson(usageFile(), {
    ts: now.toISOString(), session_id: input.session_id,
    five_hour: rl.five_hour ?? null, seven_day: rl.seven_day ?? null,
  } satisfies StoredUsage)
  return true
}

// Una ventana cuyo resets_at ya paso esta reseteada: vale 0, no el ultimo dato.
function windowUsed(w: Window | null | undefined, nowSec: number): number | null {
  if (!w || w.used_percentage == null) return null
  if (w.resets_at && w.resets_at <= nowSec) return 0
  return w.used_percentage
}

export function readClaudeUsage(now = new Date()): ClaudeUsage | null {
  const u = readJson<StoredUsage>(usageFile())
  if (!u) return null
  const s = Math.floor(now.getTime() / 1000)
  const fiveHour = windowUsed(u.five_hour, s)
  if (fiveHour == null) return null
  return { fiveHour, sevenDay: windowUsed(u.seven_day, s) }
}

export async function claudeInfo(): Promise<{ installed: boolean; version: string | null }> {
  const cmd = resolveCommand('claude')
  if (!cmd) return { installed: false, version: null }
  const r = await run(cmd, ['--version'], { timeoutMs: 15_000 })
  return { installed: true, version: r.code === 0 ? r.stdout.trim().split(/\s+/)[0] : null }
}
