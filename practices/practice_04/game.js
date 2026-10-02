// game.js — игровая логика Race Mini
// Чистые функции, без обращения к DOM

const MAX_SPEED = 10;
const MIN_SPEED = 0;
const ACCELERATION = 0.5;
const BRAKE_POWER = 0.8;
const TURN_SPEED = 5;

// Валидные команды игрока
const VALID_COMMANDS = new Set(['accelerate', 'brake', 'left', 'right', 'none']);

/**
 * Входная валидация команды игрока
 * @param {*} command - команда для проверки
 * @throws {TypeError} если command не строка
 * @throws {RangeError} если command не из валидного набора
 */
function validateMove(command) {
  if (typeof command !== 'string') {
    throw new TypeError(`Command must be a string, got ${typeof command}`);
  }
  if (!VALID_COMMANDS.has(command)) {
    throw new RangeError(`Unknown command "${command}". Valid commands: ${[...VALID_COMMANDS].join(', ')}`);
  }
}

/**
 * Создаёт начальное состояние игры
 * @returns {Object} игровое состояние
 */
function createInitialState() {
  return {
    player: {
      x: 400,
      y: 500,
      speed: 0,
      angle: 0
    },
    gameOver: false,
    score: 0
  };
}

/**
 * Применяет команду игрока к состоянию
 * Чистая функция: не мутирует входное состояние
 * @param {Object} state - текущее состояние игры
 * @param {string} command - команда игрока
 * @returns {Object} новое состояние игры
 */
function applyMove(state, command) {
  validateMove(command); // первая строка — валидация ввода

  const newState = JSON.parse(JSON.stringify(state)); // deep clone
  const player = newState.player;

  switch (command) {
    case 'accelerate':
      player.speed = Math.min(player.speed + ACCELERATION, MAX_SPEED);
      break;
    case 'brake':
      player.speed = Math.max(player.speed - BRAKE_POWER, MIN_SPEED);
      break;
    case 'left':
      player.angle -= TURN_SPEED;
      break;
    case 'right':
      player.angle += TURN_SPEED;
      break;
    case 'none':
      // ничего не делаем
      break;
  }

  return newState;
}

/**
 * Обновляет физику (движение по углу)
 * @param {Object} state - текущее состояние
 * @returns {Object} новое состояние
 */
function updatePhysics(state) {
  const newState = JSON.parse(JSON.stringify(state));
  const player = newState.player;

  const radians = (player.angle * Math.PI) / 180;
  player.x += Math.sin(radians) * player.speed;
  player.y -= Math.cos(radians) * player.speed;

  return newState;
}

// CommonJS экспорт для тестов
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAX_SPEED,
    MIN_SPEED,
    ACCELERATION,
    BRAKE_POWER,
    TURN_SPEED,
    VALID_COMMANDS,
    validateMove,
    createInitialState,
    applyMove,
    updatePhysics
  };
}
