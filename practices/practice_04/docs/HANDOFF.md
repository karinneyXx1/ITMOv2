# HANDOFF — практика 4 (Metro Rush)

Для новой сессии агента: прочитай этот файл и `AGENTS.md`, запусти
`sh scripts/check.sh`, ничего не меняй без поручения.

## Состояние
- Ветка `practice_4`. Фичи A и B закоммичены (`ecd81fc`, `61d2b6e`, `b84fcfc`)
  и проверены вместе. Свой MCP, свой skill и правки среды после `b84fcfc` —
  в рабочей копии / следующем коммите. На сервер ничего не отправлено.
- Проверка: `sh scripts/check.sh` → `CHECK: PASS`
  (58 тестов логики, 12 тестов звука, 8 + 4 теста MCP; с `--full` — плюс браузер).
- OpenCode **1.18.34** (2.0.20 из презентации не опубликован) — конфиги, hook
  и пути скиллов в формате 1.x.
- Модели через курсовой VseLLM недоступны: учебный ключ с 2.10 16:54 отвечает
  `402 Payment Required` (лимит исчерпан на фиче B, ~4,3 млн входных токенов).
  Обход — бесплатная модель OpenCode Zen: `opencode -m opencode/big-pickle`
  (ключ не нужен, но медленная — ~1 мин на шаг).

## Что сделано
| Часть | Результат | Где |
|---|---|---|
| Контракт | Фичи A и B: поведение + способ проверки, обе ✅ | `docs/requirements.md` |
| Правила | Правила для агента, ссылки на контракт/style guide/runner | `AGENTS.md` |
| Style guide | 5 правил, у каждого — место в коде и проверка | `docs/style-guide.md` |
| Skills (готовые) | `test-driven-development` (+ `writing-good-tests.md`), `webapp-testing`, `frontend-design` | `.agents/skills/`, `skills-lock.json` |
| Skill (свой) | `metro-balance-check`: сравнивает баланс «последний коммит → текущий код» на одних трассах, скрипт + процедура | `.agents/skills/metro-balance-check/` |
| MCP (готовые) | playwright, context7 | `opencode.json` |
| MCP (свой) | `metro-rush`, tool `simulate_run(seed, seconds, actions, autopilot)` — заезд на логике `game.js`; ошибочный вход → `isError` с понятным текстом | `mcp/`, `opencode.json` |
| Runner | синтаксис + тесты игры, звука, MCP; `--full` — браузер | `scripts/check.sh` |
| Hook | после правки агентом файла игры/MCP запускает runner, результат дописывает агенту | `.opencode/plugins/check-after-edit.js` |
| Фича A | `validateCommand()` первой строкой `applyCommand()` | `game.js`, `ecd81fc` |
| Фича B | сбой звука: один `AudioContext`, лимит 2 с, плашка + значок «Звук выкл», игра не ждёт звук. Сделана в worktree `../ITMOv2-p4-b`, 2 ревью `@explore` + доп. ревью, замечания исправлены, слияние `--ff-only` | `audio.js`, `main.js`, `test_audio.js`, `b84fcfc` |

## Подтверждения применения (из базы OpenCode `~/.local/share/opencode/opencode.db`)
- Hook: 18 срабатываний, из них в работе над B — 4 FAIL и 12 PASS.
- Skill: агент загружал `test-driven-development` (сессия B) и `webapp-testing`.
- AGENTS.md: прочитан агентом в сессии B.
- Субагент: 2 вызова `@explore` (ревью diff B и финальная проверка).
- **MCP: реальных вызовов ещё нет** — только статус `connected`.

## Как проверять
| Команда | Ожидание |
|---|---|
| `sh scripts/check.sh` | `CHECK: PASS` |
| `sh scripts/check.sh --full` | `CHECK: PASS` (нужен `venv` с Playwright) |
| `opencode mcp list` | 3 × `connected` (playwright, context7, metro-rush) |
| `opencode debug skill` | 4 скилла из `.agents/skills` |
| `node .agents/skills/metro-balance-check/scripts/balance.js` | таблица до/после (нужен коммит с `mcp/`) |
| открыть `index.html`, Enter | заезд стартует |

Окружение: `python3 -m venv venv && venv/bin/pip install playwright && venv/bin/playwright install chromium`;
`cd mcp && npm install`.

## Ограничения и особенности
- `opencode.json` скрыт локальным `.git/info/exclude`, файл практики добавлен
  через `git add -f`. Секретов нет: ключ через `{env:VSELLM_API_KEY}`.
- Hook реагирует только на правки **агента**; его вывод не виден в интерфейсе
  OpenCode — уходит модели.
- Автопилот `simulate_run` простой: ~1 авария из 5 за 30 с. Поэтому баланс
  сравнивается до/после на одних seed, а не с идеалом.
- Фича B: повторная попытка включить звук на следующем заезде идёт без лимита 2 с
  (игру не блокирует, значок показан) — принято как известное ограничение.
- `.agents/skills/webapp-testing/SKILL.md` — пробел в конце строки, сторонний файл, не правим.
- Worktree `../ITMOv2-p4-b` ещё существует (`git worktree remove ../ITMOv2-p4-b`).

## Что осталось
1. **Модель:** демонстрации делать на `opencode/big-pickle`, каждую — в новом чате
   (или вернуть Claude, если преподаватель восстановит лимит ключа).
2. Демо в OpenCode (подтверждения для отчёта):
   правила (AGENTS.md → ограничения A и команда проверки), правило style guide
   и место в коде, `use context7`, `simulate_run` — успешный вызов и вход с
   командой `turbo`, запуск skill `metro-balance-check`, загрузка skill
   `frontend-design` на UI-задаче (агент ещё ни разу его не загружал).
3. Проверка этого HANDOFF новой сессией (слайд 22).
4. Отчёт для сдачи (`report/index.html`): блоки А–Г, обоснование подключений,
   ссылки на файлы, подтверждения.
5. `reflection.md` — пишет автор.
6. `git push` — по решению автора.
