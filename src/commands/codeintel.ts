// Code intelligence detras de una interfaz minima.
//
// El runtime nunca importa codegraph directamente: codegraph tiene bus factor 1
// (un autor, 5 estrellas) y cambiar de motor tiene que ser cambiar una linea de
// config, no reescribir el runtime. Dos backends (serena, deprecado en D-032):
//   codegraph  tree-sitter + grafo; lo instala orq init en un prefijo propio
//   native     git ls-files + git grep; siempre disponible, es el fallback
//
// Es descubrimiento, no fuente de verdad: orienta y localiza. Lo que se va a
// editar se lee entero, y lo que decide es el compilador, los tests y git diff.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveCommand, run, which } from '../core/proc.ts'
import { loadConfig } from '../core/config.ts'
import { codegraphCli } from './install.ts'

export interface SymbolHit { name: string; file: string; line: number; kind: string }
export interface Ref { file: string; line: number }
export interface CodeIntelProvider {
  id: 'codegraph' | 'native'
  detect(): Promise<boolean>
  ensureIndex(root: string): Promise<void>
  symbols(root: string, query: string): Promise<SymbolHit[]>
  refs(root: string, handle: string): Promise<Ref[]>
  impact(root: string, paths: string[]): Promise<{ dependents: string[]; tests: string[] }>
  orient(root: string): Promise<string>
}

const rel = (root: string, f: string) => path.relative(root, f).replaceAll('\\', '/') || f
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/

// --- codegraph ---
async function cg(root: string, args: string[]): Promise<any> {
  const r = await run({ file: process.execPath, prefix: [codegraphCli()] }, [...args, '--json'], { cwd: root, timeoutMs: 300_000 })
  if (r.code !== 0) throw new Error(`codegraph ${args[0]}: ${r.stderr.trim().split('\n').filter(l => !/ExperimentalWarning|trace-warnings/.test(l)).pop() ?? `exit ${r.code}`}`)
  return JSON.parse(r.stdout)
}

export const codegraph: CodeIntelProvider = {
  id: 'codegraph',
  detect: async () => existsSync(codegraphCli()),
  ensureIndex: async root => { await cg(root, ['orient']) }, // el primer comando construye el indice; despues es incremental
  symbols: async (root, q) => ((await cg(root, ['symbols', q])).symbols ?? []).map((s: any) => ({
    name: s.qualifiedName ?? s.name, file: s.location.file, line: s.location.range.start.line, kind: s.kind })),
  // codegraph resuelve referencias desde una posicion exacta (archivo:linea:col o
  // el handle de `symbols`); con archivo:linea sin columna devuelve not_found.
  // Un nombre suelto se resuelve primero a su handle.
  refs: async (root, handle) => {
    let target = handle
    if (!handle.includes(':')) {
      const s = ((await cg(root, ['symbols', handle])).symbols ?? []).find((x: any) => x.name === handle) ?? null
      if (!s) return []
      target = s.handle
    }
    return ((await cg(root, ['refs', target])).references ?? []).map((r: any) => ({ file: rel(root, r.file), line: r.range.start.line }))
  },
  impact: async (root, paths) => {
    const [a, d] = await Promise.all([cg(root, ['affected', ...paths]), Promise.all(paths.map(p => cg(root, ['rdeps', p])))])
    return {
      tests: (a.affectedTests ?? []).map((t: any) => t.file),
      dependents: [...new Set(d.flatMap((x: any) => (x.items ?? []).map((i: any) => rel(root, i.file))))] as string[],
    }
  },
  orient: async root => {
    const r = await run({ file: process.execPath, prefix: [codegraphCli()] }, ['orient'], { cwd: root, timeoutMs: 300_000 })
    return r.stdout.trim()
  },
}

// --- native: git, siempre disponible ---
async function git(root: string, args: string[]): Promise<string> {
  const g = resolveCommand('git')
  if (!g) throw new Error('git no esta en el PATH')
  return (await run(g, args, { cwd: root, timeoutMs: 60_000 })).stdout
}
const gitLines = async (root: string, args: string[]) => (await git(root, args)).split('\n').filter(Boolean)

