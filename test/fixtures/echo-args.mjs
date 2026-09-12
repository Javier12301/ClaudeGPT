// CLI falso: imprime sus args como JSON y, si recibe stdin, su longitud.
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', d => { input += d })
process.stdin.on('end', () => {
  const mode = process.argv[2]
  if (mode === 'sleep') { setTimeout(() => {}, 60_000); return }
  if (mode === 'flood') {
    // BR-010: el hijo llena stdout ANTES de terminar de leer stdin.
    for (let i = 0; i < 2000; i++) process.stdout.write(`line ${i}\n`)
  }
  if (mode === 'exit3') process.exit(3)
  if (mode === 'stderr') { process.stderr.write(`err:${input}`); process.exit(7) }
  process.stdout.write(JSON.stringify({ args: process.argv.slice(2), len: input.length, input }) + '\n')
})
