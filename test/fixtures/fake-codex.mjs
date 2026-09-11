// Codex falso para los tests: imita la superficie que usa el runtime, sin
// gastar cuota. El comportamiento lo decide FAKE_CODEX (ok | review | needs-info
// | contract | fail | nojson | malformed | quota-low | logged-out | slow).
import { writeFileSync, appendFileSync } from 'node:fs'
const mode = process.env.FAKE_CODEX ?? 'ok'
const argv = process.argv.slice(2)
if (process.env.FAKE_CODEX_LOG) appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(argv) + '\n')
const out = s => process.stdout.write(s + '\n')

if (argv[0] === '--version') { out('codex-cli 9.9.9'); process.exit(0) }
if (argv[0] === 'login') {
  if (mode === 'logged-out') { process.stderr.write('Not logged in\n'); process.exit(1) }
  process.stderr.write('Logged in using ChatGPT\n'); process.exit(0)
}
if (argv[0] === 'debug' && argv[1] === 'models') {
  out(JSON.stringify({ models: [
    { slug: 'm-lead', priority: 1, visibility: 'list', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'medium' }, { effort: 'high' }] },
    { slug: 'm-worker', priority: 2, visibility: 'list', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'medium' }, { effort: 'high' }] },
    { slug: 'm-cheap', priority: 3, visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low' }] },
    { slug: 'm-hidden', priority: 0, visibility: 'hide' },
  ] }))
  process.exit(0)
}
if (argv[0] === 'app-server') {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', d => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
      if (msg.id === 1) out(JSON.stringify({ id: 1, result: {} }))
      if (msg.id === 2) out(JSON.stringify({ id: 2, result: { rateLimits: { planType: 'plus', primary: { usedPercent: mode === 'quota-low' ? 95 : 20, resetsAt: 1790000000 } } } }))
    }
  })
  setTimeout(() => {}, 30_000)
} else if (argv[0] === 'exec') {
  const o = argv[argv.indexOf('-o') + 1]
  let prompt = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', d => { prompt += d })
  process.stdin.on('end', async () => {
    out(JSON.stringify({ type: 'thread.started', thread_id: '01aa0000-0000-7000-8000-000000000001' }))
    out(JSON.stringify({ type: 'item_completed' }))
    if (mode === 'slow') await new Promise(r => setTimeout(r, 8000))
    if (mode === 'fail') { process.stderr.write('boom: sandbox error\n'); process.exit(3) }
    const payloads = {
      ok: { files_changed: ['src/a.ts'], summary: 'hecho', tests: { command: 'npm test', status: 'GREEN' }, risks: [], blocked: false, status: 'DONE', clarifications: [] },
      'needs-info': { files_changed: [], summary: 'falta dato', tests: { command: '', status: 'NOT_RUN' }, risks: [], blocked: false, status: 'NEEDS_INFO',
        clarifications: [{ missing_fact: 'motor de BD', evidence_checked: ['pom.xml'], question: 'MySQL o Postgres?', affected_decision: 'dialecto SQL' }] },
      contract: { files_changed: [], summary: 'x', tests: { command: '', status: 'NOT_RUN' }, risks: [], blocked: false, status: 'NEEDS_INFO', clarifications: [] },
      review: { findings: [{ severity: 'P1', file: 'src/a.ts', line: 3, problem: 'race', impact: 'doble cobro', evidence: 'dos requests concurrentes', suggested_fix: 'lock' }], coverage_note: 'solo src/' },
      slow: { findings: [], coverage_note: 'nada' },
    }
    if (mode === 'nojson') writeFileSync(o, 'no pude\nseguir\n')
    else if (mode === 'malformed') writeFileSync(o, '{}')
    else writeFileSync(o, JSON.stringify(payloads[mode] ?? payloads.ok))
    if (process.env.FAKE_CODEX_PROMPT) writeFileSync(process.env.FAKE_CODEX_PROMPT, prompt)
    process.exit(0)
  })
} else {
  process.exit(0)
}
