// `orq worktree`: aislamiento para writers paralelos reales (topologia PARALLEL).
//
// Solo cuando dos unidades escriben codigo a la vez. Un reviewer read-only no
// necesita worktree, y el trabajo secuencial tampoco. Nunca hay merge
// automatico: el runtime crea, lista y limpia; integrar es decision del
// razonador despues de un checkpoint en verde.
import path from 'node:path'
import { existsSync, realpathSync } from 'node:fs'
import { resolveCommand, run } from '../core/proc.ts'

const NAME = /^[a-z0-9][a-z0-9_-]{0,40}$/ // entra en una ruta y en un nombre de branch: sin inyeccion posible
export const branchFor = (name: string) => `orq/${name}`
export const pathFor = (root: string, name: string) => path.join(path.dirname(root), `${path.basename(root)}.wt`, name)

async function git(root: string, args: string[]) {
  const g = resolveCommand('git')
  if (!g) return { code: 127, stdout: '', stderr: 'git no esta en el PATH', timedOut: false }
  return run(g, args, { cwd: root, timeoutMs: 120_000 })
}

// En Windows git reporta la ruta larga y os.tmpdir() puede dar la corta 8.3
// (JAVIER~1.RAM): se comparan canonicas, y sin distinguir mayusculas.
export function samePath(a: string, b: string): boolean {
  const canon = (p: string) => { let r = path.resolve(p); try { r = realpathSync.native(r) } catch { /* no existe */ } return process.platform === 'win32' ? r.toLowerCase() : r }
  return canon(a) === canon(b)
}

export interface Worktree { path: string; branch: string | null; head: string }
export async function listWorktrees(root: string): Promise<Worktree[]> {
  const r = await git(root, ['worktree', 'list', '--porcelain'])
  return r.stdout.split(/\r?\n\r?\n/).filter(Boolean).map(block => {
    const get = (k: string) => block.match(new RegExp(`^${k} (.+)$`, 'm'))?.[1] ?? null
    return { path: path.resolve(get('worktree') ?? ''), branch: get('branch')?.replace('refs/heads/', '') ?? null, head: get('HEAD') ?? '' }
  })
}

export async function addWorktree(root: string, name: string): Promise<{ code: number; msg: string }> {
  if (!NAME.test(name)) return { code: 6, msg: `nombre invalido: "${name}" (a-z, 0-9, - y _; max 41)` }
  const dir = pathFor(root, name), branch = branchFor(name)
  const existing = (await listWorktrees(root)).find(w => samePath(w.path, dir))
  if (existing) return { code: 0, msg: `ya existe: ${dir} (${existing.branch}) - se reusa` }
  if (existsSync(dir)) return { code: 1, msg: `${dir} existe pero no es un worktree de este repo: no se toca` }
  const hasBranch = (await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).code === 0
  const r = await git(root, hasBranch ? ['worktree', 'add', dir, branch] : ['worktree', 'add', '-b', branch, dir])
  if (r.code !== 0) return { code: 1, msg: `git worktree add fallo: ${r.stderr.trim()}` }
  return { code: 0, msg: `${dir}\nbranch ${branch}${hasBranch ? ' (existente)' : ' (nueva, desde HEAD)'}\nEl writer trabaja ahi (orq run --repo "${dir}"). Integrar solo tras orq checkpoint fast en verde.` }
}

export async function removeWorktree(root: string, name: string): Promise<{ code: number; msg: string }> {
  if (!NAME.test(name)) return { code: 6, msg: `nombre invalido: "${name}"` }
  const dir = pathFor(root, name)
  const wt = (await listWorktrees(root)).find(w => samePath(w.path, dir))
  if (!wt) return { code: 0, msg: `no hay worktree ${name}` }
  const dirty = (await git(dir, ['status', '--porcelain'])).stdout.trim()
  if (dirty) return { code: 1, msg: `${dir} tiene cambios sin commitear: no se borra (el trabajo se perderia).\n${dirty.split('\n').slice(0, 10).join('\n')}` }
  const r = await git(root, ['worktree', 'remove', dir])
  if (r.code !== 0) return { code: 1, msg: `git worktree remove fallo: ${r.stderr.trim()}` }
  // `branch -d` (no -D): git se niega si no esta integrada, que es lo que queremos.
  const b = await git(root, ['branch', '-d', branchFor(name)])
  return { code: 0, msg: `worktree ${name} eliminado.${b.code === 0 ? ` branch ${branchFor(name)} borrada (estaba integrada).` : ` branch ${branchFor(name)} se conserva: tiene commits sin integrar.`}` }
}

export async function worktreeCommand(root: string, sub: string | undefined, name: string | undefined): Promise<number> {
  if (sub === 'list') {
    const wts = (await listWorktrees(root)).filter(w => w.branch?.startsWith('orq/'))
    console.log(wts.length ? wts.map(w => `${w.branch}  ${w.path}`).join('\n') : 'Sin worktrees de orq.')
    return 0
  }
  if ((sub === 'add' || sub === 'remove') && name) {
    const r = sub === 'add' ? await addWorktree(root, name) : await removeWorktree(root, name)
    console.log(r.msg)
    return r.code
  }
  console.log('uso: orq worktree add|remove <nombre> | orq worktree list')
  return 6
}
