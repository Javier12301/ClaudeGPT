// init / doctor / uninstall / migrate. Instalacion determinista: nunca se le
// pide a un modelo que "investigue como instalar esto y edite la config".
//
// El manifiesto (~/.orquestador/manifest.json) registra todo lo que init puso:
// archivos, claves sembradas, MCPs agregados. uninstall es su inversa exacta.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolveCommand, run, which, type Command } from '../core/proc.ts'
import { claudeHome, codexHome, orqHome, readJson } from '../core/state.ts'
import { codexInfo } from '../providers/codex.ts'
import { claudeInfo, usageFile } from '../providers/claude.ts'
import { Tx, listFiles, pruneBackups } from '../install/files.ts'
import {
  mergeClaudeSettings, unmergeClaudeSettings, mergeCodexHooks, unmergeCodexHooks,
  mergeAgentsBlock, unmergeAgentsBlock, RUNTIME_MARK, LEGACY_MARK,
} from '../install/merge.ts'

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const KIT = path.join(PKG_ROOT, 'kit')
export const CODEGRAPH_VERSION = '2.3.24' // pinneado: bus factor 1, no se sigue @latest
const MIN_NODE = [22, 16]
const CONTEXT7_URL = 'https://mcp.context7.com/mcp'

export const runtimeDir = () => path.join(orqHome(), 'runtime')
export const runtimeCli = () => path.join(runtimeDir(), 'dist', 'cli.js').replaceAll('\\', '/')
// Windows: launcher sin consola para hooks/statusline (ver docs/DECISIONS.md D-034).
// Vive dentro de dist/ (lo compila scripts/build-launcher.mjs) asi el copyTree
// de mas abajo ya lo instala solo, sin un paso especial.
export const launcherExe = () => path.join(runtimeDir(), 'dist', 'native', 'orq-hidden.exe').replaceAll('\\', '/')
const launcherSrc = () => path.join(PKG_ROOT, 'dist', 'native', 'orq-hidden.exe')
export const manifestFile = () => path.join(orqHome(), 'manifest.json')
const toolsDir = () => path.join(orqHome(), 'tools')
export const codegraphCli = () => path.join(toolsDir(), 'node_modules', '@lzehrung', 'codegraph', 'dist', 'bin', 'cli.js')
const agentsSkillsHome = () => process.env.ORQ_AGENTS_HOME ?? path.join(os.homedir(), '.agents', 'skills')

export interface Manifest {
  version: string; installedAt: string
  files: string[]; seeded: string[]
  created: string[]
  // Permisos que init agrego (no los que el usuario ya tenia) y archivos ajenos
  // que init reemplazo -> ruta de su original. uninstall restaura esos, no los borra.
  addedPerms: string[]; replaced: Record<string, string>
  mcp: { claude: string[]; codex: string[] }
  codeIntel: 'codegraph' | 'none'
  codex: boolean
}

function normalizeManifest(raw: Partial<Manifest> | null): Manifest | null {
  if (!raw) return null
  return {
    version: raw.version ?? '', installedAt: raw.installedAt ?? '',
    files: raw.files ?? [], seeded: raw.seeded ?? [], created: raw.created ?? [],
    addedPerms: raw.addedPerms ?? [], replaced: raw.replaced ?? {},
    mcp: { claude: raw.mcp?.claude ?? [], codex: raw.mcp?.codex ?? [] },
    codeIntel: raw.codeIntel ?? 'none', codex: raw.codex ?? false,
  }
}

const pkgVersion = (): string => JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version
const nodeOk = () => { const [a, b] = process.versions.node.split('.').map(Number); return a > MIN_NODE[0] || (a === MIN_NODE[0] && b >= MIN_NODE[1]) }
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n'

function readJsonStrict(file: string): { ok: true; doc: any } | { ok: false; error: string } {
  if (!existsSync(file)) return { ok: true, doc: {} }
  try { return { ok: true, doc: JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '') || '{}') } }
  catch (e: any) { return { ok: false, error: `${file} no es JSON valido: ${e.message}` } }
}

