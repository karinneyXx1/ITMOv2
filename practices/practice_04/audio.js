// Metro Rush — звук. Всё синтезируется через Web Audio API, без аудиофайлов.
// Двигатель меняет тон от оборотов, короткие эффекты — на события игры.

function createSound() {
  let ctx = null;
  let master = null;
  let engine = null;
  let muted = false;
  let noiseBuffer = null;

  // AudioContext можно создать только после жеста пользователя (Enter/клик).
  function init() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const low = ctx.createOscillator();
    low.type = "sawtooth";
    const high = ctx.createOscillator();
    high.type = "square";
    const highGain = ctx.createGain();
    highGain.gain.value = 0.25;
    low.connect(filter);
    high.connect(highGain).connect(filter);
    filter.connect(gain).connect(master);
    low.start();
    high.start();
    engine = { low, high, filter, gain };

    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  function setEngine(rpmValue, gear, running) {
    if (!ctx || !engine) return;
    const t = ctx.currentTime;
    const r = Math.max(0, Math.min(1.1, rpmValue));
    const freq = 42 + r * 120 + gear * 7;
    engine.low.frequency.setTargetAtTime(freq, t, 0.04);
    engine.high.frequency.setTargetAtTime(freq * 2.01, t, 0.04);
    engine.filter.frequency.setTargetAtTime(500 + r * 1600, t, 0.05);
    engine.gain.gain.setTargetAtTime(running ? 0.07 + r * 0.06 : 0, t, 0.08);
  }

  function tone(freq, duration, { type = "square", volume = 0.2, slideTo = null, delay = 0 } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  function noise(duration, { volume = 0.3, from = 2000, to = 200 } = {}) {
    if (!ctx || !noiseBuffer) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(gain).connect(master);
    src.start(t);
    src.stop(t + duration);
  }

  return {
    init,
    setEngine,
    coin: () => tone(1320, 0.09, { type: "triangle", volume: 0.18, slideTo: 1980 }),
    jump: () => tone(240, 0.22, { type: "sine", volume: 0.25, slideTo: 620 }),
    lane: () => noise(0.08, { volume: 0.08, from: 3000, to: 1200 }),
    shift(quality) {
      if (quality === "perfect") {
        tone(660, 0.08, { volume: 0.16 });
        tone(990, 0.12, { volume: 0.16, delay: 0.07 });
      } else if (quality === "early" || quality === "overrev" || quality === "late") {
        tone(150, 0.18, { type: "sawtooth", volume: 0.18, slideTo: 90 });
      } else {
        tone(320, 0.06, { volume: 0.1 });
      }
    },
    nitro: () => noise(0.9, { volume: 0.35, from: 400, to: 4000 }),
    magnet: () => {
      tone(520, 0.1, { type: "triangle", volume: 0.2 });
      tone(780, 0.16, { type: "triangle", volume: 0.2, delay: 0.08 });
    },
    crash() {
      noise(0.6, { volume: 0.6, from: 1800, to: 80 });
      tone(110, 0.5, { type: "sawtooth", volume: 0.3, slideTo: 40 });
    },
    setMuted(value) {
      muted = value;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.02);
    },
    isMuted: () => muted,
  };
}
