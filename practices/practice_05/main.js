// Metro Rush — связка: ввод с клавиатуры/тача, игровой цикл, HUD и экраны.
// Правила игры — только в game.js; здесь мы лишь вызываем applyCommand/step
// и показываем результат (render.js — картинка, audio.js — звук).

(function () {
  const BEST_KEY = "metro-rush-best";
  const GARAGE_KEY = "metro-rush-garage";
  const MISSIONS_KEY = "metro-rush-missions";
  const TOAST_TIME = 0.9; // длительность всплывающей надписи (как анимация .toast.show)
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
    soundOff: $("hud-sound-off"),
    gear: $("hud-gear"),
    speed: $("hud-speed"),
    nitro: $("hud-nitro"),
    nitroBox: document.querySelector(".nitro"),
    lights: $("shift-lights"),
    needle: $("tacho-needle"),
    tachoFill: $("tacho-fill"),
    toast: $("toast"),
    soundStatus: $("sound-status"),
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
    overEarned: $("over-earned"),
    garage: $("garage"),
    garageCard: document.querySelector(".garage-card"),
    garageCoins: $("garage-coins"),
    garageList: $("garage-list"),
    garageStatus: $("garage-status"),
    hudUpgrades: $("hud-upgrades"),
    menuStatus: $("menu-status"),
    missions: $("missions"),
    missionsCard: document.querySelector(".missions-card"),
    missionsCoins: $("missions-coins"),
    missionsList: $("missions-list"),
    missionsStatus: $("missions-status"),
    missionsTimer: $("missions-timer"),
    missionsDone: $("missions-done"),
    missionsUnavailable: $("missions-unavailable"),
    overMissions: $("over-missions"),
    touch: $("touch"),
  };

  // mode: menu | playing | paused | crashing | over | garage | missions
  let mode = "menu";
  let world = createWorld();
  let rng = createRng(Date.now() & 0x7fffffff);
  let best = loadBest();
  let garage = loadGarage();
  let runCredited = true; // монеты текущего заезда уже в кошельке (до первого старта — нечего зачислять)
  let garageFrom = "menu"; // экран, на который вернёт Esc из гаража
  // Ежедневные задания (specs/003-daily-missions, контракт specs/daily-missions-contract.md)
  let nowOffset = 0; // сдвиг «сейчас» для тестов (window.__metro.setNow)
  const now = () => Date.now() + nowOffset;
  let missions = null;
  let missionsOk = true; // false — «Задания сейчас недоступны», остальная игра работает
  let missionsFrom = "menu";
  let lastRun = null; // результат applyRunToMissions последнего заезда (для экрана итогов)
  let announced = new Set(); // задания, о выполнении которых уже сказали в этом заезде
  let toastUntil = 0; // до какого момента clock показывается текущая надпись
  const toastQueue = [];
  let saveWarned = false;
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

  // ---------- гараж ----------

  function loadGarage() {
    try {
      return parseGarage(localStorage.getItem(GARAGE_KEY));
    } catch {
      return createGarage();
    }
  }

  function saveGarage(value) {
    try {
      localStorage.setItem(GARAGE_KEY, JSON.stringify(value));
    } catch {
      // хранилище недоступно — гараж живёт до перезагрузки
    }
  }

  // Зачисляет монеты заезда в кошелёк ровно один раз (и при аварии, и при выходе в меню).
  function finishRun() {
    if (runCredited) return 0;
    runCredited = true;
    const earned = world.coins;
    garage = creditCoins(garage, earned);
    saveGarage(garage);
    lastRun = null;
    if (missionsOk) {
      try {
        lastRun = applyRunToMissions(missions, garage, runResultsFromWorld(world), dayKey(now()));
        missions = lastRun.state;
        garage = lastRun.garage;
        persistMissions();
      } catch (err) {
        console.error("Задания: не удалось учесть заезд:", err);
        missionsOk = false;
      }
    }
    return earned;
  }

  // ---------- ежедневные задания: хранение ----------

  function loadMissions(day) {
    try {
      return parseMissions(localStorage.getItem(MISSIONS_KEY), day);
    } catch {
      return createDailyMissions(day); // хранилище недоступно
    }
  }

  function saveMissions(state) {
    try {
      localStorage.setItem(MISSIONS_KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  // Сохраняет кошелёк, затем задания (порядок не даёт потерять монеты).
  function persistMissions() {
    saveGarage(garage);
    if (!saveMissions(missions) && !saveWarned) {
      saveWarned = true;
      showSoundStatus("Прогресс заданий не сохранится после перезагрузки");
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
    const gearScale = player.stats.gearScale;
    if (player.speed < GEARS[player.gear - 1].min * gearScale) return 0.08;
    return rpm(player.speed, player.gear, gearScale);
  }

  // ---------- HUD ----------

  function setText(el, key, value) {
    if (lastHud[key] === value) return;
    lastHud[key] = value;
    el.textContent = value;
    if (el.dataset.text !== undefined) el.dataset.text = value;
  }

  function showToast(text, tone) {
    toastUntil = clock + TOAST_TIME;
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

    ui.nitro.style.width = `${Math.round((p.nitroT > 0 ? p.nitroT / p.stats.nitroDuration : p.nitro) * 100)}%`;
    ui.nitroBox.classList.toggle("ready", p.nitro >= 1 && p.nitroT <= 0);

    const target = displayRpm(p);
    needleRpm += (target - needleRpm) * Math.min(1, dt * 18);
    ui.needle.setAttribute("transform", `rotate(${tachoAngle(needleRpm) + 90} 100 100)`);
    ui.tachoFill.setAttribute("d", arcPath(0, Math.max(0.001, needleRpm), TACHO.r - 9));

    const r = rpm(p.speed, p.gear, p.stats.gearScale);
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

  function showSoundStatus(message) {
    if (!message) return;
    ui.soundStatus.textContent = message;
    ui.soundStatus.hidden = false;
    ui.soundStatus.classList.remove("fade-out");
    // Автоматически скрыть через 5 секунд
    setTimeout(() => {
      ui.soundStatus.classList.add("fade-out");
      setTimeout(() => {
        ui.soundStatus.hidden = true;
      }, 300);
    }, 5000);
  }

  function show(screen) {
    ui.menu.hidden = screen !== "menu";
    ui.pause.hidden = screen !== "pause";
    ui.over.hidden = screen !== "over";
    ui.garage.hidden = screen !== "garage";
    ui.missions.hidden = screen !== "missions";
    ui.hud.hidden = screen === "menu" || screen === "garage" || screen === "missions";
  }

  // ---------- ежедневные задания: экран, кнопки, итоги ----------

  const fmtNum = (n) => n.toLocaleString("ru-RU");
  const MISSION_TEXT = {
    coins: { title: (t) => `Собери ${fmtNum(t)} монет`, unit: "монет" },
    perfectShifts: { title: (t) => `Сделай ${t} идеальных переключений`, unit: "переключений" },
    distance: { title: (t) => `Проедь ${fmtNum(t)} м`, unit: "м" },
  };
  const GENERIC_CLAIM_ERROR = "Не удалось забрать награду. Попробуй ещё раз.";

  function missionStateLabel(m) {
    if (m.claimed) return "Получено";
    if (m.completed) return "Выполнено — забери награду";
    return m.progress > 0 ? "В процессе" : "Не начато";
  }

  function setMissionsStatus(text, tone) {
    ui.missionsStatus.textContent = text;
    ui.missionsStatus.className = `garage-status ${tone || ""}`;
  }

  // Кнопки «Задания» в меню и на экране итогов: «Задания N/3» + отметка.
  function renderMissionsButtons() {
    let count = "—";
    let badge = "";
    if (missionsOk) {
      const list = describeMissions(missions);
      count = `${list.filter((m) => m.completed).length}/${list.length}`;
      if (list.some((m) => m.completed && !m.claimed)) badge = "Награда!";
      else if (!missions.seen) badge = "Новые!";
    }
    for (const el of document.querySelectorAll("[data-missions-count]")) el.textContent = count;
    for (const el of document.querySelectorAll("[data-missions-badge]")) {
      el.textContent = badge;
      el.hidden = !badge;
    }
  }

  function missionsTimerText() {
    const left = nextDayStart(now()) - now();
    if (left < 60000) return "Новые задания меньше чем через минуту";
    const h = Math.floor(left / 3600000);
    const min = Math.floor((left % 3600000) / 60000);
    return h > 0 ? `Новые задания через ${h} ч ${String(min).padStart(2, "0")} мин` : `Новые задания через ${min} мин`;
  }

  function missionRow(m) {
    const text = MISSION_TEXT[m.type];
    const title = text ? text.title(m.target) : m.type;
    const progress = Math.min(Math.max(m.progress, 0), m.target);
    const row = document.createElement("li");
    row.className = "mission";
    row.dataset.id = m.id;
    row.dataset.state = m.claimed ? "claimed" : m.completed ? "ready" : progress > 0 ? "progress" : "new";

    const head = document.createElement("div");
    head.className = "mission-head";
    const name = document.createElement("b");
    name.textContent = title;
    const label = document.createElement("span");
    label.className = "mission-state";
    label.textContent = missionStateLabel(m);
    head.append(name, label);

    const bar = document.createElement("div");
    bar.className = "mission-bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(m.target));
    bar.setAttribute("aria-valuenow", String(progress));
    bar.setAttribute("aria-valuetext", `${progress} из ${m.target} ${text ? text.unit : ""}`.trim());
    const fill = document.createElement("div");
    fill.className = "mission-fill";
    fill.style.width = `${Math.round((progress / m.target) * 100)}%`;
    bar.append(fill);

    const foot = document.createElement("div");
    foot.className = "mission-foot";
    const nums = document.createElement("span");
    nums.className = "mission-nums";
    nums.textContent = `${fmtNum(progress)} / ${fmtNum(m.target)}`;
    foot.append(nums);
    if (m.completed && !m.claimed) {
      const btn = document.createElement("button");
      btn.className = "btn-buy";
      btn.dataset.claim = m.id;
      btn.innerHTML = `Забрать +${m.reward}<span class="coin-icon" aria-hidden="true"></span>`;
      btn.setAttribute("aria-label", `Забрать награду ${m.reward} монет за задание: ${title}`);
      foot.append(btn);
    } else {
      const reward = document.createElement("span");
      reward.className = "mission-reward";
      reward.innerHTML = m.claimed ? "✓ Получено" : `+${m.reward}<span class="coin-icon" aria-hidden="true"></span>`;
      foot.append(reward);
    }
    row.append(head, bar, foot);
    return row;
  }

  function renderMissions() {
    ui.missionsCoins.textContent = String(garage.coins);
    ui.missionsUnavailable.hidden = missionsOk;
    ui.missionsList.hidden = !missionsOk;
    ui.missionsTimer.hidden = !missionsOk;
    if (!missionsOk) {
      ui.missionsDone.hidden = true;
      return;
    }
    try {
      const list = describeMissions(missions);
      ui.missionsList.replaceChildren(...list.map(missionRow));
      ui.missionsDone.hidden = !list.every((m) => m.claimed);
      ui.missionsTimer.textContent = missionsTimerText();
    } catch (err) {
      console.error("Задания: не удалось показать:", err);
      missionsOk = false;
      renderMissions();
    }
  }

  // Актуализация дня (контракт, раздел 5): при загрузке, в меню, на экране «Заданий».
  function refreshMissionsDay() {
    if (!missionsOk) return null;
    let r;
    try {
      r = ensureMissionDay(missions, garage, dayKey(now()));
    } catch (err) {
      console.error("Задания: не удалось проверить день:", err);
      missionsOk = false;
      renderMissionsButtons();
      return null;
    }
    if (r.dayChanged) {
      missions = r.state;
      garage = r.garage;
      persistMissions();
      const credit = r.autoCredited > 0 ? `Вчерашние награды: +${r.autoCredited} монет в гараж` : "";
      if (mode === "missions") {
        setMissionsStatus(["Наступил новый день — задания обновлены", credit].filter(Boolean).join(". "), "good");
        renderMissions();
      } else if (mode === "menu" && credit) {
        ui.menuStatus.textContent = credit;
      }
    }
    renderMissionsButtons();
    return r;
  }

  function renderOverMissions(run) {
    ui.overMissions.hidden = !missionsOk || !run;
    if (ui.overMissions.hidden) return;
    const list = describeMissions(run.state);
    const rows = list.map((m) => {
      const li = document.createElement("li");
      const gain = run.gains[m.id] || 0;
      const text = MISSION_TEXT[m.type];
      li.innerHTML = `<span class="om-title"></span><span class="om-nums"></span>`;
      li.querySelector(".om-title").textContent = text ? text.title(m.target) : m.type;
      const extra = `${gain > 0 ? ` (+${fmtNum(gain)})` : ""}${run.completed.includes(m.id) ? " · Выполнено!" : ""}`;
      li.querySelector(".om-nums").textContent = `${fmtNum(m.progress)} / ${fmtNum(m.target)}${extra}`;
      if (run.completed.includes(m.id)) li.className = "om-done";
      return li;
    });
    ui.overMissions.querySelector("ul").replaceChildren(...rows);
    const notes = [];
    if (run.dayChanged) notes.push("Наступил новый день — задания обновлены");
    if (run.autoCredited > 0) notes.push(`Вчерашние награды: +${run.autoCredited} монет в гараж`);
    if (list.some((m) => m.completed && !m.claimed)) notes.push("Забери награду в «Заданиях»");
    ui.overMissions.querySelector(".om-note").textContent = notes.join(". ");
  }

  function openMissions() {
    if (mode !== "menu" && mode !== "over") return;
    missionsFrom = mode;
    mode = "missions";
    setMissionsStatus("");
    if (missionsOk) {
      refreshMissionsDay();
      if (!missions.seen) {
        missions = markMissionsSeen(missions);
        persistMissions();
        if (!ui.missionsStatus.textContent) setMissionsStatus("Новые задания на сегодня", "good");
      }
    }
    renderMissions();
    renderMissionsButtons();
    show("missions");
    // фокус на карточку: Enter, которым открыли экран, не «заберёт» награду
    ui.missionsCard.focus({ preventScroll: true });
  }

  function closeMissions() {
    mode = missionsFrom;
    show(missionsFrom);
    if (missionsFrom === "menu") {
      ui.menuBest.textContent = String(best);
      refreshMissionsDay();
    }
    renderMissionsButtons();
    $(missionsFrom === "over" ? "over-missions-open" : "menu-missions").focus({ preventScroll: true });
  }

  function claim(id) {
    if (!missionsOk) return;
    const btn = ui.missionsList.querySelector(`[data-claim="${CSS.escape(id)}"]`);
    if (btn) btn.disabled = true; // двойное нажатие не даёт второго начисления
    try {
      const r = claimMissionReward(missions, garage, id, dayKey(now()));
      missions = r.state;
      garage = r.garage;
      persistMissions();
      setMissionsStatus(`+${r.reward} монет в гараж`, "good");
    } catch (err) {
      if (err.code === "stale-day") {
        const r = refreshMissionsDay();
        const credit = r && r.autoCredited > 0 ? `. Вчерашние награды: +${r.autoCredited} монет в гараж` : "";
        setMissionsStatus(`${err.message}${credit}`, "bad");
      } else if (err.code === "not-completed" || err.code === "already-claimed") {
        setMissionsStatus(err.message, "bad");
      } else {
        console.warn("Задания: отказ в награде:", err);
        setMissionsStatus(GENERIC_CLAIM_ERROR, "bad");
      }
    }
    renderMissions();
    renderMissionsButtons();
    const next = ui.missionsList.querySelector("[data-claim]") || $("missions-back");
    next.focus({ preventScroll: true });
  }

  // Предпросмотр в заезде: надпись в момент выполнения (UI FR-013), без сохранения.
  function previewMissions() {
    if (!missionsOk || missions.day !== dayKey(now())) return;
    let ids;
    try {
      ids = previewCompleted(missions, runResultsFromWorld(world)).filter((id) => !announced.has(id));
    } catch {
      return;
    }
    if (!ids.length) return;
    ids.forEach((id) => announced.add(id));
    toastQueue.push(ids.length === 1 ? "Задание выполнено!" : `Задания выполнены: ${ids.length}`);
  }

  function drainToasts() {
    if (toastQueue.length && clock >= toastUntil) showToast(toastQueue.shift(), "good");
  }

  // ---------- экран гаража ----------

  const UPGRADE_INFO = {
    engine: { name: "Мотор", effect: (l) => `макс. ${kmh(topSpeed(MAX_GEAR, false, ENGINE_GEAR_SCALE[l]))} км/ч` },
    nitro: { name: "Нитро", effect: (l) => `${NITRO_DURATION_BY_LEVEL[l]} с` },
    jump: { name: "Прыжок", effect: (l) => `высота ×${JUMP_HEIGHT_SCALE[l].toFixed(1)}` },
  };

  function renderGarage() {
    ui.garageCoins.textContent = String(garage.coins);
    ui.garageList.replaceChildren(
      ...UPGRADE_IDS.map((id) => {
        const info = UPGRADE_INFO[id];
        const level = garage.levels[id];
        const price = nextPrice(garage, id);
        const row = document.createElement("li");
        row.className = "upgrade";
        row.dataset.id = id;

        const title = document.createElement("div");
        title.className = "upgrade-title";
        title.innerHTML = `<b>${info.name}</b> <span class="upgrade-level">${level}/${MAX_UPGRADE_LEVEL}</span>`;
        const effect = document.createElement("div");
        effect.className = "upgrade-effect";
        effect.textContent = price === null ? info.effect(level) : `${info.effect(level)} → ${info.effect(level + 1)}`;

        const btn = document.createElement("button");
        btn.className = "btn-buy";
        btn.dataset.buy = id;
        if (price === null) {
          btn.textContent = "макс.";
          btn.disabled = true;
        } else {
          btn.innerHTML = `<span class="coin-icon" aria-hidden="true"></span>${price}`;
          btn.setAttribute("aria-label", `Купить: ${info.name}, уровень ${level + 1}, ${price} монет`);
          // не хватает монет — видно заранее; по нажатию объясняем почему
          btn.setAttribute("aria-disabled", String(garage.coins < price));
        }
        row.append(title, effect, btn);
        return row;
      })
    );
  }

  function buy(id) {
    try {
      garage = buyUpgrade(garage, id);
      saveGarage(garage);
      ui.garageStatus.textContent = `${UPGRADE_INFO[id].name}: уровень ${garage.levels[id]}`;
      ui.garageStatus.className = "garage-status good";
    } catch (err) {
      ui.garageStatus.textContent = err.message;
      ui.garageStatus.className = "garage-status bad";
    }
    renderGarage();
    ui.garageList.querySelector(`[data-buy="${id}"]`)?.focus({ preventScroll: true });
  }

  function openGarage() {
    if (mode !== "menu" && mode !== "over") return;
    garageFrom = mode;
    mode = "garage";
    ui.garageStatus.textContent = "";
    renderGarage();
    show("garage");
    // фокус на карточку, а не на кнопку: иначе Enter «нажал» бы её и закрыл гараж
    ui.garageCard.focus({ preventScroll: true });
  }

  function closeGarage() {
    mode = garageFrom;
    show(garageFrom);
    if (garageFrom === "menu") {
      ui.menuBest.textContent = String(best);
      refreshMissionsDay();
    }
    $(garageFrom === "over" ? "restart" : "start").focus({ preventScroll: true });
  }

  // Индикаторы купленных улучшений в HUD; уровень 0 не показываем.
  function renderHudUpgrades(levels) {
    ui.hudUpgrades.replaceChildren(
      ...UPGRADE_IDS.filter((id) => levels[id] > 0).map((id) => {
        const chip = document.createElement("div");
        chip.className = "chip chip-upgrade";
        chip.textContent = `${UPGRADE_INFO[id].name} ${levels[id]}`;
        return chip;
      })
    );
  }

  function start() {
    // Запускаем игру сразу, звук инициализируется параллельно
    world = createWorld(garage.levels); // уровни фиксируются на весь заезд
    runCredited = false;
    announced = new Set();
    toastQueue.length = 0;
    ui.menuStatus.textContent = "";
    renderHudUpgrades(garage.levels);
    rng = createRng(Date.now() & 0x7fffffff);
    needleRpm = 0;
    held.brake = false;
    mode = "playing";
    show("hud");
    for (const key of Object.keys(lastHud)) delete lastHud[key];

    // Инициализация звука идёт параллельно и не задерживает старт
    initSound().then((result) => {
      if (result.status === "available") {
        sound.init();
        ui.soundOff.hidden = true;
      } else {
        showSoundStatus(result.message);
        ui.soundOff.hidden = false;
      }
    }).catch((err) => {
      console.error("Неожиданная ошибка инициализации звука:", err);
      ui.soundOff.hidden = false;
    });
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
    finishRun();
    mode = "menu";
    world = createWorld();
    ui.menuBest.textContent = String(best);
    show("menu");
    if (lastRun && lastRun.autoCredited > 0) {
      ui.menuStatus.textContent = `Вчерашние награды: +${lastRun.autoCredited} монет в гараж`;
    }
    refreshMissionsDay();
    sound.setEngine(0, 1, false);
  }

  function gameOver() {
    mode = "over";
    const earned = finishRun();
    ui.overEarned.textContent = `+${earned} в гараж`;
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
    renderOverMissions(lastRun);
    renderMissionsButtons();
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
    if (mode === "garage" && e.code !== "KeyM" && e.code !== "KeyF") {
      // в гараже клавиши заезда (и Enter) не действуют, Esc — назад
      if (e.code === "Escape") closeGarage();
      return;
    }
    if (mode === "missions" && e.code !== "KeyM" && e.code !== "KeyF") {
      // на экране «Задания» клавиши заезда и Enter-старт не действуют, Esc — назад
      if (e.code === "Escape") closeMissions();
      return;
    }
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
  $("menu-garage").addEventListener("click", openGarage);
  $("over-garage").addEventListener("click", openGarage);
  $("garage-back").addEventListener("click", closeGarage);
  ui.garageList.addEventListener("click", (e) => {
    const id = e.target.closest("button")?.dataset.buy;
    if (id) buy(id);
  });
  $("menu-missions").addEventListener("click", openMissions);
  $("over-missions-open").addEventListener("click", openMissions);
  $("missions-back").addEventListener("click", closeMissions);
  ui.missionsList.addEventListener("click", (e) => {
    const id = e.target.closest("button")?.dataset.claim;
    if (id) claim(id);
  });
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
      previewMissions();
      const p = world.player;
      sound.setEngine(displayRpm(p), p.gear, true);
    } else if (mode === "crashing") {
      sound.setEngine(0, 1, false);
      crashTimer -= dt;
      if (crashTimer <= 0) gameOver();
    }

    drainToasts();
    renderer.draw(world, clock, mode === "paused" ? 0 : dt);
    if (mode !== "menu" && mode !== "garage" && mode !== "missions") updateHud(dt);
    requestAnimationFrame(loop);
  }

  buildTacho();
  ui.menuBest.textContent = String(best);
  try {
    missions = loadMissions(dayKey(now()));
  } catch (err) {
    console.error("Задания недоступны:", err);
    missionsOk = false;
  }
  refreshMissionsDay();
  renderMissionsButtons();
  // Смена дня без перезагрузки: проверка в меню и на экране «Задания» (не реже раза в минуту).
  setInterval(() => {
    if (mode === "menu") refreshMissionsDay();
    if (mode === "missions") {
      refreshMissionsDay();
      renderMissions();
    }
  }, 30000);
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
    get garage() {
      return garage;
    },
    get missions() {
      return missions;
    },
    setNow(ts) {
      nowOffset = ts - Date.now();
    },
    refreshMissionsDay() {
      refreshMissionsDay();
      if (mode === "missions") renderMissions();
    },
    claimMission: claim,
    start,
    command,
    pause: pauseToggle,
  };
})();
