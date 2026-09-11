// Spawn portable. Todo proceso hijo del runtime pasa por aca.
//
// Nunca `shell: true`: los args van como array y no hay quoting que escapar,
// que es de donde salia toda la superficie de inyeccion y los bugs de
// ConvertTo-CmdArg del wrapper PowerShell. En Windows eso choca con los shims
// de npm (`codex.cmd`), que Node se niega a lanzar sin shell desde el fix de
// CVE-2024-27980: resolveCommand lee el shim y lanza `node <script.js>` directo.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export const IS_WIN = process.platform === 'win32'

export interface Command { file: string; prefix: string[] }

function isFile(p: string): boolean {
  try { return statSync(p).isFile() } catch { return false }
}

// Busca `name` en el PATH respetando PATHEXT en Windows. Devuelve la ruta o null.
export function which(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (name.includes('/') || name.includes('\\')) return isFile(name) ? name : null
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)
  // En Windows el archivo sin extension (el shim bash de npm) no es ejecutable:
  // solo cuentan las extensiones de PATHEXT.
  const exts = IS_WIN
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(e => e.toLowerCase())
    : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext)
      if (isFile(p)) return p
    }
  }
  return null
}

// Un shim .cmd de npm termina en `"%_prog%" "%dp0%\node_modules\...\x.js" %*`.
// El npm.cmd del instalador de Node usa otro formato: `SET "NPM_CLI_JS=%~dp0\...\npm-cli.js"`.
// ponytail: ignora el override de NPM_PREFIX (npm global actualizado); usa el npm que trae Node.
export function parseNpmShim(cmdPath: string): string | null {
  let text: string
  try { text = readFileSync(cmdPath, 'utf8') } catch { return null }
  const m = text.match(/"%dp0%\\([^"]+?\.(?:c|m)?js)"/i) ?? text.match(/"NPM_CLI_JS=%~dp0\\([^"]+?\.js)"/i)
  if (!m) return null
  const script = path.join(path.dirname(cmdPath), m[1])
  return existsSync(script) ? script : null
}

export function resolveCommand(name: string, env: NodeJS.ProcessEnv = process.env): Command | null {
  const hit = which(name, env)
  if (!hit) return null
  if (IS_WIN && /\.(cmd|bat)$/i.test(hit)) {
    const script = parseNpmShim(hit)
    // ponytail: solo shims de npm; un .cmd arbitrario no se lanza (exigiria shell).
    return script ? { file: process.execPath, prefix: [script] } : null
  }
  return { file: hit, prefix: [] }
}

export interface RunOptions {
  cwd?: string
  input?: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  onLine?: (line: string) => void
}

export interface RunResult { code: number; stdout: string; stderr: string; timedOut: boolean }

export const TIMEOUT_CODE = 124

export function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    if (IS_WIN) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-pid, 'SIGKILL')
  } catch { /* ya murio */ }
}

// Corre `cmd` y resuelve siempre (nunca rechaza): un fallo de spawn vuelve como
// code 127, un timeout como 124. stdin se escribe mientras stdout ya se esta
// drenando, asi que el deadlock de BR-010 no existe por construccion.
export function run(cmd: Command, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise(resolve => {
    let stdout = '', stderr = '', pending = '', timedOut = false, done = false
    const child = spawn(cmd.file, [...cmd.prefix, ...args], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      windowsHide: true,
      detached: !IS_WIN, // grupo propio en POSIX para poder matar el arbol
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const finish = (code: number) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (pending && opts.onLine) opts.onLine(pending)
      resolve({ code, stdout, stderr, timedOut })
    }
    const timer = opts.timeoutMs
      ? setTimeout(() => { timedOut = true; killTree(child.pid); finish(TIMEOUT_CODE) }, opts.timeoutMs)
      : undefined
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (!opts.onLine) return
      const lines = (pending + chunk).split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const l of lines) opts.onLine(l)
    })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', err => { stderr += String(err); finish(127) })
    child.on('close', code => finish(code ?? 1))
    child.stdin.on('error', () => { /* el hijo cerro stdin antes: no es fallo nuestro */ })
    child.stdin.end(opts.input ?? '')
  })
}
