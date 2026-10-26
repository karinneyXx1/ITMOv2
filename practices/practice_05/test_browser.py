#!/usr/bin/env python3
"""
Браузерная проверка Metro Rush (Playwright, headless Chromium).

Что проверяется:
1. Страница открывается без ошибок в консоли, canvas занимает весь экран.
2. Стартовый экран виден, Enter запускает заезд.
3. Машина разгоняется сама, E переключает передачу вверх, Q — вниз.
4. Стрелки меняют полосу, пробел запускает прыжок.
5. Невалидная команда отклоняется и не меняет состояние.
6. Пауза по Esc останавливает мир.
7. Сбой звука (unsupported): плашка видна, игра запускается сразу, команды работают.
9. Гараж: Enter в гараже не запускает заезд, покупка списывает монеты,
   купленный уровень виден в HUD и действует в заезде.
10. Ежедневные задания (Spec Kit 003): экран и кнопка, выполнение в заезде и учёт итогов,
   награда в кошелёк гаража, новый день и автозачисление, ошибки и границы.

Запуск:  venv/bin/python test_browser.py
Скриншоты сохраняются в папку из SCREENSHOT_DIR (по умолчанию — системная временная папка).
"""

import os
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
FILE_URL = f"file://{os.path.join(HERE, 'index.html')}"
SHOTS = os.environ.get("SCREENSHOT_DIR", tempfile.gettempdir())

failures = []


def check(condition, message):
    print(("  ✅ " if condition else "  ❌ ") + message)
    if not condition:
        failures.append(message)


def world(page):
    return page.evaluate("() => window.__metro.world")


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)

    print(f"Открываю {FILE_URL}")
    page.goto(FILE_URL)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)

    print("\n1. Загрузка и полноэкранный canvas")
    size = page.evaluate(
        "() => { const c = document.getElementById('game'); return [c.clientWidth, c.clientHeight]; }"
    )
    check(size == [1440, 900], f"canvas на весь экран: {size}")
    page.screenshot(path=os.path.join(SHOTS, "metro_menu.png"))

    print("\n2. Стартовый экран и запуск")
    check(page.is_visible("#menu"), "стартовое меню видно")
    check(page.evaluate("() => window.__metro.mode") == "menu", "режим menu")
    page.keyboard.press("Enter")
    page.wait_for_timeout(200)
    check(page.evaluate("() => window.__metro.mode") == "playing", "Enter запускает заезд")
    check(page.is_visible("#hud"), "HUD показан")
    check(not page.is_visible("#menu"), "меню скрыто")

    print("\n3. Разгон и коробка передач")
    page.wait_for_timeout(900)
    w = world(page)
    check(w["player"]["speed"] > 3, f"машина разгоняется сама: speed={w['player']['speed']:.1f}")
    check(w["player"]["gear"] == 1, "стартуем на 1-й передаче")
    page.keyboard.press("e")
    page.wait_for_timeout(100)
    check(world(page)["player"]["gear"] == 2, "E — передача вверх")
    check(page.inner_text("#hud-gear") == "2", "HUD показывает 2-ю передачу")
    page.keyboard.press("q")
    page.wait_for_timeout(100)
    check(world(page)["player"]["gear"] == 1, "Q — передача вниз")

    print("\n4. Полосы и прыжок")
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(100)
    check(world(page)["player"]["lane"] == 0, "← — левая полоса")
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(100)
    check(world(page)["player"]["lane"] == 2, "→ → — правая полоса")
    page.keyboard.press("Space")
    page.wait_for_timeout(120)
    check(world(page)["player"]["jumping"] is True, "пробел — прыжок")
    page.screenshot(path=os.path.join(SHOTS, "metro_play.png"))

    print("\n5. Невалидная команда")
    before = world(page)["player"]
    accepted = page.evaluate("() => window.__metro.command('turbo')")
    after = world(page)["player"]
    check(accepted is False, "command('turbo') отклонена")
    check(after["lane"] == before["lane"] and after["gear"] == before["gear"], "состояние не изменилось")

    print("\n6. Пауза")
    page.keyboard.press("Escape")
    page.wait_for_timeout(100)
    z1 = world(page)["player"]["z"]
    page.wait_for_timeout(400)
    z2 = world(page)["player"]["z"]
    check(page.is_visible("#pause"), "экран паузы показан")
    check(z1 == z2, "мир стоит на паузе")
    page.keyboard.press("Escape")
    page.wait_for_timeout(100)
    check(page.evaluate("() => window.__metro.mode") == "playing", "Esc снимает паузу")

    print("\n7. Ошибки в консоли")
    real_errors = [e for e in errors if "fonts.g" not in e]
    check(not real_errors, f"нет ошибок JS: {real_errors}")

    browser.close()

