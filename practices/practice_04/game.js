// Metro Rush — чистая игровая логика. Без DOM и браузерных API.
// Тестируется напрямую (см. test_game.js), используется render.js / main.js в браузере.
// Всё, что зависит от случайности, получает rng снаружи — тесты детерминированы.

const LANES = 3;
const LANE_WIDTH = 2.6; // ширина полосы в мировых единицах (нужна рендеру и спавну)

// Механическая КПП: у каждой передачи свой диапазон скоростей (мировые единицы/с).
// Диапазоны перекрываются, поэтому переключение в нужный момент не роняет обороты в ноль.
const GEARS = [
  { min: 0, max: 10 },
  { min: 7, max: 16 },
  { min: 12, max: 22 },
  { min: 17, max: 28 },
  { min: 22, max: 34 },
];
const MAX_GEAR = GEARS.length;

const BASE_ACCEL = 9; // базовое ускорение на пике момента
const LUGGING_FACTOR = 0.3; // доля тяги, если передача слишком высокая для скорости
const BRAKE_DECEL = 26;
const ENGINE_BRAKE = 14; // торможение двигателем, если скорость выше диапазона передачи

const PERFECT_SHIFT_MIN = 0.82; // окно "идеального" переключения по оборотам: [0.82, 1)
const EARLY_SHIFT_MAX = 0.45; // переключение вверх ниже этих оборотов — "рано"
const PERFECT_SHIFT_BONUS = 150; // очков за идеальное переключение (умножается на передачу)
const PERFECT_SHIFT_BOOST = 2; // прибавка скорости за идеальное переключение
const SHIFT_COOLDOWN = 0.8; // защита от фарма бонуса быстрыми Q/E

const NITRO_DURATION = 3;
const NITRO_SPEED_BONUS = 8;
const NITRO_ACCEL_FACTOR = 1.8;
const NITRO_PER_COIN = 0.05; // 20 монет = полный баллон
const MAGNET_DURATION = 8;
const MAGNET_RANGE = 10;

const JUMP_DURATION = 0.7;
const JUMP_HEIGHT = 2.2;
const BARRIER_CLEARANCE = 0.9; // с какой высоты машина перелетает барьер
const LANE_SWITCH_RATE = 12; // скорость перестроения (полос в секунду)

const CAR_HALF_LENGTH = 1.6;
const COIN_PICKUP_RADIUS = 1.4;
const COIN_HEIGHT_TOLERANCE = 1.2;
const COIN_SCORE = 10;
const KMH_FACTOR = 6; // перевод внутренней скорости в км/ч для спидометра

const FIRST_SPAWN_Z = 70;
const SPAWN_AHEAD = 260;
const DESPAWN_BEHIND = 20;
const DIFFICULTY_DISTANCE = 8000; // на какой дистанции сложность выходит на максимум

const VALID_COMMANDS = new Set(["left", "right", "jump", "gearUp", "gearDown", "nitro", "none"]);

// ---------- утилиты и валидация ----------

/**
 * Ограничивает число диапазоном [min, max].
 */
function clamp(value, min, max) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new TypeError("value must be a finite number");
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * Входная валидация команды игрока. Вызывается первой строкой в applyCommand().
 */
function validateCommand(command) {
  if (typeof command !== "string") {
    throw new TypeError("command must be a string");
  }
  if (!VALID_COMMANDS.has(command)) {
    throw new RangeError(`unknown command: "${command}"`);
  }
  return true;
}

/**
 * Валидация шага времени в секундах (неотрицательное конечное число).
 */
function validateDt(dt) {
  if (typeof dt !== "number" || !Number.isFinite(dt) || dt < 0) {
    throw new RangeError("dt must be a non-negative finite number");
  }
  return true;
}

/**
 * Валидация номера передачи: целое 1..MAX_GEAR.
 */
function validateGear(gear) {
  if (typeof gear !== "number" || !Number.isInteger(gear)) {
    throw new TypeError("gear must be an integer");
  }
  if (gear < 1 || gear > MAX_GEAR) {
    throw new RangeError(`gear out of range: ${gear}`);
  }
  return true;
}

