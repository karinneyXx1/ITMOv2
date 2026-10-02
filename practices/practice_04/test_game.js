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