# Отдельная проверка со сбоем звука
print("\n\n8. Сбой звука (unsupported)")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors_sound = []
    page.on("pageerror", lambda err: errors_sound.append(str(err)))
    page.on("console", lambda msg: errors_sound.append(msg.text) if msg.type == "error" else None)

    # Удаляем AudioContext перед загрузкой страницы
    page.add_init_script("delete window.AudioContext; delete window.webkitAudioContext;")

    page.goto(FILE_URL)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)

    # Запускаем игру
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)

    check(page.evaluate("() => window.__metro.mode") == "playing", "Enter запускает заезд без звука")

    # Проверяем, что плашка со статусом звука видна
    status_visible = page.is_visible("#sound-status")
    check(status_visible, "плашка статуса звука видна")

    if status_visible:
        status_text = page.inner_text("#sound-status")
        check("не поддерживает Web Audio" in status_text, f"текст плашки содержит 'не поддерживает Web Audio': {status_text}")

    # Проверяем, что игра работает
    page.wait_for_timeout(200)
    w_sound = world(page)
    check(w_sound["player"]["speed"] > 0, f"машина разгоняется без звука: speed={w_sound['player']['speed']:.1f}")

    # Проверяем команды
    page.keyboard.press("e")
    page.wait_for_timeout(100)
    check(world(page)["player"]["gear"] == 2, "команды работают без звука")

    page.screenshot(path=os.path.join(SHOTS, "metro_no_sound.png"))

    real_errors_sound = [e for e in errors_sound if "fonts.g" not in e]
    check(not real_errors_sound, f"нет ошибок JS при сбое звука: {real_errors_sound}")

    browser.close()

# Гараж (openspec change garage-upgrades)
print("\n\n9. Гараж")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors_garage = []
    page.on("pageerror", lambda err: errors_garage.append(str(err)))
    page.on("console", lambda msg: errors_garage.append(msg.text) if msg.type == "error" else None)

    # Заранее кладём гараж в localStorage: 60 монет, все улучшения на уровне 0
    page.goto(FILE_URL)
    page.evaluate(
        """() => localStorage.setItem('metro-rush-garage',
            JSON.stringify({ coins: 60, levels: { engine: 0, nitro: 0, jump: 0 } }))"""
    )
    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(300)

    page.click("#menu-garage")
    page.wait_for_timeout(100)
    check(page.is_visible("#garage"), "гараж открывается из меню")
    check(page.inner_text("#garage-coins") == "60", "гараж показывает 60 монет из хранилища")

    page.keyboard.press("Enter")
    page.wait_for_timeout(200)
    check(page.evaluate("() => window.__metro.mode") == "garage", "Enter в гараже не запускает заезд")
    check(page.is_visible("#garage"), "гараж остаётся открытым после Enter")

    page.click('[data-buy="engine"]')
    page.wait_for_timeout(100)
    saved = page.evaluate("() => JSON.parse(localStorage.getItem('metro-rush-garage'))")
    check(saved["coins"] == 10 and saved["levels"]["engine"] == 1, f"покупка мотора: 60 → 10, мотор 1, сохранено: {saved}")
    check(page.inner_text("#garage-coins") == "10", "кошелёк на экране обновился")
    page.screenshot(path=os.path.join(SHOTS, "metro_garage.png"))

    page.keyboard.press("Escape")
    page.wait_for_timeout(100)
    check(page.is_visible("#menu"), "Esc возвращает в меню")
    page.keyboard.press("Enter")
    page.wait_for_timeout(200)
    check(page.evaluate("() => window.__metro.mode") == "playing", "из меню заезд запускается")
    chips = page.locator("#hud-upgrades .chip").all_inner_texts()
    check(chips == ["Мотор 1"], f"HUD показывает купленное улучшение: {chips}")
    scale = page.evaluate("() => window.__metro.world.player.stats.gearScale")
    check(scale == 1.03, f"мотор 1 действует в заезде: gearScale={scale}")

    real_errors_garage = [e for e in errors_garage if "fonts.g" not in e]
    check(not real_errors_garage, f"нет ошибок JS в гараже: {real_errors_garage}")

    browser.close()

