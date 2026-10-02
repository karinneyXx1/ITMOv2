// test_game.js — юнит-тесты для game.js
// Использует встроенные node:test и node:assert

const { test } = require('node:test');
const assert = require('node:assert');
const {
  MAX_SPEED,
  MIN_SPEED,
  ACCELERATION,
  BRAKE_POWER,
  validateMove,
  createInitialState,
  applyMove,
  updatePhysics
} = require('./game.js');

// ========== Тесты validateMove ==========

test('validateMove: accepts valid "accelerate" command', () => {
  assert.doesNotThrow(() => validateMove('accelerate'));
});

test('validateMove: accepts valid "brake" command', () => {
  assert.doesNotThrow(() => validateMove('brake'));
});

test('validateMove: accepts valid "left" command', () => {
  assert.doesNotThrow(() => validateMove('left'));
});

test('validateMove: accepts valid "right" command', () => {
  assert.doesNotThrow(() => validateMove('right'));
});

test('validateMove: accepts valid "none" command', () => {
  assert.doesNotThrow(() => validateMove('none'));
});

test('validateMove: throws TypeError on non-string (number)', () => {
  assert.throws(
    () => validateMove(123),
    { name: 'TypeError', message: /must be a string/ }
  );
});

test('validateMove: throws TypeError on non-string (null)', () => {
  assert.throws(
    () => validateMove(null),
    { name: 'TypeError' }
  );
});

test('validateMove: throws TypeError on non-string (undefined)', () => {
  assert.throws(
    () => validateMove(undefined),
    { name: 'TypeError' }
  );
});

test('validateMove: throws RangeError on unknown command', () => {
  assert.throws(
    () => validateMove('jump'),
    { name: 'RangeError', message: /Unknown command/ }
  );
});

test('validateMove: throws RangeError on empty string', () => {
  assert.throws(
    () => validateMove(''),
    { name: 'RangeError' }
  );
});

// ========== Тесты createInitialState ==========

test('createInitialState: returns valid initial state', () => {
  const state = createInitialState();
  assert.strictEqual(typeof state, 'object');
  assert.strictEqual(typeof state.player, 'object');
  assert.strictEqual(state.player.speed, 0);
  assert.strictEqual(state.gameOver, false);
});

test('createInitialState: is pure (multiple calls return independent objects)', () => {
  const state1 = createInitialState();
  const state2 = createInitialState();
  state1.player.speed = 5;
  assert.strictEqual(state2.player.speed, 0);
});

// ========== Тесты applyMove ==========

test('applyMove: accelerate increases speed by ACCELERATION', () => {
  const state = createInitialState();
  const newState = applyMove(state, 'accelerate');
  assert.strictEqual(newState.player.speed, ACCELERATION);
  // оригинал не изменился
  assert.strictEqual(state.player.speed, 0);
});

test('applyMove: accelerate stops at MAX_SPEED', () => {
  const state = createInitialState();
  state.player.speed = MAX_SPEED - 0.1;
  const newState = applyMove(state, 'accelerate');
  assert.strictEqual(newState.player.speed, MAX_SPEED);
});

test('applyMove: accelerate does not exceed MAX_SPEED', () => {
  const state = createInitialState();
  state.player.speed = MAX_SPEED;
  const newState = applyMove(state, 'accelerate');
  assert.strictEqual(newState.player.speed, MAX_SPEED);
});

test('applyMove: brake decreases speed by BRAKE_POWER', () => {
  const state = createInitialState();
  state.player.speed = 5;
  const newState = applyMove(state, 'brake');
  assert.strictEqual(newState.player.speed, 5 - BRAKE_POWER);
});

test('applyMove: brake stops at MIN_SPEED', () => {
  const state = createInitialState();
  state.player.speed = 0.5;
  const newState = applyMove(state, 'brake');
  assert.strictEqual(newState.player.speed, MIN_SPEED);
});

test('applyMove: brake does not go below MIN_SPEED', () => {
  const state = createInitialState();
  state.player.speed = 0;
  const newState = applyMove(state, 'brake');
  assert.strictEqual(newState.player.speed, MIN_SPEED);
});

test('applyMove: left decreases angle', () => {
  const state = createInitialState();
  const initialAngle = state.player.angle;
  const newState = applyMove(state, 'left');
  assert.ok(newState.player.angle < initialAngle);
});

test('applyMove: right increases angle', () => {
  const state = createInitialState();
  const initialAngle = state.player.angle;
  const newState = applyMove(state, 'right');
  assert.ok(newState.player.angle > initialAngle);
});

test('applyMove: none does not change state', () => {
  const state = createInitialState();
  state.player.speed = 5;
  state.player.angle = 45;
  const newState = applyMove(state, 'none');
  assert.strictEqual(newState.player.speed, 5);
  assert.strictEqual(newState.player.angle, 45);
});

test('applyMove: is pure (does not mutate input state)', () => {
  const state = createInitialState();
  const originalSpeed = state.player.speed;
  applyMove(state, 'accelerate');
  assert.strictEqual(state.player.speed, originalSpeed);
});

test('applyMove: throws on invalid command', () => {
  const state = createInitialState();
  assert.throws(
    () => applyMove(state, 'fly'),
    { name: 'RangeError' }
  );
});

// ========== Тесты updatePhysics ==========

test('updatePhysics: moves player forward when speed > 0 and angle = 0', () => {
  const state = createInitialState();
  state.player.speed = 5;
  state.player.angle = 0;
  const initialY = state.player.y;
  const newState = updatePhysics(state);
  assert.ok(newState.player.y < initialY); // движение вверх (y уменьшается)
});

test('updatePhysics: does not move when speed = 0', () => {
  const state = createInitialState();
  state.player.speed = 0;
  const initialX = state.player.x;
  const initialY = state.player.y;
  const newState = updatePhysics(state);
  assert.strictEqual(newState.player.x, initialX);
  assert.strictEqual(newState.player.y, initialY);
});

test('updatePhysics: is pure (does not mutate input state)', () => {
  const state = createInitialState();
  state.player.speed = 5;
  const originalY = state.player.y;
  updatePhysics(state);
  assert.strictEqual(state.player.y, originalY);
});

console.log('\n✅ Все тесты пройдены успешно!\n');
