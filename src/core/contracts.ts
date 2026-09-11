// Contratos de salida de los workers. Se fuerzan con JSON Schema
// (`codex exec --output-schema`), no con la buena voluntad del prompt.

export type SchemaKind = 'impl' | 'review' | 'docs'
export type Role = 'constructor' | 'tester-tdd' | 'verifier' | 'reviewer' | 'security-reviewer' | 'docs-researcher'

export const ROLES: Record<Role, { tier: 'lead' | 'worker' | 'cheap'; schema: SchemaKind; readOnly: boolean }> = {
  'constructor':       { tier: 'worker', schema: 'impl',   readOnly: false },
  'tester-tdd':        { tier: 'worker', schema: 'impl',   readOnly: false },
  'verifier':          { tier: 'cheap',  schema: 'impl',   readOnly: false },
  'reviewer':          { tier: 'worker', schema: 'review', readOnly: true },
  'security-reviewer': { tier: 'worker', schema: 'review', readOnly: true },
  'docs-researcher':   { tier: 'cheap',  schema: 'docs',   readOnly: true },
}

const str = { type: 'string' }
const strs = { type: 'array', items: str }
const obj = (required: string[], properties: Record<string, unknown>) =>
  ({ type: 'object', additionalProperties: false, required, properties })

export const SCHEMAS: Record<SchemaKind, object> = {
  impl: obj(['files_changed', 'summary', 'tests', 'risks', 'blocked', 'status', 'clarifications'], {
    files_changed: strs,
    summary: str,
    tests: obj(['command', 'status'], { command: str, status: { type: 'string', enum: ['GREEN', 'RED', 'NOT_RUN'] } }),
    risks: strs,
    blocked: { type: 'boolean' },
    status: { type: 'string', enum: ['DONE', 'NEEDS_INFO', 'BLOCKED'] },
    clarifications: { type: 'array', items: obj(['missing_fact', 'evidence_checked', 'question', 'affected_decision'], {
      missing_fact: str, evidence_checked: strs, question: str, affected_decision: str,
    }) },
  }),
  // `evidence` es lo que le permite al razonador arbitrar el finding sin
  // re-derivarlo: que se ejecuto, que se leyo, que input lo rompe.
  review: obj(['findings', 'coverage_note'], {
    findings: { type: 'array', items: obj(['severity', 'file', 'line', 'problem', 'impact', 'evidence', 'suggested_fix'], {
      severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
      file: str, line: { type: 'integer' }, problem: str, impact: str, evidence: str, suggested_fix: str,
    }) },
    coverage_note: str,
  }),
  docs: obj(['conclusion', 'api_version', 'source', 'implication'], {
    conclusion: str, api_version: str, source: str, implication: str,
  }),
}

export interface Clarification { missing_fact: string; evidence_checked: string[]; question: string; affected_decision: string }
export interface ImplPayload {
  files_changed: string[]; summary: string; tests: { command: string; status: 'GREEN' | 'RED' | 'NOT_RUN' }
  risks: string[]; blocked: boolean; status: 'DONE' | 'NEEDS_INFO' | 'BLOCKED'; clarifications: Clarification[]
}
export interface Finding {
  severity: 'P0' | 'P1' | 'P2' | 'P3'; file: string; line: number
  problem: string; impact: string; evidence: string; suggested_fix: string
}
export interface ReviewPayload { findings: Finding[]; coverage_note: string }
export interface DocsPayload { conclusion: string; api_version: string; source: string; implication: string }

