// Merges puros de configuracion ajena. Sin I/O: entran el documento y el
// contexto, sale el documento nuevo. Asi se puede probar que:
//   - correr dos veces deja el mismo resultado (idempotencia),
//   - ninguna clave del usuario se pierde ni se pisa,
//   - uninstall saca exactamente lo que agrego init.
//
// Lo nuestro se reconoce por un marcador en el comando (la ruta del runtime),
// no por posicion: el usuario puede reordenar sus hooks sin romper nada.

export const RUNTIME_MARK = '.orquestador/runtime'
// Lo que instalaba el kit PowerShell (V1). Se reemplaza al migrar.
export const LEGACY_MARK = /(?:^|[\\/])\.claude[\\/](?:hooks[\\/](?:git-guard|orq-metrics)\.ps1|statusline-wrapper\.ps1|scripts[\\/]codex-run\.ps1)|(?:^|[\\/])\.codex[\\/]hooks[\\/]orquestador-git-guard\.ps1/i

type Json = Record<string, any>
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x ?? {}))

export interface Ctx { runtimeCli: string } // ruta absoluta a dist/cli.js del runtime, con '/'

export const orqCmd = (ctx: Ctx, sub: string) => `node "${ctx.runtimeCli}" ${sub}`
const isOurs = (cmd: unknown) => typeof cmd === 'string' && (cmd.includes(RUNTIME_MARK) || LEGACY_MARK.test(cmd))
const hookIsOurs = (h: Json) => isOurs(h?.command) || isOurs(h?.commandWindows)
// Saca nuestros hooks uno por uno: un hook del usuario que quedo en el mismo
// grupo sobrevive. El grupo se va solo si quedo vacio.
function stripOurs(groups: Json[] | undefined): Json[] {
  return (groups ?? []).flatMap(g => {
    const hooks = (g?.hooks ?? []).filter((h: Json) => !hookIsOurs(h))
    return hooks.length ? [{ ...g, hooks }] : []
  })
}

// Los hooks del V2. Cada uno con una razon de existir; ninguno de adorno:
//   git-guard      D-008: las formas de push que la deny rule no cubre
//   metrics        P0: la unica fuente de verdad de lo que paso en la sesion
//   session-start  P1: el gate de presupuesto corre solo, no de memoria
export function claudeHooks(ctx: Ctx): Json {
  const h = (sub: string, timeout = 10) => ({ type: 'command', command: orqCmd(ctx, sub), timeout })
  return {
    SessionStart: [{ hooks: [h('hook session-start', 20)] }],
    PreToolUse: [
      { matcher: 'Bash|PowerShell', hooks: [h('hook git-guard', 5)] },
      { matcher: 'Agent|Task', hooks: [h('hook metrics')] },
    ],
    PostToolUse: [{ matcher: 'Bash|PowerShell', hooks: [h('hook metrics')] }],
    SubagentStart: [{ hooks: [h('hook metrics')] }],
    SubagentStop: [{ hooks: [h('hook metrics')] }],
  }
}

// Deny: la forma directa de push, en las dos tools de shell. El hook cubre el
// resto (`git -C . push`, que `Bash(git push *)` no matchea: docs de permisos).
export const DENY = ['Bash(git push *)', 'Bash(git.exe push *)', 'PowerShell(git push *)', 'PowerShell(git.exe push *)']
export const ALLOW = ['Bash(orq *)', 'PowerShell(orq *)']
const LEGACY_PERMS = /codex-run\.ps1|^Bash\(git(\.exe)? push:\*\)$/

// seeded: claves que init creo. addedPerms: entradas de permisos que init agrego
// (una que el usuario ya tenia no se registra, y uninstall no la toca).
export interface ClaudeMergeReport { statusLine: 'set' | 'kept-ours' | 'foreign'; seeded: string[]; addedPerms: string[] }

export function mergeClaudeSettings(doc: Json, ctx: Ctx): { doc: Json; report: ClaudeMergeReport } {
  const out = clone(doc)
  const seeded: string[] = []

  // hooks: se sacan los grupos nuestros (V2 o V1) y se agregan los actuales.
  out.hooks ??= {}
  for (const event of Object.keys(out.hooks)) {
    const kept = stripOurs(out.hooks[event])
    if (kept.length) out.hooks[event] = kept
    else delete out.hooks[event]
  }
  for (const [event, groups] of Object.entries(claudeHooks(ctx))) {
    out.hooks[event] = [...(out.hooks[event] ?? []), ...(groups as Json[])]
  }

  // permisos: se agregan sin duplicar; los del V1 que ya no aplican se van.
  out.permissions ??= {}
  const addedPerms: string[] = []
  const merge = (cur: string[] | undefined, add: string[]) => {
    const kept = (cur ?? []).filter(p => !LEGACY_PERMS.test(p))
    for (const p of add) if (!kept.includes(p)) { kept.push(p); addedPerms.push(p) }
    return kept
  }
  out.permissions.deny = merge(out.permissions.deny, DENY)
  out.permissions.allow = merge(out.permissions.allow, ALLOW)
  // NO se siembra defaultMode: bypassPermissions (lo hacia el V1). Un flag
  // peligroso no se instala para ahorrar prompts; si el usuario lo tiene, es suyo.

  // statusLine: es la fuente de la cuota de Claude. Se pone si no hay, o si es
  // la nuestra / la del V1. Una statusline ajena NO se pisa: el gate queda ciego
  // de ese lado y doctor lo dice.
  let statusLine: ClaudeMergeReport['statusLine'] = 'set'
  const cur = out.statusLine?.command
  if (cur && !isOurs(cur)) statusLine = 'foreign'
  else {
    if (cur?.includes(RUNTIME_MARK)) statusLine = 'kept-ours'
    out.statusLine = { type: 'command', command: orqCmd(ctx, 'statusline') }
  }

  // Sin atribucion de IA en commits (regla dura del kit). Se siembra, no se impone.
  if (out.includeCoAuthoredBy === undefined) { out.includeCoAuthoredBy = false; seeded.push('includeCoAuthoredBy') }
  if (out.attribution === undefined) { out.attribution = { commits: false, pullRequests: false }; seeded.push('attribution') }
  // Ponytail: los agents tester/constructor lo precargan. Se siembra si falta.
  if (out.enabledPlugins?.['ponytail@ponytail'] === undefined) {
    out.enabledPlugins = { ...(out.enabledPlugins ?? {}), 'ponytail@ponytail': true }
    out.extraKnownMarketplaces = { ...(out.extraKnownMarketplaces ?? {}),
      ponytail: out.extraKnownMarketplaces?.ponytail ?? { source: { source: 'github', repo: 'DietrichGebert/ponytail' } } }
    seeded.push('ponytail')
  }
  return { doc: out, report: { statusLine, seeded, addedPerms } }
}

