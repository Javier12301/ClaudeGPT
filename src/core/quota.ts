// Gate de presupuesto en dos capas que se componen (docs/SYSTEM.md BR-001..003).
//
//   Capa 1, veredicto:  "¿se puede usar Codex, y para que?"  GO / WARN / NO-GO
//   Capa 2, estado:     "¿quien lidera y quien ejecuta?"
//
// Funciones puras: sin I/O. Leer las cuotas es trabajo de los providers.

// --- politica: todos los umbrales son constantes nombradas y fijadas por test ---
export const CODEX_MIN_FREE = 10    // por debajo: NO-GO
export const CODEX_WARN_FREE = 20   // por debajo: solo si el usuario lo pide
export const CODEX_HEAVY_FREE = 40  // desde aca: implementacion voluminosa permitida
export const CLAUDE_PREFER_5H = 50  // desde aca Codex ejecuta por defecto
export const CLAUDE_HANDOFF_5H = 70 // desde aca se recomienda /model sonnet
export const CLAUDE_PRESSURE = 85   // desde aca la ventana esta en estado critico
export const CLAUDE_WEEK_GATE = 80  // 7d por encima: el nivel no baja de 'presionado'

export type Decision = 'GO' | 'WARN' | 'NO-GO'
export type Level = 'fresco' | 'presionado' | 'apretado' | 'critico'
export type State = 'BALANCED' | 'CODEX-PREFERRED' | 'SONNET-LEAD' | 'CLAUDE-LEAD' | 'SURVIVAL'

// Lo que devuelve `account/rateLimits/read` de `codex app-server`.
export interface RateWindow { usedPercent?: number | null; resetsAt?: number | null; windowDurationMins?: number }
export interface RateBucket {
  primary?: RateWindow | null
  secondary?: RateWindow | null
  planType?: string
  spendControlReached?: boolean
  rateLimitReachedType?: string | null
}
export interface CodexRateLimits {
  rateLimits?: RateBucket | null
  rateLimitsByLimitId?: Record<string, RateBucket | null> | null
}

export interface ClaudeUsage { fiveHour: number | null; sevenDay: number | null; resetsAt?: string | null }

export interface Budget {
  codexFree: number | null
  codexPlan: string | null
  codexResetsAt: number | null
  claudeFiveHour: number | null
  claudeSevenDay: number | null
  decision: Decision
  reason: string
  allowHeavy: boolean
  level: Level | null
  state: State
  stateReason: string
}

// La ventana MAS ajustada de todas: primary/secondary de cada limitId.
export function freePercent(res: CodexRateLimits | null | undefined): number | null {
  if (!res) return null
  const buckets = [res.rateLimits, ...Object.values(res.rateLimitsByLimitId ?? {})]
  const used: number[] = []
  for (const b of buckets) {
    for (const w of [b?.primary, b?.secondary]) {
      if (w && w.usedPercent != null) used.push(Number(w.usedPercent))
    }
  }
  if (!used.length) return null
  return Math.round((100 - Math.max(...used)) * 10) / 10
}

// Capa 1. `installed=false` es un NO-GO con razon propia: no es lo mismo que
// Codex no conteste (WARN) a que Codex no exista (BR-001).
export function codexVerdict(installed: boolean, res: CodexRateLimits | null, claude: ClaudeUsage | null) {
  const out = { decision: 'WARN' as Decision, reason: '', allowHeavy: false,
                free: null as number | null, plan: null as string | null, resetsAt: null as number | null }
  if (!installed) {
    return { ...out, decision: 'NO-GO' as Decision, reason: 'Codex no esta instalado en el PATH.' }
  }
  const rl = res?.rateLimits
  if (!rl) {
    return { ...out, reason: 'No se pudo leer la cuota de Codex (app-server sin respuesta). Delegar solo si el usuario lo pide.' }
  }
  out.plan = rl.planType ?? null
  out.resetsAt = rl.primary?.resetsAt ?? null
  out.free = freePercent(res)
  if (rl.spendControlReached || rl.rateLimitReachedType) {
    return { ...out, decision: 'NO-GO' as Decision, reason: 'Codex alcanzo su limite de gasto o de rate limit.' }
  }
  const f = out.free
  if (f == null) return { ...out, reason: 'Codex no reporto porcentaje de uso.' }
  if (f < CODEX_MIN_FREE) return { ...out, decision: 'NO-GO' as Decision, reason: `Codex libre ${f}% (< ${CODEX_MIN_FREE}%). Claude-only.` }
  if (f < CODEX_WARN_FREE) return { ...out, decision: 'WARN' as Decision, reason: `Codex libre ${f}%. Solo si el usuario lo pide explicitamente.` }
  if (f < CODEX_HEAVY_FREE) return { ...out, decision: 'GO' as Decision, reason: `Codex libre ${f}%. Review/verify/docs si; implementacion voluminosa no.` }
  let reason = `Codex libre ${f}%. Delegacion normal.`
  if (claude?.fiveHour != null && claude.fiveHour > CLAUDE_PRESSURE && f > CODEX_HEAVY_FREE) {
    reason += ` Claude al ${claude.fiveHour}% de su ventana de 5h: conviene empujar trabajo a Codex.`
  }
  return { ...out, decision: 'GO' as Decision, reason, allowHeavy: true }
}

