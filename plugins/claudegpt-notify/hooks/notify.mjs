#!/usr/bin/env node
// Notificación de escritorio para los hooks Stop y Notification de Claude Code.
// Opcional: el orquestador no depende de esto. Nunca falla ni bloquea: siempre
// sale con 0 y mata al hijo si tarda más de KILL_AFTER_MS.
//
// win32 -> toast WinRT vía powershell.exe oculto (windowsHide, sin shell, sin detach:
//          en Windows detached le crea consola propia al hijo).
// linux -> notify-send; si no está instalado, no hace nada.
// otro  -> no hace nada.
//
// CLAUDEGPT_NOTIFY_DRYRUN=1 imprime el comando en vez de ejecutarlo.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const KILL_AFTER_MS = 8000;
// AppUserModelID registrado por Windows PowerShell: permite toasts sin instalar nada.
const WINDOWS_APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

function readInput() {
  try {
    if (process.stdin.isTTY) return {};
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function buildMessage(input) {
  const project = input.cwd ? path.basename(input.cwd) : "";
  const title = project ? `Claude Code · ${project}` : "Claude Code";
  const body =
    input.hook_event_name === "Notification"
      ? input.message || "Claude necesita tu atención"
      : "Claude terminó";
  return { title, body: body.slice(0, 250) };
}

function xmlEscape(s) {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
}

function windowsCommand({ title, body }) {
  const xml = `<toast><visual><binding template="ToastGeneric"><text>${xmlEscape(title)}</text><text>${xmlEscape(body)}</text></binding></visual></toast>`;
  const script = [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
    "$x = New-Object Windows.Data.Xml.Dom.XmlDocument",
    `$x.LoadXml('${xml.replace(/'/g, "''")}')`,
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${WINDOWS_APP_ID}').Show([Windows.UI.Notifications.ToastNotification]::new($x))`,
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return {
    file: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
  };
}

function linuxCommand({ title, body }) {
  return { file: "notify-send", args: ["--app-name=Claude Code", title, body] };
}

function commandFor(platform, msg) {
  if (platform === "win32") return windowsCommand(msg);
  if (platform === "linux") return linuxCommand(msg);
  return null;
}

function main() {
  const platform = process.env.CLAUDEGPT_NOTIFY_PLATFORM || process.platform;
  const cmd = commandFor(platform, buildMessage(readInput()));
  if (!cmd) return;

  if (process.env.CLAUDEGPT_NOTIFY_DRYRUN === "1") {
    console.log(JSON.stringify(cmd));
    return;
  }

  let child;
  try {
    child = spawn(cmd.file, cmd.args, { stdio: "ignore", windowsHide: true, shell: false });
  } catch {
    return;
  }
  const timer = setTimeout(() => child.kill(), KILL_AFTER_MS);
  const done = () => clearTimeout(timer);
  child.on("error", done); // ENOENT (p. ej. sin notify-send): se ignora
  child.on("exit", done);
}

try {
  main();
} catch {
  // Una notificación nunca rompe la sesión.
}
process.exitCode = 0;
