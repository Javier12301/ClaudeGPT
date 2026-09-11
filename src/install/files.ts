// Escritura con respaldo. Toda modificacion de archivos fuera del repo pasa por
// aca: nada se pisa sin copia previa, nada se escribe si no cambio (eso es lo
// que hace a init idempotente de verdad: la segunda corrida no toca el disco).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { orqHome } from '../core/state.ts'

export const BACKUP_KEEP = 5 // el V1 los acumulaba sin limite (deuda del ROADMAP)

export function listFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p); else out.push(p)
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

// Ruta estable y sin colisiones para guardar una copia de `target`: relativa
// al home si esta adentro; si no (CLAUDE_CONFIG_DIR afuera), un hash de la ruta
// completa, para que dos SKILL.md de carpetas distintas no compartan copia.
export function keyFor(target: string): string {
  const rel = path.relative(os.homedir(), target)
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel
  return path.join('_outside', createHash('sha1').update(path.resolve(target).toLowerCase()).digest('hex').slice(0, 16), path.basename(target))
}

export class Tx {
  readonly changes: string[] = []
  readonly backupRoot: string
  private backedUp = new Set<string>()

  readonly dryRun: boolean

  constructor(dryRun: boolean) {
    this.dryRun = dryRun
    this.backupRoot = path.join(orqHome(), 'backups', new Date().toISOString().replace(/[:.]/g, '-'))
  }

  // Ruta del respaldo: relativa al home para que se entienda de donde vino.
  private backup(target: string): void {
    if (this.backedUp.has(target) || !existsSync(target)) return
    this.backedUp.add(target)
    if (this.dryRun) return
    const dest = path.join(this.backupRoot, keyFor(target))
    mkdirSync(path.dirname(dest), { recursive: true })
    cpSync(target, dest, { recursive: true })
  }

  write(file: string, content: string): boolean {
    let current: string | null = null
    try { current = readFileSync(file, 'utf8') } catch { /* no existe */ }
    if (current === content) return false
    this.changes.push(`${current == null ? 'crear' : 'actualizar'} ${file}`)
    if (this.dryRun) return true
    this.backup(file)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
    return true
  }

  remove(target: string): boolean {
    if (!existsSync(target)) return false
    this.changes.push(`borrar ${target}`)
    if (this.dryRun) return true
    this.backup(target)
    rmSync(target, { recursive: true, force: true })
    return true
  }

  // Copia src -> dst archivo por archivo (solo lo que cambio). Con `exact`, lo
  // que sobra en dst se borra: sirve para directorios 100% nuestros (el runtime).
  copyTree(src: string, dst: string, exact = false): string[] {
    const written: string[] = []
    for (const f of listFiles(src)) {
      const target = path.join(dst, path.relative(src, f))
      this.write(target, readFileSync(f, 'utf8'))
      written.push(target)
    }
    if (exact) for (const f of listFiles(dst)) if (!written.includes(f)) this.remove(f)
    return written
  }

  external(desc: string): void { this.changes.push(desc) }

  // El original de un archivo ajeno que init va a reemplazar. Va a
  // originals/ (fuera de la rotacion de backups) porque uninstall lo restaura:
  // si se podara, uninstall borraria el archivo del usuario en vez de devolverlo.
  preserve(target: string): string {
    const dest = path.join(orqHome(), 'originals', keyFor(target))
    if (!this.dryRun && existsSync(target) && !existsSync(dest)) {
      mkdirSync(path.dirname(dest), { recursive: true })
      cpSync(target, dest)
    }
    return dest
  }

  restore(from: string, to: string): void {
    this.changes.push(`restaurar ${to}`)
    if (this.dryRun) return
    mkdirSync(path.dirname(to), { recursive: true })
    cpSync(from, to)
    rmSync(from, { force: true })
  }

  // Deshace los `remove` de esta transaccion desde sus respaldos.
  rollbackRemovals(): string[] {
    const restored: string[] = []
    for (const target of this.backedUp) {
      const src = path.join(this.backupRoot, keyFor(target))
      if (!existsSync(target) && existsSync(src)) { cpSync(src, target, { recursive: true }); restored.push(target) }
    }
    return restored
  }
}

export function pruneBackups(keep = BACKUP_KEEP): void {
  const dir = path.join(orqHome(), 'backups')
  let entries: string[] = []
  try { entries = readdirSync(dir).filter(n => statSync(path.join(dir, n)).isDirectory()).sort() } catch { return }
  for (const old of entries.slice(0, Math.max(0, entries.length - keep))) rmSync(path.join(dir, old), { recursive: true, force: true })
}
