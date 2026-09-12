#!/usr/bin/env node
// Compila native/orq-hidden/orq-hidden.cs a dist/native/orq-hidden.exe con
// csc.exe (viene incluido en Windows como parte de .NET Framework 4.x: no
// agrega dependencia nueva). Solo aplica a Windows -- en otros SO es un
// no-op, el launcher no tiene sentido ahi. Ver docs/DECISIONS.md D-034.
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') process.exit(0)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'native', 'orq-hidden', 'orq-hidden.cs')
const OUT_DIR = path.join(ROOT, 'dist', 'native')
const OUT = path.join(OUT_DIR, 'orq-hidden.exe')

const CSC_CANDIDATES = [
  'csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
]

function findCsc() {
  for (const c of CSC_CANDIDATES) {
    const r = spawnSync(c, ['/help'], { stdio: 'ignore', windowsHide: true })
    if (!r.error) return c
  }
  return null
}

const csc = findCsc()
if (!csc) {
  console.log('AVISO: no se encontro csc.exe (.NET Framework 4.x). Se salteo la compilacion de orq-hidden.exe: los hooks en Windows van a mostrar consola hasta compilarlo. csc.exe viene de fabrica en casi todo Windows 10/11; si falta, habilitar ".NET Framework 3.5" en "Activar o desactivar caracteristicas de Windows" o instalar el SDK de .NET.')
  process.exit(0)
}

mkdirSync(OUT_DIR, { recursive: true })
const r = spawnSync(csc, ['/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', `/out:${OUT}`, SRC], { stdio: 'inherit', windowsHide: true })
if (r.status !== 0) {
  console.error('orq-hidden.exe: fallo la compilacion.')
  process.exit(1)
}
console.log(`orq-hidden.exe compilado en ${OUT}`)
