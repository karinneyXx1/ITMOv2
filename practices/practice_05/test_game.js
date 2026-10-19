// Тесты игровой логики Metro Rush (game.js). Только встроенные node:test / node:assert.
// Запуск: node test_game.js

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LANES,
  GEARS,
  MAX_GEAR,
  PERFECT_SHIFT_BONUS,
  PERFECT_SHIFT_BOOST,
  SHIFT_COOLDOWN,
  NITRO_DURATION,
  NITRO_SPEED_BONUS,
  NITRO_PER_COIN,
  MAGNET_DURATION,
  JUMP_DURATION,
  JUMP_HEIGHT,
  CAR_HALF_LENGTH,
  COIN_SCORE,
  FIRST_SPAWN_Z,
  SPAWN_AHEAD,
  DESPAWN_BEHIND,
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
} = require("./game.js");

// Мир без препятствий: генерация трассы отодвинута далеко вперёд.
function emptyWorld(playerPatch = {}) {
  const world = createWorld();
  return { ...world, nextSpawnZ: 1e9, player: { ...world.player, ...playerPatch } };
}

// Детерминированный "rng", который всегда возвращает одно и то же значение.
const constRng = (value) => () => value;

// ---------- валидация ----------

test("validateCommand: принимает все известные команды", () => {
  for (const cmd of ["left", "right", "jump", "gearUp", "gearDown", "nitro", "none"]) {
    assert.equal(validateCommand(cmd), true);
  }
});

test("validateCommand: TypeError на не-строку", () => {
  assert.throws(() => validateCommand(1), TypeError);
  assert.throws(() => validateCommand(null), TypeError);
  assert.throws(() => validateCommand(undefined), TypeError);
});

test("validateCommand: RangeError на неизвестную команду", () => {
  assert.throws(() => validateCommand("turbo"), RangeError);
  assert.throws(() => validateCommand(""), RangeError);
  assert.throws(() => validateCommand("accelerate"), RangeError, "старые команды больше не поддерживаются");
});

test("validateDt: принимает 0 и положительные, кидает на отрицательный/NaN/Infinity/строку", () => {
  assert.equal(validateDt(0), true);
  assert.equal(validateDt(0.016), true);
  assert.throws(() => validateDt(-0.1), RangeError);
  assert.throws(() => validateDt(NaN), RangeError);
  assert.throws(() => validateDt(Infinity), RangeError);
  assert.throws(() => validateDt("0.1"), RangeError);
});

test("validateGear: границы 1..MAX_GEAR", () => {
  assert.equal(validateGear(1), true);
  assert.equal(validateGear(MAX_GEAR), true);
  assert.throws(() => validateGear(0), RangeError);
  assert.throws(() => validateGear(MAX_GEAR + 1), RangeError);
  assert.throws(() => validateGear(2.5), TypeError);
  assert.throws(() => validateGear("3"), TypeError);
});

test("clamp: ограничивает и кидает на не-число", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
  assert.throws(() => clamp("5", 0, 10), TypeError);
  assert.throws(() => clamp(NaN, 0, 10), TypeError);
});

// ---------- rng ----------

test("createRng: одинаковый seed даёт одинаковую последовательность", () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 20; i++) {
    assert.equal(a(), b());
  }
});

test("createRng: значения в [0, 1), разные seed — разные последовательности", () => {
  const a = createRng(1);
  const b = createRng(2);
  let differs = false;
  for (let i = 0; i < 100; i++) {
    const va = a();
    assert.ok(va >= 0 && va < 1);
    if (va !== b()) differs = true;
  }
  assert.ok(differs);
});

test("createRng: кидает на нецелый seed", () => {
  assert.throws(() => createRng(1.5), TypeError);
  assert.throws(() => createRng("seed"), TypeError);
});

// ---------- начальное состояние ----------

test("createWorld: игрок стоит на средней полосе, на 1-й передаче, без очков", () => {
  const world = createWorld();
  assert.equal(world.player.lane, 1);
  assert.equal(world.player.x, 1);
  assert.equal(world.player.gear, 1);
  assert.equal(world.player.speed, 0);
  assert.equal(world.player.crashed, false);
  assert.equal(world.score, 0);
  assert.equal(world.coins, 0);
  assert.deepEqual(world.objects, []);
  assert.equal(world.nextSpawnZ, FIRST_SPAWN_Z);
});

// ---------- двигатель и КПП ----------

test("rpm: 0 внизу диапазона, 1 на отсечке, не отрицательные ниже диапазона", () => {
  const g2 = GEARS[1];
  assert.equal(rpm(g2.min, 2), 0);
  assert.equal(rpm(g2.max, 2), 1);
  assert.equal(rpm(0, 2), 0);
  assert.ok(rpm(g2.max + 3, 2) > 1, "после понижения передачи обороты выше отсечки");
});

