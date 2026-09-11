// git-guard (D-008). Incluye las reproducciones del review adversarial de Codex
// sobre el V2: formas que la regex dejaba pasar y texto inerte que bloqueaba.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isGitPush, segments } from '../src/core/guard.ts'
import { gitGuardDecision } from '../src/commands/hook.ts'

const BLOCK = [
  'git push', 'git push origin main', 'git.exe push origin main', 'git -C . push origin main',
  'git --git-dir=.git push', 'git --git-dir .git push', 'git --work-tree . push', 'git -c user.name=x push',
  'npm test && git push', 'echo a; git push --force-with-lease', 'git status | git push',
  '& git push', '& "C:\\Program Files\\Git\\cmd\\git.exe" push', '/usr/bin/git push',
  // review adversarial: se escapaban
  'git --no-pager push', 'git -c user.name="A B" push', 'git -C "C:\\repo with spaces" push',
  // ejecucion indirecta
  'bash -lc "git push"', "sh -c 'git push origin main'", 'pwsh -Command "git push"', 'powershell -NoProfile -Command git push',
  'cmd /c git push', 'iex "git push"', 'echo "$(git push)"', 'x=`git push`', 'FOO=1 git push', 'sudo git push',
  'git -c alias.p=push p',
  'npm test\ngit push',
  // segundo review adversarial
  '(git push)', 'if true; then git push; fi', 'g\\it push', 'env -i git push', 'sudo -u root git push',
  '& { git push }', "$g='git'; & $g push", '$(which git) push', '${GIT} push', 'g`it push', 'nohup git push &',
  'Start-Process git -ArgumentList push', 'while true; do git push; done',
  'cmd /c g^it push', 'cmd /c "g^it push"', 'eval git push', "bash -lc 'eval git push'",
]
const PASS = [
  'git status', 'npm run push-docs', 'git commit -m "push fix"', 'git pushd', 'git log --grep push',
  'mygit push', 'git stash push -m x',
  // review adversarial: se bloqueaban sin motivo
  'git commit -m "never run git push here"', 'echo git push', 'git log --grep="git push"',
  '- git push must be blocked in every form', 'rg "git push" docs/',
]

test('bloquea todas las formas de push', () => {
  for (const c of BLOCK) assert.ok(isGitPush(c), `deberia bloquear: ${c}`)
})

test('bloquea escapes caret de cmd y eval anidado', () => {
  for (const c of ['cmd /c g^it push', 'cmd /c "g^it push"', 'eval git push', "bash -lc 'eval git push'"]) {
    assert.ok(isGitPush(c), `deberia bloquear: ${c}`)
  }
})

test('deja pasar el texto inerte', () => {
  for (const c of PASS) assert.ok(!isGitPush(c), `no deberia bloquear: ${c}`)
})

test('argv de Codex: sin unir tokens (rutas con espacios) y con shells anidados', () => {
  assert.ok(isGitPush(['git', '-C', 'C:\\repo with spaces', 'push']))
  assert.ok(isGitPush(['bash', '-lc', 'git push']))
  assert.ok(isGitPush(['powershell.exe', '-Command', 'git push origin main']))
  assert.ok(!isGitPush(['git', 'commit', '-m', 'git push later']))
  assert.ok(!isGitPush(['echo', 'git', 'push']))
})

test('el tokenizer respeta comillas y separadores', () => {
  assert.deepEqual(segments('a "b c" \'d;e\' ; f && g | h'), [['a', 'b c', 'd;e'], ['f'], ['g'], ['h']])
})

test('contrato de salida identico en Claude y Codex', () => {
  const d = gitGuardDecision({ tool_input: { command: 'git push' } }) as any
  assert.equal(d.hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(gitGuardDecision({ tool_input: { command: 'ls' } }), null)
})