// Nivel de presion de Claude. null si no hay dato: nunca se inventa un nivel.
export function claudeLevel(fiveHour: number | null, sevenDay: number | null): Level | null {
  if (fiveHour == null) return null
  let level: Level = fiveHour >= CLAUDE_PRESSURE ? 'critico'
    : fiveHour >= CLAUDE_HANDOFF_5H ? 'apretado'
    : fiveHour >= CLAUDE_PREFER_5H ? 'presionado'
    : 'fresco'
  // Gate de 7 dias: sube el piso, nunca lo baja.
  if (sevenDay != null && sevenDay > CLAUDE_WEEK_GATE && level === 'fresco') level = 'presionado'
  return level
}

// Capa 2. Reglas de arriba hacia abajo: la primera que coincide gana (BR-003).
export function capacityState(level: Level | null, decision: Decision, allowHeavy: boolean): { state: State; reason: string } {
  const out = (state: State, reason: string) => ({ state, reason })
  const codexOut = decision === 'NO-GO'
  const codexAsk = decision === 'WARN'
  // 1. Sin dato de Claude no se infiere nada. Primera a proposito.
  if (level == null) return out('BALANCED', 'Sin lectura de la cuota de Claude (statusline de orq ausente o sin rate_limits): routing por naturaleza de la tarea.')
  let r: { state: State; reason: string }
  if (level === 'critico' && (codexOut || codexAsk)) r = out('SURVIVAL', 'Claude critico y Codex sin margen: no iniciar trabajo nuevo, cerrar la unidad actual y hacer checkpoint.')
  else if (codexOut) r = out('CLAUDE-LEAD', 'Codex descartado: pipeline Claude, sin ritual multi-provider.')
  // 4-6 exigen GO: un WARN no alcanza para poner a Codex a ejecutar. Cae a la 7.
  else if (!codexAsk && (level === 'critico' || level === 'apretado')) r = out('SONNET-LEAD', 'Claude apretado: recomendar /model sonnet una vez; Codex ejecuta.')
  else if (!codexAsk && level === 'presionado') r = out('CODEX-PREFERRED', 'Claude planifica y arbitra; ejecucion a Codex.')
  else if (codexAsk) r = out('CLAUDE-LEAD', 'Codex en WARN: pipeline Claude salvo que el usuario pida lo contrario.')
  else r = out('BALANCED', 'Ambos con margen: reparto por naturaleza de la tarea.')
  // Las capas se componen: el veredicto sigue vetando el volumen dentro del estado.
  if (!allowHeavy && (r.state === 'CODEX-PREFERRED' || r.state === 'SONNET-LEAD')) {
    r.reason += ' Codex acotado: sin implementacion voluminosa.'
  }
  return r
}

export function budget(codexInstalled: boolean, codex: CodexRateLimits | null, claude: ClaudeUsage | null): Budget {
  const v = codexVerdict(codexInstalled, codex, claude)
  const level = claudeLevel(claude?.fiveHour ?? null, claude?.sevenDay ?? null)
  const s = capacityState(level, v.decision, v.allowHeavy)
  return {
    codexFree: v.free, codexPlan: v.plan, codexResetsAt: v.resetsAt,
    claudeFiveHour: claude?.fiveHour ?? null, claudeSevenDay: claude?.sevenDay ?? null,
    decision: v.decision, reason: v.reason, allowHeavy: v.allowHeavy,
    level, state: s.state, stateReason: s.reason,
  }
}

const fmtEpoch = (e: number | null) => e ? new Date(e * 1000).toISOString().slice(0, 16).replace('T', ' ') : 'n/d'

export function formatBudget(b: Budget): string {
  const pct = (v: number | null, suffix: string) => v == null ? 'n/d' : `${v}% ${suffix}`
  return [
    '== Presupuesto ==',
    `Codex  : ${pct(b.codexFree, 'libre')} (plan ${b.codexPlan ?? 'n/d'}) - reset ${fmtEpoch(b.codexResetsAt)}`,
    `Claude : 5h ${pct(b.claudeFiveHour, 'usado')} | 7d ${pct(b.claudeSevenDay, 'usado')}`,
    `Estado : ${b.state} - ${b.stateReason}`,
    `Decision: ${b.decision} - ${b.reason}`,
  ].join('\n')
}
