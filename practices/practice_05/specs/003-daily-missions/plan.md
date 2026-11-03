# Implementation Plan: Ежедневные задания — сквозная реализация

**Branch**: `003-daily-missions` (работа ведётся в git-ветке `practice_5`) | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-daily-missions/spec.md` + спеки
[001 (UI)](../001-daily-missions-ui/spec.md), [002 (логика)](../002-daily-missions-logic/spec.md) и
[общий контракт v1.1](../daily-missions-contract.md).

## Summary

Ежедневные задания (3 в день: монеты, идеальные переключения, дистанция; награды 20/40/60 в
кошелёк гаража) реализуются одним целым: чистые функции логики в `game.js` по разделу 3 контракта,
экран «Задания», кнопка в меню, блок на экране итогов и всплывающие надписи в `main.js` /
`index.html` / `styles.css` по спеке 001 и разделу 5 контракта. Состояние хранится под ключом
`metro-rush-missions`. Сначала логика с тестами в Node (TDD), затем UI, затем сквозной браузерный
сценарий. Существующий код меняется только в точках интеграции (`finishRun`, `show`, обработчик
клавиш, игровой цикл, хук `window.__metro`).

## Technical Context

**Language/Version**: JavaScript ES2020+ (vanilla, без сборки), Python 3 для браузерного теста

**Primary Dependencies**: нет новых; Playwright (уже в `venv`) только для `test_browser.py`

**Storage**: `localStorage`, ключ `metro-rush-missions` (JSON состояния дня); гараж — прежний `metro-rush-garage`

**Testing**: `node:test` / `node:assert` (`test_game.js`), Playwright (`test_browser.py`), единая проверка `sh scripts/check.sh --full`

**Target Platform**: современный браузер (desktop и mobile), открытие `index.html` напрямую; Node 20+ для тестов

**Project Type**: браузерная игра (single project, плоская структура файлов)

**Performance Goals**: 60 fps сохраняется — предпросмотр в заезде O(3) на кадр, без записи в хранилище во время заезда

**Constraints**: офлайн; без npm в игре; логика без `Date.now()`/`localStorage`/DOM (время — параметром); текст UI на русском; стиль по `docs/DESIGN.md`

**Scale/Scope**: 1 игрок на устройство; 3 задания в день; ~11 функций логики, 1 новый экран, 1 блок, 1 кнопка

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Принцип | Как выполняется | Статус |
|---|---|---|
| I. Чистые функции | Вся логика заданий — в `game.js`, время (`ts`/`day`) и гараж приходят параметрами, `rng` создаётся из даты через существующий `createRng`; хранилище и DOM — только в `main.js` | ✅ |
| II. Громкая валидация | `validateDayKey`, `validateRunResults`, `validateMissionId` первой строкой; `TypeError`/`RangeError` с `code` (контракт, раздел 4) | ✅ |
| III. Сбой API не роняет игру | `loadMissions`/`saveMissions` в `try/catch`, `saveMissions` → `false`; любое исключение логики при показе → «Задания недоступны», остальная игра работает | ✅ |
| IV. Сначала тест | Каждая функция логики — падающий тест → код; сквозные сценарии US1–US5 — новый сценарий `test_browser.py` | ✅ |
| V. Проверки не ослабляются | Прежние тесты и `scripts/check.sh` не меняются; новые тесты добавляются в конец файлов | ✅ |
| VI. Контракт до кода | Контракт v1.1 принят до плана; [contracts/](contracts/) ссылается на него; отклонение кода от контракта — дефект | ✅ |
| Ограничения: свой `mode` у экрана | `mode = "missions"`, как у гаража | ✅ |
| Ограничения: один ключ на область | `metro-rush-missions` отдельно от `metro-rush-garage` | ✅ |

Нарушений нет — раздел Complexity Tracking не заполняется.

**Повторная проверка после Phase 1**: data-model и contracts не вводят новых зависимостей, хранилищ
или обходов принципов; тестовые хуки (`setNow`, `refreshMissionsDay`) живут только в `window.__metro`
и не влияют на логику — ✅.

## Project Structure

### Documentation (this feature)

```text
specs/003-daily-missions/
├── spec.md              # сквозные сценарии (ссылки на 001, 002, контракт)
├── plan.md              # этот файл
├── research.md          # Phase 0: решения по реализации
├── data-model.md        # Phase 1: сущности, поля, переходы состояний
├── quickstart.md        # Phase 1: как проверить фичу целиком
├── contracts/
│   ├── README.md        # ссылка на общий контракт v1.1 (источник истины для стыка UI ↔ логика)
│   └── test-hooks.md    # интерфейс тестового хука window.__metro для сквозных проверок
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
specs/daily-missions-contract.md   # общий контракт v1.1 (согласован командами 001 и 002)
```

### Source Code (repository root = practices/practice_05)

```text
game.js          # + константы каталога видов и целей; + 11 функций контракта (раздел 3); экспорт
main.js          # + loadMissions/saveMissions, режим "missions", экран и кнопка, блок итогов,
                 #   предпросмотр в цикле, очередь всплывающих надписей, проверка дня в меню, хук
index.html       # + кнопка «Задания» в меню и на экране итогов, блок «Задания дня», <section id="missions">
styles.css       # + стили экрана, строк, полос прогресса, отметок «Награда!»/«Новые!», блока итогов
test_game.js     # + тесты логики заданий (в конец файла)
test_browser.py  # + сценарий 10 «Ежедневные задания» (существующие сценарии без изменений)
AGENTS.md        # + описание заданий в структуре и модели
```

**Structure Decision**: плоская структура существующего проекта (single project). Новых файлов кода
не появляется: логика — в `game.js` рядом с гаражом, связка — в `main.js`, как у гаража.

## Complexity Tracking

Не требуется — нарушений конституции нет.