// Inversa exacta: saca lo nuestro y solo lo nuestro. `seeded` viene del manifiesto.
export function unmergeClaudeSettings(doc: Json, seeded: string[] = [], addedPerms: string[] = []): Json {
  const out = clone(doc)
  for (const event of Object.keys(out.hooks ?? {})) {
    const kept = stripOurs(out.hooks[event])
    if (kept.length) out.hooks[event] = kept
    else delete out.hooks[event]
  }
  if (out.hooks && !Object.keys(out.hooks).length) delete out.hooks
  if (out.permissions) {
    out.permissions.deny = (out.permissions.deny ?? []).filter((p: string) => !addedPerms.includes(p))
    out.permissions.allow = (out.permissions.allow ?? []).filter((p: string) => !addedPerms.includes(p))
    for (const k of ['deny', 'allow']) if (!out.permissions[k].length) delete out.permissions[k]
    if (!Object.keys(out.permissions).length) delete out.permissions
  }
  if (isOurs(out.statusLine?.command)) delete out.statusLine
  // Una clave sembrada se quita solo si sigue con el valor que puso init: si el
  // usuario la cambio despues, ya es suya.
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  if (seeded.includes('includeCoAuthoredBy') && out.includeCoAuthoredBy === false) delete out.includeCoAuthoredBy
  if (seeded.includes('attribution') && same(out.attribution, { commits: false, pullRequests: false })) delete out.attribution
  if (seeded.includes('ponytail') && out.enabledPlugins?.['ponytail@ponytail'] === true) {
    delete out.enabledPlugins['ponytail@ponytail']
    delete out.extraKnownMarketplaces?.ponytail
  }
  // Un objeto que quedo vacio por sacar lo nuestro no se deja como cascara.
  for (const k of ['enabledPlugins', 'extraKnownMarketplaces']) {
    if (out[k] && !Object.keys(out[k]).length) delete out[k]
  }
  return out
}

// --- Codex: hooks.json (el git-guard de Codex, mismo contrato de salida) ---
export function mergeCodexHooks(doc: Json, ctx: Ctx): Json {
  const out = clone(doc)
  out.hooks ??= {}
  const pre = stripOurs(out.hooks.PreToolUse)
  pre.push({ matcher: '^Bash$', hooks: [{ type: 'command', command: orqCmd(ctx, 'hook git-guard'), timeout: 5, statusMessage: 'Validando politica Git' }] })
  pre.push({ matcher: '^(Agent|spawn_agent)$', hooks: [{ type: 'command', command: orqCmd(ctx, 'hook metrics'), timeout: 10 }] })
  out.hooks.PreToolUse = pre
  for (const event of ['SubagentStart', 'SubagentStop']) {
    out.hooks[event] = [...stripOurs(out.hooks[event]), { hooks: [{ type: 'command', command: orqCmd(ctx, 'hook metrics'), timeout: 10 }] }]
  }
  return out
}

export function unmergeCodexHooks(doc: Json): Json {
  const out = clone(doc)
  for (const event of ['PreToolUse', 'SubagentStart', 'SubagentStop']) {
    const kept = stripOurs(out.hooks?.[event])
    if (kept.length) out.hooks[event] = kept
    else if (out.hooks) delete out.hooks[event]
  }
  if (out.hooks && !Object.keys(out.hooks).length) delete out.hooks
  return out
}

// --- Codex: AGENTS.md global con bloque administrado ---
const BLOCK = /\r?\n?<!-- ORQUESTADOR:START -->[\s\S]*?<!-- ORQUESTADOR:END -->\r?\n?/g
export function mergeAgentsBlock(existing: string, managed: string): string {
  const rest = existing.replace(BLOCK, '\n').trimEnd()
  return `${rest ? rest + '\n\n' : ''}<!-- ORQUESTADOR:START -->\n${managed.trim()}\n<!-- ORQUESTADOR:END -->\n`
}
export function unmergeAgentsBlock(existing: string): string {
  const rest = existing.replace(BLOCK, '\n').trim()
  return rest ? rest + '\n' : ''
}