test("engineAccel: ноль на отсечке, слабая тяга на слишком высокой передаче", () => {
  assert.equal(engineAccel(GEARS[0].max, 1), 0);
  const lugging = engineAccel(1, 5);
  const proper = engineAccel(1, 1);
  assert.ok(lugging > 0);
  assert.ok(lugging < proper, "5-я передача с места тянет хуже 1-й");
});

test("engineAccel: нитро добавляет тягу и поднимает потолок скорости", () => {
  const speed = GEARS[2].min + 2;
  assert.ok(engineAccel(speed, 3, true) > engineAccel(speed, 3, false));
  assert.equal(topSpeed(3, true), GEARS[2].max + NITRO_SPEED_BONUS);
  assert.ok(engineAccel(GEARS[2].max, 3, true) > 0, "с нитро отсечка выше");
});

test("shiftGear: идеальное переключение в окне оборотов даёт буст", () => {
  const g1 = GEARS[0];
  const speed = g1.min + (g1.max - g1.min) * 0.9;
  const { player, event } = shiftGear({ ...createPlayer(), speed }, 1);
  assert.equal(player.gear, 2);
  assert.equal(event.quality, "perfect");
  assert.equal(player.speed, speed + PERFECT_SHIFT_BOOST);
  assert.equal(player.shiftCooldown, SHIFT_COOLDOWN);
});

test("shiftGear: на отсечке — late, без буста", () => {
  const { player, event } = shiftGear({ ...createPlayer(), speed: GEARS[0].max }, 1);
  assert.equal(event.quality, "late");
  assert.equal(player.speed, GEARS[0].max);
});

test("shiftGear: на низких оборотах — early", () => {
  const { event } = shiftGear({ ...createPlayer(), speed: 1 }, 1);
  assert.equal(event.quality, "early");
});

test("shiftGear: во время кулдауна идеальное переключение не засчитывается", () => {
  const speed = GEARS[0].max * 0.9;
  const { event } = shiftGear({ ...createPlayer(), speed, shiftCooldown: 0.3 }, 1);
  assert.equal(event.quality, "good");
});

test("shiftGear: понижение на скорости выше диапазона — overrev", () => {
  const { player, event } = shiftGear({ ...createPlayer(), gear: 3, speed: GEARS[1].max + 4 }, -1);
  assert.equal(player.gear, 2);
  assert.equal(event.quality, "overrev");
});

test("shiftGear: не выходит за 1-ю и последнюю передачу", () => {
  const low = shiftGear(createPlayer(), -1);
  assert.equal(low.player.gear, 1);
  assert.equal(low.event, null);
  const high = shiftGear({ ...createPlayer(), gear: MAX_GEAR }, 1);
  assert.equal(high.player.gear, MAX_GEAR);
  assert.equal(high.event, null);
});

test("shiftGear: кидает на направление, отличное от ±1", () => {
  assert.throws(() => shiftGear(createPlayer(), 2), RangeError);
  assert.throws(() => shiftGear(createPlayer(), 0), RangeError);
});

test("computeMultiplier: растёт с передачей, удваивается нитро", () => {
  assert.equal(computeMultiplier(createPlayer()), 1);
  assert.equal(computeMultiplier({ ...createPlayer(), gear: 5 }), 2);
  assert.equal(computeMultiplier({ ...createPlayer(), gear: 5, nitroT: 1 }), 4);
});

test("kmh: переводит внутреннюю скорость в км/ч", () => {
  assert.equal(kmh(0), 0);
  assert.equal(kmh(10), 60);
});

// ---------- updatePlayer ----------

test("updatePlayer: разгоняется, но не выше отсечки текущей передачи", () => {
  let player = createPlayer();
  for (let i = 0; i < 600; i++) {
    player = updatePlayer(player, 1 / 60);
  }
  assert.equal(player.speed, GEARS[0].max);
  assert.ok(player.z > 0);
});

test("updatePlayer: не мутирует исходное состояние", () => {
  const player = createPlayer();
  updatePlayer(player, 0.1);
  assert.deepEqual(player, createPlayer());
});

test("updatePlayer: тормоз снижает скорость, но не ниже нуля", () => {
  const player = updatePlayer({ ...createPlayer(), speed: 1 }, 1, { brake: true });
  assert.equal(player.speed, 0);
  assert.equal(player.braking, true);
});

test("updatePlayer: после понижения передачи двигатель тормозит до новой отсечки", () => {
  const start = { ...createPlayer(), gear: 1, speed: 20 };
  const next = updatePlayer(start, 0.1);
  assert.ok(next.speed < 20);
  assert.ok(next.speed >= GEARS[0].max);
});

test("updatePlayer: x плавно догоняет целевую полосу", () => {
  const start = { ...createPlayer(), lane: 2, x: 1 };
  const mid = updatePlayer(start, 0.02);
  assert.ok(mid.x > 1 && mid.x < 2);
  const done = updatePlayer(start, 1);
  assert.equal(done.x, 2);
});

