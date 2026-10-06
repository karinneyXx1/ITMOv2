// Ядро MCP-инструмента simulate_run: прогоняет заезд Metro Rush без браузера
// на настоящей логике game.js и возвращает итог. Не зависит от MCP SDK —
// тестируется напрямую (test_simulate.js), сервер (server.mjs) только оборачивает.

const game = require("../game.js");

const DT = 1 / 60; // шаг симуляции — как кадр в браузере
const MAX_SECONDS = 120;
const MAX_ACTIONS = 500;

/**
 * Входная валидация (тот же подход, что в фиче A): первой строкой,
 * громкие TypeError/RangeError с указанием, какое поле неверно.
 */
function validateRunInput(input) {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("input must be an object");
  }
  const { seed, seconds, actions = [], autopilot = false } = input;
  if (typeof seed !== "number" || !Number.isInteger(seed)) {
    throw new TypeError("seed must be an integer");
  }
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    throw new TypeError("seconds must be a finite number");
  }
  if (seconds <= 0 || seconds > MAX_SECONDS) {
    throw new RangeError(`seconds must be in (0, ${MAX_SECONDS}], got ${seconds}`);
  }
  if (!Array.isArray(actions)) {
    throw new TypeError("actions must be an array");
  }
  if (actions.length > MAX_ACTIONS) {
    throw new RangeError(`too many actions: ${actions.length} > ${MAX_ACTIONS}`);
  }
  actions.forEach((a, i) => {
    if (typeof a !== "object" || a === null) {
      throw new TypeError(`actions[${i}] must be an object { t, cmd }`);
    }
    if (typeof a.t !== "number" || !Number.isFinite(a.t) || a.t < 0 || a.t > seconds) {
      throw new RangeError(`actions[${i}].t must be a number in [0, ${seconds}], got ${a.t}`);
    }
    try {
      game.validateCommand(a.cmd); // валидация из фичи A
    } catch (err) {
      err.message = `actions[${i}].cmd: ${err.message}`;
      throw err;
    }
  });
  if (typeof autopilot !== "boolean") {
    throw new TypeError("autopilot must be a boolean");
  }
  return true;
}

/**
 * Простой автопилот: уходит от поездов на свободный путь, прыгает через
 * барьеры, переключается вверх на высоких оборотах. Возвращает команды на этот кадр.
 */
function autopilotCommands(world) {
  const p = world.player;
  const cmds = [];
  const lookahead = 18 + p.speed * 0.6;
  // поезд мешает, если любая его часть (z..z+length) попадает в окно от борта машины до lookahead —
  // так учитываются и длинные поезда, которые уже едут рядом
  const trains = world.objects.filter(
    (o) => o.type === "train" && o.z - p.z < lookahead && o.z + o.length > p.z - game.CAR_HALF_LENGTH
  );
  const train = trains.find((o) => o.lane === p.lane && o.z > p.z);
  if (train) {
    const blocked = new Set(trains.map((o) => o.lane));
    const free = [0, 1, 2]
      .filter((l) => !blocked.has(l))
      .sort((a, b) => Math.abs(a - p.lane) - Math.abs(b - p.lane))[0];
    if (free !== undefined && free !== p.lane) cmds.push(free < p.lane ? "left" : "right");
  }
  const barrier = world.objects.find(
    (o) => o.type === "barrier" && o.lane === p.lane && o.z - p.z > 0 && o.z - p.z < p.speed * 0.3 + 2
  );
  if (barrier && !p.jumping) cmds.push("jump");
  if (p.gear < game.MAX_GEAR && game.rpm(p.speed, p.gear) > 0.9) cmds.push("gearUp");
  return cmds;
}

/**
 * Прогон заезда. Команды из actions применяются, когда время заезда доходит до t.
 * Возвращает итог: причину окончания, дистанцию, очки, переключения, краш.
 */
function simulateRun(input) {
  validateRunInput(input);
  const { seed, seconds, actions = [], autopilot = false } = input;

  const rng = game.createRng(seed);
  let world = game.createWorld();
  const queue = [...actions].sort((a, b) => a.t - b.t);
  const shifts = [];
  let crash = null;
  let time = 0;

  const record = (events) => {
    for (const e of events) {
      if (e.type === "shift") {
        shifts.push({ t: round(time), gear: e.gear, quality: e.quality });
      } else if (e.type === "crash") {
        crash = { t: round(time), obstacle: e.obstacle, lane: e.lane, distance: round(world.player.z) };
      }
    }
  };

  while (time < seconds && !world.player.crashed) {
    while (queue.length && queue[0].t <= time) {
      world = game.applyCommand(world, queue.shift().cmd);
      record(world.events);
    }
    if (autopilot) {
      for (const cmd of autopilotCommands(world)) {
        world = game.applyCommand(world, cmd);
        record(world.events);
      }
    }
    const dt = Math.min(DT, seconds - time);
    world = game.step(world, dt, {}, rng);
    time += dt;
    record(world.events);
  }

  const p = world.player;
  return {
    seed,
    seconds_requested: seconds,
    seconds_simulated: round(time),
    finished: crash ? "crash" : "time",
    crash,
    distance: round(p.z),
    score: Math.floor(world.score),
    coins: world.coins,
    final_gear: p.gear,
    final_kmh: game.kmh(p.speed),
    max_kmh: game.kmh(world.maxSpeed),
    perfect_shifts: world.perfectShifts,
    shifts,
  };
}

function round(x) {
  return Math.round(x * 100) / 100;
}

module.exports = { simulateRun, validateRunInput, autopilotCommands, MAX_SECONDS, MAX_ACTIONS };
