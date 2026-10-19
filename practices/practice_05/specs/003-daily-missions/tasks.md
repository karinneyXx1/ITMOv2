---

description: "Task list for daily missions (integrated UI + logic)"
---

# Tasks: Ежедневные задания — сквозная реализация

**Input**: `specs/003-daily-missions/` (plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md) + спеки 001, 002 и [контракт v1.1](../daily-missions-contract.md)

**Tests**: обязательны — конституция, принцип IV (сначала падающий тест). Тесты логики — в конец
`test_game.js`, сквозные — новый сценарий 10 в `test_browser.py`; существующие тесты не меняются.

**Organization**: логика (Foundational) → истории по приоритету: US1, US2, US5 (P1), US3, US4 (P2).

## Format: `[ID] [P?] [Story] Description`

Все пути — относительно `practices/practice_05/`.

---

## Phase 1: Setup

- [ ] T001 Зафиксировать базовую линию: `sh scripts/check.sh --full` → `CHECK: PASS` до любых правок (число тестов `test_game.js` и сценариев `test_browser.py` записать в отчёт)

---

## Phase 2: Foundational — логика заданий в `game.js` (блокирует все истории)

**Purpose**: операции раздела 3 контракта, чистые функции, каждая — сначала падающий тест в `test_game.js`.

- [ ] T002 Тесты + константы `MISSION_TYPES` (coins/perfectShifts/distance, цели 60/150/300, 3/8/12, 1000/3000/6000) и `MISSION_REWARDS` (20/40/60), helper `missionError(Cls, code, message)` в `game.js`
- [ ] T003 Тесты + `dayKey(ts)` и `nextDayStart(ts)` (местное время, переход 23:59→00:00, неверный ввод → `invalid-input`: тип → TypeError, значение → RangeError) в `game.js`
- [ ] T004 Тесты + `createDailyMissions(day)`: 3 задания в порядке видов, id `"<day>:<type>"`, прогресс 0, `seen: false`; одна дата — один набор; на 365 датах набор отличается от вчерашнего хотя бы одной целью (research §1) в `game.js`
- [ ] T005 Тесты + `parseMissions(raw, day)`: мусор/null/неверная дата/не тот состав → новый набор; плохой прогресс → 0; больше цели → цель; цели и награды из правил, не из сохранения; набор с днём позже `day` остаётся; никогда не бросает в `game.js`
- [ ] T006 Тесты + `ensureMissionDay(state, garage, day)`: тот же/ранний день — без изменений, `autoCredited: 0`, `dayChanged: false`; поздний день — новый набор, автозачисление незабранных выполненных, пропущенные дни ничего не дают; исходные объекты не мутируются в `game.js`
- [ ] T007 Тесты + `runResultsFromWorld(world)` и проверка итогов (`floor(player.z)`, целые ≥ 0, `invalid-input`) в `game.js`
- [ ] T008 Тесты + `applyRunToMissions(state, garage, results, day)`: актуализация дня первой, прибавка к невыполненным с потолком цели, `gains`, `completed`, выполненные не меняются, монеты наград не считаются в `game.js`
- [ ] T009 Тесты + `previewCompleted(state, results)`: какие задания эти итоги впервые довели бы до цели; состояние не меняется; совпадает с `completed` у `applyRunToMissions` в `game.js`
- [ ] T010 Тесты + `claimMissionReward(state, garage, id, day)`: успех (+reward, `claimed`, уровни гаража целы); `stale-day` (день в id раньше `day`), `unknown-mission`, `not-completed` «Задание ещё не выполнено: X из Y», `already-claimed`, `invalid-input`; при откате часов — выдаётся; при ошибке ничего не меняется в `game.js`
- [ ] T011 Тесты + `markMissionsSeen(state)` и `describeMissions(state)`; экспорт всех функций и констант в `module.exports`; `sh scripts/check.sh` → `CHECK: PASS` в `game.js`

**Checkpoint**: логика полностью покрыта тестами Node, UI ещё не тронут.

---

## Phase 3: Foundational — связка в `main.js`

