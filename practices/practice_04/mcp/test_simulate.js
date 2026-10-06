// Тесты ядра simulate_run (без MCP). Запуск: node mcp/test_simulate.js

const test = require("node:test");
const assert = require("node:assert/strict");
const { simulateRun, validateRunInput, MAX_SECONDS } = require("./simulate.js");

test("simulateRun: без команд машина едет на 1-й передаче и упирается в отсечку", () => {
  const r = simulateRun({ seed: 1, seconds: 3 });
  assert.equal(r.final_gear, 1);
  assert.equal(r.final_kmh, 60, "отсечка 1-й передачи = 10 ед/с = 60 км/ч");
  assert.ok(r.distance > 0);
  assert.equal(r.shifts.length, 0);
});

test("simulateRun: одинаковый seed и команды — одинаковый результат", () => {
  const input = { seed: 42, seconds: 20, autopilot: true };
  assert.deepEqual(simulateRun(input), simulateRun(input));
});

test("simulateRun: переключение на высоких оборотах засчитывается как perfect", () => {
  const r = simulateRun({ seed: 1, seconds: 3, actions: [{ t: 1.1, cmd: "gearUp" }] });
  assert.equal(r.shifts.length, 1);
  assert.equal(r.shifts[0].gear, 2);
  assert.equal(r.shifts[0].quality, "perfect");
  assert.equal(r.perfect_shifts, 1);
});

test("simulateRun: переключение сразу со старта — early", () => {
  const r = simulateRun({ seed: 1, seconds: 1, actions: [{ t: 0, cmd: "gearUp" }] });
  assert.equal(r.shifts[0].quality, "early");
});

test("simulateRun: без управления машина рано или поздно разбивается, краш описан", () => {
  const r = simulateRun({ seed: 7, seconds: 60, actions: [{ t: 0.9, cmd: "gearUp" }] });
  assert.equal(r.finished, "crash");
  assert.ok(["train", "barrier"].includes(r.crash.obstacle));
  assert.ok(r.seconds_simulated < 60);
});

test("simulateRun: автопилот в среднем уезжает намного дальше машины без управления", () => {
  // бот простой и иногда разбивается — проверяем свойство на 50 трассах, а не одну удачную
  let withBot = 0;
  let without = 0;
  let crashes = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const bot = simulateRun({ seed, seconds: 30, autopilot: true });
    withBot += bot.distance;
    without += simulateRun({ seed, seconds: 30 }).distance;
    if (bot.finished === "crash") crashes += 1;
  }
  assert.ok(withBot > without * 4, `бот ${withBot.toFixed(0)} vs без управления ${without.toFixed(0)}`);
  assert.ok(crashes <= 15, `слишком много аварий бота: ${crashes} из 50`);
});

test("validateRunInput: неизвестная команда — RangeError с указанием поля (валидация фичи A)", () => {
  assert.throws(
    () => validateRunInput({ seed: 1, seconds: 5, actions: [{ t: 1, cmd: "turbo" }] }),
    { name: "RangeError", message: 'actions[0].cmd: unknown command: "turbo"' }
  );
});

test("validateRunInput: время вне диапазона и нецелый seed отклоняются", () => {
  assert.throws(() => validateRunInput({ seed: 1, seconds: 0 }), RangeError);
  assert.throws(() => validateRunInput({ seed: 1, seconds: MAX_SECONDS + 1 }), RangeError);
  assert.throws(() => validateRunInput({ seed: 1.5, seconds: 5 }), TypeError);
  assert.throws(() => validateRunInput({ seed: 1, seconds: 5, actions: [{ t: 9, cmd: "jump" }] }), RangeError);
});
