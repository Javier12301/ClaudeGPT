// orq.config.json en la raiz del repo. Opcional: sin archivo, defaults.
import path from 'node:path'
import { readJson } from './state.ts'

export interface Config {
  // Comandos del FAST CHECKPOINT, en orden de coste. Solo corren los declarados:
  // un repo sin typecheck no lo tiene, y no se inventa.
  checks: Partial<Record<'format' | 'lint' | 'typecheck' | 'test' | 'build', string>>
  codeIntel: 'codegraph' | 'native'
  asyncReview: { maxConcurrent: number }
}

export const CHECK_ORDER = ['format', 'lint', 'typecheck', 'test', 'build'] as const

export function loadConfig(repo: string): Config {
  const c = readJson<Partial<Config>>(path.join(repo, 'orq.config.json')) ?? {}
  const maxConcurrent = c.asyncReview?.maxConcurrent
  return {
    checks: c.checks ?? {},
    codeIntel: c.codeIntel ?? 'codegraph', // si no esta instalado, codeIntel() cae a native
    // Tope duro de ASYNC_REVIEW: 1 reviewer externo activo por tarea. Subirlo
    // es una decision explicita del repo, nunca un default.
    asyncReview: { maxConcurrent: typeof maxConcurrent === 'number' && Number.isFinite(maxConcurrent) && Number.isInteger(maxConcurrent) && maxConcurrent >= 1 ? maxConcurrent : 1 },
  }
}
