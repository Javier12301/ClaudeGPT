// init / uninstall / migrate contra homes temporales (nunca el home real).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sandbox, orq, type Sandbox } from './helpers.ts'
import { keyFor, listFiles } from '../src/install/files.ts'

// Foto del estado instalado: todo archivo bajo los homes, con su contenido.
function snapshot(sb: Sandbox): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of ['.claude', '.codex', '.agents', path.join('.orquestador', 'runtime')]) {
    for (const f of listFiles(path.join(sb.home, d))) out[path.relative(sb.home, f)] = readFileSync(f, 'utf8')
  }
  const manifest = path.join(sb.home, '.orquestador', 'manifest.json')
  if (existsSync(manifest)) out[path.relative(sb.home, manifest)] = readFileSync(manifest, 'utf8')
  return out
}
const settings = (sb: Sandbox) => JSON.parse(readFileSync(path.join(sb.home, '.claude', 'settings.json'), 'utf8'))

const userSettings = {
  model: 'sonnet',
  permissions: { deny: ['Bash(rm -rf *)'], allow: ['Read(~/notas/**)'] },
  hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier --write' }] }] },
}

test('init es idempotente: la segunda corrida no cambia ni un byte ni crea backups', () => {
  const sb = sandbox()
  mkdirSync(path.join(sb.home, '.claude'), { recursive: true })
  writeFileSync(path.join(sb.home, '.claude', 'settings.json'), JSON.stringify(userSettings))
  const a = orq(sb, ['init', '--offline'])
  assert.equal(a.code, 0, a.out)
  const first = snapshot(sb)
  const b = orq(sb, ['init', '--offline'])
  assert.equal(b.code, 0, b.out)
  assert.match(b.out, /sin cambios/)
  assert.doesNotMatch(b.out, /\/hooks/, 'no pide revisar hooks si su hash no cambió')
  assert.deepEqual(snapshot(sb), first)
})

test('init instala runtime, skills, agents, hooks y el kit Codex (sesion ChatGPT)', () => {
  const sb = sandbox()
  const init = orq(sb, ['init', '--offline'])
  assert.equal(init.code, 0)
  assert.match(init.out, /\/hooks/, 'Codex exige confiar el hash nuevo de hooks antes de ejecutarlos')
  const s = settings(sb)
  const cmds = Object.values(s.hooks).flat().flatMap((g: any) => g.hooks.map((h: any) => h.command))
  assert.ok(cmds.every((c: string) => c.includes('.orquestador/runtime/dist/cli.js')))
  assert.ok(existsSync(path.join(sb.home, '.orquestador', 'runtime', 'dist', 'cli.js')))
  assert.ok(existsSync(path.join(sb.home, '.claude', 'skills', 'orquestador', 'SKILL.md')))
  assert.ok(existsSync(path.join(sb.home, '.claude', 'agents', 'tester.md')))
  assert.ok(existsSync(path.join(sb.home, '.codex', 'agents', 'reviewer.toml')))
  assert.match(readFileSync(path.join(sb.home, '.codex', 'AGENTS.md'), 'utf8'), /ORQUESTADOR:START/)
  const codexHooks = readFileSync(path.join(sb.home, '.codex', 'hooks.json'), 'utf8')
  assert.match(codexHooks, /hook git-guard/)
  assert.equal(codexHooks.split('hook metrics').length - 1, 3, 'Codex registra request/start/stop de subagentes nativos')
  assert.equal(s.permissions.defaultMode, undefined, 'no siembra bypassPermissions')
})