// Lo que el V1 (PowerShell) dejaba instalado y el V2 reemplaza.
export function legacyArtifacts(): string[] {
  const c = claudeHome(), x = codexHome()
  return [
    path.join(c, 'scripts', 'codex-run.ps1'), path.join(c, 'hooks', 'git-guard.ps1'), path.join(c, 'hooks', 'orq-metrics.ps1'),
    path.join(c, 'statusline-wrapper.ps1'), path.join(c, 'statusline'),
    path.join(x, 'hooks', 'orquestador-git-guard.ps1'),
    path.join(x, 'agents', 'explorador.toml'), path.join(x, 'agents', 'e2e-browser.toml'), path.join(x, 'agents', 'browser-diagnostics.toml'),
    path.join(agentsSkillsHome(), 'constructor'), path.join(agentsSkillsHome(), 'revisor-completo'),
  ].filter(p => existsSync(p))
}

// --- MCPs: presencia deterministica por CLI, nunca editando sus archivos a mano ---
async function claudeHasMcp(cmd: Command, name: string) { return (await run(cmd, ['mcp', 'get', name], { timeoutMs: 60_000 })).code === 0 }
async function codexMcps(cmd: Command): Promise<string[]> {
  const r = await run(cmd, ['mcp', 'list', '--json'], { timeoutMs: 60_000 })
  try { return (JSON.parse(r.stdout) as { name: string }[]).map(m => m.name) } catch { return [] }
}

export interface InitOptions { dryRun: boolean; claudeOnly: boolean; external?: boolean }

// Todo lo que puede hacer fallar a init, verificado antes de escribir nada.
// Un JSON roto no se "arregla" pisandolo: se frena y se dice.
export function preflight(): string | null {
  if (!nodeOk()) return `Node ${process.versions.node}: se requiere >= ${MIN_NODE.join('.')}.`
  if (!which('git')) return 'Falta git en el PATH.'
  if (!existsSync(path.join(PKG_ROOT, 'dist', 'cli.js'))) return 'Falta dist/: corre `npm run build` antes de `orq init`.'
  if (process.platform === 'win32' && !existsSync(launcherSrc())) {
    return 'Falta dist/native/orq-hidden.exe: corre `npm run build` (necesita csc.exe / .NET Framework 4.x, incluido de fabrica en casi todo Windows) antes de `orq init`. Sin el, los hooks en Windows mostrarian consola.'
  }
  for (const file of [path.join(claudeHome(), 'settings.json'), path.join(codexHome(), 'hooks.json')]) {
    const r = readJsonStrict(file)
    if (!r.ok) return `${r.error}\nCorregilo a mano (o restaura un backup) y volve a correr.`
  }
  return null
}

export async function initCommand(o: InitOptions): Promise<number> {
  const blocked = preflight()
  if (blocked) { console.log(blocked); return 1 }
  const partial: { m: Manifest | null } = { m: null }
  try {
    return await install(o, partial)
  } catch (e: any) {
    // Lo instalado hasta la falla queda en el manifiesto: `orq uninstall` lo
    // puede limpiar, y migrate sabe que tiene que restaurar el V1.
    if (!o.dryRun && partial.m) (await import('../core/state.ts')).writeJson(manifestFile(), partial.m)
    console.log(`init fallo: ${e?.message ?? e}${partial.m ? '\nLo instalado hasta aca quedo en el manifiesto: orq uninstall lo limpia.' : ''}`)
    return 1
  }
}

