# Decisiones vigentes

Estado actual del diseño. Lo que describe la v1 (runtime `orq`) está en el tag `v1-final`.

## Codex solo a través del plugin oficial

ClaudeGPT no lanza ni administra procesos de Codex. Todo pasa por
`openai/codex-plugin-cc`: `codex:rescue` para delegar y el companion del plugin para
los reviews. Así desaparecen el launcher nativo, los hooks propios y la gestión de
procesos que tenía la v1.

## La skill se invoca solo a mano

`disable-model-invocation: true`. El comando es `/claudegpt:orquestador`, porque
Claude Code siempre antepone el nombre del plugin a sus componentes. Fuera de esa
invocación, Claude trabaja sin fases, sin documentos y sin delegar automáticamente.

## Review automático con wrapper y respaldo manual

`/codex:review` y `/codex:adversarial-review` tienen `disable-model-invocation`.
`scripts/codex-review.mjs` ubica el companion del plugin (primero en
`installed_plugins.json`, después en el cache con la versión semver más alta) y lo
invoca con la misma forma que esos comandos. Si no lo encuentra, sale con 3 y la skill
le pide al usuario el comando manual. Depende de la estructura interna del plugin.
El review gate del plugin no se activa nunca.

## Dos documentos operativos y /docs estable

`IMPLEMENTATION.md` cumple a la vez de plan y de estado, e incluye un Punto de
reanudación. `HANDOFF.md` solo se escribe cuando se prevé un compact o un cambio de
sesión. `/docs` guarda el conocimiento estable del proyecto que se orquesta. No existe
un comando `/fase`: con `continuar` y esos dos documentos alcanza.

## SKILL.md corto

Después de un compact, Claude Code vuelve a adjuntar solo los primeros 5.000 tokens
de cada skill invocada. SKILL.md queda por debajo de ese límite, con lo crítico
arriba. La plantilla de spec para Codex y las plantillas de documentos se cargan
bajo demanda.

## Notificaciones en un plugin aparte

`claudegpt-notify` es opcional y se puede desinstalar sin afectar al orquestador. En
Windows lanza `powershell.exe` con `windowsHide` y sin `detached` (en Windows,
`detached` le crea consola propia al hijo), espera hasta 8 s como máximo y siempre sale
con 0.

## Versiones de Codex

- Windows: la versión estable verificada, en una variable de `install.ps1`.
- Linux: `latest`.
- No hay soporte para macOS.