test("updatePlayer: прыжок длится JUMP_DURATION и заканчивается на земле", () => {
  let player = { ...createPlayer(), jumping: true, jumpT: 0 };
  player = updatePlayer(player, JUMP_DURATION / 2);
  assert.equal(player.jumping, true);
  assert.ok(Math.abs(jumpHeight(player) - JUMP_HEIGHT) < 1e-9, "в середине прыжка — максимальная высота");
  player = updatePlayer(player, JUMP_DURATION);
  assert.equal(player.jumping, false);
  assert.equal(jumpHeight(player), 0);
});

test("updatePlayer: таймеры нитро/магнита/кулдауна убывают и не уходят в минус", () => {
  const player = updatePlayer({ ...createPlayer(), nitroT: 0.5, magnetT: 2, shiftCooldown: 0.1 }, 1);
  assert.equal(player.nitroT, 0);
  assert.equal(player.magnetT, 1);
  assert.equal(player.shiftCooldown, 0);
});

test("updatePlayer: после краша состояние не меняется", () => {
  const player = { ...createPlayer(), crashed: true, speed: 5 };
  assert.equal(updatePlayer(player, 1), player);
});

test("laneOf: округляет фактическое положение во время перестроения", () => {
  assert.equal(laneOf({ x: 1.4 }), 1);
  assert.equal(laneOf({ x: 1.6 }), 2);
});

// ---------- applyCommand ----------

test("applyCommand: left/right меняют полосу и упираются в края", () => {
  let world = createWorld();
  world = applyCommand(world, "left");
  assert.equal(world.player.lane, 0);
  assert.deepEqual(world.events, [{ type: "lane", lane: 0 }]);
  world = applyCommand(world, "left");
  assert.equal(world.player.lane, 0);
  assert.deepEqual(world.events, [], "у края событие не генерируется");
  for (let i = 0; i < LANES + 2; i++) world = applyCommand(world, "right");
  assert.equal(world.player.lane, LANES - 1);
});

test("applyCommand: jump запускает прыжок, повторный в воздухе игнорируется", () => {
  let world = applyCommand(createWorld(), "jump");
  assert.equal(world.player.jumping, true);
  assert.equal(world.events[0].type, "jump");
  world = applyCommand(world, "jump");
  assert.deepEqual(world.events, []);
});

test("applyCommand: идеальное переключение начисляет бонус и считает статистику", () => {
  const speed = GEARS[0].max * 0.9;
  const world = applyCommand(emptyWorld({ speed }), "gearUp");
  assert.equal(world.player.gear, 2);
  assert.equal(world.score, PERFECT_SHIFT_BONUS * 2);
  assert.equal(world.perfectShifts, 1);
  assert.equal(world.events[0].quality, "perfect");
  assert.equal(world.events[0].bonus, PERFECT_SHIFT_BONUS * 2);
});

test("applyCommand: gearDown понижает передачу", () => {
  const world = applyCommand(emptyWorld({ gear: 3, speed: 13 }), "gearDown");
  assert.equal(world.player.gear, 2);
  assert.equal(world.events[0].quality, "good");
});

test("applyCommand: nitro срабатывает только с полным баллоном", () => {
  const empty = applyCommand(emptyWorld({ nitro: 0.5 }), "nitro");
  assert.equal(empty.player.nitroT, 0);
  assert.deepEqual(empty.events, []);
  const full = applyCommand(emptyWorld({ nitro: 1 }), "nitro");
  assert.equal(full.player.nitroT, NITRO_DURATION);
  assert.equal(full.player.nitro, 0);
  assert.equal(full.events[0].type, "nitro");
});

test("applyCommand: невалидная команда кидает исключение и не меняет мир", () => {
  const world = createWorld();
  const snapshot = JSON.stringify(world);
  assert.throws(() => applyCommand(world, "turbo"), RangeError);
  assert.throws(() => applyCommand(world, 42), TypeError);
  assert.equal(JSON.stringify(world), snapshot);
});

test("applyCommand: после краша команды игнорируются", () => {
  const world = emptyWorld({ crashed: true });
  const next = applyCommand(world, "left");
  assert.equal(next.player, world.player);
  assert.deepEqual(next.events, []);
});

// ---------- трасса ----------

test("spawnPattern: всегда оставляет safeLane без поездов и двигает nextSpawnZ вперёд", () => {
  const rng = createRng(7);
  let world = createWorld();
  for (let i = 0; i < 300; i++) {
    const before = world;
    world = spawnPattern(world, rng);
    assert.ok(Math.abs(world.safeLane - before.safeLane) <= 1, "safeLane смещается не больше чем на 1");
    const fresh = world.objects.slice(before.objects.length);
    assert.ok(fresh.length > 0);
    for (const obj of fresh) {
      if (obj.type === "train") assert.notEqual(obj.lane, world.safeLane);
      assert.ok(obj.lane >= 0 && obj.lane < LANES);
    }
    assert.ok(world.nextSpawnZ > before.nextSpawnZ);
  }
});