async function install(o: InitOptions, partial: { m: Manifest | null }): Promise<number> {
  const external = o.external ?? true
  const log = (s: string) => console.log(s)

  const settingsFile = path.join(claudeHome(), 'settings.json')
  const settings = readJsonStrict(settingsFile) as { ok: true; doc: any }

  const tx = new Tx(o.dryRun)
  const prev = normalizeManifest(readJson<Partial<Manifest>>(manifestFile()))
  const m: Manifest = { version: pkgVersion(), installedAt: prev?.installedAt || new Date().toISOString(), files: [], seeded: prev?.seeded ?? [], created: prev?.created ?? [],
    addedPerms: prev?.addedPerms ?? [], replaced: prev?.replaced ?? {},
    mcp: { claude: prev?.mcp.claude ?? [], codex: prev?.mcp.codex ?? [] }, codeIntel: prev?.codeIntel ?? 'none', codex: false }
  partial.m = m
  const isWin = process.platform === 'win32'
  const ctx = { runtimeCli: runtimeCli(), launcherExe: isWin ? launcherExe() : null, nodeExe: isWin ? process.execPath.replaceAll('\\', '/') : null }
  let codexHooksChanged = false
  const prevFiles = new Set(prev?.files ?? [])
  // Un archivo que existe y no es nuestro (no estaba en el manifiesto anterior):
  // se preserva su original antes de reemplazarlo, para que uninstall lo devuelva.
  const own = (target: string, content: string) => {
    if (!prevFiles.has(target) && existsSync(target) && !(target in m.replaced)) m.replaced[target] = tx.preserve(target)
    tx.write(target, content)
    m.files.push(target)
  }
  const ownTree = (src: string, dst: string) => { for (const f of listFiles(src)) own(path.join(dst, path.relative(src, f)), readFileSync(f, 'utf8')) }

  // 1. runtime: copia propia, estable aunque el cache de npx se limpie.
  const pkgTarget = path.join(runtimeDir(), 'package.json')
  tx.write(pkgTarget, readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')); m.files.push(pkgTarget)
  m.files.push(...tx.copyTree(path.join(PKG_ROOT, 'dist'), path.join(runtimeDir(), 'dist'), true))
  m.files.push(...tx.copyTree(KIT, path.join(runtimeDir(), 'kit'), true))

  // 2. Claude: skills, agents, settings.
  const claude = await claudeInfo()
  ownTree(path.join(KIT, 'claude', 'skills'), path.join(claudeHome(), 'skills'))
  ownTree(path.join(KIT, 'claude', 'agents'), path.join(claudeHome(), 'agents'))
  const merged = mergeClaudeSettings(settings.doc, ctx)
  if (!existsSync(settingsFile)) m.created.push(settingsFile)
  tx.write(settingsFile, json(merged.doc))
  m.seeded = [...new Set([...m.seeded, ...merged.report.seeded])]
  m.addedPerms = [...new Set([...m.addedPerms, ...merged.report.addedPerms])]

  // 3. Codex, solo con sesion ChatGPT (nunca API key: cambiaria la facturacion).
  const cx = await codexInfo()
  const codexCmd = resolveCommand('codex')
  if (!o.claudeOnly && cx.auth === 'chatgpt') {
    m.codex = true
    ownTree(path.join(KIT, 'codex', 'agents'), path.join(codexHome(), 'agents'))
    ownTree(path.join(KIT, 'codex', 'rules'), path.join(codexHome(), 'rules'))
    ownTree(path.join(KIT, 'codex', 'skills'), agentsSkillsHome())
    const agentsMd = path.join(codexHome(), 'AGENTS.md')
    tx.write(agentsMd, mergeAgentsBlock(existsSync(agentsMd) ? readFileSync(agentsMd, 'utf8') : '', readFileSync(path.join(KIT, 'codex', 'AGENTS.md'), 'utf8')))
    const hooksFile = path.join(codexHome(), 'hooks.json')
    const hooks = readJsonStrict(hooksFile) as { ok: true; doc: any } // validado en preflight
    if (!existsSync(hooksFile)) m.created.push(hooksFile)
    codexHooksChanged = tx.write(hooksFile, json(mergeCodexHooks({ description: 'User-level Codex hooks', ...hooks.doc }, ctx)))
  }

  // 4. MCPs y code intelligence (comandos externos: se saltean en --dry-run).
  const claudeCmd = resolveCommand('claude')
  const addMcp = async (who: 'claude' | 'codex', name: string, args: string[]) => {
    tx.external(`${who} mcp add ${name}`)
    if (o.dryRun || !external) return
    const cmd = who === 'claude' ? claudeCmd! : codexCmd!
    const r = await run(cmd, args, { timeoutMs: 120_000 })
    if (r.code === 0) m.mcp[who] = [...new Set([...m.mcp[who], name])]
    else log(`AVISO: no se pudo registrar ${name} en ${who}: ${r.stderr.trim().split('\n').pop()}`)
  }
  if (external && claudeCmd && !(await claudeHasMcp(claudeCmd, 'context7'))) {
    await addMcp('claude', 'context7', ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'context7', CONTEXT7_URL])
  }
  if (external && m.codex && codexCmd && !(await codexMcps(codexCmd)).includes('context7')) {
    await addMcp('codex', 'context7', ['mcp', 'add', 'context7', '--url', CONTEXT7_URL])
  }
  if (external) {
    // codegraph en un prefijo propio y pinneado: sin npm global, uninstall = borrar el dir.
    if (!existsSync(codegraphCli())) {
      tx.external(`npm install @lzehrung/codegraph@${CODEGRAPH_VERSION} en ${toolsDir()}`)
      if (!o.dryRun) {
        const npm = resolveCommand('npm')
        const r = npm ? await run(npm, ['install', '--prefix', toolsDir(), '--no-audit', '--no-fund', '--omit=dev', `@lzehrung/codegraph@${CODEGRAPH_VERSION}`], { timeoutMs: 600_000 }) : null
        if (!r || r.code !== 0) log(`AVISO: no se pudo instalar codegraph (${r?.stderr.trim().split('\n').pop() ?? 'npm no encontrado'}). Fallback: git ls-files + grep.`)
      }
    }
    if (o.dryRun || existsSync(codegraphCli())) {
      m.codeIntel = 'codegraph'
      const serve = ['--', 'node', codegraphCli().replaceAll('\\', '/'), 'mcp', 'serve', '--root', '.', '--stdio']
      if (claudeCmd && !(await claudeHasMcp(claudeCmd, 'codegraph'))) await addMcp('claude', 'codegraph', ['mcp', 'add', '--scope', 'user', 'codegraph', ...serve])
      if (m.codex && codexCmd && !(await codexMcps(codexCmd)).includes('codegraph')) await addMcp('codex', 'codegraph', ['mcp', 'add', 'codegraph', ...serve])
    }
  }

  // Solo se arrastra ownership del componente Codex cuando esta corrida lo
  // salteo. En componentes reinstalados, un archivo retirado del kit se limpia.
  const inDir = (file: string, dir: string) => { const rel = path.relative(dir, file); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel) }
  const installedCodex = m.codex
  for (const f of prev?.files ?? []) {
    if (m.files.includes(f) || f.startsWith(runtimeDir())) continue
    const codexFile = inDir(f, codexHome()) || inDir(f, agentsSkillsHome())
    if (!installedCodex && codexFile && existsSync(f)) { m.files.push(f); continue }
    const original = m.replaced[f]
    if (original && existsSync(original)) tx.restore(original, f)
    else tx.remove(f)
    delete m.replaced[f]
  }
  m.codex = installedCodex || (!installedCodex && !!prev?.codex)
  m.created = [...new Set(m.created)]
  if (!o.dryRun) {
    if (!prev || json(prev) !== json(m)) (await import('../core/state.ts')).writeJson(manifestFile(), m)
    pruneBackups()
  }

  log(o.dryRun ? '== orq init --dry-run (no se escribio nada) ==' : '== orq init ==')
  log(tx.changes.length ? tx.changes.map(c => `  ${c}`).join('\n') : '  sin cambios: la instalacion ya estaba al dia')
  if (!o.dryRun && tx.changes.length) log(`Respaldos: ${tx.backupRoot}`)
  if (!external) log('Modo --offline: sin registro de MCPs ni descarga de codegraph (code intel cae a git ls-files + grep).')
  if (!claude.installed) log('AVISO: `claude` no esta en el PATH; el kit se instalo igual.')
  if (merged.report.statusLine === 'foreign') log('AVISO: tenes otra statusLine configurada; no se piso. El gate no va a ver la cuota de Claude (degrada a BALANCED).')
  if (o.claudeOnly) log('Modo --claude-only: kit Codex salteado.')
  else if (cx.auth !== 'chatgpt') log(`Codex ${cx.installed ? 'sin sesion ChatGPT' : 'no instalado'}: modo Claude-solo. Para el entorno hibrido: codex login (Sign in with ChatGPT) y orq init.`)
  else if (codexHooksChanged && !o.dryRun) log('Codex exige confiar cada hash nuevo de hooks: abri una sesion interactiva, ejecuta `/hooks` y revisa `~/.codex/hooks.json`. No uses flags de bypass.')
  const legacy = legacyArtifacts()
  if (legacy.length) log(`Instalacion V1 (PowerShell) detectada (${legacy.length} artefactos): orq migrate`)
  if (!which('orq')) log(`\`orq\` no esta en el PATH. Hasta el release: npm link (desde el repo) o node "${runtimeCli()}".`)
  return 0
}

