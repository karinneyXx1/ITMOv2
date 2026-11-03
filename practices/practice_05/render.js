// Metro Rush — рендер. Только рисование на canvas, никакой игровой логики:
// читает мир (из game.js) и рисует псевдо-3D сцену с камерой за машиной.
// Стиль — граффити: жирная тёмно-синяя обводка, жёлто-оранжевые градиенты,
// стально-голубые "пузыри" (см. docs/DESIGN.md).

function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");

  const PALETTE = {
    ink: "#1c2541",
    inkSoft: "#2d3a5c",
    sunLight: "#fff27a",
    sun: "#ffd92e",
    flame: "#ff9a1f",
    ember: "#f2541b",
    steel: "#6f93c0",
    steelDeep: "#4a6c99",
    steelLight: "#a9c4e2",
    mist: "#d9e8f5",
    skyTop: "#5d8fd0",
    skyBottom: "#cfe4f6",
    gravel: "#8a8f9c",
    gravelDark: "#7a7f8d",
    bed: "#5d5550",
    sleeper: "#7a5a3c",
    rail: "#c9d3df",
    wall: "#b9b2a6",
    wallDark: "#a59d90",
    white: "#ffffff",
    go: "#3ddc84",
  };

  const TRAIN_LIVERIES = [
    { front: "#6f93c0", side: "#4a6c99", top: "#a9c4e2", stripe: "#ffd92e" },
    { front: "#ff9a1f", side: "#e0741a", top: "#ffc56b", stripe: "#1c2541" },
    { front: "#eef3f9", side: "#c9d5e3", top: "#ffffff", stripe: "#f2541b" },
  ];

  const CAM_BACK = 7.5;
  const CAM_HEIGHT = 4.4;
  const NEAR = 0.6;
  const DRAW_DIST = 190;
  const FOG_START = 70;
  const WALL_X = (LANES / 2) * LANE_WIDTH + 2.2;
  const WALL_HEIGHT = 3.6;
  const PANEL_LENGTH = 12;
  const SLEEPER_SPACING = 1.3;
  const BAND_LENGTH = 8;
  const GANTRY_SPACING = 64;

  const reducedMotion =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0;
  let H = 0;
  let horizonY = 0;
  let focal = 1;
  let cam = { x: 0, y: CAM_HEIGHT, z: 0 };
  const fogRgb = hexToRgb(PALETTE.skyBottom);
  const rgbCache = new Map();

  const particles = [];
  const speedLines = [];
  let shake = 0;

  // ---------- утилиты ----------

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbOf(hex) {
    let rgb = rgbCache.get(hex);
    if (!rgb) {
      rgb = hexToRgb(hex);
      rgbCache.set(hex, rgb);
    }
    return rgb;
  }

  // Смешивает цвет с цветом тумана в зависимости от дальности.
  function fog(hex, dz) {
    const f = Math.min(1, Math.max(0, (dz - FOG_START) / (DRAW_DIST - FOG_START)));
    if (f <= 0) return hex;
    const c = rgbOf(hex);
    const r = Math.round(c[0] + (fogRgb[0] - c[0]) * f);
    const g = Math.round(c[1] + (fogRgb[1] - c[1]) * f);
    const b = Math.round(c[2] + (fogRgb[2] - c[2]) * f);
    return `rgb(${r},${g},${b})`;
  }

  // Детерминированный хэш для декора (граффити на панелях и т.п.).
  function hash(n) {
    let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }

  function laneX(lane) {
    return (lane - (LANES - 1) / 2) * LANE_WIDTH;
  }

  function project(x, y, z) {
    const dz = z - cam.z;
    if (dz < NEAR - 1e-6) return null;
    const s = focal / dz;
    return { x: W / 2 + (x - cam.x) * s, y: horizonY + (cam.y - y) * s, s, dz };
  }

  function outlineWidth(s) {
    return Math.max(1, Math.min(4, s * 0.09));
  }

  function poly(points, fill, stroke, lineWidth) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  // Четырёхугольник на земле (y = const) между z0 и z1.
  function groundQuad(x0, x1, z0, z1, y, fill) {
    const zNear = Math.max(z0, cam.z + NEAR);
    if (z1 <= zNear) return;
    const a = project(x0, y, zNear);
    const b = project(x1, y, zNear);
    const c = project(x1, y, z1);
    const d = project(x0, y, z1);
    poly([a, b, c, d], fill);
  }

  /**
   * Параллелепипед в мировых координатах. faces: { front, side, top, stroke }.
   * Рисуются только грани, обращённые к камере. Возвращает проекцию передней грани
   * (она всегда параллельна экрану — удобно рисовать на ней детали).
   */
  function drawBox(x0, x1, y0, y1, z0, z1, faces) {
    const zFront = Math.max(z0, cam.z + NEAR);
    if (z1 <= zFront) return null;
    const dz = zFront - cam.z;
    const f00 = project(x0, y0, zFront);
    const f10 = project(x1, y0, zFront);
    const f11 = project(x1, y1, zFront);
    const f01 = project(x0, y1, zFront);
    const b00 = project(x0, y0, z1);
    const b10 = project(x1, y0, z1);
    const b11 = project(x1, y1, z1);
    const b01 = project(x0, y1, z1);
    const stroke = faces.stroke === undefined ? PALETTE.ink : faces.stroke;
    const lw = outlineWidth(f00.s);

    if (cam.x < x0) poly([f00, f01, b01, b00], fog(faces.side, dz), stroke, lw);
    if (cam.x > x1) poly([f10, f11, b11, b10], fog(faces.side, dz), stroke, lw);
    if (cam.y > y1) poly([f01, f11, b11, b01], fog(faces.top, dz), stroke, lw);
    const frontVisible = z0 >= cam.z + NEAR;
    if (frontVisible) poly([f00, f10, f11, f01], fog(faces.front, dz), stroke, lw);
    return frontVisible ? { left: f00.x, right: f10.x, top: f01.y, bottom: f00.y, s: f00.s, dz } : null;
  }

  // ---------- фон ----------

  function drawSky(time) {
    const g = ctx.createLinearGradient(0, 0, 0, horizonY);
    g.addColorStop(0, PALETTE.skyTop);
    g.addColorStop(1, PALETTE.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizonY + 2);

    // облака-пузыри (как пузыри фона у граффити-логотипа)
    const drift = reducedMotion ? 0 : time * 6;
    for (let i = 0; i < 6; i++) {
      const baseX = ((hash(i + 11) * W * 1.6 + drift * (0.4 + hash(i) * 0.6)) % (W * 1.6)) - W * 0.3;
      const baseY = horizonY * (0.15 + hash(i + 3) * 0.45);
      const size = Math.min(W, H) * (0.035 + hash(i + 7) * 0.035);
      drawBubbleCloud(baseX - cam.x * 2, baseY, size, i);
    }

    // силуэт города у горизонта — два слоя для глубины
    drawSkyline(0.55, PALETTE.steelLight, 1);
    drawSkyline(0.35, "#93b2d6", 2);
  }

  function drawBubbleCloud(cx, cy, size, seed) {
    const bubbles = [];
    for (let k = 0; k < 5; k++) {
      bubbles.push({
        x: cx + (k - 2) * size * 0.9 + (hash(seed * 31 + k) - 0.5) * size * 0.5,
        y: cy + (hash(seed * 17 + k) - 0.5) * size * 0.6 - (k === 2 ? size * 0.3 : 0),
        r: size * (0.6 + hash(seed * 7 + k) * 0.55),
      });
    }
    ctx.lineWidth = Math.max(2, size * 0.09);
    ctx.strokeStyle = PALETTE.steelDeep;
    for (const b of bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const b of bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.mist;
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (const b of bubbles) {
      ctx.beginPath();
      ctx.ellipse(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.28, b.r * 0.16, -0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSkyline(heightFactor, color, layer) {
    const parallax = cam.x * (layer === 1 ? 3 : 6);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, horizonY + 2);
    const step = W / 26;
    for (let i = -2; i < 30; i++) {
      const x = i * step - (parallax % step);
      const idx = i + Math.floor(parallax / step) + layer * 100;
      const h = horizonY * heightFactor * (0.25 + hash(idx) * 0.75) * 0.45;
      ctx.lineTo(x, horizonY - h);
      ctx.lineTo(x + step * 0.92, horizonY - h);
      ctx.lineTo(x + step * 0.92, horizonY - h * 0.6);
    }
    ctx.lineTo(W, horizonY + 2);
    ctx.closePath();
    ctx.fill();
  }

  // ---------- трасса ----------

  function drawGround() {
    const g = ctx.createLinearGradient(0, horizonY, 0, H);
    g.addColorStop(0, PALETTE.skyBottom);
    g.addColorStop(0.08, PALETTE.gravel);
    g.addColorStop(1, PALETTE.gravelDark);
    ctx.fillStyle = g;
    ctx.fillRect(0, horizonY, W, H - horizonY);

    const farZ = cam.z + DRAW_DIST;
    const halfWidth = WALL_X;

    // поперечные полосы гравия — дают ощущение скорости
    const firstBand = Math.floor(cam.z / BAND_LENGTH) * BAND_LENGTH;
    for (let z = firstBand; z < farZ; z += BAND_LENGTH) {
      if (Math.floor(z / BAND_LENGTH) % 2 === 0) {
        groundQuad(-halfWidth, halfWidth, z, z + BAND_LENGTH, 0, fog(PALETTE.gravelDark, z - cam.z));
      }
    }

    // насыпь под каждым путём
    for (let lane = 0; lane < LANES; lane++) {
      const cx = laneX(lane);
      groundQuad(cx - 1.15, cx + 1.15, cam.z, farZ, 0.01, PALETTE.bed);
    }

    // шпалы
    const sleeperFar = cam.z + 110;
    const first = Math.ceil((cam.z + NEAR) / SLEEPER_SPACING) * SLEEPER_SPACING;
    for (let z = sleeperFar; z >= first; z -= SLEEPER_SPACING) {
      const zz = Math.floor(z / SLEEPER_SPACING) * SLEEPER_SPACING;
      const color = fog(PALETTE.sleeper, zz - cam.z);
      for (let lane = 0; lane < LANES; lane++) {
        const cx = laneX(lane);
        groundQuad(cx - 1.0, cx + 1.0, zz, zz + 0.38, 0.02, color);
      }
    }

    // рельсы
    for (let lane = 0; lane < LANES; lane++) {
      const cx = laneX(lane);
      for (const off of [-0.62, 0.62]) {
        groundQuad(cx + off - 0.07, cx + off + 0.07, cam.z, farZ, 0.08, PALETTE.rail);
      }
    }
  }

  function drawWalls(time) {
    const farZ = cam.z + DRAW_DIST;
    const firstPanel = Math.floor(cam.z / PANEL_LENGTH);
    const lastPanel = Math.floor(farZ / PANEL_LENGTH);
    for (const side of [-1, 1]) {
      const x = side * WALL_X;
      for (let i = lastPanel; i >= firstPanel; i--) {
        const z0 = Math.max(i * PANEL_LENGTH, cam.z + NEAR);
        const z1 = (i + 1) * PANEL_LENGTH;
        if (z1 <= z0) continue;
        const dz = z0 - cam.z;
        const a = project(x, 0, z0);
        const b = project(x, WALL_HEIGHT, z0);
        const c = project(x, WALL_HEIGHT, z1);
        const d = project(x, 0, z1);
        const base = (i + (side > 0 ? 1 : 0)) % 2 === 0 ? PALETTE.wall : PALETTE.wallDark;
        poly([a, b, c, d], fog(base, dz), fog(PALETTE.inkSoft, dz), outlineWidth(a.s) * 0.6);
        // парапет сверху
        const e = project(x, WALL_HEIGHT + 0.35, z0);
        const f = project(x, WALL_HEIGHT + 0.35, z1);
        poly([b, e, f, c], fog(PALETTE.steelDeep, dz));

        const seed = i * 2 + (side > 0 ? 1 : 0);
        if (hash(seed) > 0.35 && dz < 140) {
          drawGraffiti(x, i * PANEL_LENGTH + PANEL_LENGTH / 2, seed, dz, time);
        }
      }
    }
  }

  // Абстрактный граффити-кусок на стене: облако пузырей + "буквы"-капли
  // с жёлто-оранжевым градиентом и толстой обводкой. Это не логотип и не надпись.
  function drawGraffiti(x, zc, seed, dz, time) {
    const pieces = [];
    const n = 3 + Math.floor(hash(seed + 5) * 3);
    for (let k = 0; k < n; k++) {
      pieces.push({
        z: zc + (k - (n - 1) / 2) * 1.7,
        y: 1.6 + hash(seed * 13 + k) * 0.5,
        r: 0.6 + hash(seed * 29 + k) * 0.35,
      });
    }
    const ref = project(x, 1.8, zc);
    if (!ref) return;
    const lw = outlineWidth(ref.s) * 0.9;
    ctx.lineJoin = "round";

    // пузыри-фон: эллипс, у которого ширина — реальная проекция отрезка стены
    for (const b of pieces) {
      const left = project(x, b.y + 0.3, b.z - b.r * 1.2);
      const right = project(x, b.y + 0.3, b.z + b.r * 1.2);
      if (!left || !right) continue;
      const cx = (left.x + right.x) / 2;
      const cy = (left.y + right.y) / 2;
      const rx = Math.max(1, Math.abs(right.x - left.x) / 2);
      const ry = b.r * 1.2 * (left.s + right.s) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = fog(PALETTE.steelLight, dz);
      ctx.fill();
      ctx.strokeStyle = fog(PALETTE.steelDeep, dz);
      ctx.lineWidth = lw;
      ctx.stroke();
    }

    // "буквы": четырёхугольники на плоскости стены с градиентом и толстой обводкой
    const hue = hash(seed + 99);
    const top = hue > 0.4 ? PALETTE.sunLight : PALETTE.mist;
    const bottom = hue > 0.4 ? PALETTE.ember : PALETTE.steelDeep;
    for (const b of pieces) {
      const halfW = b.r * 0.55;
      const y0 = b.y - b.r * 0.9;
      const y1 = b.y + b.r * 0.9 + hash(seed * 5 + b.z) * 0.4;
      const a = project(x, y0, b.z - halfW);
      const c = project(x, y1, b.z - halfW);
      const d = project(x, y1, b.z + halfW);
      const e = project(x, y0, b.z + halfW);
      if (!a || !d) continue;
      const grad = ctx.createLinearGradient(0, Math.min(c.y, d.y), 0, Math.max(a.y, e.y));
      grad.addColorStop(0, fog(top, dz));
      grad.addColorStop(0.45, fog(PALETTE.sun, dz));
      grad.addColorStop(1, fog(bottom, dz));
      poly([a, c, d, e], grad, fog(PALETTE.ink, dz), lw * 1.8);
      // блик по верхнему краю
      ctx.beginPath();
      ctx.moveTo(c.x + (d.x - c.x) * 0.2, c.y + (a.y - c.y) * 0.12);
      ctx.lineTo(c.x + (d.x - c.x) * 0.7, d.y + (e.y - d.y) * 0.12);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = lw * 0.8;
      ctx.stroke();
      // подтёк краски
      if (hash(seed * 3 + b.z) > 0.55) {
        const mid = project(x, y0, b.z);
        const drip = project(x, y0 - 0.5, b.z);
        if (mid && drip) {
          ctx.beginPath();
          ctx.moveTo(mid.x, mid.y);
          ctx.lineTo(drip.x, drip.y);
          ctx.strokeStyle = fog(PALETTE.ink, dz);
          ctx.lineWidth = lw * 1.4;
          ctx.lineCap = "round";
          ctx.stroke();
        }
      }
    }

    // блик-звёздочка
    if (hash(seed + 7) > 0.5) {
      const p = project(x, pieces[0].y + 1.3, pieces[0].z);
      const pulse = reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(time * 4 + seed);
      if (p) drawSparkle(p.x, p.y, p.s * 0.45 * pulse, "#ffffff");
    }
  }

  function gantryDrawables() {
    const list = [];
    const first = Math.ceil((cam.z + NEAR) / GANTRY_SPACING);
    const last = Math.floor((cam.z + DRAW_DIST) / GANTRY_SPACING);
    for (let i = first; i <= last; i++) list.push({ kind: "gantry", z: i * GANTRY_SPACING });
    return list;
  }

  function drawGantry(z) {
    const x0 = -WALL_X + 0.4;
    const x1 = WALL_X - 0.4;
    const post = { front: PALETTE.steelDeep, side: PALETTE.inkSoft, top: PALETTE.steel };
    drawBox(x0, x0 + 0.45, 0, 6.6, z, z + 0.45, post);
    drawBox(x1 - 0.45, x1, 0, 6.6, z, z + 0.45, post);
    const beam = drawBox(x0, x1, 6.0, 6.6, z, z + 0.45, { front: PALETTE.sun, side: PALETTE.flame, top: PALETTE.sunLight });
    if (beam) {
      // диагональные полосы на балке
      ctx.save();
      ctx.beginPath();
      ctx.rect(beam.left, beam.top, beam.right - beam.left, beam.bottom - beam.top);
      ctx.clip();
      ctx.fillStyle = fog(PALETTE.ink, beam.dz);
      const stripe = (beam.bottom - beam.top) * 1.6;
      for (let sx = beam.left - stripe; sx < beam.right; sx += stripe * 2) {
        ctx.beginPath();
        ctx.moveTo(sx, beam.bottom);
        ctx.lineTo(sx + stripe, beam.bottom);
        ctx.lineTo(sx + stripe * 1.6, beam.top);
        ctx.lineTo(sx + stripe * 0.6, beam.top);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ---------- объекты ----------

  function drawTrain(obj) {
    const cx = laneX(obj.lane);
    const livery = TRAIN_LIVERIES[obj.variant % TRAIN_LIVERIES.length];
    const x0 = cx - 1.2;
    const x1 = cx + 1.2;
    // колёсная тележка
    drawBox(x0 + 0.2, x1 - 0.2, 0, 0.5, obj.z + 0.4, obj.z + obj.length - 0.4, {
      front: PALETTE.inkSoft,
      side: PALETTE.ink,
      top: PALETTE.ink,
    });
    const front = drawBox(x0, x1, 0.45, 3.4, obj.z, obj.z + obj.length, livery);

    // окна на видимом борту
    const sideX = cam.x < x0 ? x0 : cam.x > x1 ? x1 : null;
    if (sideX !== null) {
      for (let wz = obj.z + 2; wz < obj.z + obj.length - 2; wz += 3.2) {
        const a = project(sideX, 1.8, wz);
        const b = project(sideX, 2.8, wz);
        const c = project(sideX, 2.8, wz + 2);
        const d = project(sideX, 1.8, wz + 2);
        if (!a || !c) continue;
        poly([a, b, c, d], fog(PALETTE.inkSoft, a.dz), fog(PALETTE.ink, a.dz), outlineWidth(a.s) * 0.7);
      }
      // полоса ливреи вдоль борта
      const s0 = project(sideX, 1.25, Math.max(obj.z, cam.z + NEAR));
      const s1 = project(sideX, 1.55, Math.max(obj.z, cam.z + NEAR));
      const s2 = project(sideX, 1.55, obj.z + obj.length);
      const s3 = project(sideX, 1.25, obj.z + obj.length);
      if (s0 && s2) poly([s0, s1, s2, s3], fog(livery.stripe, s0.dz));
    }

    if (front) {
      const w = front.right - front.left;
      const h = front.bottom - front.top;
      const lw = outlineWidth(front.s);
      // лобовое стекло
      ctx.beginPath();
      ctx.roundRect(front.left + w * 0.12, front.top + h * 0.12, w * 0.76, h * 0.36, w * 0.06);
      ctx.fillStyle = fog(PALETTE.inkSoft, front.dz);
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = fog(PALETTE.ink, front.dz);
      ctx.stroke();
      // блик
      ctx.beginPath();
      ctx.moveTo(front.left + w * 0.2, front.top + h * 0.44);
      ctx.lineTo(front.left + w * 0.34, front.top + h * 0.16);
      ctx.lineTo(front.left + w * 0.42, front.top + h * 0.16);
      ctx.lineTo(front.left + w * 0.28, front.top + h * 0.44);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fill();
      // полоса
      ctx.fillStyle = fog(livery.stripe, front.dz);
      ctx.fillRect(front.left, front.top + h * 0.58, w, h * 0.1);
      // фары
      for (const fx of [0.2, 0.8]) {
        ctx.beginPath();
        ctx.arc(front.left + w * fx, front.top + h * 0.8, w * 0.07, 0, Math.PI * 2);
        ctx.fillStyle = fog(PALETTE.sunLight, front.dz);
        ctx.fill();
        ctx.lineWidth = lw * 0.8;
        ctx.stroke();
      }
    }
  }

  function drawBarrier(obj) {
    const cx = laneX(obj.lane);
    const post = { front: PALETTE.inkSoft, side: PALETTE.ink, top: PALETTE.inkSoft };
    drawBox(cx - 1.0, cx - 0.8, 0, 1.1, obj.z, obj.z + 0.3, post);
    drawBox(cx + 0.8, cx + 1.0, 0, 1.1, obj.z, obj.z + 0.3, post);
    const board = drawBox(cx - 1.15, cx + 1.15, 0.55, 1.2, obj.z, obj.z + 0.25, {
      front: PALETTE.white,
      side: "#d9dee6",
      top: "#ffffff",
    });
    if (board) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(board.left, board.top, board.right - board.left, board.bottom - board.top);
      ctx.clip();
      ctx.fillStyle = fog(PALETTE.ember, board.dz);
      const stripe = (board.bottom - board.top) * 0.9;
      for (let sx = board.left - stripe * 2; sx < board.right; sx += stripe * 2) {
        ctx.beginPath();
        ctx.moveTo(sx, board.bottom);
        ctx.lineTo(sx + stripe, board.bottom);
        ctx.lineTo(sx + stripe * 2, board.top);
        ctx.lineTo(sx + stripe, board.top);
        ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = fog(PALETTE.ink, board.dz);
      ctx.lineWidth = outlineWidth(board.s);
      ctx.strokeRect(board.left, board.top, board.right - board.left, board.bottom - board.top);
    }
  }

  function drawCoin(obj, time) {
    const p = project(laneX(obj.lane), 0.9 + (obj.h || 0), obj.z);
    if (!p) return;
    const r = 0.5 * p.s;
    if (r < 0.6) return;
    const spin = reducedMotion ? 1 : Math.abs(Math.cos(time * 4 + obj.id * 0.7));
    const rx = Math.max(r * 0.12, r * spin);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, r, 0, 0, Math.PI * 2);
    const g = ctx.createLinearGradient(0, p.y - r, 0, p.y + r);
    g.addColorStop(0, fog(PALETTE.sunLight, p.dz));
    g.addColorStop(0.6, fog(PALETTE.sun, p.dz));
    g.addColorStop(1, fog(PALETTE.flame, p.dz));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = outlineWidth(p.s);
    ctx.strokeStyle = fog(PALETTE.ink, p.dz);
    ctx.stroke();
    if (rx > r * 0.4) {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rx * 0.55, r * 0.55, 0, 0, Math.PI * 2);
      ctx.lineWidth = outlineWidth(p.s) * 0.6;
      ctx.strokeStyle = fog(PALETTE.flame, p.dz);
      ctx.stroke();
    }
  }

  function drawMagnet(obj, time) {
    const bob = reducedMotion ? 0 : Math.sin(time * 3) * 0.15;
    const p = project(laneX(obj.lane), 1.3 + bob, obj.z);
    if (!p) return;
    const r = 0.55 * p.s;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(reducedMotion ? 0 : Math.sin(time * 2) * 0.25);
    ctx.lineCap = "butt";
    ctx.lineWidth = r * 0.55 + outlineWidth(p.s) * 2;
    ctx.strokeStyle = PALETTE.ink;
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, 0, true);
    ctx.stroke();
    ctx.lineWidth = r * 0.55;
    ctx.strokeStyle = PALETTE.ember;
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, 0, true);
    ctx.stroke();
    ctx.fillStyle = PALETTE.mist;
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = outlineWidth(p.s);
    for (const sx of [-1, 1]) {
      ctx.fillRect(sx * r - r * 0.3, -r * 0.45, r * 0.6, r * 0.45);
      ctx.strokeRect(sx * r - r * 0.3, -r * 0.45, r * 0.6, r * 0.45);
    }
    ctx.restore();
    drawSparkle(p.x + r * 1.2, p.y - r * 1.1, r * 0.5, "#ffffff");
  }

  function drawPlayer(player, time) {
    const x = laneX(player.x);
    const z = player.z;
    const lift = jumpHeight(player);

    // тень на земле
    const sh = project(x, 0, z);
    if (sh) {
      const k = 1 - lift / (JUMP_HEIGHT * 1.6);
      ctx.beginPath();
      ctx.ellipse(sh.x, sh.y, 1.1 * sh.s * k, 0.35 * sh.s * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(28,37,65,0.35)";
      ctx.fill();
    }

    const rear = project(x, lift, z - 1.7);
    if (!rear) return;
    ctx.save();
    // наклон при перестроении
    const tilt = (player.lane - player.x) * 0.12;
    ctx.translate(rear.x, rear.y);
    ctx.rotate(tilt);
    ctx.translate(-rear.x, -rear.y);

    const crashed = player.crashed;
    const body = crashed
      ? { front: "#8d93a3", side: "#6f7584", top: "#a6abb8" }
      : { front: PALETTE.flame, side: PALETTE.ember, top: PALETTE.sun };

    // колёса
    const wheel = { front: PALETTE.ink, side: PALETTE.inkSoft, top: PALETTE.inkSoft };
    for (const wx of [-0.95, 0.68]) {
      drawBox(x + wx, x + wx + 0.27, lift, lift + 0.6, z + 0.8, z + 1.5, wheel);
      drawBox(x + wx, x + wx + 0.27, lift, lift + 0.6, z - 1.5, z - 0.8, wheel);
    }
    // кузов
    const back = drawBox(x - 0.9, x + 0.9, lift + 0.22, lift + 0.95, z - 1.7, z + 1.7, body);
    // кабина
    const cabin = drawBox(x - 0.68, x + 0.68, lift + 0.95, lift + 1.5, z - 0.6, z + 0.9, {
      front: PALETTE.inkSoft,
      side: PALETTE.ink,
      top: crashed ? "#a6abb8" : PALETTE.sunLight,
    });
    if (cabin) {
      const w = cabin.right - cabin.left;
      const h = cabin.bottom - cabin.top;
      ctx.beginPath();
      ctx.moveTo(cabin.left + w * 0.15, cabin.bottom - h * 0.15);
      ctx.lineTo(cabin.left + w * 0.3, cabin.top + h * 0.2);
      ctx.lineTo(cabin.left + w * 0.4, cabin.top + h * 0.2);
      ctx.lineTo(cabin.left + w * 0.25, cabin.bottom - h * 0.15);
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fill();
    }
    // низкий спойлер-губа на крышке багажника
    drawBox(x - 0.85, x + 0.85, lift + 0.95, lift + 1.08, z - 1.7, z - 1.2, {
      front: PALETTE.ink,
      side: PALETTE.ink,
      top: PALETTE.inkSoft,
    });

    if (back) {
      const w = back.right - back.left;
      const h = back.bottom - back.top;
      const lw = outlineWidth(back.s);
      // градиент "граффити" на задней панели
      const g = ctx.createLinearGradient(0, back.top, 0, back.bottom);
      g.addColorStop(0, crashed ? "#a6abb8" : PALETTE.sunLight);
      g.addColorStop(0.45, crashed ? "#8d93a3" : PALETTE.sun);
      g.addColorStop(1, crashed ? "#6f7584" : PALETTE.ember);
      ctx.fillStyle = g;
      ctx.fillRect(back.left, back.top, w, h);
      ctx.lineWidth = lw;
      ctx.strokeStyle = PALETTE.ink;
      ctx.strokeRect(back.left, back.top, w, h);
      // стоп-сигналы
      const bright = player.braking && !crashed;
      for (const fx of [0.08, 0.72]) {
        ctx.beginPath();
        ctx.roundRect(back.left + w * fx, back.top + h * 0.22, w * 0.2, h * 0.28, h * 0.08);
        ctx.fillStyle = bright ? "#ff3b3b" : "#b3202a";
        if (bright) {
          ctx.shadowColor = "#ff3b3b";
          ctx.shadowBlur = 18;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = lw * 0.8;
        ctx.stroke();
      }
      // номер-наклейка
      ctx.fillStyle = PALETTE.white;
      ctx.fillRect(back.left + w * 0.38, back.top + h * 0.58, w * 0.24, h * 0.24);
      ctx.strokeRect(back.left + w * 0.38, back.top + h * 0.58, w * 0.24, h * 0.24);

      // пламя нитро из выхлопа
      if (player.nitroT > 0 && !crashed) {
        const flick = reducedMotion ? 1 : 0.75 + Math.random() * 0.5;
        for (const fx of [0.3, 0.7]) {
          const ex = back.left + w * fx;
          const ey = back.bottom - h * 0.1;
          const len = h * 1.2 * flick;
          const fg = ctx.createLinearGradient(ex, ey, ex, ey + len);
          fg.addColorStop(0, "#ffffff");
          fg.addColorStop(0.3, "#8fd3ff");
          fg.addColorStop(1, "rgba(79,140,255,0)");
          ctx.beginPath();
          ctx.moveTo(ex - w * 0.06, ey);
          ctx.lineTo(ex + w * 0.06, ey);
          ctx.lineTo(ex, ey + len);
          ctx.closePath();
          ctx.fillStyle = fg;
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // кольцо магнита
    if (player.magnetT > 0 && !crashed) {
      const p = project(x, lift + 0.8, z);
      if (p) {
        const pulse = reducedMotion ? 0 : Math.sin(time * 6) * 0.1;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, (1.6 + pulse) * p.s, (0.9 + pulse) * p.s, 0, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(242,84,27,0.55)";
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // ---------- эффекты ----------

  function drawSparkle(x, y, size, color) {
    if (size < 1) return;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.quadraticCurveTo(x, y, x + size, y);
    ctx.quadraticCurveTo(x, y, x, y + size);
    ctx.quadraticCurveTo(x, y, x - size, y);
    ctx.quadraticCurveTo(x, y, x, y - size);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function burst(kind, worldPos) {
    const p = project(laneX(worldPos.lane), 0.9 + (worldPos.h || 0), worldPos.z);
    const sx = p ? p.x : W / 2;
    const sy = p ? p.y : H * 0.7;
    const count = kind === "crash" ? 34 : 8;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (kind === "crash" ? 260 : 140) * (0.4 + Math.random());
      particles.push({
        kind,
        x: sx,
        y: sy,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - (kind === "crash" ? 180 : 60),
        life: kind === "crash" ? 1.1 : 0.5,
        age: 0,
        size: kind === "crash" ? 6 + Math.random() * 10 : 6 + Math.random() * 6,
        color:
          kind === "crash"
            ? [PALETTE.ink, PALETTE.flame, PALETTE.sun, "#8d93a3"][i % 4]
            : i % 2
              ? PALETTE.sunLight
              : "#ffffff",
      });
    }
  }

  function updateAndDrawParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.kind === "crash" ? 700 : 200) * dt;
      const k = 1 - p.age / p.life;
      if (p.kind === "coin") {
        drawSparkle(p.x, p.y, p.size * k, p.color);
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.age * 8);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
        ctx.restore();
      }
    }
  }

  function updateAndDrawSpeedLines(player, dt) {
    if (reducedMotion) return;
    const intensity = Math.max(0, (player.speed - 18) / 20) + (player.nitroT > 0 ? 0.6 : 0);
    if (!player.crashed && Math.random() < intensity * 1.6) {
      const a = Math.random() * Math.PI * 2;
      speedLines.push({ a, r: Math.max(W, H) * (0.18 + Math.random() * 0.1), age: 0 });
    }
    const cx = W / 2;
    const cy = horizonY;
    ctx.lineCap = "round";
    for (let i = speedLines.length - 1; i >= 0; i--) {
      const l = speedLines[i];
      l.age += dt;
      l.r += (900 + player.speed * 40) * dt;
      if (l.r > Math.max(W, H) * 1.1) {
        speedLines.splice(i, 1);
        continue;
      }
      const len = 60 + player.speed * 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(l.a) * l.r, cy + Math.sin(l.a) * l.r * 0.8);
      ctx.lineTo(cx + Math.cos(l.a) * (l.r + len), cy + Math.sin(l.a) * (l.r + len) * 0.8);
      ctx.strokeStyle = `rgba(255,255,255,${0.55 * Math.min(1, intensity)})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  function drawVignette(player) {
    const nitro = player.nitroT > 0;
    const g = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.75);
    g.addColorStop(0, "rgba(28,37,65,0)");
    g.addColorStop(1, nitro ? "rgba(79,140,255,0.35)" : "rgba(28,37,65,0.35)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------- публичный API ----------

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function addShake(amount) {
    if (!reducedMotion) shake = Math.max(shake, amount);
  }

  /**
   * Рисует кадр. world — состояние из game.js, time — секунды с начала, dt — шаг кадра.
   */
  function draw(world, time, dt) {
    const player = world.player;
    const speedFactor = Math.min(1, player.speed / (GEARS[GEARS.length - 1].max + NITRO_SPEED_BONUS));
    horizonY = H * 0.36;
    focal = Math.min(W * 0.5, H * 0.78) * (1 - speedFactor * 0.12);
    const targetX = laneX(player.x) * 0.65;
    cam = {
      x: targetX,
      y: CAM_HEIGHT + jumpHeight(player) * 0.35,
      z: player.z - CAM_BACK,
    };

    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      shake = Math.max(0, shake - dt * 40);
    }

    drawSky(time);
    drawGround();
    drawWalls(time);

    const drawables = gantryDrawables();
    for (const obj of world.objects) {
      if (obj.z + (obj.length || 0) < cam.z + NEAR || obj.z > cam.z + DRAW_DIST) continue;
      drawables.push({ kind: obj.type, z: obj.z, obj });
    }
    drawables.push({ kind: "player", z: player.z - 1.7 });
    drawables.sort((a, b) => b.z - a.z);

    ctx.lineJoin = "round";
    for (const d of drawables) {
      if (d.kind === "gantry") drawGantry(d.z);
      else if (d.kind === "train") drawTrain(d.obj);
      else if (d.kind === "barrier") drawBarrier(d.obj);
      else if (d.kind === "coin") drawCoin(d.obj, time);
      else if (d.kind === "magnet") drawMagnet(d.obj, time);
      else if (d.kind === "player") drawPlayer(player, time);
    }

    updateAndDrawSpeedLines(player, dt);
    updateAndDrawParticles(dt);
    drawVignette(player);
    ctx.restore();
  }

  resize();
  return { resize, draw, burst, addShake, laneX };
}