# Ежедневные задания (Spec Kit specs/003-daily-missions, контракт specs/daily-missions-contract.md)
print("\n\n10. Ежедневные задания")

DAY_MS = 24 * 3600 * 1000


def missions_page(p, init_script=None):
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    page.on("pageerror", lambda err: errs.append(str(err)))
    page.on("console", lambda msg: errs.append(msg.text) if msg.type == "error" else None)
    if init_script:
        page.add_init_script(init_script)
    page.goto(FILE_URL)
    page.wait_for_load_state("networkidle")
    return browser, page, errs


def preset(page, missions_js, garage_coins=0):
    """Кладёт состояние заданий (выражение JS от today) и гараж в localStorage и перезагружает."""
    page.evaluate(
        """([expr, coins]) => {
            const today = dayKey(Date.now());
            const state = eval(expr);
            localStorage.setItem('metro-rush-missions', JSON.stringify(state));
            localStorage.setItem('metro-rush-garage',
              JSON.stringify({ coins, levels: { engine: 0, nitro: 0, jump: 0 } }));
        }""",
        [missions_js, garage_coins],
    )
    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(200)


def mstate(page):
    return page.evaluate("() => window.__metro.missions")


def mode_of(page):
    return page.evaluate("() => window.__metro.mode")


# distance — «цель − 1»: машина едет сама, поэтому выполнение в заезде гарантировано
DIST_ALMOST = """(() => { const s = createDailyMissions(today);
  s.missions[2] = { ...s.missions[2], progress: s.missions[2].target - 1 }; return { ...s, seen: true }; })()"""
COINS_DONE = """(() => { const s = createDailyMissions(today);
  s.missions[0] = { ...s.missions[0], progress: s.missions[0].target }; return { ...s, seen: true }; })()"""