- [ ] T012 `now()` = `Date.now()` + смещение; `loadMissions(day)` (`parseMissions` в `try/catch`) и `saveMissions(state)` → `true/false` под ключом `metro-rush-missions`; при загрузке страницы `ensureMissionDay`, при автозачислении сохранить гараж, затем задания (research §3, §5) в `main.js`
- [ ] T013 Хук `window.__metro`: `missions`, `setNow(ts)`, `refreshMissionsDay()`, `claimMission(id)` по [contracts/test-hooks.md](contracts/test-hooks.md) в `main.js`

---

## Phase 4: User Story 1 — Полный день: заезд → выполнено → забрать → гараж (P1) 🎯 MVP

**Goal**: игрок видит задания, выполняет, забирает награду в кошелёк гаража.
**Independent Test**: сценарий US1 из spec.md; сквозной браузерный тест.

- [ ] T014 [P] [US1] Разметка: кнопка «Задания» с отметкой в `#menu` и на `#over`, `<section id="missions">` (заголовок «Задания дня», кошелёк, список, `role="status"`, таймер, плашка «Все задания…», «Назад Esc»), блок «Задания дня» на экране итогов в `index.html`
- [ ] T015 [P] [US1] Стили экрана, строк, полос прогресса, состояний, отметок «Награда!»/«Новые!», блока итогов по `docs/DESIGN.md`; ширина 360 px без горизонтальной прокрутки в `styles.css`
- [ ] T016 [US1] `renderMissions()` (формулировки и состояния по разделу 6 контракта, «цель / цель», таймер `nextDayStart(now) − now`, плашка при 3 «Получено») и кнопка меню «Задания N/3» + отметка (UI FR-001, FR-002, FR-005–FR-008, FR-018, FR-019) в `main.js`
- [ ] T017 [US1] Режим `missions`: открыть из меню/итогов (`ensureMissionDay` → `markMissionsSeen` → сохранить → показать, «Новые задания на сегодня» при `seen: false`), фокус на карточку, Esc/«Назад» с возвратом фокуса на кнопку «Задания», клавиши заезда и Enter игнорируются, M/F работают (UI FR-003, FR-017, FR-023–FR-025) в `main.js`
- [ ] T018 [US1] «Забрать +N»: `claimMissionReward` в `try/catch`, кнопка сразу неактивна, при успехе сохранить гараж и задания, «+N монет в гараж», фокус на следующую «Забрать» или «Назад» (UI FR-009, FR-010, FR-012) в `main.js`
- [ ] T019 [US1] Сценарий 10 в `test_browser.py`, часть US1: чистое хранилище → «Задания 0/3» + «Новые!» → экран (3 строки) → Enter не стартует заезд → заезд с монетами ≥ цели лёгкого задания (через хук) → блок итогов «Выполнено!» → «Забрать» → кошелёк в гараже +награда; перезагрузка — повторной награды нет

---

## Phase 5: User Story 2 — Прогресс по ходу и после заезда (P1)

**Goal**: надпись в момент выполнения; итоги ровно один раз при аварии и при выходе через паузу.

- [ ] T020 [US2] `finishRun()`: после зачисления монет заезда — `applyRunToMissions(missions, garage, runResultsFromWorld(world), dayKey(now()))`, сохранить гараж и задания, результат (`gains`, `completed`, `dayChanged`, `autoCredited`) — в блок «Задания дня» на экране итогов (+X, «Выполнено!», подсказка «Забери награду в «Заданиях»», скрыт при недоступности) (UI FR-014, FR-015) в `main.js`
- [ ] T021 [US2] В `loop` при `playing` и `missions.day === dayKey(now())` — `previewCompleted`; новые id → надпись «Задание выполнено!» / «Задания выполнены: N» через очередь надписей, не затирая текущую; сброс `announced` при старте заезда (UI FR-013, research §4) в `main.js`
- [ ] T022 [US2] Сценарий 10, часть US2: прогресс перед целью → действие в заезде → надпись; выход через паузу → «В меню» — прогресс учтён ровно один раз в `test_browser.py`