// --- doctor ---
type Status = 'ok' | 'warn' | 'fail'
interface Check { id: string; status: Status; detail: string; fix?: string }

export async function doctorCommand(o: { json: boolean }): Promise<number> {
  const C: Check[] = []
  const add = (id: string, status: Status, detail: string, fix?: string) => C.push({ id, status, detail, fix })

  add('node', nodeOk() ? 'ok' : 'fail', process.versions.node, nodeOk() ? undefined : `instalar Node >= ${MIN_NODE.join('.')}`)
  add('git', which('git') ? 'ok' : 'fail', which('git') ?? 'no encontrado', 'instalar git')
  const cl = await claudeInfo()
  add('claude', cl.installed ? 'ok' : 'warn', cl.version ?? 'no encontrado', 'instalar Claude Code')
  const cx = await codexInfo()
  add('codex', cx.installed ? (cx.auth === 'chatgpt' ? 'ok' : 'warn') : 'warn',
    cx.installed ? `${cx.version} (auth: ${cx.auth})` : 'no instalado: modo Claude-solo',
    cx.installed && cx.auth !== 'chatgpt' ? 'codex login (Sign in with ChatGPT)' : undefined)

  const m = normalizeManifest(readJson<Partial<Manifest>>(manifestFile()))
  add('runtime', m && existsSync(runtimeCli()) ? (m.version === pkgVersion() ? 'ok' : 'warn') : 'fail',
    m ? `v${m.version} en ${runtimeDir()}` : 'no instalado', m?.version !== pkgVersion() ? 'orq init' : undefined)
  add('orq en PATH', which('orq') ? 'ok' : 'warn', which('orq') ?? 'no', 'npm link / npm i -g orquestador')

  const s = readJsonStrict(path.join(claudeHome(), 'settings.json'))
  if (!s.ok) add('settings.json', 'fail', s.error, 'corregir el JSON o restaurar un backup')
  else {
    const cmds: string[] = Object.values(s.doc.hooks ?? {}).flat().flatMap((g: any) => (g?.hooks ?? []).map((h: any) => String(h?.command ?? '')))
    for (const h of ['git-guard', 'metrics', 'session-start']) {
      const n = cmds.filter(c => c.includes(RUNTIME_MARK) && c.includes(`hook ${h}`)).length
      const expected = h === 'metrics' ? 4 : 1
      add(`hook ${h}`, n === expected ? 'ok' : n ? 'warn' : 'fail', `${n} registro(s), esperado ${expected}`, 'orq init')
    }
    const leg = cmds.filter(c => LEGACY_MARK.test(c))
    if (leg.length) add('hooks V1', 'warn', `${leg.length} hook(s) PowerShell todavia registrados`, 'orq migrate')
    const guard = (s.doc.hooks?.PreToolUse ?? []).find((g: any) => JSON.stringify(g).includes('hook git-guard'))
    if (guard && !/PowerShell/.test(guard.matcher)) add('git-guard PowerShell', 'fail', 'el guard no cubre la tool PowerShell', 'orq init')
    const sl = String(s.doc.statusLine?.command ?? '')
    add('statusline', sl.includes(RUNTIME_MARK) ? 'ok' : 'warn', sl || 'ninguna',
      sl.includes(RUNTIME_MARK) ? undefined : 'sin la statusline de orq el gate no ve la cuota de Claude')
    if (s.doc.permissions?.defaultMode === 'bypassPermissions') add('permisos', 'warn', 'defaultMode = bypassPermissions (lo sembraba el V1)', 'evaluar volver a un modo con prompts; orq no lo necesita')
  }
  const usage = readJson<{ ts: string }>(usageFile())
  add('cuota Claude', usage ? 'ok' : 'warn', usage ? `ultima lectura ${usage.ts}` : 'sin datos todavia',
    usage ? undefined : 'aparece tras la primera respuesta en una sesion con la statusline de orq (planes Pro/Max)')

  if (m) {
    const missing = m.files.filter(f => !existsSync(f))
    add('archivos del kit', missing.length ? 'fail' : 'ok', missing.length ? `${missing.length} faltantes (ej. ${missing[0]})` : `${m.files.length} presentes`, 'orq init')
  }
  if (m?.codex) {
    const h = readJsonStrict(path.join(codexHome(), 'hooks.json'))
    const n = h.ok ? JSON.stringify(h.doc).split('hook git-guard').length - 1 : 0
    add('codex git-guard', h.ok && n === 1 ? 'ok' : 'fail', h.ok ? `${n} registro(s)` : h.error, 'orq init')
    const metrics = h.ok ? JSON.stringify(h.doc).split('hook metrics').length - 1 : 0
    add('codex metrics', h.ok && metrics === 3 ? 'ok' : 'fail', h.ok ? `${metrics} registro(s), esperado 3` : h.error, 'orq init')
    const r = resolveCommand('codex')
    if (r) {
      const d = await run(r, ['doctor', '--summary'], { timeoutMs: 120_000 })
      const tail = d.stdout.trim().split('\n').pop() ?? ''
      add('codex doctor', d.code === 0 ? 'ok' : 'warn', tail.slice(0, 120))
    }
  }

  const cg = existsSync(codegraphCli())
  add('code intel', cg ? 'ok' : 'warn', cg ? `codegraph ${CODEGRAPH_VERSION}` : 'codegraph no instalado: fallback git ls-files + grep', cg ? undefined : 'orq init')
  const idx = existsSync(path.join(process.cwd(), '.codegraph'))
  if (cg) add('indice del repo', idx ? 'ok' : 'warn', idx ? '.codegraph/ presente' : 'sin indice en este repo', 'orq codeintel orient (lo crea)')

  const legacy = legacyArtifacts()
  if (legacy.length) add('instalacion V1', 'warn', `${legacy.length} artefactos PowerShell`, 'orq migrate')

  if (o.json) console.log(JSON.stringify(C, null, 2))
  else {
    const icon = { ok: '[ok]  ', warn: '[warn]', fail: '[FAIL]' }
    for (const c of C) console.log(`${icon[c.status]} ${c.id.padEnd(22)} ${c.detail}${c.fix && c.status !== 'ok' ? `\n        -> ${c.fix}` : ''}`)
  }
  return C.some(c => c.status === 'fail') ? 1 : 0
}