test("spawnPattern: следующий паттерн начинается после конца самого длинного поезда", () => {
  const rng = createRng(99);
  let world = createWorld();
  for (let i = 0; i < 200; i++) {
    const before = world;
    world = spawnPattern(world, rng);
    for (const obj of world.objects.slice(before.objects.length)) {
      assert.ok(obj.z + (obj.length || 0) < world.nextSpawnZ);
    }
  }
});

test("spawnPattern: одинаковый seed — одинаковая трасса", () => {
  const a = spawnAhead(createWorld(), createRng(5));
  const b = spawnAhead(createWorld(), createRng(5));
  assert.deepEqual(a.objects, b.objects);
});

test("spawnAhead: заполняет трассу на SPAWN_AHEAD вперёд", () => {
  const world = spawnAhead(createWorld(), createRng(3));
  assert.ok(world.nextSpawnZ >= world.player.z + SPAWN_AHEAD);
  assert.ok(world.objects.length > 0);
});

// ---------- столкновения и подбор ----------

test("hitsObstacle: поезд на той же полосе — столкновение", () => {
  const player = { ...createPlayer(), z: 100 };
  const train = { type: "train", lane: 1, z: 100 + CAR_HALF_LENGTH - 0.1, length: 14 };
  assert.equal(hitsObstacle(player, 99, train), true);
});

test("hitsObstacle: другая полоса или далеко — нет столкновения", () => {
  const player = { ...createPlayer(), z: 100 };
  assert.equal(hitsObstacle(player, 99, { type: "train", lane: 0, z: 100, length: 14 }), false);
  assert.equal(hitsObstacle(player, 99, { type: "train", lane: 1, z: 110, length: 14 }), false);
});

test("hitsObstacle: тонкий барьер не проскакивает между кадрами (swept)", () => {
  const player = { ...createPlayer(), z: 110 };
  const barrier = { type: "barrier", lane: 1, z: 105, length: 0.6 };
  assert.equal(hitsObstacle(player, 100, barrier), true);
});

test("hitsObstacle: барьер перепрыгивается в верхней части прыжка", () => {
  const player = { ...createPlayer(), z: 100, jumping: true, jumpT: JUMP_DURATION / 2 };
  const barrier = { type: "barrier", lane: 1, z: 100, length: 0.6 };
  assert.equal(hitsObstacle(player, 99.5, barrier), false);
  const low = { ...player, jumpT: 0.01 };
  assert.equal(hitsObstacle(low, 99.5, barrier), true);
});

test("hitsObstacle: поезд нельзя перепрыгнуть", () => {
  const player = { ...createPlayer(), z: 100, jumping: true, jumpT: JUMP_DURATION / 2 };
  assert.equal(hitsObstacle(player, 99.5, { type: "train", lane: 1, z: 100, length: 14 }), true);
});

test("collects: наземная монета собирается на земле, воздушная — только в прыжке", () => {
  const ground = { ...createPlayer(), z: 50 };
  const air = { ...ground, jumping: true, jumpT: JUMP_DURATION / 2 };
  assert.equal(collects(ground, 49, { type: "coin", lane: 1, z: 50, h: 0 }), true);
  assert.equal(collects(ground, 49, { type: "coin", lane: 1, z: 50, h: 2 }), false);
  assert.equal(collects(air, 49, { type: "coin", lane: 1, z: 50, h: 2 }), true);
  assert.equal(collects(ground, 49, { type: "coin", lane: 0, z: 50, h: 0 }), false);
});

test("collects: магнит собирает монеты впереди с любой полосы", () => {
  const player = { ...createPlayer(), z: 50, magnetT: 3 };
  assert.equal(collects(player, 49, { type: "coin", lane: 0, z: 55, h: 2 }), true);
  assert.equal(collects(player, 49, { type: "coin", lane: 0, z: 80, h: 0 }), false);
});

// ---------- step ----------

test("step: игрок едет вперёд и получает очки за дистанцию", () => {
  let world = emptyWorld({ speed: 5 });
  world = step(world, 1, {}, constRng(0.5));
  assert.ok(world.player.z > 5);
  assert.ok(world.score > 0);
  assert.ok(world.time === 1);
  assert.ok(world.maxSpeed > 5);
});

test("step: не мутирует исходный мир", () => {
  const world = spawnAhead(createWorld(), createRng(1));
  const snapshot = JSON.stringify(world);
  step(world, 0.1, {}, createRng(2));
  assert.equal(JSON.stringify(world), snapshot);
});

test("step: монета подбирается, даёт очки, нитро и событие", () => {
  const world = { ...emptyWorld({ z: 10, speed: 0 }), objects: [{ id: 1, type: "coin", lane: 1, z: 10.5, h: 0 }] };
  const next = step(world, 0.016, {}, constRng(0.5));
  assert.equal(next.coins, 1);
  assert.equal(next.objects.length, 0);
  assert.ok(next.score >= COIN_SCORE);
  assert.equal(next.player.nitro, NITRO_PER_COIN);
  assert.equal(next.events[0].type, "coin");
});

