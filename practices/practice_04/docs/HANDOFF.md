# HANDOFF — практика 4 (Metro Rush)

Новой сессии: прочитай этот файл и `AGENTS.md`, запусти `sh scripts/check.sh`,
ничего не меняй без поручения.

## Состояние
- Ветка `practice_4`, всё закоммичено. Фича A — `4391fdf`, фича B — `2ea59b4`,
  свой MCP и skill — `1ead196`, отчёт — последний коммит ветки.
- Отчёт для сдачи: `report/index.html` (+ `report/connections.md`, `report/reflection.md`).
- Готово: фичи A и B, правила, style guide, 4 скилла (3 готовых + свой
  `metro-balance-check`), MCP context7 и свой `metro-rush`, runner и hook.
- `sh scripts/check.sh` → `CHECK: PASS` (58 + 12 + 12 тестов; `--full` — плюс браузер).
- Модель: учебный ключ VseLLM отвечает `402` (лимит исчерпан) → работаем на
  `opencode -m opencode/big-pickle` (без ключа, ~1 мин на шаг).

## Источники
| Что | Где |
|---|---|
| Контракт фич A и B | `docs/requirements.md` |
| Правила кода | `docs/style-guide.md` |
| Скиллы | `.agents/skills/` (свой — `metro-balance-check/`) |
| MCP | `opencode.json`; свой сервер — `mcp/` |
| Runner / hook | `scripts/check.sh` / `.opencode/plugins/check-after-edit.js` |
| Задание и критерии | `README.md`, `presentation.pdf` |

## Проверки
- `sh scripts/check.sh` — должно быть `CHECK: PASS`.
- `opencode mcp list` — `context7` и `metro-rush`: `connected`.
- `opencode debug skill` — 4 скилла из `.agents/skills`.

## Ограничения
- OpenCode **1.18.34** (2.0.20 не опубликован): hook на `tool.execute.after`,
  конфиг MCP и путь скиллов — формата 1.x.
- Hook реагирует только на правки агента; его вывод не виден в интерфейсе.
- `opencode.json` скрыт локальным `.git/info/exclude` → в git через `git add -f`.
- Фича B: повторный запуск звука на следующем заезде — без лимита 2 с (принято).

## Что осталось
1. ✅ Демо в OpenCode сделаны 07.10 на Big Pickle: правила, style guide, context7,
   `simulate_run` (успех и `turbo`), skill `metro-balance-check`; скриншоты в `report/img/`.
2. ✅ Отчёт `report/index.html` заполнен.
3. Коммит практики 4 и `git push` — по решению автора (в т.ч. ветки `practice_3`,
   где локально лежит коммит с `opencode.json`).