test('sin Codex: init instala solo el lado Claude y lo dice', () => {
  const sb = sandbox(false)
  const r = orq(sb, ['init', '--offline'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /modo Claude-solo/)
  assert.ok(!existsSync(path.join(sb.home, '.codex', 'hooks.json')))
})

test('--dry-run no escribe nada', () => {
  const sb = sandbox()
  const r = orq(sb, ['init', '--dry-run', '--offline'])
  assert.equal(r.code, 0)
  assert.match(r.out, /no se escribio nada/)
  assert.ok(!existsSync(path.join(sb.home, '.claude', 'settings.json')))
  assert.ok(!existsSync(path.join(sb.home, '.orquestador')))
})

test('settings.json corrupto: init frena y no lo pisa', () => {
  const sb = sandbox()
  mkdirSync(path.join(sb.home, '.claude'), { recursive: true })
  writeFileSync(path.join(sb.home, '.claude', 'settings.json'), '{ "model": "opus", ')
  const r = orq(sb, ['init', '--offline'])
  assert.equal(r.code, 1)
  assert.match(r.out, /no es JSON valido/)
  assert.equal(readFileSync(path.join(sb.home, '.claude', 'settings.json'), 'utf8'), '{ "model": "opus", ')
})

test('uninstall deja exactamente la config previa del usuario', () => {
  const sb = sandbox()
  mkdirSync(path.join(sb.home, '.claude'), { recursive: true })
  writeFileSync(path.join(sb.home, '.claude', 'settings.json'), JSON.stringify(userSettings))
  mkdirSync(path.join(sb.home, '.codex'), { recursive: true })
  writeFileSync(path.join(sb.home, '.codex', 'AGENTS.md'), '# mis reglas\n')
  assert.equal(orq(sb, ['init', '--offline']).code, 0)
  const r = orq(sb, ['uninstall', '--offline'])
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(settings(sb), userSettings)
  assert.equal(readFileSync(path.join(sb.home, '.codex', 'AGENTS.md'), 'utf8'), '# mis reglas\n')
  assert.ok(!existsSync(path.join(sb.home, '.orquestador', 'runtime')))
  assert.ok(!existsSync(path.join(sb.home, '.claude', 'skills', 'orquestador')))
  assert.ok(!existsSync(path.join(sb.home, '.codex', 'rules', 'orquestador.rules')))
  assert.ok(existsSync(path.join(sb.home, '.orquestador', 'backups')), 'los respaldos se conservan')
})

test('migrate: borra los artefactos V1 con respaldo y deja una instalacion V2 limpia', () => {
  const sb = sandbox()
  const c = path.join(sb.home, '.claude')
  for (const f of ['scripts/codex-run.ps1', 'hooks/git-guard.ps1', 'hooks/orq-metrics.ps1', 'statusline-wrapper.ps1', 'statusline/statusline.ps1']) {
    mkdirSync(path.dirname(path.join(c, f)), { recursive: true }); writeFileSync(path.join(c, f), '# v1')
  }
  writeFileSync(path.join(c, 'settings.json'), JSON.stringify({
    permissions: { allow: ['Bash(powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/scripts/codex-run.ps1:*)'] },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'powershell -File ~/.claude/hooks/git-guard.ps1' }] }] },
    statusLine: { type: 'command', command: 'powershell -File ~/.claude/statusline-wrapper.ps1' },
  }))
  mkdirSync(path.join(sb.home, '.codex'), { recursive: true })
  writeFileSync(path.join(sb.home, '.codex', 'config.toml'), 'model = "gpt-5.6-sol"\napproval_policy = "never"\n')
  const r = orq(sb, ['migrate', '--offline'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /Revisar a mano/)
  assert.ok(!existsSync(path.join(c, 'scripts', 'codex-run.ps1')))
  assert.ok(!existsSync(path.join(c, 'statusline')))
  assert.ok(!JSON.stringify(settings(sb)).includes('.ps1'))
  const backups = listFiles(path.join(sb.home, '.orquestador', 'backups'))
  assert.ok(backups.some(f => f.endsWith('codex-run.ps1')), 'respaldo del V1')
  const d = orq(sb, ['doctor'])
  assert.doesNotMatch(d.out, /instalacion V1/)
})

test('review: un archivo del usuario en una ruta del kit se restaura en uninstall, no se borra', () => {
  const sb = sandbox()
  const mine = path.join(sb.home, '.claude', 'agents', 'tester.md')
  mkdirSync(path.dirname(mine), { recursive: true })
  writeFileSync(mine, 'user-owned')
  assert.equal(orq(sb, ['init', '--offline']).code, 0)
  assert.notEqual(readFileSync(mine, 'utf8'), 'user-owned', 'init instala el del kit')
  assert.equal(orq(sb, ['init', '--offline']).code, 0, 'reinstalar no pierde el original')
  assert.equal(orq(sb, ['uninstall', '--offline']).code, 0)
  assert.equal(readFileSync(mine, 'utf8'), 'user-owned')
})

test('review: migrate con settings.json corrupto no toca el V1', () => {
  const sb = sandbox()
  const guard = path.join(sb.home, '.claude', 'hooks', 'git-guard.ps1')
  mkdirSync(path.dirname(guard), { recursive: true })
  writeFileSync(guard, '# v1')
  writeFileSync(path.join(sb.home, '.claude', 'settings.json'), '{ roto')
  const r = orq(sb, ['migrate', '--offline'])
  assert.equal(r.code, 1)
  assert.match(r.out, /No se toco la instalacion V1/)
  assert.ok(existsSync(guard), 'el V1 sigue ahi')
})

