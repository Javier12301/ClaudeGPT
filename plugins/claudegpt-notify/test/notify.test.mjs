import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../hooks/notify.mjs", import.meta.url));

function run(input, env) {
  return spawnSync(process.execPath, [SCRIPT], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 15000,
  });
}

const dry = (platform) => ({ CLAUDEGPT_NOTIFY_DRYRUN: "1", CLAUDEGPT_NOTIFY_PLATFORM: platform });

test("win32: powershell oculto con toast y texto escapado", () => {
  const r = run({ hook_event_name: "Notification", message: `Aprobá <rm> & "x" it's`, cwd: "/p/mi-app" }, dry("win32"));
  assert.equal(r.status, 0, r.stderr);
  const cmd = JSON.parse(r.stdout);
  assert.equal(cmd.file, "powershell.exe");
  assert.deepEqual(cmd.args.slice(0, 7), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand"]);
  const script = Buffer.from(cmd.args[7], "base64").toString("utf16le");
  assert.match(script, /ToastNotificationManager/);
  assert.match(script, /Claude Code · mi-app/);
  assert.match(script, /Aprobá &lt;rm&gt; &amp; &quot;x&quot; it&apos;s/);
  assert.doesNotMatch(script, /<rm>/);
});

test("linux: notify-send con título y mensaje de Stop", () => {
  const r = run({ hook_event_name: "Stop", cwd: "/home/u/proyecto" }, dry("linux"));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), {
    file: "notify-send",
    args: ["--app-name=Claude Code", "Claude Code · proyecto", "Claude terminó"],
  });
});

test("otras plataformas: no hace nada", () => {
  const r = run({ hook_event_name: "Stop" }, dry("darwin"));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("linux sin notify-send: sale con 0 sin error", () => {
  const r = run({ hook_event_name: "Stop" }, { CLAUDEGPT_NOTIFY_PLATFORM: "linux", PATH: "" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("stdin vacío o inválido: sale con 0", () => {
  assert.equal(run("", dry("linux")).status, 0);
  assert.equal(run("{no es json", dry("linux")).status, 0);
});
