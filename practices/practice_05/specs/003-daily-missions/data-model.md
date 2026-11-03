# Data Model: Ежедневные задания

Поля и форматы — по разделу 2 [контракта v1.1](../daily-missions-contract.md); здесь — правила
проверки и переходы состояний для реализации.

## Каталог видов (`MISSION_TYPES`, константа `game.js`)

| type | Источник в итогах заезда | Цели по уровням (0/1/2) |
|---|---|---|
| `coins` | `world.coins` | 60 / 150 / 300 |
| `perfectShifts` | `world.perfectShifts` | 3 / 8 / 12 |
| `distance` | `Math.floor(world.player.z)` | 1000 / 3000 / 6000 |

Награды по уровню (`MISSION_REWARDS`): 20 / 40 / 60.

## Задание (Mission)

| Поле | Тип | Правило |
|---|---|---|
| `id` | string | `"<day>:<type>"` |
| `type` | string | из каталога |
| `level` | 0 \| 1 \| 2 | из правил набора дня |
| `target` | int > 0 | `MISSION_TYPES[type].targets[level]` (не из сохранения) |
| `reward` | int > 0 | `MISSION_REWARDS[level]` (не из сохранения) |
| `progress` | int | `0 ≤ progress ≤ target`; из сохранения: не целое/отрицательное → 0, больше цели → цель |
| `claimed` | boolean | из сохранения: не boolean → `false` |

Производное: `completed = progress === target`.

### Переходы состояния задания
```
Не начато (0) ──заезд──▶ В процессе (0<p<t) ──заезд──▶ Выполнено (p=t, !claimed)
      │                                                     │
      └───────────────заезд, итог ≥ цели───────────────────▶│
                                                            ├──claimMissionReward──▶ Получено (claimed)
                                                            └──смена дня──▶ автозачисление, набор заменён
```

## Состояние дня (MissionsState)

| Поле | Тип | Правило |
|---|---|---|
| `day` | `"YYYY-MM-DD"` | реальная дата; из сохранения неверная → новый набор на `day` |
| `missions` | Mission[3] | ровно coins, perfectShifts, distance в этом порядке, id соответствуют `day`; иначе новый набор |
| `seen` | boolean | `false` у нового набора; `markMissionsSeen` → `true` |

Переходы: `ensureMissionDay` при `day > state.day` → новый набор (`seen: false`), автозачисление
незабранных выполненных; при `day ≤ state.day` → без изменений.

## Итоги заезда (RunResults)

`{ coins, perfectShifts, distance }` — целые ≥ 0. Не число (или не объект) → `TypeError`
(`invalid-input`); отрицательное или дробное число → `RangeError` (`invalid-input`).

## Хранилище

`localStorage["metro-rush-missions"] = JSON.stringify(MissionsState)`. Чтение — `parseMissions`
(никогда не бросает при корректном `day`; набор с днём позже `day` остаётся действующим).