with sync_playwright() as p:
    browser, page, errs = missions_page(p)
    page.evaluate("() => localStorage.clear()")
    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(200)

    print("  US1: кнопка в меню и экран «Задания»")
    check(page.inner_text("#menu-missions [data-missions-count]") == "0/3", "в меню «Задания 0/3»")
    check(page.inner_text("#menu-missions [data-missions-badge]") == "Новые!", "отметка «Новые!» до первого открытия")
    page.click("#menu-missions")
    page.wait_for_timeout(100)
    check(mode_of(page) == "missions" and page.is_visible("#missions"), "экран «Задания» открыт")
    check(page.locator("#missions-list .mission").count() == 3, "три строки заданий")
    check(page.inner_text("#missions-status") == "Новые задания на сегодня", "сообщение «Новые задания на сегодня»")
    check(page.inner_text("#missions-timer").startswith("Новые задания"), f"таймер: {page.inner_text('#missions-timer')}")
    page.screenshot(path=os.path.join(SHOTS, "metro_missions.png"))

    print("  US5: клавиши заезда на экране «Задания» не действуют")
    for key in ["Enter", "e", "ArrowLeft", "Space", "p"]:
        page.keyboard.press(key)
    page.wait_for_timeout(150)
    check(mode_of(page) == "missions", "Enter и клавиши заезда не запускают заезд")
    page.keyboard.press("Escape")
    page.wait_for_timeout(100)
    check(mode_of(page) == "menu", "Esc — назад в меню")
    check(page.is_hidden("#menu-missions [data-missions-badge]"), "после просмотра отметки «Новые!» нет")

    print("  US2: надпись в заезде, итоги ровно один раз (пауза → «В меню»)")
    preset(page, DIST_ALMOST)
    target = mstate(page)["missions"][2]["target"]
    page.keyboard.press("Enter")
    try:
        page.wait_for_function("() => document.getElementById('toast').textContent === 'Задание выполнено!'", timeout=5000)
        toast_ok = True
    except Exception:
        toast_ok = False
    check(toast_ok, "во время заезда всплыла «Задание выполнено!»")
    page.keyboard.press("Escape")
    run_coins = page.evaluate("() => window.__metro.world.coins")
    page.click("#to-menu")
    page.wait_for_timeout(150)
    st = mstate(page)
    check(st["missions"][2]["progress"] == target, "задание на дистанцию выполнено")
    coins_m = st["missions"][0]
    check(coins_m["progress"] == min(run_coins, coins_m["target"]), f"монеты заезда учтены: {coins_m['progress']} из {run_coins}")
    page.click("#menu-garage")
    page.keyboard.press("Escape")
    page.click("#menu-missions")
    page.keyboard.press("Escape")
    check(mstate(page)["missions"][0]["progress"] == coins_m["progress"], "переходы между экранами не учитывают заезд повторно")
    check(page.inner_text("#menu-missions [data-missions-badge]") == "Награда!", "в меню отметка «Награда!»")

    # ровно один раз — по дистанции: метры за заезд растут всегда, двойной учёт был бы виден
    preset(page, "({ ...createDailyMissions(today), seen: true })")
    page.keyboard.press("Enter")
    page.wait_for_timeout(1500)
    page.keyboard.press("Escape")
    run_m = page.evaluate("() => Math.floor(window.__metro.world.player.z)")
    page.click("#to-menu")
    page.wait_for_timeout(100)
    for sel in ["#menu-garage", "#menu-missions"]:
        page.click(sel)
        page.keyboard.press("Escape")
    got = mstate(page)["missions"][2]["progress"]
    check(run_m > 0 and got == run_m, f"дистанция заезда учтена ровно один раз: {got} м из {run_m} м")

    print("  US1: авария → блок итогов → «Забрать» → кошелёк гаража")
    preset(page, DIST_ALMOST, garage_coins=5)
    reward = mstate(page)["missions"][2]["reward"]
    page.keyboard.press("Enter")
    page.wait_for_function("() => window.__metro.mode === 'over'", timeout=90000)
    page.wait_for_timeout(100)
    check(page.is_visible("#over-missions"), "на экране итогов блок «Задания дня»")
    check("(+1) · Выполнено!" in page.inner_text("#over-missions"), "в блоке прибавка «+1» и пометка «Выполнено!»")
    check("Забери награду" in page.inner_text("#over-missions"), "подсказка забрать награду")
    page.screenshot(path=os.path.join(SHOTS, "metro_missions_over.png"))
    page.keyboard.press("Tab")
    coins_before = page.evaluate("() => window.__metro.garage.coins")
    page.click("#over-missions-open")
    page.wait_for_timeout(100)
    claim_btn = page.locator('[data-claim$=":distance"]')
    check(claim_btn.count() == 1 and f"+{reward}" in claim_btn.inner_text(), "кнопка «Забрать +N»")
    claim_btn.dblclick()
    page.wait_for_timeout(150)
    coins_after = page.evaluate("() => window.__metro.garage.coins")
    check(coins_after == coins_before + reward, f"кошелёк +{reward} ровно один раз (двойное нажатие): {coins_before} → {coins_after}")
    check(page.inner_text("#missions-status") == f"+{reward} монет в гараж", "сообщение «+N монет в гараж»")
    check(page.inner_text("#missions-coins") == str(coins_after), "кошелёк на экране обновлён")
    page.keyboard.press("Escape")
    check(mode_of(page) == "over", "Esc — назад на экран итогов")
    page.click("#over-garage")
    check(page.inner_text("#garage-coins") == str(coins_after), "в гараже та же сумма")
    page.reload()
    page.wait_for_timeout(200)
    check(page.evaluate("() => window.__metro.garage.coins") == coins_after, "после перезагрузки награда не выдана повторно")
    check(mstate(page)["missions"][2]["claimed"] is True, "задание осталось «Получено»")

    print("  US3: новый день — автозачисление вчерашней награды")
    preset(page, """(() => { const y = dayKey(Date.now() - 86400000); const s = createDailyMissions(y);
      s.missions[0] = { ...s.missions[0], progress: s.missions[0].target }; return { ...s, seen: true }; })()""", garage_coins=100)
    st = mstate(page)
    today = page.evaluate("() => dayKey(Date.now())")
    yreward = page.evaluate("() => createDailyMissions(dayKey(Date.now() - 86400000)).missions[0].reward")
    check(st["day"] == today, "при загрузке набор сменился на сегодняшний")
    check(page.evaluate("() => window.__metro.garage.coins") == 100 + yreward, f"вчерашняя награда +{yreward} зачислена")
    check(page.inner_text("#menu-status") == f"Вчерашние награды: +{yreward} монет в гараж", "сообщение в меню")
    check(page.inner_text("#menu-missions [data-missions-badge]") == "Новые!", "новые задания с отметкой «Новые!»")

    print("  US3: смена дня в меню без перезагрузки")
    preset(page, COINS_DONE, garage_coins=0)
    r0 = mstate(page)["missions"][0]["reward"]
    page.evaluate(f"() => {{ window.__metro.setNow(Date.now() + {DAY_MS}); window.__metro.refreshMissionsDay(); }}")
    check(mstate(page)["day"] != today, "день сменился без перезагрузки")
    check(page.inner_text("#menu-status") == f"Вчерашние награды: +{r0} монет в гараж", "сообщение в меню при смене дня")

    print("  US3: «Забрать» после полуночи → stale-day и автозачисление")
    page.evaluate("() => window.__metro.setNow(Date.now())")
    preset(page, COINS_DONE, garage_coins=0)
    page.click("#menu-missions")
    page.evaluate(f"() => window.__metro.setNow(Date.now() + {DAY_MS})")
    page.click('[data-claim$=":coins"]')
    page.wait_for_timeout(100)
    status = page.inner_text("#missions-status")
    check(status.startswith("Задания устарели — наступил новый день"), f"текст stale-day: {status}")
    check(f"Вчерашние награды: +{r0}" in status, "вчерашняя награда зачислена автоматически")
    check(page.evaluate("() => window.__metro.garage.coins") == r0, "кошелёк вырос ровно на награду")
    check(page.locator("#missions-list .mission").count() == 3 and mstate(page)["day"] != today, "экран показывает новый день")
    page.keyboard.press("Escape")
    page.evaluate("() => window.__metro.setNow(Date.now())")

    print("  US4: ошибки и границы")
    preset(page, """(() => { const s = createDailyMissions(today);
      s.missions[0] = { ...s.missions[0], progress: 37 }; return { ...s, seen: true }; })()""", garage_coins=10)
    t0 = mstate(page)["missions"][0]["target"]
    page.click("#menu-missions")
    page.evaluate("() => window.__metro.claimMission(window.__metro.missions.missions[0].id)")
    check(page.inner_text("#missions-status") == f"Задание ещё не выполнено: 37 из {t0}", "невыполненное: понятный текст")
    page.evaluate("() => window.__metro.claimMission(dayKey(Date.now()) + ':jumps')")
    check(page.inner_text("#missions-status") == "Не удалось забрать награду. Попробуй ещё раз.", "неизвестное задание: общий текст без id")
    check(page.evaluate("() => window.__metro.garage.coins") == 10, "при отказах кошелёк не изменился")
    page.keyboard.press("Escape")
    page.evaluate("() => localStorage.setItem('metro-rush-missions', '{мусор')")
    page.reload()
    page.wait_for_timeout(200)
    st = mstate(page)
    check(all(m["progress"] == 0 for m in st["missions"]) and len(st["missions"]) == 3, "мусор в сохранении → задания дня с нулём")
    check(page.evaluate("() => window.__metro.garage.coins") == 10, "гараж цел при испорченных заданиях")
    page.set_viewport_size({"width": 390, "height": 844})
    page.click("#menu-missions")
    page.wait_for_timeout(100)
    sw = page.evaluate("() => [document.querySelector('.missions-card').scrollWidth, document.querySelector('.missions-card').clientWidth]")
    check(sw[0] <= sw[1], f"390 px: экран «Задания» без горизонтальной прокрутки {sw}")
    page.screenshot(path=os.path.join(SHOTS, "metro_missions_390.png"), full_page=True)

    real = [e for e in errs if "fonts.g" not in e]
    check(not real, f"нет ошибок JS в заданиях: {real}")
    browser.close()

print("  US4: хранилище запрещено браузером")
with sync_playwright() as p:
    browser, page, errs = missions_page(
        p, "Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });"
    )
    page.wait_for_timeout(200)
    check(len(mstate(page)["missions"]) == 3, "задания дня есть без хранилища")
    page.click("#menu-missions")
    page.wait_for_timeout(100)
    check("Прогресс заданий не сохранится после перезагрузки" in page.inner_text("#sound-status"), "сообщение о несохраняемом прогрессе")
    page.keyboard.press("Escape")
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)
    check(mode_of(page) == "playing", "заезд запускается без хранилища")
    real = [e for e in errs if "fonts.g" not in e]
    check(not real, f"нет ошибок JS без хранилища: {real}")
    browser.close()

print(f"\nСкриншоты: {SHOTS}/metro_menu.png, metro_play.png, metro_no_sound.png, metro_garage.png, metro_missions*.png")
if failures:
    print(f"\n❌ Провалено проверок: {len(failures)}")
    sys.exit(1)
print("\n✅ Все браузерные проверки пройдены")