test("step: подбор магнита включает его на MAGNET_DURATION", () => {
  const world = { ...emptyWorld({ z: 10 }), objects: [{ id: 1, type: "magnet", lane: 1, z: 10 }] };
  const next = step(world, 0.016, {}, constRng(0.5));
  assert.equal(next.player.magnetT, MAGNET_DURATION);
  assert.equal(next.events[0].type, "magnet");
});

test("step: врезался в поезд — краш, скорость 0, событие crash", () => {
  const world = {
    ...emptyWorld({ z: 10, speed: 10 }),
    objects: [{ id: 1, type: "train", lane: 1, z: 12, length: 14 }],
  };
  const next = step(world, 0.05, {}, constRng(0.5));
  assert.equal(next.player.crashed, true);
  assert.equal(next.player.speed, 0);
  assert.equal(next.events[0].type, "crash");
});

test("step: после краша мир замирает", () => {
  const world = emptyWorld({ crashed: true, z: 30 });
  const next = step(world, 1, {}, constRng(0.5));
  assert.equal(next.player, world.player);
  assert.equal(next.time, world.time);
});

test("step: объекты далеко позади удаляются", () => {
  const world = {
    ...emptyWorld({ z: 200 }),
    objects: [{ id: 1, type: "barrier", lane: 0, z: 200 - DESPAWN_BEHIND - 5, length: 0.6 }],
  };
  const next = step(world, 0.016, {}, constRng(0.5));
  assert.equal(next.objects.length, 0);
});

test("step: кидает на невалидный dt", () => {
  assert.throws(() => step(createWorld(), -1), RangeError);
  assert.throws(() => step(createWorld(), NaN), RangeError);
});

test("step: бот, всегда едущий по safeLane и прыгающий через барьеры, проезжает 3 км", () => {
  // Интеграционная проверка проходимости генератора трассы.
  const rng = createRng(2024);
  let world = createWorld();
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 600 && world.player.z < 3000; i++) {
    const p = world.player;
    // ищем ближайший барьер на своей полосе и прыгаем заранее
    const barrierAhead = world.objects.find(
      (o) => o.type === "barrier" && o.lane === p.lane && o.z - p.z > 0 && o.z - p.z < p.speed * 0.3 + 2
    );
    if (barrierAhead) world = applyCommand(world, "jump");
    // ищем ближайший поезд на своей полосе — уходим на свободную
    const trainAhead = world.objects.find(
      (o) => o.type === "train" && o.lane === p.lane && o.z - p.z > 0 && o.z - p.z < 30
    );
    if (trainAhead) {
      const blocked = new Set(
        world.objects.filter((o) => o.type === "train" && Math.abs(o.z - trainAhead.z) < 1).map((o) => o.lane)
      );
      const target = [0, 1, 2].filter((l) => !blocked.has(l)).sort((a, b) => Math.abs(a - p.lane) - Math.abs(b - p.lane))[0];
      if (target < p.lane) world = applyCommand(world, "left");
      if (target > p.lane) world = applyCommand(world, "right");
    }
    if (rpm(p.speed, p.gear) > 0.9 && p.gear < 3) world = applyCommand(world, "gearUp");
    world = step(world, dt, {}, rng);
    assert.equal(world.player.crashed, false, `краш на z=${world.player.z.toFixed(1)}`);
  }
  assert.ok(world.player.z >= 3000);
});

// ================= Гараж: каталог, кошелёк, покупка (garage-upgrades) =================

const garageApi = require("./game.js");

test("гараж: каталог — три улучшения, уровни 0..3, цены 50/120/250", () => {
  assert.deepEqual(garageApi.UPGRADE_IDS, ["engine", "nitro", "jump"]);
  assert.equal(garageApi.MAX_UPGRADE_LEVEL, 3);
  assert.deepEqual(garageApi.UPGRADE_PRICES, [50, 120, 250]);
});

test("гараж: createGarage — пустой кошелёк и все уровни 0", () => {
  assert.deepEqual(garageApi.createGarage(), { coins: 0, levels: { engine: 0, nitro: 0, jump: 0 } });
});

test("гараж: nextPrice — цена следующего уровня и null на максимальном", () => {
  const g = garageApi.createGarage();
  assert.equal(garageApi.nextPrice(g, "engine"), 50);
  assert.equal(garageApi.nextPrice({ ...g, levels: { ...g.levels, engine: 1 } }, "engine"), 120);
  assert.equal(garageApi.nextPrice({ ...g, levels: { ...g.levels, nitro: 2 } }, "nitro"), 250);
  assert.equal(garageApi.nextPrice({ ...g, levels: { ...g.levels, jump: 3 } }, "jump"), null);
});

test("гараж: nextPrice — неизвестное улучшение кидает RangeError", () => {
  assert.throws(() => garageApi.nextPrice(garageApi.createGarage(), "turbo"), RangeError);
});

test("гараж: creditCoins — добавляет монеты и не мутирует исходный гараж", () => {
  const g = { ...garageApi.createGarage(), coins: 100 };
  const next = garageApi.creditCoins(g, 37);
  assert.equal(next.coins, 137);
  assert.equal(g.coins, 100);
  assert.deepEqual(garageApi.creditCoins(g, 0), g);
});

