// Portado y ampliado de legacy/claude/tests/test-install-merge.ps1.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeClaudeSettings, unmergeClaudeSettings, mergeCodexHooks, unmergeCodexHooks,
  mergeAgentsBlock, unmergeAgentsBlock, DENY,
} from '../src/install/merge.ts'

const ctx = { runtimeCli: 'C:/Users/u/.orquestador/runtime/dist/cli.js' }

// La configuracion real de un usuario con el V1 instalado, recortada.
const v1User = {
  model: 'opus', effortLevel: 'medium', skipDangerousModePermissionPrompt: true,
  permissions: {
    allow: ['mcp__engram__mem_save', 'Bash(powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/scripts/codex-run.ps1:*)'],
    deny: ['Bash(git push:*)', 'Bash(git.exe push:*)', 'Bash(rm -rf /)'],
    defaultMode: 'bypassPermissions',
  },
  hooks: {
    PreToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/hooks/git-guard.ps1' }] },
      { matcher: 'Agent', hooks: [{ type: 'command', command: 'powershell -File ~/.claude/hooks/orq-metrics.ps1' }] },
      { matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier --write' }] },
    ],
    PostToolUse: [{ matcher: 'Agent|Bash', hooks: [{ type: 'command', command: 'powershell -File ~/.claude/hooks/orq-metrics.ps1' }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: 'engram session-start' }] }],
  },
  statusLine: { type: 'command', command: 'powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/statusline-wrapper.ps1' },
  enabledPlugins: { 'engram@engram': true, 'ponytail@ponytail': true },
  includeCoAuthoredBy: false,
  attribution: { commits: false, pullRequests: false },
}

const allCommands = (doc: any) => Object.values(doc.hooks ?? {}).flat().flatMap((g: any) => g.hooks.map((h: any) => h.command))

test('init es idempotente: correr dos veces da el mismo documento', () => {
  const once = mergeClaudeSettings(v1User, ctx).doc
  const twice = mergeClaudeSettings(once, ctx).doc
  assert.deepEqual(twice, once)
})

test('migracion V1: los hooks PowerShell se reemplazan, los del usuario quedan', () => {
  const { doc } = mergeClaudeSettings(v1User, ctx)
  const cmds = allCommands(doc)
  assert.ok(!cmds.some(c => /\.ps1/.test(c)), 'ningun hook .ps1')
  assert.ok(cmds.includes('prettier --write'), 'hook ajeno intacto')
  assert.ok(cmds.includes('engram session-start'), 'SessionStart ajeno intacto')
  assert.equal(cmds.filter(c => c.includes('hook git-guard')).length, 1)
  assert.equal(doc.statusLine.command, `node "${ctx.runtimeCli}" statusline`)
})

test('el git-guard cubre la tool PowerShell (en V1 solo Bash)', () => {
  const { doc } = mergeClaudeSettings({}, ctx)
  const g = doc.hooks.PreToolUse.find((x: any) => x.hooks[0].command.includes('git-guard'))
  assert.equal(g.matcher, 'Bash|PowerShell')
  assert.ok(doc.permissions.deny.includes('PowerShell(git push *)'))
})

test('permisos: se fusionan sin duplicar; se va el allow del wrapper V1; se conserva lo ajeno', () => {
  const { doc } = mergeClaudeSettings(v1User, ctx)
  assert.ok(doc.permissions.allow.includes('mcp__engram__mem_save'))
  assert.ok(!doc.permissions.allow.some((p: string) => p.includes('codex-run.ps1')))
  assert.ok(doc.permissions.deny.includes('Bash(rm -rf /)'))
  assert.equal(new Set(doc.permissions.deny).size, doc.permissions.deny.length)
})

test('no se siembra bypassPermissions; el del usuario no se toca', () => {
  assert.equal(mergeClaudeSettings({}, ctx).doc.permissions.defaultMode, undefined)
  assert.equal(mergeClaudeSettings(v1User, ctx).doc.permissions.defaultMode, 'bypassPermissions')
})

test('claves del usuario (model, effort, etc.) quedan intactas', () => {
  const { doc } = mergeClaudeSettings(v1User, ctx)
  for (const k of ['model', 'effortLevel', 'skipDangerousModePermissionPrompt']) assert.deepEqual(doc[k], (v1User as any)[k])
  assert.equal(doc.enabledPlugins['engram@engram'], true)
})

test('una statusline ajena no se pisa', () => {
  const { doc, report } = mergeClaudeSettings({ statusLine: { type: 'command', command: 'starship prompt' } }, ctx)
  assert.equal(report.statusLine, 'foreign')
  assert.equal(doc.statusLine.command, 'starship prompt')
})

test('uninstall saca exactamente lo que agrego init sobre una config vacia', () => {
  const { doc, report } = mergeClaudeSettings({}, ctx)
  assert.deepEqual(unmergeClaudeSettings(doc, report.seeded, report.addedPerms), {})
})

test('uninstall sobre config del usuario deja solo lo del usuario', () => {
  const user = { model: 'sonnet', permissions: { deny: ['Bash(rm *)'] }, hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'fmt' }] }] }, includeCoAuthoredBy: true }
  const { doc, report } = mergeClaudeSettings(user, ctx)
  assert.deepEqual(unmergeClaudeSettings(doc, report.seeded, report.addedPerms), user)
  assert.ok(!report.seeded.includes('includeCoAuthoredBy'), 'no siembra lo que el usuario ya decidio')
})