---

## Phase 6: User Story 5 — Ничего не сломано (P1)

- [ ] T023 [US5] Проверить, что прежние тесты не изменены (diff `test_game.js`/`test_browser.py` — только добавления в конец) и `sh scripts/check.sh --full` → `CHECK: PASS`; в сценарии 10 — Enter и клавиши заезда на экране «Задания» не действуют, Esc — назад

---

## Phase 7: User Story 3 — Новый день и автозачисление (P2)

- [ ] T024 [US3] Проверка дня в меню: при возврате в меню и `setInterval` раз в 30 с, пока открыто меню или «Задания»; при `autoCredited > 0` — «Вчерашние награды: +N монет в гараж» один раз в месте по UI FR-016; при смене дня на открытом экране — «Наступил новый день — задания обновлены» (UI FR-016, FR-017) в `main.js`
- [ ] T025 [US3] Обработка `stale-day` при «Забрать»: текст ошибки → `ensureMissionDay` → сохранить → перерисовать → сообщение об автозачислении (UI FR-011) в `main.js`
- [ ] T026 [US3] Сценарий 10, часть US3: выполненное незабранное задание → `setNow(+1 день)` + `refreshMissionsDay()` → сообщение в меню, кошелёк +награда, новые задания с «Новые!»; открытый экран со вчерашним набором → «Забрать» после смены дня → «Задания устарели…» и автозачисление в `test_browser.py`

---

## Phase 8: User Story 4 — Ошибки и границы (P2)

- [ ] T027 [US4] Тексты ошибок по разделу 4 контракта: `not-completed`, `already-claimed`, `stale-day` — текст логики; `unknown-mission`, `invalid-input` и прочие — «Не удалось забрать награду. Попробуй ещё раз.» (подробности в консоль); `saveMissions` → `false` — один раз за сессию «Прогресс заданий не сохранится после перезагрузки»; исключение логики при показе → «Задания сейчас недоступны…» (UI FR-011, FR-020–FR-022) в `main.js`
- [ ] T028 [US4] Сценарий 10, часть US4: «Забрать» невыполненного (через хук) → текст, кошелёк цел; двойное нажатие — одно начисление; прогресс выше цели → «цель / цель» и «+остаток»; мусор в `metro-rush-missions` → задания с нулём, гараж цел; запрещённое хранилище → сообщение, игра работает в `test_browser.py`

---

## Phase 9: Polish

- [ ] T029 [P] Доступность и движение: имя экрана, `aria` у полос прогресса и кнопок «Забрать», вежливая строка статуса, `prefers-reduced-motion` (UI FR-026, FR-027) в `index.html`, `styles.css`, `main.js`
- [ ] T030 [P] Обновить `AGENTS.md`: задания в структуре кода и модели (функции, ключ `metro-rush-missions`, режим `missions`, хуки)
- [ ] T031 Пройти [quickstart.md](quickstart.md); скриншоты экрана «Задания», меню и итогов на 1440 и 390 px для демо; `sh scripts/check.sh --full` → `CHECK: PASS`

---

## Dependencies & Execution Order

- T001 → Phase 2 (T002…T011 по порядку: каждая функция опирается на предыдущие) → Phase 3 (T012, T013).
- US1 (T014–T019) зависит от Phase 2–3; T014 и T015 — параллельно [P] (разные файлы).
- US2 (T020–T022) зависит от US1 (блок итогов и экран). US5 (T023) — после US2.
- US3 (T024–T026) и US4 (T027–T028) — после US1; между собой независимы, но правят `main.js` — выполнять последовательно.
- Polish — последним.

## Parallel Example

```text
После T013: T014 (index.html) ‖ T015 (styles.css)
В Polish:   T029 ‖ T030
```

## Implementation Strategy

MVP = Phase 1–4 (логика + US1): игрок уже видит задания и забирает награды. Затем US2 (вклад
заезда), проверка US5, затем US3 и US4. После каждой фазы — `sh scripts/check.sh`.
