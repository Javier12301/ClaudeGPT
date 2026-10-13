# Decisiones vigentes

Estado actual del diseño (v3). La v1 (runtime `orq`) está en el tag `v1-final`; la v2
(plugin de Claude Code sobre `codex-plugin-cc`), en el historial.

## Una skill independiente, no un plugin

ClaudeGPT es la skill `claudegpt` y se instala con `npx skills add` (el mismo ecosistema
que usa Orca para sus skills y que `find-skills`). Así se instala igual para Claude Code
y Codex, se actualiza aparte de Orca y no modifica configuraciones del usuario. No hay
scripts de instalación: no aportaban nada que `npx skills` no cubra.

## Solo invocación manual

Claude: `disable-model-invocation: true` → `/claudegpt`. Codex:
`agents/openai.yaml` con `policy.allow_implicit_invocation: false` → `$claudegpt`.
Fuera de esa invocación el agente trabaja sin fases, sin documentos y sin delegar.
OpenCode no tiene flag equivalente; la description lo pide de forma explícita.

## Orca es el runtime; nada propio

Procesos, terminales, worktrees, mensajería y estado de workers son de Orca. La skill no
copia sus flags: manda a cargar `orca skills get orchestration` (la guía del binario
instalado) y fija solo el ciclo mínimo y los hechos verificados. Orca no valida que el
CLI de un agente exista, así que la skill lo verifica antes de delegar.

## Codex por su CLI, no como worker de Orca

En Windows, un worker Codex con sandbox no puede escribir en el named pipe del runtime
de Orca y nunca entrega `worker_done` (stablyai/orca#13539; en macOS #22947). Correrlo
sin sandbox no es aceptable. Por eso Codex implementa y testea con
`codex exec -s workspace-write -o <archivo>` y revisa con `codex review`: el fin del
proceso es la señal de terminado. Si ese issue se cierra, Codex puede volver a
`worker-start`.

## Reviews con `codex review`

Es el CLI oficial y aplica la skill de sistema `review-agent` de OpenAI (findings P0–P3
con archivo:línea). Reemplaza al wrapper sobre los internals de `codex-plugin-cc`.
`--base` no admite instrucciones: el adversarial pasa el rango y el foco en el texto.

## Nunca esperar a ciegas

Toda espera tiene timeout y corre en background con aviso al terminar; si algo no avanza
se mira su salida. Viene de la PoC: un worker que no puede reportar deja al coordinador
esperando indefinidamente.

## Versiones de Codex: la última, con CLI y daemon alineados

Ya no se fija una versión en Windows. Se actualiza con `npm i -g @openai/codex@latest` y
`codex app-server daemon update`. Si el CLI y su daemon quedan en versiones distintas,
cada sesión abre un menú de "incompatible feature settings" que traba a un agente
desatendido.

## Documentos: dos operativos y /docs estable

`IMPLEMENTATION.md` es plan y estado, con un Punto de reanudación que guarda el `run_id`
de Orca, no una copia de su estado. `HANDOFF.md` solo se escribe antes de un compact o
un cambio de sesión. `/docs` guarda el conocimiento estable del proyecto que se orquesta.

## SKILL.md corto y una sola referencia

Después de un compact, Claude Code vuelve a adjuntar solo los primeros 5.000 tokens de
cada skill invocada. SKILL.md queda debajo de ese límite, con lo crítico arriba.
`references/delegacion.md` se carga solo al delegar o revisar: si el Tech Lead resuelve
directo, no paga ese contexto.

## Herramientas opcionales

CodeGraph, engram, Context7 y Chrome DevTools MCP se usan si están disponibles; nunca
son requisito.

## Sin plugin de notificaciones

Orca ya notifica cuando un agente termina. `claudegpt-notify` se eliminó.