test('uninstall quita seeds intactos pero conserva atribucion cambiada por el usuario', () => {
  const { doc, report } = mergeClaudeSettings({}, ctx)
  assert.deepEqual(unmergeClaudeSettings(doc, report.seeded, report.addedPerms), {})

  doc.includeCoAuthoredBy = true
  doc.attribution = { commits: true, pullRequests: 'link' }
  const unmerged = unmergeClaudeSettings(doc, report.seeded, report.addedPerms)
  assert.equal(unmerged.includeCoAuthoredBy, true)
  assert.deepEqual(unmerged.attribution, { commits: true, pullRequests: 'link' })
})

test('review: un hook del usuario en el mismo grupo que uno nuestro sobrevive', () => {
  const mixed = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [
    { type: 'command', command: 'powershell -File ~/.claude/hooks/git-guard.ps1' },
    { type: 'command', command: 'user-audit' },
  ] }] } }
  const { doc, report } = mergeClaudeSettings(mixed, ctx)
  const cmds = allCommands(doc)
  assert.ok(cmds.includes('user-audit'), 'el hook del usuario no se pierde al migrar')
  assert.ok(!cmds.some(c => c.includes('.ps1')))
  assert.ok(allCommands(unmergeClaudeSettings(doc, report.seeded, report.addedPerms)).includes('user-audit'))
})

test('review: un permiso que el usuario ya tenia no se borra en uninstall', () => {
  const user = { permissions: { deny: ['Bash(git push *)'] } }
  const { doc, report } = mergeClaudeSettings(user, ctx)
  assert.ok(!report.addedPerms.includes('Bash(git push *)'))
  assert.deepEqual(unmergeClaudeSettings(doc, report.seeded, report.addedPerms), user)
})

test('codex hooks.json: idempotente, conserva lo ajeno, reemplaza el guard V1', () => {
  const v1 = { description: 'x', hooks: { PreToolUse: [
    { matcher: '^Bash$', hooks: [{ type: 'command', commandWindows: 'powershell -File ~/.codex/hooks/orquestador-git-guard.ps1', command: 'powershell -File ~/.codex/hooks/orquestador-git-guard.ps1' }] },
    { matcher: '^Edit$', hooks: [{ type: 'command', command: 'otro' }] },
  ] } }
  const once = mergeCodexHooks(v1, ctx)
  assert.deepEqual(mergeCodexHooks(once, ctx), once)
  assert.equal(once.hooks.PreToolUse.length, 3)
  assert.ok(once.hooks.PreToolUse.some((g: any) => g.hooks[0].command === 'otro'))
  assert.ok(once.hooks.PreToolUse.some((g: any) => g.matcher.includes('spawn_agent') && g.hooks[0].command.includes('hook metrics')))
  assert.equal(once.hooks.SubagentStart.filter((g: any) => g.hooks[0].command.includes('hook metrics')).length, 1)
  assert.equal(once.hooks.SubagentStop.filter((g: any) => g.hooks[0].command.includes('hook metrics')).length, 1)
  assert.ok(!JSON.stringify(once).includes('.ps1'))
  const clean = unmergeCodexHooks(once)
  assert.deepEqual(clean.hooks.PreToolUse, [v1.hooks.PreToolUse[1]])
  assert.equal(clean.hooks.SubagentStart, undefined)
  assert.equal(clean.hooks.SubagentStop, undefined)
})

test('codex hooks.json: uninstall conserva hooks de lifecycle ajenos', () => {
  const user = { hooks: {
    SubagentStart: [{ matcher: '^reviewer$', hooks: [{ type: 'command', command: 'user-start' }] }],
    SubagentStop: [{ matcher: '^reviewer$', hooks: [{ type: 'command', command: 'user-stop' }] }],
  } }
  const installed = mergeCodexHooks(user, ctx)
  assert.deepEqual(unmergeCodexHooks(installed), user)
})

test('codex hooks.json: un script ajeno con nombre parecido al V1 se conserva', () => {
  const user = { hooks: { PreToolUse: [{ matcher: '^Agent$', hooks: [
    { type: 'command', command: 'C:/tools/orq-metrics.ps1 --personal' },
  ] }] } }
  const installed = mergeCodexHooks(user, ctx)
  assert.ok(JSON.stringify(installed).includes('C:/tools/orq-metrics.ps1'))
  assert.deepEqual(unmergeCodexHooks(installed), user)
})

test('AGENTS.md: bloque administrado idempotente y removible', () => {
  const user = '# Mis reglas\n\n- usar pnpm\n'
  const once = mergeAgentsBlock(user, 'regla A')
  assert.equal(mergeAgentsBlock(once, 'regla A'), once)
  assert.match(mergeAgentsBlock(once, 'regla B'), /regla B/)
  assert.doesNotMatch(mergeAgentsBlock(once, 'regla B'), /regla A/)
  assert.equal(unmergeAgentsBlock(once), user)
  assert.equal(unmergeAgentsBlock(mergeAgentsBlock('', 'x')), '')
})

test('DENY solo incluye formas que la deny rule sabe matchear', () => {
  assert.ok(DENY.every(d => /^(Bash|PowerShell)\(git(\.exe)? push \*\)$/.test(d)))
})