// Declaraciones en los lenguajes comunes. Heuristico por construccion: para
// precision de verdad esta codegraph; esto es lo que queda cuando no hay nada.
const DECL = (q: string) => `(function|class|interface|type|enum|def|func|fn|struct|const|let|var)[[:space:]]+${q.replace(/[^\w$]/g, '')}\\b`

export const native: CodeIntelProvider = {
  id: 'native',
  detect: async () => !!which('git'),
  ensureIndex: async () => { /* sin indice: git ya es el indice */ },
  symbols: async (root, q) => (await gitLines(root, ['grep', '-n', '-E', '-I', DECL(q)])).slice(0, 50).map(l => {
    const [file, line, ...rest] = l.split(':')
    return { name: q, file, line: Number(line), kind: rest.join(':').trim().split(/\s+/)[0] }
  }),
  refs: async (root, handle) => (await gitLines(root, ['grep', '-n', '-w', '-I', '-F', handle.split(/[:/]/).pop() ?? handle])).slice(0, 100).map(l => {
    const [file, line] = l.split(':'); return { file, line: Number(line) }
  }),
  impact: async (root, paths) => {
    const stems = paths.map(p => path.basename(p).replace(/\.[^.]+$/, ''))
    const hits = new Set<string>()
    for (const s of stems) for (const f of await gitLines(root, ['grep', '-l', '-I', '-F', s])) hits.add(f)
    for (const p of paths) hits.delete(p.replaceAll('\\', '/'))
    const all = [...hits]
    return { dependents: all.filter(f => !TEST_FILE.test(f)), tests: all.filter(f => TEST_FILE.test(f)) }
  },
  orient: async root => {
    const files = await gitLines(root, ['ls-files'])
    const manifests = files.filter(f => /(^|\/)(package\.json|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|[^/]+\.csproj|[^/]+\.sln|docker-compose\.ya?ml|orq\.config\.json)$/.test(f))
    const top: Record<string, number> = Object.create(null)
    for (const f of files) { const k = f.includes('/') ? f.split('/')[0] + '/' : f; top[k] = (top[k] ?? 0) + 1 }
    return [`${files.length} archivos trackeados`, 'Manifests:', ...manifests.map(m => `  ${m}`), 'Arbol:',
      ...Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `  ${k.padEnd(30)} ${n}`)].join('\n')
  },
}

const BACKENDS: Record<string, CodeIntelProvider> = { codegraph, native }

// El configurado si esta disponible; si no, native. Nunca deja al runtime sin nada.
// Un valor desconocido (p. ej. "serena" de una config vieja) cae a codegraph.
export async function codeIntel(root: string): Promise<CodeIntelProvider> {
  const want = loadConfig(root).codeIntel
  const preferred = BACKENDS[want] ?? codegraph
  for (const p of [preferred, codegraph, native]) if (await p.detect()) return p
  return native
}

export async function codeintelCommand(root: string, sub: string | undefined, args: string[]): Promise<number> {
  const p = await codeIntel(root)
  const out = (s: string) => console.log(s)
  try {
    switch (sub) {
      case 'orient': out(`[${p.id}]`); out(await p.orient(root)); return 0
      case 'symbols': {
        if (!args[0]) { out('uso: orq codeintel symbols <nombre>'); return 6 }
        for (const s of await p.symbols(root, args[0])) out(`${s.file}:${s.line}  ${s.kind}  ${s.name}`)
        return 0
      }
      case 'refs': {
        if (!args[0]) { out('uso: orq codeintel refs <nombre | archivo:linea:col>'); return 6 }
        for (const r of await p.refs(root, args[0])) out(`${r.file}:${r.line}`)
        return 0
      }
      case 'impact': {
        if (!args.length) { out('uso: orq codeintel impact <archivo...>'); return 6 }
        const r = await p.impact(root, args)
        out(`[${p.id}] dependientes (${r.dependents.length}):`); r.dependents.slice(0, 40).forEach(f => out(`  ${f}`))
        if (r.dependents.length > 40) out(`  ... ${r.dependents.length - 40} mas`)
        out(`tests relacionados (${r.tests.length}):`); r.tests.slice(0, 40).forEach(f => out(`  ${f}`))
        return 0
      }
      default: out('uso: orq codeintel orient|symbols|refs|impact'); return 6
    }
  } catch (e: any) {
    out(`[${p.id}] ${e.message}`)
    return 1
  }
}
