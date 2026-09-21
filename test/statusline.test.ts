import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { renderStatusline } from '../src/commands/statusline.ts'

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

test('statusline conserva modelo/rama/contexto y muestra las cuatro cuotas libres', () => {
  const old = process.env.ORQ_HOME
  const home = mkdtempSync(path.join(os.tmpdir(), 'orq-statusline-'))
  const repo = path.join(home, 'mi-repo')
  mkdirSync(repo)
  spawnSync('git', ['init', '-q', '-b', 'feature/cuotas', repo])
  writeFileSync(path.join(home, 'codex-usage.json'), JSON.stringify({
    ts: new Date().toISOString(),
    res: { rateLimits: {
      primary: { usedPercent: 7, windowDurationMins: 300 },
      secondary: { usedPercent: 9, windowDurationMins: 10080 },
    } },
  }))
  process.env.ORQ_HOME = home
  try {
    const out = plain(renderStatusline({
      model: { display_name: 'Opus 4.1' },
      workspace: { current_dir: repo },
      context_window: { used_percentage: 23 },
      rate_limits: {
        five_hour: { used_percentage: 51 },
        seven_day: { used_percentage: 27 },
      },
    }))
    assert.match(out, /^Opus 4\.1 \| mi-repo \(feature\/cuotas\) \| ctx 23%/)
    assert.match(out, /CL libre 5h 49% 7d 73%/)
    assert.match(out, /CX libre 5h 93% 7d 91%/)
  } finally {
    if (old === undefined) delete process.env.ORQ_HOME
    else process.env.ORQ_HOME = old
  }
})

test('statusline omite solo las ventanas ausentes', () => {
  const old = process.env.ORQ_HOME
  const home = mkdtempSync(path.join(os.tmpdir(), 'orq-statusline-partial-'))
  writeFileSync(path.join(home, 'codex-usage.json'), JSON.stringify({
    ts: new Date().toISOString(),
    res: { rateLimits: { primary: { usedPercent: 20, windowDurationMins: 300 } } },
  }))
  process.env.ORQ_HOME = home
  try {
    const out = plain(renderStatusline({ rate_limits: { five_hour: { used_percentage: 10 } } }))
    assert.match(out, /CL libre 5h 90%/)
    assert.doesNotMatch(out, /CL libre[^|]*7d/)
    assert.match(out, /CX libre 5h 80%/)
    assert.doesNotMatch(out, /CX libre[^|]*7d/)
  } finally {
    if (old === undefined) delete process.env.ORQ_HOME
    else process.env.ORQ_HOME = old
  }
})
