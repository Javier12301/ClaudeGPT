# ClaudeGPT: orquestador Claude + Codex

Marketplace de plugins de Claude Code con una skill de invocación manual,
**`/claudegpt:orquestador`**. Claude trabaja como Tech Lead: investiga, pregunta,
planifica por fases y arbitra. Cada fase se ejecuta con Claude directo, con un
subagente Sonnet o con Codex. Codex se usa a través del plugin oficial
[`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc); este repo no
lanza procesos propios.

Fuera de `/claudegpt:orquestador`, Claude Code trabaja normalmente: no hay fases,
documentos ni delegación automática.

Plataformas: **Windows y Linux**.

## Instalación en una PC nueva

Requisitos: Claude Code, Git, Node 18+ y una cuenta de ChatGPT para Codex.

1. Cloná el repo:
   `git clone https://github.com/Javier12301/Claudio-y-Gepeto.git ClaudeGPT && cd ClaudeGPT`
2. Corré el instalador. Verifica Node, instala Codex CLI y copia
   `setup/codex-config.toml` a `~/.codex/config.toml` **solo si no existe**:
   - Windows: `powershell -ExecutionPolicy Bypass -File setup\install.ps1`
   - Linux: `bash setup/install.sh`

   (Con `-DryRun` / `--dry-run` muestra qué haría sin tocar nada.)
3. Iniciá sesión en Codex: `codex login`
4. En Claude Code, instalá el plugin de Codex:
   `/plugin marketplace add openai/codex-plugin-cc` y `/plugin install codex@openai-codex`
5. Instalá este marketplace y el orquestador:
   `/plugin marketplace add <ruta del repo clonado>` y `/plugin install claudegpt@claudegpt`
6. Opcional: `/plugin install claudegpt-notify@claudegpt`, para recibir notificaciones de escritorio.
7. `/reload-plugins`, y después `/codex:setup` para verificar que Codex está listo.
8. Probá: `/claudegpt:orquestador <requerimiento y preferencias>`

El instalador imprime estos mismos comandos con la ruta ya resuelta.

> No actives el review gate del plugin de Codex (`/codex:setup --enable-review-gate`):
> el orquestador decide cuándo conviene un review.

## Uso

```
/claudegpt:orquestador Implementar X. Tests: Codex. Review: Codex. Implementación: decidí vos.
/claudegpt:orquestador docs/analisis-x.md
/claudegpt:orquestador continuar
```

- Las preferencias que declares (quién testea, quién revisa, quién implementa) mandan
  sobre las reglas por defecto.
- Arranca en plan mode: investiga, pregunta hasta cerrar dudas y entrega un informe de
  viabilidad. Cuando aprobás el plan, lo escribe en `IMPLEMENTATION.md` (plan y
  estado de la feature en un solo documento).
- Hace un commit por cada unidad lógica estable. **Nunca hace `git push`.**
- Cuando el contexto se ensucia, deja todo persistido en `/docs`, `IMPLEMENTATION.md`
  y `HANDOFF.md`, y te recomienda `/compact`. Para retomar en una sesión nueva:
  `/claudegpt:orquestador continuar`.
- La invocación siempre lleva el prefijo del plugin (`/claudegpt:orquestador`). Claude
  Code no ofrece `/orquestador` a secas para skills de plugin.

## Cómo se ejecutan los reviews de Codex

`/codex:review` y `/codex:adversarial-review` solo se pueden invocar a mano. Para que
el orquestador pueda lanzarlos solo, `plugins/claudegpt/scripts/codex-review.mjs` ubica
el `codex-companion.mjs` del plugin de Codex instalado y lo llama con los mismos
argumentos que esos comandos. Busca primero en `~/.claude/plugins/installed_plugins.json`
y, si no lo encuentra ahí, en el cache con la versión más alta. Respeta `CLAUDE_CONFIG_DIR`.

**Esto depende de la estructura interna del plugin de Codex.** Si una actualización
del plugin cambia esa estructura, el wrapper sale con código 3 y el orquestador se
detiene para pedirte que tipees el comando a mano (por ejemplo `/codex:review --base
main`). Nunca saltea el review en silencio.

## Versión de Codex

- **Windows:** `$CODEX_VERSION_WINDOWS` en `setup/install.ps1` es la **versión estable
  verificada**, hoy 0.157.1. Subila solo después de usar una versión nueva en
  condiciones reales sin que se abran ventanas de consola. Si reaparecen, volvé de
  inmediato a la última estable y corré de nuevo el instalador.
- **Linux:** `CODEX_VERSION_LINUX="latest"` en `setup/install.sh`.

## Notificaciones (opcional)

`claudegpt-notify` muestra una notificación cuando Claude termina o pide atención. En
Windows es un toast y en Linux usa `notify-send`; si no está instalado, no hace nada.
El orquestador no depende de este plugin: si da problemas,
`/plugin uninstall claudegpt-notify@claudegpt` y listo.

## Estructura

```
.claude-plugin/marketplace.json
plugins/claudegpt/               skill orquestador, plantillas, guía de Codex, codex-review.mjs
plugins/claudegpt-notify/        hooks Stop/Notification (opcional)
setup/                           install.ps1, install.sh, codex-config.toml
docs/decisions.md                decisiones vigentes
```

## Desarrollo

```bash
node --test "plugins/*/test/*.test.mjs"
claude plugin validate . && claude plugin validate ./plugins/claudegpt && claude plugin validate ./plugins/claudegpt-notify
```

Para probar una instalación sin tocar tu configuración real, usá
`CLAUDE_CONFIG_DIR` y `CODEX_HOME` apuntando a un directorio temporal.

La versión 1 (runtime `orq`) está en el tag `v1-final`.

## Licencia

MIT
