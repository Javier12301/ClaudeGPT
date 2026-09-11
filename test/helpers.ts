// Entorno aislado para tests de punta a punta: homes temporales, un Codex falso
// en el PATH (via shim npm en Windows, ejecutable en POSIX) y el CLI real.
import { chmodSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, '..')
export const CLI = path.join(ROOT, 'src', 'cli.ts')
const FAKE = path.join(HERE, 'fixtures', 'fake-codex.mjs')

export function fakeBin(): string {
  const bin = mkdtempSync(path.join(os.tmpdir(), 'orq-bin-'))
  if (process.platform === 'win32') {
    const pkg = path.join(bin, 'node_modules', 'fake-codex', 'bin')
    mkdirSync(pkg, { recursive: true })
    cpSync(FAKE, path.join(pkg, 'codex.js'))
    writeFileSync(path.join(bin, 'codex.cmd'), '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\fake-codex\\bin\\codex.js" %*\r\n')
  } else {
    writeFileSync(path.join(bin, 'codex'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`)
    chmodSync(path.join(bin, 'codex'), 0o755)
  }
  return bin
}

export interface Sandbox { home: string; repo: string; env: NodeJS.ProcessEnv }

// withCodex=false: PATH sin codex (y sin claude), para probar la degradacion.
export function sandbox(withCodex = true): Sandbox {
  const home = mkdtempSync(path.join(os.tmpdir(), 'orq-home-'))
  const repo = path.join(home, 'repo')
  mkdirSync(repo)
  spawnSync('git', ['init', '-q', repo])
  const codexHome = path.join(home, '.codex')
  cpSync(path.join(ROOT, 'kit', 'codex', 'agents'), path.join(codexHome, 'agents'), { recursive: true })
  const gitDir = path.dirname(spawnSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0])
  const nodeDir = path.dirname(process.execPath)
  const PATH = [withCodex ? fakeBin() : null, nodeDir, gitDir, process.platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin:/bin'].filter(Boolean).join(path.delimiter)
  const env: NodeJS.ProcessEnv = {
    ...process.env, PATH, Path: undefined, HOME: home, USERPROFILE: home,
    ORQ_HOME: path.join(home, '.orquestador'), CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    ORQ_AGENTS_HOME: path.join(home, '.agents', 'skills'), CLAUDE_CODE_SESSION_ID: 'TEST-SESSION', ORQ_SESSION_ID: undefined,
  }
  return { home, repo, env }
}

export function orq(sb: Sandbox, args: string[], extraEnv: NodeJS.ProcessEnv = {}, input?: string) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: sb.repo, env: { ...sb.env, ...extraEnv }, encoding: 'utf8', input, timeout: 120_000 })
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` }
}
