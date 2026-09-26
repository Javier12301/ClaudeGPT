#!/usr/bin/env node
// Lanza el review del plugin oficial de Codex (openai/codex-plugin-cc) desde la
// skill orquestador. /codex:review y /codex:adversarial-review tienen
// disable-model-invocation, asi que el modelo no puede invocarlos: este wrapper
// ubica el companion instalado y lo llama con la misma forma que esos comandos
// (`node codex-companion.mjs <sub> "<args>"`, un solo string de argumentos).
//
// Depende de la estructura interna del plugin de Codex. Si no lo encuentra, sale
// con 3 y la skill le pide al usuario tipear el comando a mano.
//
// Uso: node codex-review.mjs <review|adversarial-review> "<args>"
//      node codex-review.mjs --resolve   (imprime la ruta del companion)

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SUBCOMMANDS = new Set(["review", "adversarial-review"]);
const PLUGIN_ID = "codex@openai-codex";
const COMPANION = path.join("scripts", "codex-companion.mjs");
const NOT_FOUND = 3;
const USAGE = 6;

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

function compareSemver(a, b) {
  const pa = String(a).split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function highest(candidates) {
  const found = candidates.filter((c) => existsSync(c.file));
  found.sort((a, b) => compareSemver(b.version, a.version));
  return found[0]?.file ?? null;
}

function fromInstalledPlugins(pluginsDir) {
  try {
    const data = JSON.parse(readFileSync(path.join(pluginsDir, "installed_plugins.json"), "utf8"));
    const entry = (data.plugins ?? data)[PLUGIN_ID];
    const installs = Array.isArray(entry) ? entry : entry ? [entry] : [];
    return highest(
      installs
        .filter((i) => i && typeof i.installPath === "string")
        .map((i) => ({ version: i.version ?? path.basename(i.installPath), file: path.join(i.installPath, COMPANION) })),
    );
  } catch {
    return null;
  }
}

function fromCache(pluginsDir) {
  const base = path.join(pluginsDir, "cache", "openai-codex", "codex");
  try {
    return highest(readdirSync(base).map((v) => ({ version: v, file: path.join(base, v, COMPANION) })));
  } catch {
    return null;
  }
}

function resolveCompanion() {
  const pluginsDir = path.join(claudeDir(), "plugins");
  return fromInstalledPlugins(pluginsDir) ?? fromCache(pluginsDir);
}

function manualCommand(sub, args) {
  return `/codex:${sub}${args ? ` ${args}` : ""}`;
}

function main() {
  const [sub, ...rest] = process.argv.slice(2);

  if (sub === "--resolve") {
    const file = resolveCompanion();
    if (!file) return process.exit(NOT_FOUND);
    console.log(file);
    return;
  }

  const args = rest.join(" ").trim();
  if (!SUBCOMMANDS.has(sub)) {
    console.error(`codex-review: subcomando invalido "${sub ?? ""}". Usar review | adversarial-review.`);
    return process.exit(USAGE);
  }
  if (/--(enable|disable)-review-gate/.test(args)) {
    console.error("codex-review: el orquestador nunca toca el review gate.");
    return process.exit(USAGE);
  }

  const companion = resolveCompanion();
  if (!companion) {
    console.error(
      `codex-review: no se encontro el companion del plugin ${PLUGIN_ID} en ${path.join(claudeDir(), "plugins")}.\n` +
        `Pedile al usuario que tipee: ${manualCommand(sub, args)}`,
    );
    return process.exit(NOT_FOUND);
  }

  const child = spawn(process.execPath, [companion, sub, args], {
    stdio: "inherit",
    windowsHide: true,
    shell: false,
  });
  child.on("error", (err) => {
    console.error(`codex-review: fallo al lanzar el companion (${err.message}).\nPedile al usuario que tipee: ${manualCommand(sub, args)}`);
    process.exit(NOT_FOUND);
  });
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

main();
