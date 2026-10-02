// Metro Rush — связка: ввод с клавиатуры/тача, игровой цикл, HUD и экраны.
// Правила игры — только в game.js; здесь мы лишь вызываем applyCommand/step
// и показываем результат (render.js — картинка, audio.js — звук).

(function () {
  const BEST_KEY = "metro-rush-best";
  const MAX_DT = 0.05; // защита от скачков dt после сворачивания вкладки
  const DISPLAY_RPM_MAX = 1.1;

  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const renderer = createRenderer(canvas);
  const sound = createSound();

  const ui = {
    hud: $("hud"),
    score: $("hud-score"),
    mult: $("hud-mult"),
    coins: $("hud-coins"),
    best: $("hud-best"),
    magnet: $("hud-magnet"),
    magnetTime: $("hud-magnet-time"),
    gear: $("hud-gear"),
    speed: $("hud-speed"),
    nitro: $("hud-nitro"),
    nitroBox: document.querySelector(".nitro"),
    lights: $("shift-lights"),
    needle: $("tacho-needle"),
    tachoFill: $("tacho-fill"),
    toast: $("toast"),
    menu: $("menu"),
    menuBest: $("menu-best"),
    pause: $("pause"),
    over: $("over"),
    newRecord: $("new-record"),
    overScore: $("over-score"),
    overDistance: $("over-distance"),
    overCoins: $("over-coins"),
    overPerfect: $("over-perfect"),
    overSpeed: $("over-speed"),
    touch: $("touch"),
  };

  // mode: menu | playing | paused | crashing | over
  let mode = "menu";
  let world = createWorld();
  let rng = createRng(Date.now() & 0x7fffffff);
  let best = loadBest();
  let lastTimestamp = null;
  let clock = 0;
  let crashTimer = 0;
  let needleRpm = 0;
  const held = { brake: false };
  const lastHud = {};

  // ---------- рекорд ----------

  function loadBest() {
    try {
      return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  function saveBest(value) {
    try {
      localStorage.setItem(BEST_KEY, String(value));
    } catch {
      // приватный режим / запрещённое хранилище — рекорд живёт до перезагрузки
    }
  }

  // ---------- тахометр ----------

  const TACHO = { cx: 100, cy: 100, r: 78, start: 135, sweep: 270 };

  function tachoAngle(value) {
    return TACHO.start + (Math.min(DISPLAY_RPM_MAX, Math.max(0, value)) / DISPLAY_RPM_MAX) * TACHO.sweep;
  }

  function polar(angleDeg, r = TACHO.r) {
    const a = (angleDeg * Math.PI) / 180;
    return [TACHO.cx + r * Math.cos(a), TACHO.cy + r * Math.sin(a)];
  }

  function arcPath(from, to, r = TACHO.r) {
    const a0 = tachoAngle(from);
    const a1 = tachoAngle(to);
    const [x0, y0] = polar(a0, r);
    const [x1, y1] = polar(a1, r);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }

  function buildTacho() {
    $("tacho-track").setAttribute("d", arcPath(0, DISPLAY_RPM_MAX));
    $("tacho-perfect").setAttribute("d", arcPath(PERFECT_SHIFT_MIN, 1));
    $("tacho-red").setAttribute("d", arcPath(1, DISPLAY_RPM_MAX));
    const ticks = $("tacho-ticks");
    for (let i = 0; i <= 11; i++) {
      const a = tachoAngle(i / 10);
      const [x0, y0] = polar(a, TACHO.r - 14);
      const [x1, y1] = polar(a, TACHO.r - (i % 5 === 0 ? 30 : 22));
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x0);
      line.setAttribute("y1", y0);
      line.setAttribute("x2", x1);
      line.setAttribute("y2", y1);
      ticks.appendChild(line);
    }
    ticks.classList.add("tacho-ticks");
  }

  // Обороты для стрелки: ниже диапазона передачи показываем "холостые".
  function displayRpm(player) {
    const g = GEARS[player.gear - 1];
    if (player.speed < g.min) return 0.08;
    return rpm(player.speed, player.gear);
  }

  // ---------- HUD ----------

  function setText(el, key, value) {
    if (lastHud[key] === value) return;
    lastHud[key] = value;
    el.textContent = value;
    if (el.dataset.text !== undefined) el.dataset.text = value;
  }

  function showToast(text, tone) {
    ui.toast.textContent = text;
    ui.toast.className = `toast ${tone || ""}`;
    void ui.toast.offsetWidth; // перезапуск CSS-анимации
    ui.toast.classList.add("show");
  }

  function updateHud(dt) {
    const p = world.player;
    setText(ui.score, "score", String(Math.floor(world.score)));
    const mult = computeMultiplier(p);
    setText(ui.mult, "mult", `×${mult % 1 === 0 ? mult : mult.toFixed(2)}`);
    ui.mult.classList.toggle("boost", p.nitroT > 0);
    setText(ui.coins, "coins", String(world.coins));
    setText(ui.best, "best", String(Math.max(best, Math.floor(world.score))));
    setText(ui.gear, "gear", String(p.gear));
    setText(ui.speed, "speed", String(kmh(p.speed)));

    ui.magnet.hidden = !(p.magnetT > 0);
    if (p.magnetT > 0) setText(ui.magnetTime, "magnet", `${Math.ceil(p.magnetT)} с`);

    ui.nitro.style.width = `${Math.round((p.nitroT > 0 ? p.nitroT / NITRO_DURATION : p.nitro) * 100)}%`;
    ui.nitroBox.classList.toggle("ready", p.nitro >= 1 && p.nitroT <= 0);

    const target = displayRpm(p);
    needleRpm += (target - needleRpm) * Math.min(1, dt * 18);
    ui.needle.setAttribute("transform", `rotate(${tachoAngle(needleRpm) + 90} 100 100)`);
    ui.tachoFill.setAttribute("d", arcPath(0, Math.max(0.001, needleRpm), TACHO.r - 9));

    const r = rpm(p.speed, p.gear);
    const lit = Math.min(5, Math.floor((r / PERFECT_SHIFT_MIN) * 4 + 0.001));
    const lights = ui.lights.children;
    for (let i = 0; i < lights.length; i++) lights[i].classList.toggle("on", i < lit);
    const canShiftUp = p.gear < MAX_GEAR;
    ui.lights.classList.toggle("perfect", canShiftUp && r >= PERFECT_SHIFT_MIN && r < 1 && p.shiftCooldown <= 0);
    ui.lights.classList.toggle("limiter", canShiftUp && r >= 1 && p.nitroT <= 0);
  }

  // ---------- события мира → звук, эффекты, надписи ----------

  function handleEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case "coin":
          sound.coin();
          renderer.burst("coin", e);
          break;
        case "magnet":
          sound.magnet();
          showToast("Магнит!", "info");
          break;
        case "jump":
          sound.jump();
          break;
        case "lane":
          sound.lane();
          break;
        case "nitro":
          sound.nitro();
          renderer.addShake(6);
          showToast("Нитро!", "info");
          break;
        case "shift":
          sound.shift(e.quality);
          ui.gear.classList.remove("pop");
          void ui.gear.offsetWidth;
          ui.gear.classList.add("pop");
          if (e.quality === "perfect") showToast(`Идеально! +${e.bonus}`, "good");
          else if (e.quality === "early") showToast("Рано", "bad");
          else if (e.quality === "late") showToast("Поздно — отсечка", "bad");
          else if (e.quality === "overrev") showToast("Перекрут!", "bad");
          break;
        case "crash":
          sound.crash();
          renderer.addShake(22);
          renderer.burst("crash", { lane: world.player.lane, z: world.player.z + 2, h: 0 });
          mode = "crashing";
          crashTimer = 0.9;
          break;
      }
    }
  }

  // Безопасная точка входа для любой команды: невалидные команды отклоняются,
  // состояние остаётся прежним. Возвращает true, если команда принята.
  function command(cmd) {
    if (mode !== "playing") return false;
    try {
      world = applyCommand(world, cmd);
    } catch (err) {
      console.warn("Команда отклонена:", err.message);
      return false;
    }
    handleEvents(world.events);
    return true;
  }

  // ---------- экраны ----------

  function show(screen) {
    ui.menu.hidden = screen !== "menu";
    ui.pause.hidden = screen !== "pause";
    ui.over.hidden = screen !== "over";
    ui.hud.hidden = screen === "menu";
  }

  function start() {
    sound.init();
    world = createWorld();
    rng = createRng(Date.now() & 0x7fffffff);
    needleRpm = 0;
    held.brake = false;
    mode = "playing";
    show("hud");
    for (const key of Object.keys(lastHud)) delete lastHud[key];
  }

  function pauseToggle() {
    if (mode === "playing") {
      mode = "paused";
      show("pause");
      sound.setEngine(0, 1, false);
    } else if (mode === "paused") {
      mode = "playing";
      show("hud");
    }
  }

  function toMenu() {
    mode = "menu";
    world = createWorld();
    ui.menuBest.textContent = String(best);
    show("menu");
    sound.setEngine(0, 1, false);
  }

  function gameOver() {
    mode = "over";
    const score = Math.floor(world.score);
    const isRecord = score > best;
    if (isRecord) {
      best = score;
      saveBest(best);
    }
    ui.newRecord.hidden = !isRecord;
    ui.overScore.textContent = String(score);
    ui.overScore.dataset.text = String(score);
    ui.overDistance.textContent = `${Math.round(world.player.z)} м`;
    ui.overCoins.textContent = String(world.coins);
    ui.overPerfect.textContent = String(world.perfectShifts);
    ui.overSpeed.textContent = `${kmh(world.maxSpeed)} км/ч`;
    show("over");
    $("restart").focus({ preventScroll: true });
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  }

  // ---------- ввод ----------

  // e.code не зависит от раскладки: Q/E/N работают и при русской раскладке.
  const KEYMAP = {
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
    ArrowUp: "jump",
    KeyW: "jump",
    Space: "jump",
    KeyE: "gearUp",
    ShiftLeft: "gearUp",
    ShiftRight: "gearUp",
    KeyQ: "gearDown",
    ControlLeft: "gearDown",
    ControlRight: "gearDown",
    KeyN: "nitro",
  };
  const BRAKE_KEYS = new Set(["ArrowDown", "KeyS"]);

  window.addEventListener("keydown", (e) => {
    if (e.code === "Enter" || e.code === "NumpadEnter") {
      if (mode === "menu" || mode === "over") {
        e.preventDefault();
        start();
      }
      return;
    }
    if (e.code === "Escape" || e.code === "KeyP") {
      pauseToggle();
      return;
    }
    if (e.code === "KeyM") {
      sound.setMuted(!sound.isMuted());
      return;
    }
    if (e.code === "KeyF") {
      toggleFullscreen();
      return;
    }
    if (BRAKE_KEYS.has(e.code)) {
      e.preventDefault();
      held.brake = true;
      return;
    }
    const cmd = KEYMAP[e.code];
    if (cmd) {
      e.preventDefault();
      if (!e.repeat) command(cmd);
    }
  });

  window.addEventListener("keyup", (e) => {
    if (BRAKE_KEYS.has(e.code)) held.brake = false;
  });

  window.addEventListener("blur", () => {
    held.brake = false;
    if (mode === "playing") pauseToggle();
  });

  // свайпы: влево/вправо — полоса, вверх — прыжок, вниз — тормоз на полсекунды
  let touchStart = null;
  window.addEventListener(
    "touchstart",
    (e) => {
      ui.touch.hidden = false;
      const t = e.changedTouches[0];
      touchStart = { x: t.clientX, y: t.clientY };
    },
    { passive: true }
  );
  window.addEventListener(
    "touchend",
    (e) => {
      if (!touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      touchStart = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
      if (Math.abs(dx) > Math.abs(dy)) command(dx < 0 ? "left" : "right");
      else if (dy < 0) command("jump");
      else {
        held.brake = true;
        setTimeout(() => (held.brake = false), 500);
      }
    },
    { passive: true }
  );
  ui.touch.addEventListener("click", (e) => {
    const cmd = e.target.closest("button")?.dataset.cmd;
    if (cmd) command(cmd);
  });

  $("start").addEventListener("click", start);
  $("restart").addEventListener("click", start);
  $("resume").addEventListener("click", pauseToggle);
  $("to-menu").addEventListener("click", toMenu);
  window.addEventListener("resize", () => renderer.resize());

  // ---------- игровой цикл ----------

  function loop(timestamp) {
    if (lastTimestamp === null) lastTimestamp = timestamp;
    const dt = Math.min((timestamp - lastTimestamp) / 1000, MAX_DT);
    lastTimestamp = timestamp;
    clock += dt;

    if (mode === "playing") {
      world = step(world, dt, { brake: held.brake }, rng);
      handleEvents(world.events);
      const p = world.player;
      sound.setEngine(displayRpm(p), p.gear, true);
    } else if (mode === "crashing") {
      sound.setEngine(0, 1, false);
      crashTimer -= dt;
      if (crashTimer <= 0) gameOver();
    }

    renderer.draw(world, clock, mode === "paused" ? 0 : dt);
    if (mode !== "menu") updateHud(dt);
    requestAnimationFrame(loop);
  }

  buildTacho();
  ui.menuBest.textContent = String(best);
  show("menu");
  requestAnimationFrame(loop);

  // Хук для браузерных тестов (test_browser.py) и отладки из консоли.
  window.__metro = {
    get world() {
      return world;
    },
    get mode() {
      return mode;
    },
    start,
    command,
    pause: pauseToggle,
  };
})();
