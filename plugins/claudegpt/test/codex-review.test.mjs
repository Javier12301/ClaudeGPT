import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/codex-review.mjs", import.meta.url));

// Companion falso: imprime lo que recibió y sale con FAKE_EXIT (default 0).
const FAKE_COMPANION = `console.log(JSON.stringify({ tag: process.env.FAKE_TAG_FROM, argv: process.argv.slice(2) }));
process.exit(Number(process.env.FAKE_EXIT ?? 0));`;

function fakeConfig() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "claudegpt-review-"));
  mkdirSync(path.join(dir, "plugins"), { recursive: true });
  return dir;
}

function addCompanion(root, tag) {
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  writeFileSync(path.join(root, "scripts", "codex-companion.mjs"), FAKE_COMPANION.replace("process.env.FAKE_TAG_FROM", JSON.stringify(tag)));
}

function run(configDir, args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, ...env },
    encoding: "utf8",
  });
}

test("usa el installPath de installed_plugins.json y pasa los args como un solo string", (t) => {
  const dir = fakeConfig();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const install = path.join(dir, "elsewhere", "codex");
  addCompanion(install, "installed");
  writeFileSync(
    path.join(dir, "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "codex@openai-codex": [{ scope: "user", installPath: install, version: "1.0.6" }] } }),
  );

  const r = run(dir, ["review", "--base main"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { tag: "installed", argv: ["review", "--base main"] });
});

test("sin installed_plugins.json toma la versión semver más alta del cache", (t) => {
  const dir = fakeConfig();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cache = path.join(dir, "plugins", "cache", "openai-codex", "codex");
  addCompanion(path.join(cache, "1.0.6"), "1.0.6");
  addCompanion(path.join(cache, "1.0.10"), "1.0.10");
  mkdirSync(path.join(cache, "1.0.11"), { recursive: true }); // sin companion: se ignora

  const r = run(dir, ["adversarial-review", "--base", "main", "auth", "flow"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { tag: "1.0.10", argv: ["adversarial-review", "--base main auth flow"] });
});

test("sin plugin de Codex sale con 3 y muestra el comando manual", (t) => {
  const dir = fakeConfig();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const r = run(dir, ["review", "--base main"]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /\/codex:review --base main/);
  assert.equal(run(dir, ["--resolve"]).status, 3);
});

test("propaga el exit code del companion", (t) => {
  const dir = fakeConfig();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  addCompanion(path.join(dir, "plugins", "cache", "openai-codex", "codex", "1.0.6"), "x");

  assert.equal(run(dir, ["review", "--base main"], { FAKE_EXIT: "5" }).status, 5);
});

test("rechaza el review gate y subcomandos desconocidos", (t) => {
  const dir = fakeConfig();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  addCompanion(path.join(dir, "plugins", "cache", "openai-codex", "codex", "1.0.6"), "x");

  assert.equal(run(dir, ["review", "--enable-review-gate"]).status, 6);
  assert.equal(run(dir, ["setup"]).status, 6);
  assert.equal(run(dir, ["task", "do stuff"]).status, 6);
});
