# Orquestador V2 — Claude Code + Codex

Un runtime portable (`orq`) y una política para trabajar con **un solo
razonador por tarea** sobre dos suscripciones. El razonador — Claude o Codex —
resuelve directo lo que ya entiende y delega solo cuando la delegación tiene una
utilidad concreta y nombrable: paralelismo real, aislamiento de contexto,
independencia de criterio, volumen mecánico, capacidad especializada o
exploración amplia. Todo lo que vuelve lo arbitra él.

No maximiza agentes activos. Maximiza calidad, throughput útil y ahorro del
output del modelo caro.

- Windows, Linux, macOS y WSL con la misma lógica (Node ≥ 22.16).
- Cero dependencias de runtime.
- Instalación, diagnóstico, actualización y desinstalación deterministas.
- Degrada solo: sin Codex, modo Claude-solo; sin codegraph, `git` como code intel.

## Instalación

```bash
npx orquestador init          # pendiente de release en npm; mientras tanto:
git clone https://github.com/Javier12301/ClaudeGPT.git && cd ClaudeGPT && npm install && npm run build && npm link
orq init --dry-run            # qué va a tocar
orq init                      # instala (idempotente: correrlo de nuevo no cambia nada)
orq doctor                    # diagnóstico
```

¿Venís del kit PowerShell (V1)? `orq migrate` — respalda y reemplaza.
Detalle, upgrade, uninstall y troubleshooting: [`INSTALL.md`](INSTALL.md).

### Que lo instale tu agente

En la máquina nueva, abrí Claude Code (o Codex) en tu carpeta de proyectos y
pegale esto. Sirve para instalar y para actualizar; cualquier modelo lo sigue.

```text
Instalá el Orquestador V2. Seguí estos pasos en orden, uno por uno, sin planificar
ni improvisar. No edites a mano settings.json, hooks.json, config.toml ni archivos
de MCP: todo lo hace `orq`. Nunca uses una API key de Codex. Nunca hagas git push.
Si un paso falla, pará y mostrame el error textual; no pruebes alternativas.

1. Corré `node --version`, `git --version` y `claude --version`.
   Si Node es menor a 22.16 o falta alguno, pará y decime qué instalar.
   Corré `codex --version`: si no está, seguí igual (queda en modo Claude-solo).
2. Si ya existe la carpeta `ClaudeGPT` acá, entrá y corré `git pull`.
   Si no, corré `git clone https://github.com/Javier12301/ClaudeGPT.git` y entrá.
   El repo es privado: si el clone pide credenciales o dice "not found", pará y
   decime que corra `gh auth login` (o que inicie sesión en GitHub) y te avise.
3. Corré `npm install`, después `npm run build`, después `npm link`.
4. Corré `orq --help`. Si dice que `orq` no existe, desde acá en adelante usá
   `node dist/cli.js` en lugar de `orq` y avisame al final.
5. Corré `orq init --dry-run`. Si la salida dice "Instalacion V1", corré
   `orq migrate`. Si no, corré `orq init`.
6. Corré `orq doctor` y mostrame completas las líneas [warn] y [fail].
   Si alguna dice `codex login`, decime que lo corra yo (es interactivo).
7. Terminá diciéndome que abra una sesión nueva de Claude Code para cargar los hooks.
```

## Cómo se usa

En Claude Code: *"Trabajá como Orquestador"* (skill `/orquestador`). El gate de
presupuesto ya corrió al abrir la sesión y está en el contexto.

| Topología | Cuándo | Cómo |
|---|---|---|
| **DIRECT** | El default: cambios chicos, acoplados, o donde delegar cuesta más | El razonador |
| **DELEGATED** | Una unidad grande o mecánica contra un contrato congelado | Subagente Claude, o `orq run --role constructor --reason volume` |
| **ASYNC_REVIEW** | Review adversarial de algo ya verde mientras seguís | `orq run --role reviewer --reason independence --background` (tope: 1 por tarea) |
| **PARALLEL** | Dos unidades sin archivos en común | `orq worktree add <nombre>` si las dos escriben |

Checkpoints: `orq checkpoint fast` (los checks del repo, bloquea si falla) y
`orq checkpoint deep` (+ review adversarial, para auth, pagos, contratos…).
Planes con fases y dependencias `hard`/`soft`/`independent`: `orq plan check`.

### Ejemplo — "Implementá recuperación de contraseña"

```
[orq] Presupuesto: estado CODEX-PREFERRED | Codex GO (80% libre) | Claude 5h 58%

Razonador: 2 preguntas (¿mail o SMS? ¿expiración?) · orq codeintel impact src/auth
Plan: p1 contrato+RED (tester Claude, independence) -> p2 GREEN (Codex, volume)
      -> p3 UI (DIRECT)     p2 depende hard de p1; p3 soft de p2

tester (Sonnet)                       -> 9 RED
orq run --role constructor --reason volume  -> 6 archivos, GREEN
orq checkpoint fast                   -> PASS
orq run --role security-reviewer --reason independence --background --task auth-reset
razonador sigue con p3 (UI) mientras Codex revisa
orq jobs <id>  -> [P1] token sin rate limit (evidencia: 50 requests en 1 s)
                  [P2] log con email
Arbitraje: P1 real -> fix directo; P2 descartado, el logger redacta (logger.ts:88)
orq metrics --finding accepted|rejected ...
```

### Ejemplo — "Renombrá `usr` a `user` en session.ts"

```
El razonador edita el archivo. Fin.
orq metrics --decision not_delegated --reason too_small
```

## Qué mide

`orq metrics` — por sesión: si el gate corrió, delegaciones con su motivo y las
decisiones de **no** delegar, subagentes con duración real, delegaciones a Codex,
findings aceptados/rechazados, suites completas contra dirigidas, fricciones. Si
el log no registró la sesión, lo dice en vez de reportar ceros.
`orq metrics --feedback` arma el informe de cierre.

## Documentación

- [`docs/SYSTEM.md`](docs/SYSTEM.md) — cómo funciona hoy: reglas, arquitectura, flujos, datos, seguridad.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — por qué (V2: D-020 a D-032).
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — qué falta.
- [`INSTALL.md`](INSTALL.md) — instalación, upgrade, uninstall, doctor, troubleshooting.
- [`CHANGELOG.md`](CHANGELOG.md).

Todo cambio de comportamiento actualiza `docs/SYSTEM.md` (y `DECISIONS.md` si
trae una decisión) y `CHANGELOG.md` en el mismo diff.
