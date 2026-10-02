// Hook для OpenCode 1.x: после того как агент изменил файл игры
// (инструменты edit / write / apply_patch), запускает scripts/check.sh
// и дописывает результат в ответ инструмента — агент сразу видит PASS/FAIL
// и может исправить ошибку, не дожидаясь, пока проверку запустит человек.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Корень проекта = на два уровня выше этого файла (.opencode/plugins/ → practice_04/).
// Не зависим от того, из какой папки запущен opencode.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK_SCRIPT = path.join(ROOT, "scripts", "check.sh");

const EDIT_TOOLS = new Set(["edit", "write", "apply_patch", "multiedit", "patch"]);
const WATCHED = new Set([
  "game.js",
  "render.js",
  "audio.js",
  "main.js",
  "test_game.js",
  "index.html",
  "styles.css",
]);
const TIMEOUT_MS = 120_000;

// Какие файлы затронул вызов инструмента (по его аргументам).
function touchedFiles(args) {
  if (!args) return [];
  if (typeof args.filePath === "string") return [args.filePath];
  if (typeof args.patchText === "string") {
    return [...args.patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim());
  }
  return [];
}

// Файл относится к игре, если лежит прямо в корне проекта и входит в WATCHED.
function isGameFile(file, baseDir) {
  const abs = path.resolve(baseDir, file);
  return path.dirname(abs) === ROOT && WATCHED.has(path.basename(abs));
}

function runCheck() {
  return new Promise((resolve) => {
    const child = spawn("sh", [CHECK_SCRIPT], { cwd: ROOT });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      out += `\nпроверка не уложилась в ${TIMEOUT_MS / 1000} с и была остановлена`;
    }, TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, out: `не удалось запустить ${CHECK_SCRIPT}: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out: out.trim() });
    });
  });
}

export const CheckAfterEdit = async ({ directory }) => ({
  "tool.execute.after": async (input, output) => {
    if (!EDIT_TOOLS.has(input.tool)) return;
    const files = touchedFiles(input.args).filter((f) => isGameFile(f, directory || ROOT));
    if (files.length === 0) return;

    const { code, out } = await runCheck();
    const verdict = code === 0 ? "PASS" : "FAIL";
    const names = files.map((f) => path.basename(f)).join(", ");
    output.output =
      `${output.output ?? ""}\n\n` +
      `[hook check-after-edit] изменён ${names} → sh scripts/check.sh: ${verdict}\n` +
      out +
      (code === 0 ? "" : "\nИсправь ошибки выше, прежде чем продолжать.");
  },
});