test('init --claude-only conserva ownership Codex y uninstall restaura el original', () => {
  const sb = sandbox()
  const mine = path.join(sb.home, '.codex', 'agents', 'reviewer.toml')
  writeFileSync(mine, 'user-owned')
  assert.equal(orq(sb, ['init', '--offline']).code, 0)
  assert.notEqual(readFileSync(mine, 'utf8'), 'user-owned')

  const second = orq(sb, ['init', '--claude-only', '--offline'])
  assert.equal(second.code, 0, second.out)
  const manifest = JSON.parse(readFileSync(path.join(sb.home, '.orquestador', 'manifest.json'), 'utf8'))
  assert.equal(manifest.codex, true)
  assert.ok(manifest.files.includes(mine), 'el manifiesto conserva los archivos del kit Codex')

  assert.equal(orq(sb, ['uninstall', '--offline']).code, 0)
  assert.equal(readFileSync(mine, 'utf8'), 'user-owned')
})

test('manifiesto viejo se normaliza y un kit reinstalado descarta archivos retirados', () => {
  const sb = sandbox()
  assert.equal(orq(sb, ['init', '--offline']).code, 0)
  const mf = path.join(sb.home, '.orquestador', 'manifest.json')
  const old = JSON.parse(readFileSync(mf, 'utf8'))
  const retired = path.join(sb.home, '.claude', 'agents', 'retirado.md')
  writeFileSync(retired, 'viejo')
  old.files.push(retired)
  delete old.mcp; delete old.seeded; delete old.addedPerms; delete old.replaced
  writeFileSync(mf, JSON.stringify(old))
  const r = orq(sb, ['init', '--offline'])
  assert.equal(r.code, 0, r.out)
  assert.ok(!existsSync(retired))
  assert.doesNotThrow(() => JSON.parse(readFileSync(mf, 'utf8')))
  assert.equal(orq(sb, ['doctor', '--json']).code, 0)
  assert.equal(orq(sb, ['uninstall', '--offline']).code, 0)
})

test('uninstall borra configs creadas por init pero conserva configs preexistentes', () => {
  const created = sandbox()
  assert.equal(orq(created, ['init', '--offline']).code, 0)
  const createdSettings = path.join(created.home, '.claude', 'settings.json')
  const createdHooks = path.join(created.home, '.codex', 'hooks.json')
  assert.equal(orq(created, ['uninstall', '--offline']).code, 0)
  assert.ok(!existsSync(createdSettings))
  assert.ok(!existsSync(createdHooks))

  const existing = sandbox()
  mkdirSync(path.join(existing.home, '.claude'), { recursive: true })
  writeFileSync(path.join(existing.home, '.claude', 'settings.json'), '{}')
  mkdirSync(path.join(existing.home, '.codex'), { recursive: true })
  writeFileSync(path.join(existing.home, '.codex', 'hooks.json'), '{}')
  assert.equal(orq(existing, ['init', '--offline']).code, 0)
  assert.equal(orq(existing, ['uninstall', '--offline']).code, 0)
  assert.ok(existsSync(path.join(existing.home, '.claude', 'settings.json')))
  assert.ok(existsSync(path.join(existing.home, '.codex', 'hooks.json')))
})

test('keyFor distingue rutas externas y conserva la clave relativa dentro del home', () => {
  const root = path.parse(os.homedir()).root
  const a = path.join(root, 'orq-a', 'SKILL.md')
  const b = path.join(root, 'orq-b', 'SKILL.md')
  assert.notEqual(keyFor(a), keyFor(b))
  assert.equal(keyFor(path.join(os.homedir(), 'orq-in', 'SKILL.md')), path.join('orq-in', 'SKILL.md'))
})

test('init fallido deja manifiesto parcial y migrate fallido restaura los artefactos V1', () => {
  const initSb = sandbox()
  mkdirSync(path.join(initSb.home, '.claude'), { recursive: true })
  writeFileSync(path.join(initSb.home, '.claude', 'skills'), 'trampa')
  const init = orq(initSb, ['init', '--offline'])
  assert.equal(init.code, 1, init.out)
  const partial = JSON.parse(readFileSync(path.join(initSb.home, '.orquestador', 'manifest.json'), 'utf8'))
  assert.ok(partial.files.length > 0, 'registra lo instalado antes de fallar')

  const migrateSb = sandbox()
  const guard = path.join(migrateSb.home, '.claude', 'hooks', 'git-guard.ps1')
  const codexGuard = path.join(migrateSb.home, '.codex', 'hooks', 'orquestador-git-guard.ps1')
  mkdirSync(path.dirname(guard), { recursive: true })
  mkdirSync(path.dirname(codexGuard), { recursive: true })
  writeFileSync(guard, '# v1')
  writeFileSync(codexGuard, '# codex v1')
  writeFileSync(path.join(migrateSb.home, '.claude', 'skills'), 'trampa')
  const migrate = orq(migrateSb, ['migrate', '--offline'])
  assert.notEqual(migrate.code, 0, migrate.out)
  assert.ok(existsSync(guard), 'rollback restaura el artefacto V1')
  assert.equal(readFileSync(guard, 'utf8'), '# v1')
  assert.equal(readFileSync(codexGuard, 'utf8'), '# codex v1')
})
