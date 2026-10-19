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

// Гараж: улучшения машины за монеты (openspec change garage-upgrades).
const UPGRADE_IDS = ["engine", "nitro", "jump"];
const MAX_UPGRADE_LEVEL = 3;
const UPGRADE_PRICES = [50, 120, 250]; // цена уровня 1, 2, 3 — одинаковая для всех улучшений
// Эффекты по уровням 0..3. Мотор растягивает диапазоны передач (а не ускорение:
// замер показал, что рост ускорения ухудшает очки).
const ENGINE_GEAR_SCALE = [1.0, 1.03, 1.06, 1.1];
const NITRO_DURATION_BY_LEVEL = [3, 4, 5, 6]; // секунды
const JUMP_HEIGHT_SCALE = [1.0, 1.1, 1.2, 1.3];

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
function createPlayer(stats = statsForLevels()) {
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
    stats, // характеристики машины из гаража: { gearScale, nitroDuration, jumpHeight }
  };
}

/**
 * Начальное состояние мира: игрок, объекты на трассе, счёт и статистика заезда.
 * events — события последнего вызова (монета, переключение, краш), их читает рендер/звук.
 * levels — уровни улучшений из гаража (необязательно, по умолчанию все 0).
 */
function createWorld(levels = {}) {
  return {
    player: createPlayer(statsForLevels(levels)),
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

/** Диапазон передачи с учётом мотора из гаража (gearScale = 1 — без улучшения). */
function scaledGear(gear, gearScale) {
  const g = GEARS[gear - 1];
  return gearScale === 1 ? g : { min: g.min * gearScale, max: g.max * gearScale };
}

/**
 * Обороты двигателя как доля диапазона текущей передачи.
 * 0 — низ диапазона (или ниже), 1 — отсечка. Может быть > 1 после понижения передачи.
 */
function rpm(speed, gear, gearScale = 1) {
  validateGear(gear);
  const g = scaledGear(gear, gearScale);
  return Math.max(0, (speed - g.min) / (g.max - g.min));
}

/**
 * Максимальная скорость на передаче с учётом нитро.
 */
function topSpeed(gear, nitroActive = false, gearScale = 1) {
  validateGear(gear);
  return scaledGear(gear, gearScale).max + (nitroActive ? NITRO_SPEED_BONUS : 0);
}

/**
 * Ускорение от двигателя: пик момента на средних оборотах, слабая тяга
 * на слишком высокой передаче, ноль на отсечке. Высокие передачи тянут слабее.
 */
function engineAccel(speed, gear, nitroActive = false, gearScale = 1) {
  validateGear(gear);
  const g = scaledGear(gear, gearScale);
  if (speed >= topSpeed(gear, nitroActive, gearScale)) {
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
function shiftGear(player, direction, gearScale = 1) {
  if (direction !== 1 && direction !== -1) {
    throw new RangeError("direction must be 1 or -1");
  }
  const newGear = player.gear + direction;
  if (newGear < 1 || newGear > MAX_GEAR) {
    return { player, event: null };
  }

  const r = rpm(player.speed, player.gear, gearScale);
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
  } else if (player.speed > scaledGear(newGear, gearScale).max) {
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
 * Высота прыжка в текущий момент: парабола от 0 до высоты прыжка машины (stats.jumpHeight,
 * без статов — JUMP_HEIGHT) и обратно.
 */
function jumpHeight(player) {
  if (!player.jumping) {
    return 0;
  }
  const t = clamp(player.jumpT / JUMP_DURATION, 0, 1);
  const height = player.stats ? player.stats.jumpHeight : JUMP_HEIGHT;
  return height * 4 * t * (1 - t);
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
  const gearScale = player.stats ? player.stats.gearScale : 1;
  const top = topSpeed(player.gear, nitroActive, gearScale);
  const braking = Boolean(input.brake);
  let speed = player.speed;

  if (braking) {
    speed = Math.max(0, speed - BRAKE_DECEL * dt);
  } else if (speed > top) {
    speed = Math.max(top, speed - ENGINE_BRAKE * dt);
  } else {
    speed = Math.min(top, speed + engineAccel(speed, player.gear, nitroActive, gearScale) * dt);
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
      const result = shiftGear(p, command === "gearUp" ? 1 : -1, p.stats ? p.stats.gearScale : 1);
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
        player = { ...p, nitro: 0, nitroT: p.stats ? p.stats.nitroDuration : NITRO_DURATION };
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

// ---------- гараж: кошелёк и улучшения ----------

/**
 * Валидация id улучшения: строка из UPGRADE_IDS.
 */
function validateUpgradeId(id) {
  if (typeof id !== "string") {
    throw new TypeError("upgrade id must be a string");
  }
  if (!UPGRADE_IDS.includes(id)) {
    throw new RangeError(`неизвестное улучшение: "${id}"`);
  }
  return true;
}

/**
 * Пустой гараж: 0 монет, все улучшения на уровне 0.
 */
function createGarage() {
  return { coins: 0, levels: { engine: 0, nitro: 0, jump: 0 } };
}

/**
 * Цена следующего уровня улучшения или null, если уровень уже максимальный.
 */
function nextPrice(garage, id) {
  validateUpgradeId(id);
  const level = garage.levels[id];
  return level >= MAX_UPGRADE_LEVEL ? null : UPGRADE_PRICES[level];
}

/**
 * Зачисляет монеты в кошелёк. Возвращает новый гараж, исходный не меняется.
 */
function creditCoins(garage, amount) {
  if (typeof amount !== "number" || !Number.isInteger(amount)) {
    throw new TypeError("amount must be an integer");
  }
  if (amount < 0) {
    throw new RangeError(`amount must be non-negative, got ${amount}`);
  }
  return { ...garage, coins: garage.coins + amount };
}

/**
 * Читает сохранённый гараж (строку JSON). Отсутствующее, испорченное или
 * некорректное сохранение даёт пустой гараж — игра не должна падать из-за хранилища.
 */
function parseGarage(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return createGarage();
  }
  const isLevel = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_UPGRADE_LEVEL;
  const valid =
    data !== null &&
    typeof data === "object" &&
    Number.isInteger(data.coins) &&
    data.coins >= 0 &&
    data.levels !== null &&
    typeof data.levels === "object" &&
    Object.keys(data.levels).length === UPGRADE_IDS.length &&
    UPGRADE_IDS.every((id) => isLevel(data.levels[id]));
  if (!valid) {
    return createGarage();
  }
  return { coins: data.coins, levels: { engine: data.levels.engine, nitro: data.levels.nitro, jump: data.levels.jump } };
}

/**
 * Покупка следующего уровня улучшения. Возвращает новый гараж.
 * Отказ (неизвестное улучшение, максимальный уровень, не хватает монет) —
 * исключение с понятным текстом; исходный гараж при этом не меняется.
 */
function buyUpgrade(garage, id) {
  validateUpgradeId(id);
  const price = nextPrice(garage, id);
  if (price === null) {
    throw new RangeError(`улучшение уже максимального уровня (${MAX_UPGRADE_LEVEL})`);
  }
  if (garage.coins < price) {
    throw new RangeError(`Не хватает монет: нужно ${price}, есть ${garage.coins}`);
  }
  return {
    coins: garage.coins - price,
    levels: { ...garage.levels, [id]: garage.levels[id] + 1 },
  };
}

/**
 * Проверяет уровни улучшений для заезда: объект, известные id, целые 0..3.
 * Пропущенные улучшения считаются уровнем 0.
 */
function validateUpgradeLevels(levels) {
  if (typeof levels !== "object" || levels === null || Array.isArray(levels)) {
    throw new TypeError(`уровни улучшений должны быть объектом, получено ${levels === null ? "null" : typeof levels}`);
  }
  for (const [id, level] of Object.entries(levels)) {
    validateUpgradeId(id);
    if (!Number.isInteger(level) || level < 0 || level > MAX_UPGRADE_LEVEL) {
      throw new RangeError(`${id}: уровень должен быть от 0 до ${MAX_UPGRADE_LEVEL}, получено ${level}`);
    }
  }
  return true;
}

/** Характеристики машины по уровням улучшений; без уровней — прежние константы. */
function statsForLevels(levels = {}) {
  validateUpgradeLevels(levels);
  const { engine = 0, nitro = 0, jump = 0 } = levels;
  return {
    gearScale: ENGINE_GEAR_SCALE[engine],
    nitroDuration: NITRO_DURATION_BY_LEVEL[nitro],
    jumpHeight: JUMP_HEIGHT * JUMP_HEIGHT_SCALE[jump],
  };
}

// ---------- ежедневные задания (Spec Kit 003-daily-missions, specs/daily-missions-contract.md) ----------

const MISSION_TYPE_IDS = ["coins", "perfectShifts", "distance"];
// Цели по уровням сложности (лёгкое/среднее/сложное) — замер автопилотом: заезд ≈ 57–104 монеты,
// 2 идеальных переключения, 840–1500 м.
const MISSION_TYPES = {
  coins: { targets: [60, 150, 300] },
  perfectShifts: { targets: [3, 8, 12] },
  distance: { targets: [1000, 3000, 6000] },
};
const MISSION_REWARDS = [20, 40, 60]; // награда по уровню сложности, одинакова для всех видов
const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Ошибка логики заданий с полем code (контракт, раздел 4). */
function missionError(Cls, code, message) {
  const err = new Cls(message);
  err.code = code;
  return err;
}

function validateTimestamp(ts) {
  if (typeof ts !== "number") {
    throw missionError(TypeError, "invalid-input", `время должно быть числом, получено ${typeof ts}`);
  }
  if (!Number.isFinite(ts)) {
    throw missionError(RangeError, "invalid-input", `время должно быть конечным числом, получено ${ts}`);
  }
}

function validateDayKey(day) {
  if (typeof day !== "string") {
    throw missionError(TypeError, "invalid-input", `ключ дня должен быть строкой "ГГГГ-ММ-ДД", получено ${typeof day}`);
  }
  const m = DAY_KEY_RE.exec(day);
  const date = m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  if (!m || date.getMonth() !== Number(m[2]) - 1 || date.getDate() !== Number(m[3])) {
    throw missionError(RangeError, "invalid-input", `неверный ключ дня: "${day}"`);
  }
}

function validateRunResults(results) {
  if (typeof results !== "object" || results === null) {
    throw missionError(TypeError, "invalid-input", "итоги заезда должны быть объектом { coins, perfectShifts, distance }");
  }
  for (const type of MISSION_TYPE_IDS) {
    const v = results[type];
    if (typeof v !== "number") {
      throw missionError(TypeError, "invalid-input", `итоги заезда: ${type} должно быть числом, получено ${typeof v}`);
    }
    if (!Number.isInteger(v) || v < 0) {
      throw missionError(RangeError, "invalid-input", `итоги заезда: ${type} должно быть целым ≥ 0, получено ${v}`);
    }
  }
}

const pad2 = (n) => String(n).padStart(2, "0");

/** Календарный день по местному времени: "ГГГГ-ММ-ДД". */
function dayKey(ts) {
  validateTimestamp(ts);
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Момент ближайшей местной полуночи после ts (учитывает переход на летнее/зимнее время). */
function nextDayStart(ts) {
  validateTimestamp(ts);
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

// Зерно генератора из строки дня (FNV-1a) — один день даёт один набор на любом устройстве.
function daySeed(day) {
  let h = 0x811c9dc5;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// Уровни сложности дня: монеты и переключения — случайно по дате; дистанция — по номеру дня
// (% 3), поэтому соседние дни всегда отличаются хотя бы одной целью.
function missionLevels(day) {
  const [y, m, d] = day.split("-").map(Number);
  const dayNumber = Math.round(Date.UTC(y, m - 1, d) / 86400000);
  const rng = createRng(daySeed(day));
  return [Math.floor(rng() * 3), Math.floor(rng() * 3), dayNumber % 3];
}

/** Новый набор дня: по одному заданию каждого вида, прогресс 0. */
function createDailyMissions(day) {
  validateDayKey(day);
  const levels = missionLevels(day);
  return {
    day,
    seen: false,
    missions: MISSION_TYPE_IDS.map((type, i) => ({
      id: `${day}:${type}`,
      type,
      level: levels[i],
      target: MISSION_TYPES[type].targets[levels[i]],
      reward: MISSION_REWARDS[levels[i]],
      progress: 0,
      claimed: false,
    })),
  };
}

/**
 * Разбор сохранения: никогда не бросает при корректном day. Испорченное целиком — новый набор
 * на day; испорченный прогресс одного задания — 0; цели и награды — из правил дня.
 */
function parseMissions(raw, day) {
  validateDayKey(day);
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return createDailyMissions(day);
  }
  let base;
  try {
    base = createDailyMissions(data.day);
  } catch {
    return createDailyMissions(day);
  }
  const saved = data.missions;
  const shapeOk =
    Array.isArray(saved) &&
    saved.length === base.missions.length &&
    saved.every((m, i) => m !== null && typeof m === "object" && m.id === base.missions[i].id && m.type === base.missions[i].type);
  if (!shapeOk) {
    return createDailyMissions(day);
  }
  return {
    day: base.day,
    seen: data.seen === true,
    missions: base.missions.map((m, i) => {
      const p = saved[i].progress;
      const progress = Number.isInteger(p) && p >= 0 ? Math.min(p, m.target) : 0;
      return { ...m, progress, claimed: saved[i].claimed === true };
    }),
  };
}

/** Актуализация дня: в новый день — автозачисление незабранных наград и новый набор. */
function ensureMissionDay(state, garage, day) {
  validateDayKey(day);
  if (day <= state.day) {
    return { state, garage, autoCredited: 0, dayChanged: false };
  }
  const autoCredited = state.missions
    .filter((m) => m.progress >= m.target && !m.claimed)
    .reduce((sum, m) => sum + m.reward, 0);
  return {
    state: createDailyMissions(day),
    garage: autoCredited > 0 ? creditCoins(garage, autoCredited) : garage,
    autoCredited,
    dayChanged: true,
  };
}

/** Итоги заезда для заданий: монеты, идеальные переключения, целые метры. */
function runResultsFromWorld(world) {
  if (typeof world !== "object" || world === null || typeof world.player !== "object" || world.player === null) {
    throw missionError(TypeError, "invalid-input", "ожидается мир заезда");
  }
  return { coins: world.coins, perfectShifts: world.perfectShifts, distance: Math.floor(world.player.z) };
}

/** Какие задания эти итоги впервые довели бы до цели; состояние не меняется. */
function previewCompleted(state, results) {
  validateRunResults(results);
  return state.missions
    .filter((m) => m.progress < m.target && m.progress + results[m.type] >= m.target)
    .map((m) => m.id);
}

/** Учёт заезда: актуализация дня, прибавка к невыполненным с потолком цели. */
function applyRunToMissions(state, garage, results, day) {
  validateRunResults(results);
  const current = ensureMissionDay(state, garage, day);
  const gains = {};
  const completed = [];
  const missions = current.state.missions.map((m) => {
    const add = Math.min(results[m.type], m.target - m.progress);
    gains[m.id] = add;
    if (add === 0) {
      return m;
    }
    if (m.progress + add === m.target) {
      completed.push(m.id);
    }
    return { ...m, progress: m.progress + add };
  });
  return { ...current, state: { ...current.state, missions }, gains, completed };
}

/** Забрать награду: монеты в кошелёк гаража, задание помечается полученным. */
function claimMissionReward(state, garage, id, day) {
  if (typeof id !== "string") {
    throw missionError(TypeError, "invalid-input", `id задания должен быть строкой, получено ${typeof id}`);
  }
  validateDayKey(day);
  const idDay = id.slice(0, 10);
  if (DAY_KEY_RE.test(idDay) && idDay < day) {
    throw missionError(RangeError, "stale-day", "Задания устарели — наступил новый день");
  }
  const mission = state.missions.find((m) => m.id === id);
  if (!mission) {
    throw missionError(RangeError, "unknown-mission", `неизвестное задание: "${id}"`);
  }
  if (mission.progress < mission.target) {
    throw missionError(RangeError, "not-completed", `Задание ещё не выполнено: ${mission.progress} из ${mission.target}`);
  }
  if (mission.claimed) {
    throw missionError(RangeError, "already-claimed", "Награда за задание уже получена");
  }
  return {
    state: { ...state, missions: state.missions.map((m) => (m.id === id ? { ...m, claimed: true } : m)) },
    garage: creditCoins(garage, mission.reward),
    reward: mission.reward,
  };
}

function markMissionsSeen(state) {
  return { ...state, seen: true };
}

/** Данные для показа: задания с производным признаком completed. */
function describeMissions(state) {
  return state.missions.map((m) => ({
    id: m.id,
    type: m.type,
    level: m.level,
    target: m.target,
    progress: m.progress,
    completed: m.progress >= m.target,
    claimed: m.claimed,
    reward: m.reward,
  }));
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
    UPGRADE_IDS,
    MAX_UPGRADE_LEVEL,
    UPGRADE_PRICES,
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
    validateUpgradeId,
    createGarage,
    nextPrice,
    creditCoins,
    buyUpgrade,
    parseGarage,
    ENGINE_GEAR_SCALE,
    NITRO_DURATION_BY_LEVEL,
    JUMP_HEIGHT_SCALE,
    validateUpgradeLevels,
    statsForLevels,
    MISSION_TYPE_IDS,
    MISSION_TYPES,
    MISSION_REWARDS,
    dayKey,
    nextDayStart,
    createDailyMissions,
    parseMissions,
    ensureMissionDay,
    runResultsFromWorld,
    previewCompleted,
    applyRunToMissions,
    claimMissionReward,
    markMissionsSeen,
    describeMissions,
  };
}
