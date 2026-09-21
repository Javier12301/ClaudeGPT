// orq-hidden.exe: launcher sin consola para hooks/statusline en Windows (ver
// docs/ARCHITECTURE.md y native/orq-hidden/orq-hidden.cs). Windows-only:
// depende de un binario compilado por scripts/build-launcher.mjs (csc.exe).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, IS_WIN } from '../src/core/proc.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const LAUNCHER = path.join(ROOT, 'dist', 'native', 'orq-hidden.exe')
const BASH_PROXY = path.join(ROOT, 'dist', 'native', 'bash.exe')
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'echo-args.mjs')

const skip = !IS_WIN ? 'solo Windows' : !existsSync(LAUNCHER) ? 'orq-hidden.exe no compilado: correr npm run build' : false

const launcher = { file: LAUNCHER, prefix: [] }
const target = (...extra: string[]) => [process.execPath, FIX, ...extra]

function peSubsystem(file: string): number {
  const b = readFileSync(file)
  const pe = b.readUInt32LE(0x3c)
  return b.readUInt16LE(pe + 24 + 68)
}

test('los dos launchers son GUI y el proxy se publica con el nombre bash.exe', { skip }, () => {
  assert.ok(existsSync(BASH_PROXY), 'falta dist/native/bash.exe')
  assert.equal(peSubsystem(LAUNCHER), 2, 'orq-hidden.exe debe ser Windows GUI')
  assert.equal(peSubsystem(BASH_PROXY), 2, 'bash.exe debe ser Windows GUI')
})

test('stdin y stdout pasan intactos (sin relay: son los mismos handles)', { skip }, async () => {
  const s = 'hola mundo'
  const r = await run(launcher, target(), { input: s })
  assert.equal(r.code, 0)
  assert.deepEqual(JSON.parse(r.stdout).input, s)
})

test('stderr pasa intacto y el exit code no-cero se propaga', { skip }, async () => {
  const r = await run(launcher, target('stderr'), { input: 'oops' })
  assert.equal(r.code, 7)
  assert.equal(r.stderr, 'err:oops')
})

test('exit code 3 se propaga tal cual', { skip }, async () => {
  const r = await run(launcher, target('exit3'))
  assert.equal(r.code, 3)
})

test('argumentos con espacios, comillas y backslashes llegan intactos', { skip }, async () => {
  const tricky = ['', 'a b', 'a"b', 'a b\\', 'a\\"b', 'C:\\Program Files\\x', '& calc', '$(rm -rf /)']
  const r = await run(launcher, target(...tricky))
  assert.equal(r.code, 0)
  assert.deepEqual(JSON.parse(r.stdout).args, tricky)
})

test('Unicode en stdin/stdout llega sin mangle (los bytes nunca pasan por una capa de texto propia)', { skip }, async () => {
  const s = 'acentos: áéí ñ — "comillas" 日本語 🎉'
  const r = await run(launcher, target(), { input: s })
  assert.equal(r.code, 0)
  assert.equal(JSON.parse(r.stdout).input, s)
})

test('la ruta del propio launcher con espacios funciona', { skip }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orq test '))
  const spaced = path.join(dir, 'orq hidden.exe')
  copyFileSync(LAUNCHER, spaced)
  const r = await run({ file: spaced, prefix: [] }, target(), { input: 'x' })
  assert.equal(r.code, 0)
  assert.equal(JSON.parse(r.stdout).input, 'x')
})

test('invocaciones concurrentes no se cruzan', { skip }, async () => {
  const n = 8
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) => run(launcher, target(`arg${i}`), { input: `in${i}` })),
  )
  results.forEach((r, i) => {
    assert.equal(r.code, 0)
    const parsed = JSON.parse(r.stdout)
    assert.deepEqual(parsed.args, [`arg${i}`])
    assert.equal(parsed.input, `in${i}`)
  })
})

test('bash.exe lee el target, preserva cwd/stdin/stdout/stderr y exit code', { skip }, async () => {
  assert.ok(existsSync(BASH_PROXY), 'falta dist/native/bash.exe')
  const root = mkdtempSync(path.join(os.tmpdir(), 'orq-bash-proxy-'))
  const native = path.join(root, 'dist', 'native')
  mkdirSync(native, { recursive: true })
  const proxy = path.join(native, 'bash.exe')
  copyFileSync(BASH_PROXY, proxy)
  writeFileSync(path.join(root, 'bash-target.txt'), process.execPath)
  const cwd = path.join(root, 'cwd con espacios')
  mkdirSync(cwd)
  const r = await run({ file: proxy, prefix: [] }, [FIX, 'stderr'], { cwd, input: 'entrada' })
  assert.equal(r.code, 7)
  assert.equal(r.stderr, 'err:entrada')
  const parsed = JSON.parse(r.stdout)
  assert.equal(parsed.cwd, cwd)
  assert.deepEqual(parsed.args, ['stderr'])
})
