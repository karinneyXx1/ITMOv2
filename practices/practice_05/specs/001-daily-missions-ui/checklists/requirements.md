# Specification Quality Checklist: Ежедневные задания — интерфейс игрока

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

- Итерация валидации 1: в FR-010 было «в том же кадре взаимодействия» (деталь реализации) — заменено на «сразу, без перехода между экранами»; FR-013 переформулирован без ссылки на самого себя.
- Раздел «Что UI ожидает от логики» намеренно описывает потребности в данных и операциях (принцип VI конституции — вход в общий контракт); имена, форматы и алгоритмы не задаёт.
- Clarify, сессия 2026-10-19: маркеры FR-009 (награда забирается только на экране «Задания») и FR-016 (вчерашние награды автоматически зачисляются с сообщением) сняты, прогресс во время заезда — только всплывающая надпись. Обновлены US4-4, FR-009, FR-016, Edge Cases, SC-008, Assumptions и «Что UI ожидает от логики». Маркеров не осталось, все пункты чеклиста пройдены.
- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`
- Сверка с общим контрактом `specs/daily-missions-contract.md` (2026-10-19): ссылка на контракт в шапке. Раздел «Что UI ожидает от логики» заменён на «Что UI получает от логики (по контракту)» с операциями, полями, ключом хранилища и кодами ошибок. Обновлены US1–US5, Edge Cases, FR-001, FR-002, FR-005–FR-008, FR-010, FR-011, FR-013, FR-014–FR-018, FR-020–FR-023, Key Entities, SC-008, Assumptions. Решения владельца (награда только на экране «Задания», автозачисление, без панели в HUD) не менялись.
- Спорные места после сверки с v1.0 решены в контракте v1.1 (раздел 1.1): `unknown-mission` → общий текст (п. 14), меню актуализирует день (п. 15).
- Обновление под контракт v1.1 (2026-10-19): строка в Clarifications; правки в шапке, US4-5 (новый), FR-002, FR-011, FR-013, FR-016, FR-022, Edge Cases (полуночный заезд, откат часов), таблице операций и разделе ошибок. Маркеров нет, все пункты чеклиста пройдены.
- Открытые вопросы к v1.1 (вынесены человеку, в спеке не решались):
  1. Откат часов и таймер FR-018: набор из «будущего» дня остаётся действующим, а таймер `nextDayStart(now) − now` обещает «новые задания» в ближайшую местную полночь, хотя тогда набор не сменится.
  2. Откат часов и FR-013: при `state.day ≠ dayKey(now)` предпросмотр не вызывается, надписей в заезде нет. Но `applyRunToMissions` применит заезд к сохранённому набору, и на экране итогов задание окажется «Выполнено!» без надписи во время заезда.