test("гараж: creditCoins — отрицательное или нецелое количество кидает ошибку", () => {
  const g = garageApi.createGarage();
  assert.throws(() => garageApi.creditCoins(g, -1), RangeError);
  assert.throws(() => garageApi.creditCoins(g, 1.5), TypeError);
  assert.throws(() => garageApi.creditCoins(g, "5"), TypeError);
});

test("гараж: buyUpgrade — успешная покупка списывает цену и повышает уровень", () => {
  const g = { coins: 60, levels: { engine: 0, nitro: 0, jump: 0 } };
  const next = garageApi.buyUpgrade(g, "nitro");
  assert.deepEqual(next, { coins: 10, levels: { engine: 0, nitro: 1, jump: 0 } });
  assert.deepEqual(g, { coins: 60, levels: { engine: 0, nitro: 0, jump: 0 } }, "исходный гараж не мутирует");
});

test("гараж: buyUpgrade — не хватает монет: понятная ошибка, гараж не меняется", () => {
  const g = { coins: 40, levels: { engine: 0, nitro: 0, jump: 0 } };
  assert.throws(() => garageApi.buyUpgrade(g, "jump"), {
    name: "RangeError",
    message: "Не хватает монет: нужно 50, есть 40",
  });
  assert.deepEqual(g, { coins: 40, levels: { engine: 0, nitro: 0, jump: 0 } });
});

test("гараж: buyUpgrade — на максимальном уровне покупка отклоняется", () => {
  const g = { coins: 1000, levels: { engine: 3, nitro: 0, jump: 0 } };
  assert.throws(() => garageApi.buyUpgrade(g, "engine"), /максимальн/);
  assert.equal(g.coins, 1000);
  assert.equal(g.levels.engine, 3);
});

test("гараж: buyUpgrade — неизвестное улучшение RangeError, не строка TypeError", () => {
  const g = { coins: 1000, levels: { engine: 0, nitro: 0, jump: 0 } };
  assert.throws(() => garageApi.buyUpgrade(g, "turbo"), { name: "RangeError", message: /неизвестное улучшение/ });
  assert.throws(() => garageApi.buyUpgrade(g, 1), TypeError);
});

test("гараж: parseGarage — корректное сохранение читается как есть", () => {
  const raw = JSON.stringify({ coins: 137, levels: { engine: 2, nitro: 0, jump: 1 } });
  assert.deepEqual(garageApi.parseGarage(raw), { coins: 137, levels: { engine: 2, nitro: 0, jump: 1 } });
});

test("гараж: parseGarage — отсутствие и мусор дают пустой гараж", () => {
  const empty = garageApi.createGarage();
  assert.deepEqual(garageApi.parseGarage(null), empty);
  assert.deepEqual(garageApi.parseGarage(""), empty);
  assert.deepEqual(garageApi.parseGarage("{не json"), empty);
  assert.deepEqual(garageApi.parseGarage("42"), empty);
  assert.deepEqual(garageApi.parseGarage("null"), empty);
});

test("гараж: parseGarage — неверные значения полей дают пустой гараж", () => {
  const empty = garageApi.createGarage();
  const bad = [
    { coins: -5, levels: { engine: 0, nitro: 0, jump: 0 } },
    { coins: 1.5, levels: { engine: 0, nitro: 0, jump: 0 } },
    { coins: 10, levels: { engine: 4, nitro: 0, jump: 0 } },
    { coins: 10, levels: { engine: 0.5, nitro: 0, jump: 0 } },
    { coins: 10, levels: { engine: 0, nitro: 0 } },
    { coins: 10, levels: { engine: 0, nitro: 0, jump: 0, turbo: 1 } },
    { coins: 10 },
  ];
  for (const g of bad) assert.deepEqual(garageApi.parseGarage(JSON.stringify(g)), empty, JSON.stringify(g));
});

// ================= Улучшения в заезде (garage-upgrades) =================

// Эталон снят на game.js ДО изменений garage-upgrades: те же seed и команды
// должны давать те же результаты, пока заезд создаётся без уровней.
const COMPAT_ACTIONS = [[1.1, "gearUp"], [2.6, "gearUp"], [3.0, "left"], [4.2, "gearUp"], [5.0, "jump"], [6.5, "nitro"], [8.0, "right"]];
const COMPAT_BASELINE = {
  1: { distance: 107.22, score: 463, coins: 0, perfect: 1, gear: 4, crashed: true, time: 6.02 },
  7: { distance: 164.62, score: 739, coins: 10, perfect: 1, gear: 4, crashed: true, time: 8.07 },
  42: { distance: 120.76, score: 487, coins: 0, perfect: 1, gear: 4, crashed: true, time: 6.5 },
};

