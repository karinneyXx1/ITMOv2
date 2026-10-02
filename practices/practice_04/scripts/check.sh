#!/bin/sh
# Единая проверка Metro Rush. Её запускают человек вручную и hook
# .opencode/plugins/check-after-edit.js после каждой правки агента.
#
#   sh scripts/check.sh          — синтаксис JS + юнит-тесты (быстро, ~1 с)
#   sh scripts/check.sh --full   — плюс браузерный тест в headless Chromium
#
# Последняя строка вывода — всегда "CHECK: PASS" или "CHECK: FAIL".
# Код выхода: 0 — всё прошло, 1 — есть ошибки.

cd "$(dirname "$0")/.." || exit 1
status=0

echo "== 1. Синтаксис JS"
for f in game.js render.js audio.js main.js test_game.js test_audio.js; do
  if node --check "$f" 2>&1; then
    echo "  ok  $f"
  else
    echo "  FAIL $f"
    status=1
  fi
done

echo "== 2. Юнит-тесты логики (node test_game.js)"
unit_out=$(node test_game.js 2>&1)
unit_code=$?
if [ "$unit_code" -eq 0 ]; then
  echo "$unit_out" | grep -E "^ℹ (tests|pass|fail) "
else
  # только упавшие тесты и итог — без простыни из зелёных строк
  echo "$unit_out" | sed -n '/✖ failing tests/,$p'
  echo "$unit_out" | grep -E "^ℹ (tests|pass|fail) "
  status=1
fi

echo "== 3. Юнит-тесты звука (node test_audio.js)"
audio_out=$(node test_audio.js 2>&1)
audio_code=$?
if [ "$audio_code" -eq 0 ]; then
  echo "$audio_out" | grep -E "^ℹ (tests|pass|fail) "
else
  echo "$audio_out" | sed -n '/✖ failing tests/,$p'
  echo "$audio_out" | grep -E "^ℹ (tests|pass|fail) "
  status=1
fi

if [ "${1:-}" = "--full" ]; then
  echo "== 4. Браузерный тест (test_browser.py)"
  if [ -x venv/bin/python ]; then
    browser_out=$(venv/bin/python test_browser.py 2>&1)
    if [ $? -eq 0 ]; then
      echo "$browser_out" | tail -1
    else
      echo "$browser_out" | grep -E "❌|Error|Провалено"
      status=1
    fi
  else
    echo "  пропущен: нет venv (python3 -m venv venv && venv/bin/pip install playwright && venv/bin/playwright install chromium)"
  fi
fi

if [ "$status" -eq 0 ]; then
  echo "CHECK: PASS"
else
  echo "CHECK: FAIL"
fi
exit "$status"
