// Telemetria de utilidad: <repo>/.orquestador/decisions.jsonl.
//
// Reescrita por el P0 de la retro (MEJORAR ORQUESTADOR/Mejorar.txt), donde el
// informe de cierre afirmo cosas que no pasaron. Las tres causas y su fix:
//   1. Mezclaba sesiones        -> toda fila lleva session_id; los reportes
//                                  filtran por sesion por defecto.
//   2. Spawns en 0 s / dobles   -> los subagentes en background vuelven del tool
//                                  Agent al lanzarse, asi que Pre/PostToolUse
//                                  caen en el mismo instante. Se aparea
//                                  SubagentStart/SubagentStop por agent_id.
//   3. Suites no capturadas     -> en Windows Claude Code usa la tool PowerShell,
//                                  no Bash; el matcher solo miraba Bash.
// Y la regla de honestidad: sin eventos de la sesion, el informe lo dice.
import path from 'node:path'
import { appendJsonl, readJsonl, repoState } from './state.ts'

export const logFile = (repo: string): string => path.join(repoState(repo), 'decisions.jsonl')

// El mismo id que traen los hooks en `session_id`. Codex como razonador puede
// fijar ORQ_SESSION_ID; sin ninguno, la fila queda sin sesion y el reporte lo marca.
export const currentSession = (): string | null =>
  process.env.ORQ_SESSION_ID ?? process.env.CLAUDE_CODE_SESSION_ID ?? process.env.CODEX_THREAD_ID ?? null

export const FRICTION = ['rework', 'review-defect', 'predictable-needs-info', 'wasted-verify', 'wrong-route', 'env-gotcha'] as const
// Motivos cerrados: una razon libre por evento vuelve el log inagrupable.
export const NOT_DELEGATED = ['already_had_context', 'too_small', 'coupled', 'spec_cost_exceeds_work', 'provider_unavailable', 'user_override'] as const
export const DELEGATED = ['parallelism', 'isolation', 'independence', 'volume', 'specialization', 'broad_exploration'] as const
export const REASONS = [...NOT_DELEGATED, ...DELEGATED] as const

export interface Row { ts: string; session_id: string | null; event: string; [k: string]: unknown }

export function record(repo: string, event: string, fields: Record<string, unknown>, session = currentSession()): Row {
  const row: Row = { ts: new Date().toISOString(), session_id: session, event, ...fields }
  appendJsonl(logFile(repo), row)
  return row
}

