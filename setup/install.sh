#!/usr/bin/env bash
# Instalador de ClaudeGPT para Linux.
# Verifica Node, instala Codex CLI, copia la config base de Codex si no existe
# e imprime los comandos /plugin a correr.
#
# Uso: bash setup/install.sh [--dry-run]
set -euo pipefail

# En Linux se usa la última estable publicada.
CODEX_VERSION_LINUX="latest"

NODE_MIN_MAJOR=18
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "Argumento desconocido: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '==> %s\n' "$1"; }
fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || fail "install.sh es solo para Linux. En Windows usá setup/install.ps1."

step "Verificando Node y npm"
command -v node >/dev/null 2>&1 || fail "Node no está instalado. Instalá Node $NODE_MIN_MAJOR+ y volvé a correr."
command -v npm >/dev/null 2>&1 || fail "npm no está en el PATH."
node_version="$(node --version | sed 's/^v//')"
[ "${node_version%%.*}" -ge "$NODE_MIN_MAJOR" ] || fail "Node $node_version es viejo; hace falta $NODE_MIN_MAJOR+."
echo "    node $node_version"

step "Config de Codex en $CODEX_HOME_DIR"
target="$CODEX_HOME_DIR/config.toml"
if [ -e "$target" ]; then
  echo "    config.toml ya existe: no se toca"
elif [ "$DRY_RUN" = 1 ]; then
  echo "    [dry-run] copiar setup/codex-config.toml -> $target"
else
  mkdir -p "$CODEX_HOME_DIR"
  cp "$SCRIPT_DIR/codex-config.toml" "$target"
  echo "    copiado $target"
fi

step "Codex CLI ($CODEX_VERSION_LINUX)"
current=""
if command -v codex >/dev/null 2>&1; then
  current="$(codex --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
fi
wanted="$CODEX_VERSION_LINUX"
if [ "$wanted" = "latest" ]; then
  wanted="$(npm view @openai/codex version 2>/dev/null || echo latest)"
fi
if [ -n "$current" ] && [ "$current" = "$wanted" ]; then
  echo "    ya instalado ($current)"
elif [ "$DRY_RUN" = 1 ]; then
  echo "    [dry-run] npm install -g @openai/codex@$wanted (actual: ${current:-ninguna})"
else
  npm install -g "@openai/codex@$wanted" || fail "npm install falló. Si es un problema de permisos, usá nvm o 'npm config set prefix ~/.npm-global'."
fi

echo
step "Listo. Falta, en este orden:"
cat <<EOF
  1. En una terminal:   codex login        (cuenta ChatGPT; si ya lo hiciste, saltealo)
  2. Dentro de Claude Code:
       /plugin marketplace add openai/codex-plugin-cc
       /plugin install codex@openai-codex
       /plugin marketplace add $REPO_ROOT
       /plugin install claudegpt@claudegpt
       /plugin install claudegpt-notify@claudegpt     (opcional; necesita notify-send)
       /reload-plugins
       /codex:setup
  3. Probar:   /claudegpt:orquestador <requerimiento>
No actives el review gate de Codex (/codex:setup --enable-review-gate): el orquestador decide cuándo revisar.
EOF
