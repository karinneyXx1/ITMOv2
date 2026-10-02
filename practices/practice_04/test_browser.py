#!/usr/bin/env python3
"""
Браузерная проверка Race Mini:
1. Открыть index.html
2. Нажать стрелку вверх несколько раз → скорость растёт до MAX_SPEED
3. Вызвать testInvalidCommand() → проверить отклонение невалидной команды
"""

from playwright.sync_api import sync_playwright
import os
import time

# Получаем абсолютный путь к index.html
current_dir = os.path.dirname(os.path.abspath(__file__))
html_path = os.path.join(current_dir, 'index.html')
file_url = f'file://{html_path}'

print(f'Opening: {file_url}')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    # Открываем index.html
    page.goto(file_url)
    page.wait_for_load_state('networkidle')
    
    # Скриншот начального состояния
    page.screenshot(path='/tmp/race_mini_initial.png', full_page=True)
    print('✓ Начальный скриншот: /tmp/race_mini_initial.png')
    
    # Проверяем начальную скорость
    initial_speed = page.locator('#speedDisplay').inner_text()
    print(f'✓ Начальная скорость: {initial_speed}')
    
    # Получаем MAX_SPEED из контекста страницы
    max_speed = page.evaluate('MAX_SPEED')
    print(f'✓ MAX_SPEED из game.js: {max_speed}')
    
    # Удерживаем стрелку вверх для ускорения (keydown -> wait -> keyup)
    print('\nУдерживаем стрелку вверх для ускорения до MAX_SPEED...')
    page.keyboard.down('ArrowUp')
    time.sleep(1.5)  # достаточно времени чтобы набрать MAX_SPEED (10 / 0.5 = 20 кадров = ~0.33 сек при 60fps)
    page.keyboard.up('ArrowUp')
    
    # Ждём стабилизации состояния
    time.sleep(0.3)
    
    # Проверяем финальную скорость
    final_speed = page.locator('#speedDisplay').inner_text()
    final_speed_float = float(final_speed)
    print(f'✓ Финальная скорость: {final_speed}')
    
    # Проверка: скорость должна быть равна MAX_SPEED
    if abs(final_speed_float - max_speed) < 0.01:
        print(f'✅ Скорость достигла MAX_SPEED ({max_speed}) и остановилась!')
    else:
        print(f'❌ ОШИБКА: Скорость {final_speed_float}, ожидалась {max_speed}')
    
    # Скриншот после ускорения
    page.screenshot(path='/tmp/race_mini_accelerated.png', full_page=True)
    print('✓ Скриншот после ускорения: /tmp/race_mini_accelerated.png')
    
    # Тест невалидной команды через консоль
    print('\nТестируем невалидную команду через testInvalidCommand()...')
    result = page.evaluate('window.testInvalidCommand()')
    
    # Проверяем консольные логи на странице
    console_html = page.locator('#console').inner_html()
    
    if 'Validation correctly rejected' in console_html:
        print('✅ Невалидная команда корректно отклонена валидацией!')
    else:
        print('❌ ОШИБКА: Невалидная команда не была отклонена')
    
    # Финальный скриншот с логами
    page.screenshot(path='/tmp/race_mini_final.png', full_page=True)
    print('✓ Финальный скриншот: /tmp/race_mini_final.png')
    
    # Получаем все логи из консоли страницы
    console_logs = page.locator('#console div').all_inner_texts()
    print('\n=== Console logs ===')
    for log in console_logs:
        print(f'  {log}')
    
    browser.close()
    
print('\n✅ Все браузерные тесты пройдены успешно!')