// --- deteccion de corridas de test (hook PostToolUse Bash|PowerShell) ---
const RUNNER = /(?:^|[\s;&|(])(?:npm\s+(?:run\s+)?test|npx\s+(?:jest|vitest|playwright)|yarn\s+test|pnpm\s+(?:run\s+)?test|bun\s+test|deno\s+test|node\s+--test|jest|vitest|pytest|py\.test|python\s+-m\s+pytest|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+(?:test|verify)|gradle\s+test|\.\/gradlew\s+test|rspec|phpunit|Invoke-Pester)\b/i
const TARGETED = /(?:-k\s|-t\s|--test(?:-name-pattern|PathPattern|NamePattern)?[\s=]|--filter[\s=]|--grep[\s=]|--run[\s=]|--spec[\s=]|-Path\s|::|\.(?:test|spec)\.[cm]?[jt]sx?\b|test_[\w-]+\.py\b|[\w/\\.-]+_test\.go\b|[\w/\\.-]+\.(?:py|rb|php|cs|java|kt)\b)/i
const FAILURE = /^\s*(?:FAILED|FAIL\b|ERROR:)|\b[1-9]\d*\s+(?:failed|failing|failures?|errors?)\b|Tests?\s+failed|assertion\s+failed|\bFAILURES\b|^[#ℹ]\s*fail\s+[1-9]/im
const PASSING = /\b[1-9]\d*\s+passed\b|^[#ℹ]\s*pass\s+[1-9]\d*\b|^ok\s+\S+|test result:\s*ok\b/im

export function testScope(command: string): 'full' | 'targeted' | null {
  if (!command || !RUNNER.test(command)) return null
  return TARGETED.test(command) ? 'targeted' : 'full'
}

// Sin exit code confiable en el payload, la senal es el resumen del runner.
// Un falso GREEN pierde una metrica; nunca rompe nada.
export function testResult(output: string, exitCode?: number | null): 'RED' | 'GREEN' | 'UNKNOWN' {
  if (exitCode != null) return exitCode === 0 ? 'GREEN' : 'RED'
  if (FAILURE.test(output ?? '')) return 'RED'
  return PASSING.test(output ?? '') ? 'GREEN' : 'UNKNOWN'
}

// --- hook: un evento de Claude Code -> 0 o 1 fila ---
export interface HookEvent {
  hook_event_name?: string; session_id?: string; cwd?: string
  tool_name?: string; tool_use_id?: string; tool_input?: any; tool_response?: any
  duration_ms?: number; agent_id?: string; agent_type?: string
}

export function rowFromHook(ev: HookEvent): { event: string; fields: Record<string, unknown> } | null {
  const secs = ev.duration_ms != null ? Math.round(ev.duration_ms / 100) / 10 : undefined
  switch (ev.hook_event_name) {
    case 'SubagentStart':
      return { event: 'subagent_start', fields: { agent_id: ev.agent_id, agent_type: ev.agent_type } }
    case 'SubagentStop':
      return { event: 'subagent_stop', fields: { agent_id: ev.agent_id, agent_type: ev.agent_type } }
    case 'PreToolUse':
      if (ev.tool_name === 'Agent' || ev.tool_name === 'Task') {
        return { event: 'spawn_request', fields: {
          agent_type: ev.tool_input?.subagent_type || 'general-purpose',
          task: ev.tool_input?.description ?? '', isolation: ev.tool_input?.isolation ?? null,
          background: ev.tool_input?.run_in_background ?? null, tool_use_id: ev.tool_use_id } }
      }
      return null
    case 'PostToolUse': {
      if (ev.tool_name !== 'Bash' && ev.tool_name !== 'PowerShell') return null
      const command = String(ev.tool_input?.command ?? '')
      const scope = testScope(command)
      if (!scope) return null
      const r = ev.tool_response ?? {}
      const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}${typeof r === 'string' ? r : ''}`
      const code = r.exitCode ?? r.exit_code ?? null
      const interrupted = r.is_error || r.isError || r.timed_out || r.timedOut || r.timeout || r.interrupted || r.cancelled
      return { event: 'test_run', fields: {
        scope, result: interrupted ? 'RED' : testResult(out, typeof code === 'number' ? code : null),
        command: command.slice(0, 200), tool: ev.tool_name, duration_s: secs } }
    }
  }
  return null
}

// --- lectura ---
export function readRows(repo: string, session?: string | 'all' | null): { rows: Row[]; session: string | null; sessions: string[] } {
  const all = readJsonl<Row>(logFile(repo))
  const sessions = [...new Set(all.map(r => r.session_id).filter((s): s is string => !!s))]
  if (session === 'all') return { rows: all, session: null, sessions }
  const target = session ?? currentSession() ?? sessions.at(-1) ?? null
  return { rows: target ? all.filter(r => r.session_id === target) : [], session: target, sessions }
}

// Duracion real de cada subagente: SubagentStart/Stop apareados por agent_id.
// El task sale del spawn_request del mismo tipo, en orden (FIFO por tipo).
export function subagentRuns(rows: Row[]) {
  const starts = new Map<string, Row>()
  const requests = new Map<string, Row[]>()
  const runs: { agent_type: string; task: string; duration_s: number | null }[] = []
  for (const r of rows) {
    if (r.event === 'spawn_request') {
      const k = String(r.agent_type); requests.set(k, [...(requests.get(k) ?? []), r])
    } else if (r.event === 'subagent_start') {
      starts.set(String(r.agent_id), r)
    } else if (r.event === 'subagent_stop') {
      const s = starts.get(String(r.agent_id))
      const type = String(r.agent_type ?? s?.agent_type ?? '?')
      // ponytail: FIFO por tipo para el task; con spawns paralelos del mismo tipo
      // el texto puede cruzarse, la duracion no (va por agent_id).
      const req = requests.get(type)?.shift()
      runs.push({ agent_type: type, task: String(req?.task ?? ''),
        duration_s: s ? Math.round((Date.parse(r.ts) - Date.parse(s.ts)) / 100) / 10 : null })
      starts.delete(String(r.agent_id))
    }
  }
  return { runs, stillRunning: starts.size }
}

const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length
const group = (xs: Row[], k: string) => xs.reduce<Record<string, number>>((a, r) => { const v = String(r[k] ?? '?'); a[v] = (a[v] ?? 0) + 1; return a }, Object.create(null))

export function summarize(rows: Row[]) {
  const { runs, stillRunning } = subagentRuns(rows)
  const codex = rows.filter(r => r.event === 'delegation')
  const tests = rows.filter(r => r.event === 'test_run')
  const decisions = rows.filter(r => r.event === 'decision' || r.event === 'delegation')
  const verdicts = rows.filter(r => r.event === 'finding_verdict')
  return {
    runs, stillRunning, codex, tests, decisions, verdicts,
    friction: rows.filter(r => r.event === 'friction'),
    gateRan: rows.some(r => r.event === 'gate'),
    notDelegated: count(decisions, r => r.delegation_decision === 'not_delegated'),
    delegated: count(decisions, r => r.delegation_decision === 'delegated'),
  }
}

export function formatReport(repo: string, session: string | 'all' | null = null): string {
  const { rows, session: sid, sessions } = readRows(repo, session)
  const L: string[] = []
  const header = `Orquestador - ${sid ? `sesion ${sid.slice(0, 8)}` : 'todas las sesiones'} - ${repo}`
  // Regla de honestidad: nunca reportar ceros como si fueran medicion.
  if (!rows.length) {
    return [header, '',
      'El log no registro eventos de esta sesion. Los numeros no existen:',
      'no los uses para comparar ni para decidir.',
      sessions.length ? `(hay ${sessions.length} sesion(es) en el log; --session <id> o --all)` : '(el log esta vacio: estan instalados los hooks? orq doctor)',
    ].join('\n')
  }
  const s = summarize(rows)
  L.push(header, '-'.repeat(60))
  L.push(`gate de presupuesto        ${s.gateRan ? 'corrio al arrancar' : 'NO CORRIO en esta sesion'}`)
  L.push(`decisiones de delegacion   ${s.delegated} delegadas / ${s.notDelegated} directas`)
  for (const [k, v] of Object.entries(group(s.decisions, 'reason'))) L.push(`  ${k.padEnd(26)} ${v}`)
  L.push('', `subagentes Claude          ${s.runs.length}${s.stillRunning ? ` (+${s.stillRunning} sin terminar)` : ''}`)
  const byType: Record<string, number[]> = {}
  for (const r of s.runs) (byType[r.agent_type] ??= []).push(r.duration_s ?? NaN)
  for (const [t, ds] of Object.entries(byType)) {
    const ok = ds.filter(d => !Number.isNaN(d))
    L.push(`  ${t.padEnd(26)} ${ds.length}   ${ok.length ? `${Math.round(ok.reduce((a, b) => a + b, 0) / ok.length)} s prom` : 'sin duracion'}`)
  }
  L.push('', `delegaciones Codex         ${s.codex.length}`)
  for (const [k, v] of Object.entries(group(s.codex, 'role'))) L.push(`  ${k.padEnd(26)} ${v}`)
  if (s.codex.length) {
    L.push(`  NEEDS_INFO ${count(s.codex, r => r.status === 'NEEDS_INFO')} | retries ${count(s.codex, r => !!r.retry_of)} | fallos ${count(s.codex, r => r.exit_code !== 0)} | findings ${s.codex.reduce((a, r) => a + (Number(r.findings) || 0), 0)}`)
  }
  if (s.verdicts.length) {
    L.push(`  findings arbitrados: ${count(s.verdicts, r => r.verdict === 'accepted')} aceptados / ${count(s.verdicts, r => r.verdict === 'rejected')} rechazados`)
  }
  const full = count(s.tests, r => r.scope === 'full')
  L.push('', `corridas de test           ${s.tests.length} (${full} completas, ${s.tests.length - full} dirigidas, ${count(s.tests, r => r.result === 'RED')} RED, ${count(s.tests, r => r.result === 'UNKNOWN')} UNKNOWN)`)
  if (full > s.tests.length - full && s.tests.length > 4) L.push('  ^ mas suites completas que dirigidas: revisar la verify ladder')
  L.push('', `fricciones                 ${s.friction.length}`)
  for (const [k, v] of Object.entries(group(s.friction, 'kind'))) L.push(`  ${k.padEnd(26)} ${v}`)
  const rework = count(s.friction, r => r.kind === 'rework' || r.kind === 'wrong-route')
  if (s.notDelegated && rework) L.push(`  ${s.notDelegated} decisiones directas y ${rework} rework/wrong-route: cruzarlos antes de tocar la politica DIRECT`)
  return L.join('\n')
}

export function formatFeedback(repo: string, session: string | 'all' | null = null): string {
  const { rows, session: sid } = readRows(repo, session)
  if (!rows.length) return formatReport(repo, session)
  const s = summarize(rows)
  const L = [`# Feedback de sesion ${sid ?? ''}`.trim(), '', formatReport(repo, session), '', '## Fricciones, en el momento en que ocurrieron', '']
  if (!s.friction.length) L.push('Ninguna anotada. O la sesion salio limpia, o no se anotaron en el momento (`orq metrics --note`).')
  for (const f of s.friction) L.push(`- [${f.kind}]${f.phase ? ` (${f.phase})` : ''} ${f.detail ?? ''}`)
  L.push('', '## Delegaciones, una por una', '', '| Quien | Tarea | Motivo | Duracion | Resultado |', '|---|---|---|---|---|')
  for (const r of s.runs) L.push(`| claude:${r.agent_type} | ${r.task} | - | ${r.duration_s ?? '-'} s | - |`)
  for (const c of s.codex) L.push(`| codex:${c.role} | ${c.task ?? ''} | ${c.reason ?? '-'} | ${c.duration_s ?? '-'} s | ${c.status ?? (c.exit_code === 0 ? 'ok' : `exit ${c.exit_code}`)}${c.findings != null ? `, ${c.findings} findings` : ''} |`)
  L.push('', '## Lo que el log no sabe', '',
    '- Cual de estas delegaciones valio lo que costo.',
    '- Que defectos encontro la revision del diff, y de que familia.',
    '- Que regla del orquestador los habria evitado.',
    '', 'El log es evidencia; el resumen del orquestador es testimonio. Cuando discrepan, gana el log.')
  return L.join('\n')
}