function scriptedRun(seed, makeWorld) {
  const rng = garageApi.createRng(seed);
  let w = makeWorld();
  let t = 0;
  let i = 0;
  const dt = 1 / 60;
  while (t < 20 && !w.player.crashed) {
    while (i < COMPAT_ACTIONS.length && COMPAT_ACTIONS[i][0] <= t) {
      w = garageApi.applyCommand(w, COMPAT_ACTIONS[i][1]);
      i++;
    }
    w = garageApi.step(w, dt, {}, rng);
    t += dt;
  }
  return {
    distance: Math.round(w.player.z * 100) / 100,
    score: Math.floor(w.score),
    coins: w.coins,
    perfect: w.perfectShifts,
    gear: w.player.gear,
    crashed: w.player.crashed,
    time: Math.round(t * 100) / 100,
  };
}

test("улучшения: заезд без уровней совпадает с эталоном до изменения (seed 1, 7, 42)", () => {
  for (const seed of [1, 7, 42]) {
    assert.deepEqual(scriptedRun(seed, () => garageApi.createWorld()), COMPAT_BASELINE[seed], `seed ${seed}`);
  }
});

const COMPAT_AUTOPILOT = {
  1: { finished: "time", distance: 949.92, score: 3896, coins: 56, perfect_shifts: 2, shifts: 4, max_kmh: 204 },
  7: { finished: "time", distance: 949.92, score: 3916, coins: 57, perfect_shifts: 2, shifts: 4, max_kmh: 204 },
  42: { finished: "time", distance: 949.92, score: 3936, coins: 58, perfect_shifts: 2, shifts: 4, max_kmh: 204 },
};

test("улучшения: автопилот MCP без уровней совпадает с эталоном до изменения", () => {
  const { simulateRun } = require("./mcp/simulate.js");
  for (const seed of [1, 7, 42]) {
    const r = simulateRun({ seed, seconds: 30, autopilot: true });
    const got = {
      finished: r.finished, distance: r.distance, score: r.score, coins: r.coins,
      perfect_shifts: r.perfect_shifts, shifts: r.shifts.length, max_kmh: r.max_kmh,
    };
    assert.deepEqual(got, COMPAT_AUTOPILOT[seed], `seed ${seed}`);
  }
});

test("validateUpgradeLevels: допустимые уровни проходят, пропущенные считаются нулём", () => {
  assert.equal(garageApi.validateUpgradeLevels({ engine: 3, nitro: 0, jump: 1 }), true);
  assert.equal(garageApi.validateUpgradeLevels({ engine: 2 }), true);
});

test("validateUpgradeLevels: уровень вне 0–3, нецелый, неизвестный id — понятная ошибка", () => {
  assert.throws(() => garageApi.validateUpgradeLevels({ engine: 5 }), { name: "RangeError", message: /уровень должен быть от 0 до 3/ });
  assert.throws(() => garageApi.validateUpgradeLevels({ engine: -1 }), { name: "RangeError", message: /уровень должен быть от 0 до 3/ });
  assert.throws(() => garageApi.validateUpgradeLevels({ nitro: 1.5 }), { name: "RangeError", message: /уровень должен быть от 0 до 3/ });
  assert.throws(() => garageApi.validateUpgradeLevels({ turbo: 1 }), { name: "RangeError", message: /неизвестное улучшение: "turbo"/ });
  assert.throws(() => garageApi.validateUpgradeLevels(null), TypeError);
  assert.throws(() => garageApi.validateUpgradeLevels("engine"), TypeError);
});

test("statsForLevels: мотор, нитро и прыжок по уровням", () => {
  const gear = [1.0, 1.03, 1.06, 1.1];
  const nitro = [3, 4, 5, 6];
  const jump = [1.0, 1.1, 1.2, 1.3];
  for (let lvl = 0; lvl <= 3; lvl++) {
    const s = garageApi.statsForLevels({ engine: lvl, nitro: lvl, jump: lvl });
    assert.equal(s.gearScale, gear[lvl]);
    assert.equal(s.nitroDuration, nitro[lvl]);
    assert.ok(Math.abs(s.jumpHeight - garageApi.JUMP_HEIGHT * jump[lvl]) < 1e-9);
  }
});

test("statsForLevels: без уровней — прежние константы", () => {
  const s = garageApi.statsForLevels();
  assert.deepEqual(s, { gearScale: 1, nitroDuration: garageApi.NITRO_DURATION, jumpHeight: garageApi.JUMP_HEIGHT });
});

test("createWorld() без уровней: прежний игрок с базовыми статами", () => {
  const { stats, ...rest } = garageApi.createWorld().player;
  assert.deepEqual(stats, { gearScale: 1, nitroDuration: garageApi.NITRO_DURATION, jumpHeight: garageApi.JUMP_HEIGHT });
  assert.deepEqual(rest, {
    lane: 1, x: 1, z: 0, speed: 0, gear: 1, jumping: false, jumpT: 0, nitro: 0, nitroT: 0,
    magnetT: 0, shiftCooldown: 0, braking: false, crashed: false,
  });
});

