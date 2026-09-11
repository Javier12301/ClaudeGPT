import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, which, resolveCommand, parseNpmShim, TIMEOUT_CODE, IS_WIN } from '../src/core/proc.ts'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'echo-args.mjs')
const node = { file: process.execPath, prefix: [FIX] }

test('args con espacios, comillas y backslashes llegan intactos (sin quoting manual)', async () => {
  const tricky = ['', 'a b', 'a"b', 'a b\\', 'a\\"b', 'C:\\Program Files\\x', '& calc', '$(rm -rf /)', 'ñandú → ok']
  const r = await run(node, tricky)
  assert.equal(r.code, 0)
  assert.deepEqual(JSON.parse(r.stdout).args, tricky)
})

test('exit code se propaga', async () => {
  assert.equal((await run(node, ['exit3'])).code, 3)
})

test('timeout mata el proceso y devuelve 124', async () => {
  const t0 = Date.now()
  const r = await run(node, ['sleep'], { timeoutMs: 500 })
  assert.equal(r.code, TIMEOUT_CODE)
  assert.equal(r.timedOut, true)
  assert.ok(Date.now() - t0 < 10_000)
})

test('BR-010: stdin de 500 KB contra un hijo que inunda stdout no hace deadlock', async () => {
  const lines: string[] = []
  const r = await run(node, ['flood'], { input: 'x'.repeat(500_000), timeoutMs: 30_000, onLine: l => lines.push(l) })
  assert.equal(r.code, 0)
  assert.ok(lines.length >= 2001, 'onLine recibe todas las lineas')
  assert.match(r.stdout, /"len":500000/)
})

test('UTF-8 en stdin llega sin mangle', async () => {
  const s = 'acentos: áéí ñ — “comillas”'
  const r = await run(node, [], { input: s })
  assert.equal(JSON.parse(r.stdout).len, s.length)
})

test('comando inexistente resuelve con 127, no rechaza', async () => {
  const r = await run({ file: path.join(os.tmpdir(), 'no-existe-xyz'), prefix: [] }, [])
  assert.equal(r.code, 127)
})

test('which devuelve null si el binario no esta en el PATH', () => {
  assert.equal(which('definitivamente-no-existe-orq', { PATH: os.tmpdir() }), null)
  assert.equal(resolveCommand('definitivamente-no-existe-orq', { PATH: os.tmpdir() }), null)
})

test('shim npm .cmd se resuelve a node + script (sin shell)', { skip: !IS_WIN }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orq-shim-'))
  const pkg = path.join(dir, 'node_modules', 'fake', 'bin')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(path.join(pkg, 'fake.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
  writeFileSync(path.join(dir, 'fake.cmd'),
    '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\fake\\bin\\fake.js" %*\r\n')
  assert.equal(parseNpmShim(path.join(dir, 'fake.cmd')), path.join(pkg, 'fake.js'))
  const cmd = resolveCommand('fake', { PATH: dir, PATHEXT: '.EXE;.CMD' })
  assert.ok(cmd)
  const r = await run(cmd, ['a b', '& echo pwned'])
  assert.deepEqual(JSON.parse(r.stdout), ['a b', '& echo pwned'])
})

test('el npm.cmd del instalador de Node se resuelve a npm-cli.js', { skip: !IS_WIN }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orq-npmcmd-'))
  const bin = path.join(dir, 'node_modules', 'npm', 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(path.join(bin, 'npm-prefix.js'), '')
  writeFileSync(path.join(bin, 'npm-cli.js'), '')
  writeFileSync(path.join(dir, 'npm.cmd'),
    '@ECHO OFF\r\nSET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"\r\nSET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"\r\n"%NODE_EXE%" "%NPM_CLI_JS%" %*\r\n')
  assert.equal(parseNpmShim(path.join(dir, 'npm.cmd')), path.join(bin, 'npm-cli.js'))
})

test('un .cmd que no es shim de npm no se lanza', { skip: !IS_WIN }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orq-shim-'))
  writeFileSync(path.join(dir, 'raro.cmd'), '@echo hola\r\n')
  assert.equal(resolveCommand('raro', { PATH: dir, PATHEXT: '.CMD' }), null)
})
