// Тесты звуковой системы Metro Rush (audio.js). Проверяют поведение при
// сбое Web Audio API: отсутствие конструктора, блокировка браузером, таймаут.
// Запуск: node test_audio.js

const test = require("node:test");
const assert = require("node:assert/strict");

const SOUND_START_TIMEOUT_MS = 2000;

// Подменяем window для тестов в Node.js
function setupWindow(audioContextMock) {
  global.window = audioContextMock ? { AudioContext: audioContextMock } : {};
  // Очищаем require-кэш, чтобы audio.js перечитался с новым window
  delete require.cache[require.resolve("./audio.js")];
}

function cleanup() {
  delete global.window;
  const audioModule = require.cache[require.resolve("./audio.js")];
  if (audioModule && audioModule.exports._resetForTests) {
    audioModule.exports._resetForTests();
  }
  delete require.cache[require.resolve("./audio.js")];
}

test("initSound: unsupported — нет AudioContext в браузере", async () => {
  setupWindow(null);
  const { initSound } = require("./audio.js");

  const result = await initSound();

  assert.equal(result.status, "unsupported");
  assert.equal(result.message, "Звук недоступен: браузер не поддерживает Web Audio. Игра продолжится без звука.");
  cleanup();
});

test("initSound: blocked — конструктор AudioContext бросает исключение", async () => {
  setupWindow(function MockAudioContext() {
    throw new Error("NotAllowedError");
  });
  const { initSound } = require("./audio.js");

  const result = await initSound();

  assert.equal(result.status, "blocked");
  assert.equal(result.message, "Звук недоступен: браузер запретил воспроизведение. Игра продолжится без звука.");
  cleanup();
});

test("initSound: blocked — resume() бросает исключение", async () => {
  setupWindow(function MockAudioContext() {
    this.state = "suspended";
    this.resume = () => Promise.reject(new Error("NotAllowedError"));
    this.createGain = () => ({ gain: { value: 0 }, connect: () => {} });
    this.createBiquadFilter = () => ({ type: "", frequency: { value: 0 }, connect: () => ({}) });
    this.createOscillator = () => ({
      type: "",
      frequency: { setTargetAtTime: () => {} },
      connect: () => ({}),
      start: () => {}
    });
    this.createBuffer = () => null;
    this.sampleRate = 44100;
    this.destination = {};
  });
  const { initSound } = require("./audio.js");

  const result = await initSound();

  assert.equal(result.status, "blocked");
  assert.equal(result.message, "Звук недоступен: браузер запретил воспроизведение. Игра продолжится без звука.");
  cleanup();
});

test("initSound: timeout — контекст не переходит в running за 2 секунды", async () => {
  setupWindow(function MockAudioContext() {
    this.state = "suspended";
    // resume() никогда не завершается
    this.resume = () => new Promise(() => {});
    this.createGain = () => ({ gain: { value: 0 }, connect: () => {} });
    this.createBiquadFilter = () => ({ type: "", frequency: { value: 0 }, connect: () => ({}) });
    this.createOscillator = () => ({
      type: "",
      frequency: { setTargetAtTime: () => {} },
      connect: () => ({}),
      start: () => {}
    });
    this.createBuffer = () => null;
    this.sampleRate = 44100;
    this.destination = {};
  });
  const { initSound } = require("./audio.js");

  const start = Date.now();
  const result = await initSound();
  const elapsed = Date.now() - start;

  assert.equal(result.status, "timeout");
  assert.equal(result.message, "Звук не включился за 2 секунды. Игра продолжится без звука.");
  assert.ok(elapsed >= SOUND_START_TIMEOUT_MS - 100, `должен ждать ~2000 мс, но ждал ${elapsed} мс`);
  assert.ok(elapsed < SOUND_START_TIMEOUT_MS + 500, `не должен ждать дольше 2500 мс, но ждал ${elapsed} мс`);
  cleanup();
});

test("initSound: available — нормальный AudioContext переходит в running", async () => {
  setupWindow(function MockAudioContext() {
    this.state = "suspended";
    this.currentTime = 0;
    this.resume = () => {
      this.state = "running";
      return Promise.resolve();
    };
    this.createGain = () => ({
      gain: { value: 0, setTargetAtTime: () => {} },
      connect: () => {}
    });
    this.createBiquadFilter = () => ({
      type: "",
      frequency: { value: 0, setTargetAtTime: () => {} },
      connect: () => ({})
    });
    this.createOscillator = () => ({
      type: "",
      frequency: { setTargetAtTime: () => {} },
      connect: () => ({}),
      start: () => {}
    });
    this.createBuffer = (channels, length, rate) => ({
      getChannelData: () => new Float32Array(length)
    });
    this.sampleRate = 44100;
    this.destination = {};
  });
  const { initSound } = require("./audio.js");

  const start = Date.now();
  const result = await initSound();
  const elapsed = Date.now() - start;

  assert.equal(result.status, "available");
  assert.ok(elapsed < 500, `должен завершиться быстро, но ждал ${elapsed} мс`);
  cleanup();
});