// Valida un valor contra los schemas de arriba (el subconjunto que usan: object,
// array, string, integer, boolean, required, enum, additionalProperties:false).
// Codex deberia respetar --output-schema, pero lo que entra al runtime se
// verifica igual: un payload malformado es contrato violado, no un crash.
export function validate(schema: any, v: unknown, at = '$'): string | null {
  const t = schema.type
  if (t === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return `${at}: se esperaba un objeto`
    for (const k of schema.required ?? []) if (!(k in (v as object))) return `${at}.${k}: falta`
    for (const [k, val] of Object.entries(v as object)) {
      const sub = schema.properties?.[k]
      if (!sub) { if (schema.additionalProperties === false) return `${at}.${k}: propiedad no permitida`; continue }
      const e = validate(sub, val, `${at}.${k}`)
      if (e) return e
    }
    return null
  }
  if (t === 'array') {
    if (!Array.isArray(v)) return `${at}: se esperaba un array`
    for (let i = 0; i < v.length; i++) { const e = validate(schema.items, v[i], `${at}[${i}]`); if (e) return e }
    return null
  }
  if (t === 'string' && typeof v !== 'string') return `${at}: se esperaba string`
  if (t === 'integer' && !Number.isInteger(v)) return `${at}: se esperaba entero`
  if (t === 'boolean' && typeof v !== 'boolean') return `${at}: se esperaba boolean`
  if (schema.enum && !schema.enum.includes(v)) return `${at}: "${v}" no esta en ${schema.enum.join('|')}`
  return null
}

// BR-011: el schema deja status/blocked/clarifications independientes; la
// invariante que los liga se chequea aca. Payload no-impl => no aplica.
export function statusInvariant(p: unknown): boolean {
  if (!p || typeof p !== 'object' || !('status' in p)) return true
  const x = p as Partial<ImplPayload>
  const cl = Array.isArray(x.clarifications) ? x.clarifications.length : 0
  switch (x.status) {
    case 'DONE': return !x.blocked && cl === 0
    case 'NEEDS_INFO': return !x.blocked && cl >= 1
    case 'BLOCKED': return x.blocked === true
    default: return false
  }
}

// Politica de severidades (FASE 9). El reviewer propone; el razonador arbitra.
export const SEVERITY_ACTION: Record<Finding['severity'], string> = {
  P0: 'interrumpir: validar evidencia y corregir antes de seguir',
  P1: 'interrumpir: validar evidencia y corregir antes de cerrar la fase',
  P2: 'encolar para revision posterior',
  P3: 'informativo',
}

// Flags que desarman las protecciones desde la linea de comandos. El runtime
// nunca los pasa, y este guard hace que tampoco se puedan colar.
const FORBIDDEN_FLAGS = ['--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust', '--ignore-rules', '--yolo']
export function assertNoBypass(args: string[]): void {
  const bad = args.find(a => FORBIDDEN_FLAGS.includes(a.split('=')[0]))
  if (bad) throw new Error(`flag prohibido por el runtime: ${bad}`)
}

// El prompt que envuelve la tarea. Ingles y ASCII: los literales del repo que
// vengan en la spec se preservan tal cual (van en el bloque TASK).
export function workerPrompt(roleInstructions: string, kind: SchemaKind, task: string): string {
  const ambiguity = kind === 'impl'
    ? [
        'If more than one valid interpretation remains and the choice affects',
        'implementation, do not pick one: set status to NEEDS_INFO and list every open',
        'question at once in the clarifications array.',
        '',
        'Result status field:',
        '  DONE       - work finished; clarifications empty; blocked = false',
        '  NEEDS_INFO - a required fact could not be verified; at least one',
        '               clarification; blocked = false',
        '  BLOCKED    - a real execution or environment blocker; blocked = true',
      ].join('\n')
    : kind === 'review'
      ? [
          'Try to prove this change is broken even though the tests pass. Look for',
          'uncovered bugs, edge cases, regressions, races, broken contracts, integration',
          'and security errors, missing tests and unverified assumptions. Report only',
          'evidence-backed findings: the evidence field says what you ran or read and',
          'which input breaks it. Do not edit files. Skip style and naming.',
        ].join('\n')
      : 'If a required fact cannot be verified from repository evidence, say so\nexplicitly in your output rather than assuming it.'
  return [
    roleInstructions.trim(),
    '',
    'Never invent or infer a task-critical repository fact (database engine,',
    'framework, library, package manager, test runner, infrastructure, API',
    'contract, deployment target, architecture decision, version-specific',
    'behavior). Inspect repository evidence first. If a repository fact contradicts',
    'the spec, report the conflict instead of overriding either source.',
    '',
    ambiguity,
    '',
    'Reply ONLY with the JSON for the requested schema. No prose around it.',
    '',
    '---- TASK ----',
    task,
  ].join('\n')
}