// --- uninstall: la inversa exacta del manifiesto ---
export async function uninstallCommand(o: { dryRun: boolean; external?: boolean }): Promise<number> {
  const m = normalizeManifest(readJson<Partial<Manifest>>(manifestFile()))
  if (!m) { console.log('No hay instalacion de orq (sin manifiesto). Nada que hacer.'); return 0 }
  const tx = new Tx(o.dryRun)
  const sf = path.join(claudeHome(), 'settings.json')
  const s = readJsonStrict(sf)
  if (s.ok && existsSync(sf)) {
    const clean = unmergeClaudeSettings(s.doc, m.seeded, m.addedPerms)
    if (m.created.includes(sf) && emptyConfig(clean)) tx.remove(sf); else tx.write(sf, json(clean))
  }
  if (m.codex) {
    const hf = path.join(codexHome(), 'hooks.json')
    const h = readJsonStrict(hf)
    if (h.ok && existsSync(hf)) {
      const clean = unmergeCodexHooks(h.doc)
      if (m.created.includes(hf) && emptyConfig(clean)) tx.remove(hf); else tx.write(hf, json(clean))
    }
    const am = path.join(codexHome(), 'AGENTS.md')
    if (existsSync(am)) {
      const rest = unmergeAgentsBlock(readFileSync(am, 'utf8'))
      if (rest) tx.write(am, rest); else tx.remove(am)
    }
  }
  for (const f of m.files) {
    const original = m.replaced?.[f]
    if (original && existsSync(original)) tx.restore(original, f)
    else tx.remove(f)
  }
  // Directorios de skills que quedaron vacios.
  for (const d of [...new Set(m.files.map(f => path.dirname(f)))].sort((a, b) => b.length - a.length)) {
    if (!o.dryRun && existsSync(d) && !listFiles(d).length && !d.includes(RUNTIME_MARK)) tx.remove(d)
  }
  if (o.external ?? true) {
    for (const [who, names] of Object.entries(m.mcp) as ['claude' | 'codex', string[]][]) {
      const cmd = resolveCommand(who)
      for (const n of names) {
        tx.external(`${who} mcp remove ${n}`)
        if (!o.dryRun && cmd) await run(cmd, who === 'claude' ? ['mcp', 'remove', '--scope', 'user', n] : ['mcp', 'remove', n], { timeoutMs: 60_000 })
      }
    }
  }
  tx.remove(toolsDir())
  tx.remove(runtimeDir())
  tx.remove(manifestFile())
  console.log(o.dryRun ? '== orq uninstall --dry-run ==' : '== orq uninstall ==')
  console.log(tx.changes.map(c => `  ${c}`).join('\n'))
  if (!o.dryRun) console.log(`Respaldos (se conservan): ${path.join(orqHome(), 'backups')}`)
  return 0
}