test("createWorld({ engine: 2 }) кладёт статы уровней в игрока", () => {
  const w = garageApi.createWorld({ engine: 2, jump: 1 });
  assert.deepEqual(w.player.stats, garageApi.statsForLevels({ engine: 2, jump: 1 }));
  assert.equal(w.player.stats.gearScale, 1.06);
});

test("createWorld с недопустимым уровнем не создаёт заезд", () => {
  assert.throws(() => garageApi.createWorld({ engine: 5 }), { name: "RangeError", message: /уровень должен быть от 0 до 3/ });
});

test("мотор: отсечка 5-й передачи 204 → 210 (мотор 1) → 224 км/ч (мотор 3)", () => {
  const { topSpeed, kmh, ENGINE_GEAR_SCALE } = garageApi;
  assert.equal(kmh(topSpeed(5)), 204);
  assert.equal(kmh(topSpeed(5, false, ENGINE_GEAR_SCALE[1])), 210);
  assert.equal(kmh(topSpeed(5, false, ENGINE_GEAR_SCALE[3])), 224);
});

test("мотор 3: машина разгоняется на 5-й передаче до 224 км/ч", () => {
  let p = { ...garageApi.createWorld({ engine: 3 }).player, gear: 5, speed: 30 };
  for (let i = 0; i < 60 * 30; i++) p = garageApi.updatePlayer(p, 1 / 60, {});
  assert.equal(garageApi.kmh(p.speed), 224);
});

test("мотор: обороты и ускорение считаются от растянутого диапазона", () => {
  const { rpm, engineAccel, GEARS } = garageApi;
  const g = GEARS[4];
  assert.equal(rpm(g.max * 1.1, 5, 1.1), 1);
  assert.ok(rpm(g.max, 5, 1.1) < 1);
  assert.equal(engineAccel(g.max * 1.1, 5, false, 1.1), 0);
  assert.ok(engineAccel(g.max, 5, false, 1.1) > 0);
});

test("мотор 3: переключение на 82–99% растянутого диапазона — по-прежнему «идеальное»", () => {
  const { GEARS, PERFECT_SHIFT_MIN, createWorld, applyCommand } = garageApi;
  const s = 1.1;
  const g = GEARS[1];
  for (const r of [PERFECT_SHIFT_MIN, 0.9, 0.99]) {
    const w = createWorld({ engine: 3 });
    const speed = g.min * s + r * (g.max - g.min) * s;
    const next = applyCommand({ ...w, player: { ...w.player, gear: 2, speed } }, "gearUp");
    assert.equal(next.events[0].quality, "perfect", `rpm ${r}`);
  }
  // На базовой отсечке 2-й передачи с мотором 3 — ещё не «поздно», а в окне идеального
  const w = createWorld({ engine: 3 });
  const atBaseMax = applyCommand({ ...w, player: { ...w.player, gear: 2, speed: g.max } }, "gearUp");
  assert.notEqual(atBaseMax.events[0].quality, "late");
});

test("мотор: «перекрут» при понижении считается по растянутой верхней границе", () => {
  const { GEARS, shiftGear, createPlayer } = garageApi;
  const speed = GEARS[1].max + 1; // выше базовой отсечки 2-й, но ниже растянутой (16 × 1.1 = 17.6)
  assert.equal(shiftGear({ ...createPlayer(), gear: 3, speed }, -1).event.quality, "overrev");
  assert.notEqual(shiftGear({ ...createPlayer(), gear: 3, speed }, -1, 1.1).event.quality, "overrev");
});

test("нитро 2: при включении действует 5 секунд", () => {
  const { createWorld, applyCommand, updatePlayer } = garageApi;
  const w = createWorld({ nitro: 2 });
  let p = applyCommand({ ...w, player: { ...w.player, nitro: 1 } }, "nitro").player;
  assert.equal(p.nitroT, 5);
  for (let i = 0; i < 60 * 4.9; i++) p = updatePlayer(p, 1 / 60, {});
  assert.ok(p.nitroT > 0, "через 4.9 с нитро ещё действует");
  for (let i = 0; i < 60 * 0.2; i++) p = updatePlayer(p, 1 / 60, {});
  assert.ok(p.nitroT <= 0, "через 5.1 с нитро закончилось");
});

test("прыжок 3: в верхней точке в 1.3 раза выше, длительность та же", () => {
  const { createWorld, jumpHeight, JUMP_DURATION, updatePlayer } = garageApi;
  const mid = { jumping: true, jumpT: JUMP_DURATION / 2 };
  const base = jumpHeight({ ...createWorld().player, ...mid });
  const high = jumpHeight({ ...createWorld({ jump: 3 }).player, ...mid });
  assert.ok(Math.abs(high / base - 1.3) < 1e-9);

  let p = { ...createWorld({ jump: 3 }).player, ...mid, jumpT: 0 };
  for (let i = 0; i < Math.ceil(JUMP_DURATION * 60) + 1; i++) p = updatePlayer(p, 1 / 60, {});
  assert.equal(p.jumping, false, "прыжок 3 закончился за то же время");
});
