#!/usr/bin/env node
// Сравнение баланса Metro Rush: текущий код против версии из git (по умолчанию HEAD).
// Прогоняет одинаковые трассы (seed 1..N) автопилотом и без управления
// на логике game.js через ядро MCP-инструмента (mcp/simulate.js) и печатает таблицу.
//
//   node .agents/skills/metro-balance-check/scripts/balance.js [--seeds 30] [--seconds 30] [--ref HEAD] [--dir <папка практики>]
//
// Код выхода: 0 — сравнение готово, 1 — ошибка входа или окружения (текст ошибки в stderr).

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PRACTICE_DIR_DEFAULT = path.resolve(__dirname, "..", "..", "..", "..");

function parseArgs(argv) {
  const opts = { seeds: 30, seconds: 30, ref: "HEAD", dir: PRACTICE_DIR_DEFAULT };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`для ${key} не указано значение`);
    if (key === "--seeds") opts.seeds = Number(value);
    else if (key === "--seconds") opts.seconds = Number(value);
    else if (key === "--ref") opts.ref = value;
    else if (key === "--dir") opts.dir = path.resolve(value);
    else throw new Error(`неизвестный параметр ${key} (есть: --seeds, --seconds, --ref, --dir)`);
  }
  if (!Number.isInteger(opts.seeds) || opts.seeds < 5 || opts.seeds > 500) {
    throw new Error(`--seeds должен быть целым от 5 до 500, получено ${opts.seeds}`);
  }
  if (!Number.isFinite(opts.seconds) || opts.seconds <= 0 || opts.seconds > 120) {
    throw new Error(`--seconds должен быть в (0, 120], получено ${opts.seconds}`);
  }
  return opts;
}

// Достаёт game.js и mcp/simulate.js из git-версии ref во временную папку
// с той же структурой, чтобы simulate.js нашёл ../game.js.
function checkoutRef(practiceDir, ref) {
  const git = (...args) => execFileSync("git", args, { cwd: practiceDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  let prefix;
  try {
    prefix = git("rev-parse", "--show-prefix");
  } catch {
    throw new Error(`${practiceDir} не внутри git-репозитория`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "metro-balance-"));
  fs.mkdirSync(path.join(tmp, "mcp"));
  for (const file of ["game.js", "mcp/simulate.js"]) {
    let content;
    try {
      content = git("show", `${ref}:${prefix}${file}`);
    } catch {
      throw new Error(`в версии ${ref} нет файла ${prefix}${file} (нужен коммит, где уже есть MCP)`);
    }
    fs.writeFileSync(path.join(tmp, file), content + "\n");
  }
  return tmp;
}

function measure(simulatePath, seeds, seconds) {
  const { simulateRun } = require(simulatePath);
  const m = { distance: 0, score: 0, crashes: 0, upshifts: 0, perfect: 0, maxKmh: 0, idleSurvival: 0 };
  for (let seed = 1; seed <= seeds; seed++) {
    const bot = simulateRun({ seed, seconds, autopilot: true });
    m.distance += bot.distance;
    m.score += bot.score;
    m.maxKmh += bot.max_kmh;
    if (bot.finished === "crash") m.crashes += 1;
    const ups = bot.shifts.filter((s) => s.gear > 1 && s.quality !== "overrev");
    m.upshifts += ups.length;
    m.perfect += ups.filter((s) => s.quality === "perfect").length;
    // сколько продержится машина без управления — грубая мера плотности препятствий
    m.idleSurvival += simulateRun({ seed, seconds }).seconds_simulated;
  }
  return {
    "Средняя дистанция (бот), м": m.distance / seeds,
    "Средние очки (бот)": m.score / seeds,
    "Аварий бота, %": (m.crashes / seeds) * 100,
    "Доля идеальных переключений, %": m.upshifts ? (m.perfect / m.upshifts) * 100 : 0,
    "Средняя макс. скорость, км/ч": m.maxKmh / seeds,
    "Без управления до аварии, с": m.idleSurvival / seeds,
  };
}

function fmt(x) {
  return Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const currentSim = path.join(opts.dir, "mcp", "simulate.js");
  if (!fs.existsSync(currentSim)) throw new Error(`не найден ${currentSim}`);

  const refDir = checkoutRef(opts.dir, opts.ref);
  try {
    const before = measure(path.join(refDir, "mcp", "simulate.js"), opts.seeds, opts.seconds);
    const after = measure(currentSim, opts.seeds, opts.seconds);

    console.log(`Баланс Metro Rush: ${opts.ref} → текущий код (${opts.seeds} трасс × ${opts.seconds} с)\n`);
    console.log("| Метрика | " + opts.ref + " | сейчас | изменение |");
    console.log("|---|---|---|---|");
    let changed = false;
    for (const key of Object.keys(before)) {
      const b = before[key];
      const a = after[key];
      const diff = a - b;
      if (Math.abs(diff) > 1e-9) changed = true;
      const rel = Math.abs(b) > 1e-9 ? ` (${diff >= 0 ? "+" : ""}${((diff / b) * 100).toFixed(0)}%)` : "";
      console.log(`| ${key} | ${fmt(b)} | ${fmt(a)} | ${diff >= 0 ? "+" : ""}${fmt(diff)}${rel} |`);
    }
    console.log(changed ? "\nБаланс изменился — интерпретируй по SKILL.md." : "\nБаланс не изменился: метрики совпадают.");
  } finally {
    fs.rmSync(refDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error(`Ошибка: ${err.message}`);
  process.exit(1);
}
