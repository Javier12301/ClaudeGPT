// Jobs en background para ASYNC_REVIEW (D-015 diferia esto hasta que hiciera
// falta paralelismo real: ya hace falta).
//
// Un job es un archivo: <repo>/.orquestador/jobs/<id>.json. Sin daemon ni cola.
// El tope de concurrencia lo aplica el runtime, no el prompt: un segundo
// reviewer sobre la misma tarea se RECHAZA, no se encola en silencio.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { readJson, repoState, sleepSync, writeJson } from './state.ts'

export interface Job {
  id: string; pid: number | null; role: string; task: string
  status: 'running' | 'done' | 'failed'
  started: string; finished?: string; exit_code?: number; summary?: string[]
}

export const jobsDir = (repo: string) => path.join(repoState(repo), 'jobs')
export const jobFile = (repo: string, id: string) => path.join(jobsDir(repo), `${id}.json`)
export const newJobId = () => `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex')}`

export function isAlive(pid: number | null | undefined): boolean {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (e: any) { return e?.code === 'EPERM' }
}

export function listJobs(repo: string): Job[] {
  let names: string[] = []
  try { names = readdirSync(jobsDir(repo)).filter(n => n.endsWith('.json')) } catch { return [] }
  return names.map(n => readJson<Job>(path.join(jobsDir(repo), n))).filter((j): j is Job => !!j)
    .sort((a, b) => a.started.localeCompare(b.started))
}

// Un job "running" cuyo proceso ya no existe murio sin cleanup: no bloquea.
export function activeJobs(repo: string, task: string): Job[] {
  return listJobs(repo).filter(j => j.status === 'running' && j.task === task && isAlive(j.pid))
}

export function saveJob(repo: string, job: Job): void { writeJson(jobFile(repo, job.id), job) }
export function loadJob(repo: string, id: string): Job | null { return readJson<Job>(jobFile(repo, id)) }

// Admision atomica: el chequeo del tope y la creacion del job van bajo un lock
// exclusivo por tarea (mkdir es atomico en todos los SO). Sin esto, N
// lanzamientos simultaneos ven "0 activos" y entran todos (lo encontro el
// review adversarial: 8 concurrentes, 3 admitidos).
export const LOCK_STALE_MS = 30_000
export function withTaskLock<T>(repo: string, task: string, fn: () => T, waitMs = 10_000): T {
  const dir = path.join(jobsDir(repo), `.lock-${createHash('sha1').update(task).digest('hex').slice(0, 12)}`)
  mkdirSync(jobsDir(repo), { recursive: true })
  const deadline = Date.now() + waitMs
  const token = `${process.pid}:${randomBytes(6).toString('hex')}`
  const owner = path.join(dir, 'owner')
  for (;;) {
    try { mkdirSync(dir); writeFileSync(owner, token); break } catch (e: any) {
      if (e.code !== 'EEXIST') throw e
      // Se recupera solo un lock viejo cuyo duenio ya no existe: a un proceso
      // vivo (aunque este lento) nunca se le roba.
      try {
        const holder = Number((readOwner(owner) ?? '').split(':')[0])
        if (Date.now() - statSync(dir).mtimeMs > LOCK_STALE_MS && !isAlive(holder)) { rmSync(dir, { recursive: true, force: true }); continue }
      } catch { /* ya lo solto */ }
      if (Date.now() > deadline) throw new Error(`lock ocupado por otro lanzamiento: ${dir}`)
      sleepSync(25)
    }
  }
  try { return fn() } finally {
    // Se suelta solo si sigue siendo nuestro.
    if (readOwner(owner) === token) rmSync(dir, { recursive: true, force: true })
  }
}

function readOwner(file: string): string | null {
  try { return readFileSync(file, 'utf8') } catch { return null }
}
