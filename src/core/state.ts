// Rutas y persistencia. Todo lo que el runtime guarda es JSON o JSONL chico.
//
// Tres lugares, y nada mas:
//   ~/.orquestador/          estado de la maquina: cuota de Claude, heartbeat,
//                            copia instalada del runtime, manifiesto.
//   <repo>/.orquestador/     estado operacional del repo: decisions.jsonl,
//                            jobs/, plan.json. Gitignoreado.
//   ~/.claude, ~/.codex      config de los proveedores; solo la toca install/.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const orqHome = (): string =>
  process.env.ORQ_HOME ?? path.join(os.homedir(), '.orquestador')

// CLAUDE_CONFIG_DIR es la variable oficial; CLAUDE_HOME la usaba el kit PowerShell.
export const claudeHome = (): string =>
  process.env.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.claude')

export const codexHome = (): string =>
  process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex')

export const repoState = (repo: string): string => path.join(repo, '.orquestador')

export function readJson<T = any>(file: string): T | null {
  // El BOM lo deja PowerShell 5.1 al escribir UTF-8: se tolera al leer.
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as T } catch { return null }
}

// Escritura atomica: un lector concurrente (la statusline, un hook) nunca ve
// un archivo a medio escribir.
export function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  // En Windows, renombrar sobre un archivo que otro proceso esta leyendo falla
  // con EPERM/EBUSY por un instante: se reintenta en vez de perder la escritura.
  for (let i = 0; ; i++) {
    try { renameSync(tmp, file); return } catch (e: any) {
      if (i >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e
      sleepSync(10)
    }
  }
}

export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function appendJsonl(file: string, row: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  appendFileSync(file, JSON.stringify(row) + '\n')
}

export function readJsonl<T = any>(file: string): T[] {
  let text: string
  try { text = readFileSync(file, 'utf8') } catch { return [] }
  const rows: T[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line)) } catch { /* linea corrupta: se saltea, no rompe el reporte */ }
  }
  return rows
}
