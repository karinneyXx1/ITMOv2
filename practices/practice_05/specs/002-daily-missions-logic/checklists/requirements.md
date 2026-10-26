# Specification Quality Checklist: Ежедневные задания — логика

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-19
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Clarify, сессия 2026-10-19: сняты все 3 маркера — FR-016 (незабранная награда автоматически
  зачисляется при смене дня, логика возвращает сумму), FR-003 (ровно 3 вида, по одному в день,
  модель расширяема), FR-005 / Assumptions (фиксированные 20/40/60, без бонуса). Конкретные числа
  целей и наград остаются допущением до отдельной проверки баланса.
- Спека логики по заданию команды включает раздел «Интерфейс логики (поведение)»: это описание
  операций на уровне входов/выходов/отказов без имён функций и формы вызова — оставлено намеренно
  для сверки с UI-спекой (конституция, принцип VI). Упоминания «ошибка типа / ошибка диапазона»
  отражают принцип II конституции, а не выбор технологии.
- Итерация валидации 1: SC-001 переформулирован в проверяемый вид (смежные дни различаются),
  добавлено требование различия соседних дней в FR-004; из Assumptions убрано имя ключа хранилища.
- Согласование с общим контрактом `specs/daily-missions-contract.md` (2026-10-19): в шапку и раздел
  «Интерфейс логики» добавлена ссылка на контракт, таблица операций приведена к разделу 3
  (точные имена функций по контракту — осознанное отступление от «без деталей реализации»:
  принцип VI конституции требует, чтобы спека совпадала с контрактом). Обновлены FR-001, FR-002,
  FR-005, FR-007, FR-009, FR-010, FR-011…016, FR-017…022; добавлены FR-010a, FR-016a…c, FR-021a,
  User Story 5 («Новые!» / `seen`), сценарии previewCompleted, nextDayStart, stale-day, SC-006.
  Повторная валидация: все пункты проходят.
- Контракт v1.1 (2026-10-19, решения 10–14): обновлены FR-011, FR-013, FR-016a (`stale-day` только
  при дне в id раньше текущего; часы назад — награда как обычно), FR-018 (набор «из будущего»
  остаётся), FR-021/FR-021a (тип → `TypeError`, значение → `RangeError`, `code: "invalid-input"`),
  сценарии US3-4, US3-6, US6-5, пограничные случаи (часы назад, заезд через полночь, неверные итоги),
  таблица интерфейса, строка в Clarifications. Повторная валидация: все пункты проходят.
