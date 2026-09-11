// Detecta `git push` en un comando de shell (bash, PowerShell, cmd) o en un argv.
//
// El V1 usaba una regex sobre el string entero: se le escapaban formas validas
// (`git --no-pager push`, `git -c k="A B" push`, `-C` con una ruta con espacios)
// y bloqueaba texto inerte (`echo git push`, un mensaje de commit). Esto parsea:
// busca `git` en posicion de comando, saltea sus opciones globales, y mira el
// subcomando. Recorre tambien lo que se ejecuta de forma indirecta: `bash -c`,
// `pwsh -Command`, `cmd /c`, `iex`, `$(...)` y backticks.
//
// Limite conocido: un alias de git definido en la config del usuario (`git p`)
// no se ve. Lo cubren las otras capas (deny rule, rules de Codex) y el prompt.

// Opciones globales de git que consumen el token siguiente como valor.
const GIT_OPT_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env'])
// Comandos que ejecutan a otro: el comando real es el primer git/shell que
// aparece despues de sus opciones (`sudo -u root git push`, `env -i git push`).
const WRAPPERS = new Set(['sudo', 'command', 'exec', 'nohup', 'call', 'env', 'noglob', 'builtin', 'xargs', 'nice', 'ionice',
  'timeout', 'stdbuf', 'doas', 'runas', 'start-process', 'start', 'caffeinate', 'chronic', 'unbuffer'])
// Palabras de control que pueden abrir un segmento: `if true; then git push; fi`.
const RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'for', 'case', 'esac', '!', 'time', 'function'])
const isGitExe = (t: string) => /^git(\.exe)?$/i.test(t.split(/[\\/]/).pop() ?? t) || /^git(\.exe)?$/i.test(t.replace(/[\\`^]/g, ''))
// El ejecutable sale de una variable o una expansion: no se puede saber que es.
const isIndirect = (t: string) => /^[$%]/.test(t) || t.includes('$(') || /`[^`]*`/.test(t)
const SHELL = /^(bash|sh|zsh|dash|ksh|fish|pwsh|powershell|cmd)(\.exe)?$/i
const SHELL_CMD_FLAG = /^(-c|-lc|-ic|-lic|-command|\/c|\/k)$/i
const MAX_DEPTH = 4

// Separa en segmentos (;, &, &&, |, ||, salto de linea) y tokens, respetando comillas.
export function segments(cmd: string): string[][] {
  const out: string[][] = []
  let cur: string[] = [], tok = '', has = false, q: string | null = null
  const push = () => { if (has) cur.push(tok); tok = ''; has = false }
  const end = () => { push(); if (cur.length) out.push(cur); cur = [] }
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (q) {
      if (c === q) q = null
      else if (c === '\\' && q === '"' && cmd[i + 1] === '"') { tok += '"'; i++ }
      else tok += c
      continue
    }
    if (c === '"' || c === "'") { q = c; has = true; continue }
    // $(...), ${...} y `...` quedan como un solo token (es la forma de un
    // ejecutable indirecto: `$(which git) push`, `${GIT} push`).
    if (c === '$' && (cmd[i + 1] === '(' || cmd[i + 1] === '{')) {
      const open = cmd[i + 1], close = open === '(' ? ')' : '}'
      let depth = 0, j = i + 1
      for (; j < cmd.length; j++) { if (cmd[j] === open) depth++; else if (cmd[j] === close && --depth === 0) break }
      tok += cmd.slice(i, j + 1); has = true; i = j
      continue
    }
    if (c === '`') {
      const j = cmd.indexOf('`', i + 1)
      if (j > i + 1 && !/\s/.test(cmd.slice(i + 1, j))) { tok += cmd.slice(i, j + 1); has = true; i = j; continue }
    }
    // Agrupaciones y bloques tambien separan: `(git push)`, `& { git push }`.
    if (c === '\n' || c === ';' || c === '&' || c === '|' || c === '(' || c === ')' || c === '{' || c === '}') { end(); continue }
    if (/\s/.test(c)) { push(); continue }
    tok += c; has = true
  }
  end()
  return out
}

// Lo que un shell ejecuta aunque este dentro de comillas: $(...) y `...`.
function substitutions(cmd: string): string[] {
  const found: string[] = []
  for (let i = cmd.indexOf('$('); i >= 0; i = cmd.indexOf('$(', i + 2)) {
    let depth = 0, j = i + 1
    for (; j < cmd.length; j++) { if (cmd[j] === '(') depth++; else if (cmd[j] === ')' && --depth === 0) break }
    found.push(cmd.slice(i + 2, j))
  }
  for (const m of cmd.matchAll(/`([^`]+)`/g)) found.push(m[1])
  return found
}

function argvPushes(a: string[], depth: number): boolean {
  let i = 0
  while (i < a.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a[i]) || RESERVED.has(a[i].toLowerCase()))) i++
  if (i < a.length && WRAPPERS.has(a[i].toLowerCase())) {
    // Se saltean las opciones del wrapper (y sus valores) buscando el comando real.
    const j = a.findIndex((t, k) => k > i && (isGitExe(t) || SHELL.test(t.split(/[\\/]/).pop() ?? t) || /^(iex|invoke-expression|eval)$/i.test(t) || isIndirect(t)))
    if (j < 0) return false
    i = j
  }
  const exe = a[i]
  if (!exe) return false
  // Conservador: un ejecutable que no se puede resolver con un `push` como
  // argumento se bloquea (`$g='git'; & $g push`).
  if (isIndirect(exe)) return a.slice(i + 1).includes('push')
  const base = exe.split(/[\\/]/).pop() ?? exe
  if (isGitExe(exe)) {
    for (let j = i + 1; j < a.length; j++) {
      const t = a[j]
      if (GIT_OPT_WITH_VALUE.has(t)) {
        // `git -c alias.p=push p`: un alias inline que termina en push.
        if (t === '-c' && /^alias\.[^=]+=!?.*\bpush\b/.test(a[j + 1] ?? '')) return true
        j++
        continue
      }
      if (t.startsWith('-')) continue // --no-pager, --git-dir=x, -p, --bare...
      return t === 'push'
    }
    return false
  }
  if (depth >= MAX_DEPTH) return false
  if (SHELL.test(base)) {
    const k = a.findIndex((t, idx) => idx > i && SHELL_CMD_FLAG.test(t))
    if (k >= 0) return isGitPushText(a.slice(k + 1).join(' '), depth + 1)
    // `pwsh "git push"`: sin -Command, PowerShell toma el resto como comando.
    if (/^(pwsh|powershell)/i.test(base)) return isGitPushText(a.slice(i + 1).filter(t => !t.startsWith('-')).join(' '), depth + 1)
    return false
  }
  if (/^(iex|invoke-expression|eval)$/i.test(base)) return isGitPushText(a.slice(i + 1).join(' '), depth + 1)
  return false
}

function isGitPushText(cmd: string, depth: number): boolean {
  if (segments(cmd).some(seg => argvPushes(seg, depth))) return true
  return depth < MAX_DEPTH && substitutions(cmd).some(s => isGitPushText(s, depth + 1))
}

// `command` puede ser un string (Claude Code) o un argv (Codex).
export function isGitPush(command: unknown): boolean {
  if (Array.isArray(command)) {
    const argv = command.map(String)
    return argvPushes(argv, 0) || argv.some(t => substitutions(t).some(s => isGitPushText(s, 1)))
  }
  return isGitPushText(String(command ?? ''), 0)
}