test("createSound с доступным звуком не бросает при вызове эффектов", () => {
  setupWindow(function MockAudioContext() {
    this.state = "running";
    this.currentTime = 0;
    this.resume = () => Promise.resolve();
    this.createGain = () => ({
      gain: { value: 0, setTargetAtTime: () => {}, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: () => ({})
    });
    this.createBiquadFilter = () => ({
      type: "",
      frequency: { value: 0, setTargetAtTime: () => {}, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      Q: { value: 0 },
      connect: () => ({})
    });
    this.createOscillator = () => ({
      type: "",
      frequency: { setTargetAtTime: () => {}, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: () => ({}),
      start: () => {},
      stop: () => {}
    });
    this.createBufferSource = () => ({
      buffer: null,
      connect: () => ({}),
      start: () => {},
      stop: () => {}
    });
    this.createBuffer = (channels, length, rate) => ({
      getChannelData: () => new Float32Array(length)
    });
    this.sampleRate = 44100;
    this.destination = {};
  });

  const { createSound } = require("./audio.js");
  const sound = createSound();

  // Все эти вызовы не должны бросать исключений
  assert.doesNotThrow(() => sound.coin());
  assert.doesNotThrow(() => sound.jump());
  assert.doesNotThrow(() => sound.lane());
  assert.doesNotThrow(() => sound.shift("perfect"));
  assert.doesNotThrow(() => sound.nitro());
  assert.doesNotThrow(() => sound.magnet());
  assert.doesNotThrow(() => sound.crash());
  assert.doesNotThrow(() => sound.setEngine(0.5, 3, true));

  cleanup();
});

test("звуковой эффект, который бросает исключение, не пробрасывает его наружу", () => {
  setupWindow(function MockAudioContext() {
    this.state = "running";
    this.currentTime = 0;
    this.resume = () => Promise.resolve();
    this.createGain = () => {
      throw new Error("Эффект сломан");
    };
    this.createBiquadFilter = () => ({
      type: "",
      frequency: { value: 0 },
      connect: () => ({})
    });
    this.createOscillator = () => ({
      type: "",
      frequency: { setTargetAtTime: () => {} },
      connect: () => ({}),
      start: () => {}
    });
    this.createBuffer = () => null;
    this.sampleRate = 44100;
    this.destination = {};
  });

  const { createSound } = require("./audio.js");
  const sound = createSound();

  // Вызов эффекта с поломанным AudioContext не должен бросить исключение наружу
  assert.doesNotThrow(() => sound.coin());
  assert.doesNotThrow(() => sound.jump());

  cleanup();
});

test("initSound возвращает тот же контекст, который будет использовать createSound", async () => {
  let createdContexts = [];
  setupWindow(function MockAudioContext() {
    const ctx = this;
    createdContexts.push(ctx);
    this.state = "suspended";
    this.currentTime = 0;
    this.resume = () => {
      this.state = "running";
      return Promise.resolve();
    };
    this.createGain = () => ({
      gain: { value: 0, setTargetAtTime: () => {} },
      connect: () => {}
    });
    this.createBiquadFilter = () => ({
      type: "",
      frequency: { value: 0, setTargetAtTime: () => {} },
      connect: () => ({})
    });
    this.createOscillator = () => ({
      type: "",
      frequency: { setTargetAtTime: () => {} },
      connect: () => ({}),
      start: () => {}
    });
    this.createBuffer = (channels, length, rate) => ({
      getChannelData: () => new Float32Array(length)
    });
    this.sampleRate = 44100;
    this.destination = {};
  });

  const { initSound, createSound } = require("./audio.js");

  const result = await initSound();
  assert.equal(result.status, "available");

  const sound = createSound();
  sound.init();

  // Должен быть создан только один AudioContext
  assert.equal(createdContexts.length, 1, "должен быть создан только один AudioContext");

  cleanup();
});

test("повторный вызов initSound не создаёт новый контекст", async () => {
  let createdContexts = [];
  setupWindow(function MockAudioContext() {
    createdContexts.push(this);
    this.state = "suspended";
    this.currentTime = 0;
    this.resume = () => {
      this.state = "running";
      return Promise.resolve();
    };
    this.createGain = () => ({
      gain: { value: 0, setTargetAtTime: () => {} },
      connect: () => {}
    });
    this.createBiquadFilter = () => ({
      type: "",
      frequency: { value: 0, setTargetAtTime: () => {} },
      connect: () => ({})
    });
    this.createOscillator = () => ({
      type: "",
      frequency: { setTargetAtTime: () => {} },
      connect: () => ({}),
      start: () => {}
    });
    this.createBuffer = (channels, length, rate) => ({
      getChannelData: () => new Float32Array(length)
    });
    this.sampleRate = 44100;
    this.destination = {};
  });

  const { initSound } = require("./audio.js");

  await initSound();
  await initSound();

  assert.equal(createdContexts.length, 1, "повторный initSound не должен создавать новый контекст");

  cleanup();
});

test("setEngine не бросает исключение при сбое", () => {
  setupWindow(function MockAudioContext() {
    this.state = "running";
    this.currentTime = 0;
    this.resume = () => Promise.resolve();
    this.createGain = () => ({
      gain: {
        value: 0,
        setTargetAtTime: () => { throw new Error("setTargetAtTime сломан"); }
      },
      connect: () => {}
    });
    this.createBiquadFilter = () => ({
      type: "",
      frequency: { value: 0, setTargetAtTime: () => {} },
      connect: () => ({})
    });
    this.createOscillator = () => ({
      type: "",
      frequency: { setTargetAtTime: () => {} },
      connect: () => ({}),
      start: () => {}
    });
    this.createBuffer = (channels, length, rate) => ({
      getChannelData: () => new Float32Array(length)
    });
    this.sampleRate = 44100;
    this.destination = {};
  });

  const { createSound } = require("./audio.js");
  const sound = createSound();
  sound.init();

  // setEngine вызывается каждый кадр — не должен бросать исключение
  assert.doesNotThrow(() => sound.setEngine(0.5, 3, true));
  assert.doesNotThrow(() => sound.setEngine(0.8, 4, true));

  cleanup();
});

test("таймаут очищается после успешного resume", async () => {
  let timeoutCleared = false;
  const originalClearTimeout = global.clearTimeout;
  global.clearTimeout = (id) => {
    if (id) timeoutCleared = true;
    return originalClearTimeout(id);
  };

  setupWindow(function MockAudioContext() {
    this.state = "suspended";
    this.currentTime = 0;
    this.resume = () => {
      this.state = "running";
      return Promise.resolve();
    };
    this.createGain = () => ({
      gain: { value: 0, setTargetAtTime: () => {} },
      connect: () => {}
    });
    this.createBiquadFilter = () => ({
      type: "",
      frequency: { value: 0, setTargetAtTime: () => {} },
      connect: () => ({})
    });
    this.createOscillator = () => ({
      type: "",
      frequency: { setTargetAtTime: () => {} },
      connect: () => ({}),
      start: () => {}
    });
    this.createBuffer = (channels, length, rate) => ({
      getChannelData: () => new Float32Array(length)
    });
    this.sampleRate = 44100;
    this.destination = {};
  });

  const { initSound } = require("./audio.js");

  await initSound();

  assert.ok(timeoutCleared, "таймаут должен быть очищен после успешного resume");

  global.clearTimeout = originalClearTimeout;
  cleanup();
});

test("ошибка звука логируется только один раз на весь модуль", () => {
  const logs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logs.push(args.join(" "));

  setupWindow(function MockAudioContext() {
    this.state = "running";
    this.currentTime = 0;
    this.resume = () => Promise.resolve();
    this.createGain = () => {
      throw new Error("Сломан");
    };
    this.createBiquadFilter = () => ({
      type: "",
      frequency: { value: 0 },
      connect: () => ({})
    });
    this.createOscillator = () => ({
      type: "",
      frequency: { setTargetAtTime: () => {} },
      connect: () => ({}),
      start: () => {}
    });
    this.createBuffer = () => null;
    this.createBufferSource = () => {
      throw new Error("Сломан");
    };
    this.sampleRate = 44100;
    this.destination = {};
  });

  const { createSound } = require("./audio.js");
  const sound = createSound();
  sound.init();

  // Несколько вызовов разных эффектов
  sound.coin();
  sound.jump();
  sound.nitro(); // noise
  sound.crash(); // noise + tone
  sound.setEngine(0.5, 3, true);

  // Должна быть только одна запись об ошибке
  assert.equal(logs.length, 1, `ошибка должна быть записана один раз, но записана ${logs.length} раз(а)`);

  console.error = originalConsoleError;
  cleanup();
});
