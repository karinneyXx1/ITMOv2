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

print(f"\nСкриншоты: {SHOTS}/metro_menu.png, metro_play.png, metro_no_sound.png")
if failures:
    print(f"\n❌ Провалено проверок: {len(failures)}")
    sys.exit(1)
print("\n✅ Все браузерные проверки пройдены")