function emptyConfig(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(emptyConfig)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).every(([k, v]) =>
    (k === 'description' && v === 'User-level Codex hooks') || emptyConfig(v))
}

// --- migrate: V1 PowerShell -> V2 ---
export async function migrateCommand(o: { dryRun: boolean; external?: boolean }): Promise<number> {
  // Primero lo que puede hacer fallar a init: si falla, el V1 queda intacto.
  const blocked = preflight()
  if (blocked) { console.log(`${blocked}\nNo se toco la instalacion V1.`); return 1 }
  const legacy = legacyArtifacts()
  const tx = new Tx(o.dryRun)
  for (const f of legacy) tx.remove(f)
  console.log(legacy.length ? `== Migracion V1 -> V2: ${legacy.length} artefactos PowerShell ==` : 'No hay artefactos V1.')
  console.log(tx.changes.map(c => `  ${c}`).join('\n'))
  if (legacy.length && !o.dryRun) console.log(`Respaldos: ${tx.backupRoot}`)
  // El V1 imponia claves globales en ~/.codex/config.toml. No se revierten solas
  // (el usuario puede depender de ellas): se nombran para que las revise.
  const toml = path.join(codexHome(), 'config.toml')
  if (existsSync(toml)) {
    const t = readFileSync(toml, 'utf8')
    const imposed = [/^model\s*=\s*"gpt-5\.6-sol"/m, /^approval_policy\s*=\s*"never"/m, /^sandbox_mode\s*=\s*"danger-full-access"/m].filter(r => r.test(t))
    if (imposed.length) console.log(`Revisar a mano en ${toml}: ${imposed.length} clave(s) globales que imponia el V1 (model fijo, approval_policy=never, sandbox_mode=danger-full-access). El V2 no las necesita: los roles declaran su sandbox en su .toml.`)
  }
  // init reemplaza los hooks/statusline V1 en settings.json y hooks.json.
  let code = 1
  try { code = await initCommand({ dryRun: o.dryRun, claudeOnly: false, external: o.external }) } catch { code = 1 }
  if (code !== 0 && !o.dryRun) {
    const back = tx.rollbackRemovals()
    console.log(`init fallo: se restauraron ${back.length} artefactos V1. La instalacion queda como estaba.`)
  }
  return code
}