/**
 * Генератор псевдослучайных чисел (mulberry32) с заданным seed.
 * Возвращает функцию () => число в [0, 1). Один seed — одна и та же трасса.
 */
function createRng(seed) {
  if (typeof seed !== "number" || !Number.isInteger(seed)) {
    throw new TypeError("seed must be an integer");
  }
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- состояние ----------

/**
 * Начальное состояние машины игрока.
 * lane — целевая полоса (0..LANES-1), x — фактическое положение (плавно догоняет lane).
 */
function createPlayer() {
  return {
    lane: 1,
    x: 1,
    z: 0,
    speed: 0,
    gear: 1,
    jumping: false,
    jumpT: 0,
    nitro: 0, // заряд баллона 0..1
    nitroT: 0, // сколько секунд нитро ещё активно
    magnetT: 0,
    shiftCooldown: 0,
    braking: false,
    crashed: false,
  };
}

/**
 * Начальное состояние мира: игрок, объекты на трассе, счёт и статистика заезда.
 * events — события последнего вызова (монета, переключение, краш), их читает рендер/звук.
 */
function createWorld() {
  return {
    player: createPlayer(),
    objects: [],
    nextId: 1,
    nextSpawnZ: FIRST_SPAWN_Z,
    safeLane: 1,
    score: 0,
    coins: 0,
    perfectShifts: 0,
    maxSpeed: 0,
    time: 0,
    events: [],
  };
}

// ---------- двигатель и КПП ----------

/**
 * Обороты двигателя как доля диапазона текущей передачи.
 * 0 — низ диапазона (или ниже), 1 — отсечка. Может быть > 1 после понижения передачи.
 */
function rpm(speed, gear) {
  validateGear(gear);
  const g = GEARS[gear - 1];
  return Math.max(0, (speed - g.min) / (g.max - g.min));
}

/**
 * Максимальная скорость на передаче с учётом нитро.
 */
function topSpeed(gear, nitroActive = false) {
  validateGear(gear);
  return GEARS[gear - 1].max + (nitroActive ? NITRO_SPEED_BONUS : 0);
}

/**
 * Ускорение от двигателя: пик момента на средних оборотах, слабая тяга
 * на слишком высокой передаче, ноль на отсечке. Высокие передачи тянут слабее.
 */
function engineAccel(speed, gear, nitroActive = false) {
  validateGear(gear);
  const g = GEARS[gear - 1];
  if (speed >= topSpeed(gear, nitroActive)) {
    return 0;
  }
  const nitroFactor = nitroActive ? NITRO_ACCEL_FACTOR : 1;
  if (speed < g.min) {
    return BASE_ACCEL * LUGGING_FACTOR * nitroFactor;
  }
  const r = Math.min(1, (speed - g.min) / (g.max - g.min));
  const torque = 0.65 + 0.35 * Math.sin(Math.PI * r);
  const gearFactor = 1 - (gear - 1) * 0.1;
  return BASE_ACCEL * torque * gearFactor * nitroFactor;
}

/**
 * Переключение передачи вверх (+1) или вниз (-1).
 * Возвращает { player, event }; event.quality: perfect | good | early | late | overrev.
 * На крайних передачах переключение не происходит, event = null.
 */
function shiftGear(player, direction) {
  if (direction !== 1 && direction !== -1) {
    throw new RangeError("direction must be 1 or -1");
  }
  const newGear = player.gear + direction;
  if (newGear < 1 || newGear > MAX_GEAR) {
    return { player, event: null };
  }

  const r = rpm(player.speed, player.gear);
  let quality = "good";
  let speed = player.speed;

  if (direction === 1) {
    if (r >= 1) {
      quality = "late"; // простоял на отсечке
    } else if (r >= PERFECT_SHIFT_MIN && player.shiftCooldown <= 0) {
      quality = "perfect";
      speed += PERFECT_SHIFT_BOOST;
    } else if (r < EARLY_SHIFT_MAX) {
      quality = "early";
    }
  } else if (player.speed > GEARS[newGear - 1].max) {
    quality = "overrev";
  }

  return {
    player: { ...player, gear: newGear, speed, shiftCooldown: SHIFT_COOLDOWN },
    event: { type: "shift", gear: newGear, direction, quality },
  };
}

/**
 * Множитель очков: чем выше передача, тем больше очков за метр; нитро удваивает.
 */
function computeMultiplier(player) {
  const base = 1 + (player.gear - 1) * 0.25;
  return player.nitroT > 0 ? base * 2 : base;
}

/**
 * Скорость для спидометра, км/ч.
 */
function kmh(speed) {
  return Math.round(speed * KMH_FACTOR);
}

// ---------- движение игрока ----------

/**
 * Высота прыжка в текущий момент: парабола от 0 до JUMP_HEIGHT и обратно.
 */
function jumpHeight(player) {
  if (!player.jumping) {
    return 0;
  }
  const t = clamp(player.jumpT / JUMP_DURATION, 0, 1);
  return JUMP_HEIGHT * 4 * t * (1 - t);
}

/**
 * Полоса, в которой машина находится физически (для столкновений во время перестроения).
 */
function laneOf(player) {
  return Math.round(player.x);
}

/**
 * Физика игрока за шаг dt: скорость (двигатель/тормоз/отсечка), позиция,
 * плавное перестроение, прыжок и таймеры бонусов. Возвращает новое состояние.
 */
function updatePlayer(player, dt, input = {}) {
  validateDt(dt);
  if (player.crashed) {
    return player;
  }

  const nitroActive = player.nitroT > 0;
  const top = topSpeed(player.gear, nitroActive);
  const braking = Boolean(input.brake);
  let speed = player.speed;

  if (braking) {
    speed = Math.max(0, speed - BRAKE_DECEL * dt);
  } else if (speed > top) {
    speed = Math.max(top, speed - ENGINE_BRAKE * dt);
  } else {
    speed = Math.min(top, speed + engineAccel(speed, player.gear, nitroActive) * dt);
  }

  const dx = player.lane - player.x;
  const maxStep = LANE_SWITCH_RATE * dt;
  const x = Math.abs(dx) <= maxStep ? player.lane : player.x + Math.sign(dx) * maxStep;

  let jumping = player.jumping;
  let jumpT = player.jumpT;
  if (jumping) {
    jumpT += dt;
    if (jumpT >= JUMP_DURATION) {
      jumping = false;
      jumpT = 0;
    }
  }

  return {
    ...player,
    speed,
    z: player.z + speed * dt,
    x,
    jumping,
    jumpT,
    braking,
    nitroT: Math.max(0, player.nitroT - dt),
    magnetT: Math.max(0, player.magnetT - dt),
    shiftCooldown: Math.max(0, player.shiftCooldown - dt),
  };
}

/**
 * Применяет команду игрока к миру. Невалидная команда бросает исключение
 * и не доходит до состояния. Возвращает новый мир; world.events — события этой команды.
 */
function applyCommand(world, command) {
  validateCommand(command);

  const p = world.player;
  if (p.crashed || command === "none") {
    return { ...world, events: [] };
  }

  let player = p;
  let score = world.score;
  let perfectShifts = world.perfectShifts;
  const events = [];

  switch (command) {
    case "left":
    case "right": {
      const lane = clamp(p.lane + (command === "left" ? -1 : 1), 0, LANES - 1);
      if (lane !== p.lane) {
        player = { ...p, lane };
        events.push({ type: "lane", lane });
      }
      break;
    }
    case "jump":
      if (!p.jumping) {
        player = { ...p, jumping: true, jumpT: 0 };
        events.push({ type: "jump" });
      }
      break;
    case "gearUp":
    case "gearDown": {
      const result = shiftGear(p, command === "gearUp" ? 1 : -1);
      player = result.player;
      if (result.event) {
        if (result.event.quality === "perfect") {
          const bonus = PERFECT_SHIFT_BONUS * result.event.gear;
          score += bonus;
          perfectShifts += 1;
          events.push({ ...result.event, bonus });
        } else {
          events.push(result.event);
        }
      }
      break;
    }
    case "nitro":
      if (p.nitro >= 1 && p.nitroT <= 0) {
        player = { ...p, nitro: 0, nitroT: NITRO_DURATION };
        events.push({ type: "nitro" });
      }
      break;
  }

  return { ...world, player, score, perfectShifts, events };
}

// ---------- трасса ----------

/**
 * Генерирует один "паттерн" препятствий в точке world.nextSpawnZ.
 * Гарантия проходимости: полоса safeLane всегда свободна от поездов,
 * safeLane смещается максимум на одну полосу за паттерн,
 * следующий паттерн начинается только после самого длинного объекта + зазор.
 */
function spawnPattern(world, rng) {
  const z = world.nextSpawnZ;
  const difficulty = clamp(z / DIFFICULTY_DISTANCE, 0, 1);
  const objects = [];
  let id = world.nextId;

  let safeLane = world.safeLane;
  const drift = rng();
  if (drift < 0.25) {
    safeLane = Math.max(0, safeLane - 1);
  } else if (drift > 0.75) {
    safeLane = Math.min(LANES - 1, safeLane + 1);
  }

  const others = [];
  for (let lane = 0; lane < LANES; lane++) {
    if (lane !== safeLane) others.push(lane);
  }
  if (rng() < 0.5) others.reverse();

  const blockCount = rng() < 0.35 + difficulty * 0.45 ? 2 : 1;
  let span = 0;
  for (let i = 0; i < blockCount; i++) {
    const lane = others[i];
    if (rng() < 0.55) {
      const length = 14 + Math.floor(rng() * 3) * 8;
      objects.push({ id: id++, type: "train", lane, z, length, variant: Math.floor(rng() * 3) });
      span = Math.max(span, length);
    } else {
      objects.push({ id: id++, type: "barrier", lane, z, length: 0.6 });
      span = Math.max(span, 0.6);
    }
  }

  const extra = rng();
  if (extra < 0.25 + difficulty * 0.2) {
    // барьер на свободной полосе + дуга монет над ним — награда за прыжок
    const bz = z + 6;
    objects.push({ id: id++, type: "barrier", lane: safeLane, z: bz, length: 0.6 });
    for (let i = 0; i < 5; i++) {
      const k = (i - 2) / 2.5;
      objects.push({ id: id++, type: "coin", lane: safeLane, z: bz + (i - 2) * 2.2, h: 1.8 * (1 - k * k) });
    }
    span = Math.max(span, 11);
  } else if (extra < 0.9) {
    const count = 5 + Math.floor(rng() * 4);
    for (let i = 0; i < count; i++) {
      objects.push({ id: id++, type: "coin", lane: safeLane, z: z + i * 3, h: 0 });
    }
  } else {
    objects.push({ id: id++, type: "magnet", lane: safeLane, z: z + 4 });
  }

  const gap = 34 - difficulty * 12 + rng() * 14;
  return {
    ...world,
    objects: [...world.objects, ...objects],
    nextId: id,
    safeLane,
    nextSpawnZ: z + span + gap,
  };
}

/**
 * Досоздаёт трассу так, чтобы впереди игрока всегда было SPAWN_AHEAD единиц объектов.
 */
function spawnAhead(world, rng) {
  let w = world;
  let guard = 0;
  while (w.nextSpawnZ < w.player.z + SPAWN_AHEAD && guard < 32) {
    w = spawnPattern(w, rng);
    guard += 1;
  }
  return w;
}

/**
 * Столкновение с поездом или барьером за шаг [prevZ, player.z] (swept-проверка,
 * чтобы тонкий барьер не "проскочил" между кадрами на высокой скорости).
 * Барьер можно перепрыгнуть, поезд — нет.
 */
function hitsObstacle(player, prevZ, obj) {
  if (obj.type !== "train" && obj.type !== "barrier") {
    return false;
  }
  if (laneOf(player) !== obj.lane) {
    return false;
  }
  const near = Math.min(prevZ, player.z) - CAR_HALF_LENGTH;
  const far = Math.max(prevZ, player.z) + CAR_HALF_LENGTH;
  if (far < obj.z || near > obj.z + obj.length) {
    return false;
  }
  if (obj.type === "barrier") {
    return jumpHeight(player) < BARRIER_CLEARANCE;
  }
  return true;
}

/**
 * Подбор монеты или бонуса. С активным магнитом монеты впереди
 * собираются со всех полос и на любой высоте.
 */
function collects(player, prevZ, obj) {
  if (obj.type === "coin" && player.magnetT > 0) {
    const ahead = obj.z - player.z;
    if (ahead >= -1 && ahead <= MAGNET_RANGE) return true;
  }
  if (laneOf(player) !== obj.lane) {
    return false;
  }
  const near = Math.min(prevZ, player.z) - COIN_PICKUP_RADIUS;
  const far = Math.max(prevZ, player.z) + COIN_PICKUP_RADIUS;
  if (obj.z < near || obj.z > far) {
    return false;
  }
  const h = obj.h || 0;
  return Math.abs(jumpHeight(player) - h) <= COIN_HEIGHT_TOLERANCE;
}

/**
 * Один шаг симуляции: физика игрока, генерация трассы, столкновения,
 * подбор монет/бонусов, начисление очков. Чистая функция (rng подаётся снаружи).
 * input.brake — зажат ли тормоз.
 */
function step(world, dt, input = {}, rng = Math.random) {
  validateDt(dt);
  if (world.player.crashed) {
    return { ...world, events: [] };
  }

  const prevZ = world.player.z;
  let player = updatePlayer(world.player, dt, input);
  const spawned = spawnAhead({ ...world, player }, rng);

  const events = [];
  let coins = world.coins;
  let score = world.score;
  const kept = [];

  for (const obj of spawned.objects) {
    const end = obj.z + (obj.length || 0);
    if (end < player.z - DESPAWN_BEHIND) {
      continue;
    }
    if (obj.type === "coin" || obj.type === "magnet") {
      if (!player.crashed && collects(player, prevZ, obj)) {
        if (obj.type === "coin") {
          coins += 1;
          score += COIN_SCORE * computeMultiplier(player);
          player = { ...player, nitro: Math.min(1, player.nitro + NITRO_PER_COIN) };
          events.push({ type: "coin", lane: obj.lane, z: obj.z, h: obj.h || 0 });
        } else {
          player = { ...player, magnetT: MAGNET_DURATION };
          events.push({ type: "magnet" });
        }
        continue;
      }
    } else if (!player.crashed && hitsObstacle(player, prevZ, obj)) {
      player = { ...player, crashed: true, speed: 0, jumping: false, jumpT: 0, nitroT: 0 };
      events.push({ type: "crash", obstacle: obj.type, lane: obj.lane });
    }
    kept.push(obj);
  }

  if (!player.crashed) {
    score += (player.z - prevZ) * computeMultiplier(player);
  }

  return {
    ...spawned,
    player,
    objects: kept,
    coins,
    score,
    maxSpeed: Math.max(world.maxSpeed, player.speed),
    time: world.time + dt,
    events,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LANES,
    LANE_WIDTH,
    GEARS,
    MAX_GEAR,
    BASE_ACCEL,
    BRAKE_DECEL,
    PERFECT_SHIFT_MIN,
    EARLY_SHIFT_MAX,
    PERFECT_SHIFT_BONUS,
    PERFECT_SHIFT_BOOST,
    SHIFT_COOLDOWN,
    NITRO_DURATION,
    NITRO_SPEED_BONUS,
    NITRO_PER_COIN,
    MAGNET_DURATION,
    MAGNET_RANGE,
    JUMP_DURATION,
    JUMP_HEIGHT,
    BARRIER_CLEARANCE,
    CAR_HALF_LENGTH,
    COIN_SCORE,
    KMH_FACTOR,
    FIRST_SPAWN_Z,
    SPAWN_AHEAD,
    DESPAWN_BEHIND,
    VALID_COMMANDS,
    clamp,
    validateCommand,
    validateDt,
    validateGear,
    createRng,
    createPlayer,
    createWorld,
    rpm,
    topSpeed,
    engineAccel,
    shiftGear,
    computeMultiplier,
    kmh,
    jumpHeight,
    laneOf,
    updatePlayer,
    applyCommand,
    spawnPattern,
    spawnAhead,
    hitsObstacle,
    collects,
    step,
  };
}
